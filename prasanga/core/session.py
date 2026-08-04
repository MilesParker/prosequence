#!/usr/bin/env python3
"""The writer session the agent constructs a graph through (Directive 1d).

The harness opens a session by binding current head. The agent then calls ops
and, once, `commit()`. There is no open, no close, no patch object — patches are
not inputs here.

State is a single reference to the current corpus version (a frozen
`yaml_io.Corpus`). Every write op rebinds it to a new version that shares
every unchanged node; nodes are never mutated. Reads see uncommitted writes, so
`add_claim` -> `add_inference` -> `neighborhood` composes during construction.

Validation runs only at `commit()` — mid-construction states legitimately
violate invariants (an inference whose target is not added yet, a not-yet-cited
claim). There is no incremental validation anywhere in this module.

Ids are minted here, not by the pure ops: the session touches the clock and a
monotonic counter (UUIDv7, matching the corpus migration), passes the id into
the pure function, and returns it to the agent.

One session, one commit. Every op — read or write — raises once the session is
closed, and a session closes on its single `commit()` whether that commit
succeeds or fails.
"""
from __future__ import annotations

import difflib
import uuid
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Sequence

import yaml

from . import ops as _ops
from .corpus_store import CorpusStore, HeadMoved, WorkingTreeDirty
from .yaml_io import (
    Attribution,
    Claim,
    Corpus,
    Inference,
    Relation,
    load,
    serialize,
)
from .validate import check


# --------------------------------------------------------------------------
# Distinguishable commit failures. HeadMoved / WorkingTreeDirty are the store's
# own types, re-exported so a caller catches all three off this module. Each is
# terminal: no commit is created, the session dies, and further ops raise. They
# are distinguishable so the harness can *log* them apart — not so the session
# can respond to them (there is no repair path anywhere here).
# --------------------------------------------------------------------------

__all__ = [
    "Session",
    "ValidationFailed",
    "HeadMoved",
    "WorkingTreeDirty",
    "SessionClosed",
    "SessionDiff",
]


class ValidationFailed(Exception):
    """Raised by commit() when invariants I1-I8 do not hold at serialize time.

    Carries the specific violations (the `check()` error strings) for the log.
    No commit is created.
    """

    def __init__(self, violations: Sequence[str]):
        self.violations = list(violations)
        super().__init__(
            f"{len(self.violations)} invariant violation(s):\n  "
            + "\n  ".join(self.violations)
        )


class SessionClosed(RuntimeError):
    """Raised by any op or a second commit() after the session has closed."""


@dataclass(frozen=True)
class SessionDiff:
    """Output of `Session.diff()`: the recorded op lines plus a unified diff of
    the bound version against the current version. Nothing consumes one in
    order to execute it — it exists to be read (the Stage 3 gate reviews it)."""

    ops: tuple
    patch: str


# --------------------------------------------------------------------------
# Id minting. UUIDv7 is a 48-bit clock prefix plus a monotonic counter, which
# is exactly "a clock and a monotonic counter"; it also matches the ids the
# corpus migration produced. Owned by the session so ops stay pure.
# --------------------------------------------------------------------------

class _Minter:
    def __init__(self):
        self._last = ""

    def mint(self) -> str:
        new = str(uuid.uuid7())
        # uuid7 is monotonic within a process; assert it so a regression in the
        # clock source surfaces here rather than as a silent ordering bug.
        if new <= self._last:
            raise RuntimeError("uuid minter went backwards")
        self._last = new
        return new


# --------------------------------------------------------------------------
# The session.
# --------------------------------------------------------------------------

class Session:
    def __init__(self, store: CorpusStore, corpus: str):
        """Bind current head of `corpus` in `store`. This is the whole 'open'."""
        self._store = store
        self._name = corpus
        self._bound_head = store.head()
        self._bound_version = load(store.read(corpus, self._bound_head))
        # Canonical bytes of the bound version, captured once, for diff() and
        # for the frozen-state guarantee (the bound version never changes).
        self._bound_serialized = serialize(self._bound_version)
        self._version = self._bound_version
        self._minter = _Minter()
        self._records: List[dict] = []
        self._closed = False
        self._sha: Optional[str] = None

    # -- lifecycle guard ---------------------------------------------------

    def _ensure_open(self):
        if self._closed:
            raise SessionClosed(
                "session is closed (one session commits once); no further ops"
            )

    @property
    def bound_version(self) -> Corpus:
        """The version bound at session start. Never changes after ops run."""
        return self._bound_version

    @property
    def sha(self) -> Optional[str]:
        """The commit sha, once commit() has succeeded; otherwise None."""
        return self._sha

    # -- write ops ---------------------------------------------------------

    def add_claim(
        self,
        text: str,
        tag: str,
        attribution: Optional[Attribution] = None,
        terminal: bool = False,
    ) -> str:
        self._ensure_open()
        cid = self._minter.mint()
        self._version = _ops.add_claim(
            self._version,
            id=cid,
            text=text,
            tag=tag,
            attribution=attribution,
            terminal=terminal,
        )
        self._records.append({"kind": "add_claim", "id": cid, "tag": tag})
        return cid

    def add_inference(
        self,
        grounds: Sequence[str],
        warrants: Sequence[str],
        target: str,
        relation: Relation,
    ) -> str:
        self._ensure_open()
        iid = self._minter.mint()
        self._version = _ops.add_inference(
            self._version,
            id=iid,
            grounds=grounds,
            warrants=warrants,
            target=target,
            relation=relation,
        )
        self._records.append(
            {
                "kind": "add_inference",
                "id": iid,
                "relation": relation,
                "target": target,
            }
        )
        return iid

    def revise_claim(
        self, id: str, text: Optional[str] = None, tag: Optional[str] = None
    ) -> None:
        self._ensure_open()
        self._version = _ops.revise_claim(self._version, id, text=text, tag=tag)
        fields = [f for f, v in (("text", text), ("tag", tag)) if v is not None]
        self._records.append({"kind": "revise_claim", "id": id, "fields": fields})

    # -- read ops (see the in-progress version, not head) ------------------

    def get(self, id: str):
        self._ensure_open()
        return self._version.node(id)

    def neighborhood(self, id: str, hops: int) -> Dict[str, object]:
        """Nodes within `hops` undirected edges of `id`, keyed by uuid.

        Edges are inference<->ground, inference<->warrant, inference<->target.
        The seed is included when it resolves; dangling references (a target
        not added yet) simply do not appear."""
        self._ensure_open()
        adj: Dict[str, set] = {}

        def link(a: str, b: str):
            adj.setdefault(a, set()).add(b)
            adj.setdefault(b, set()).add(a)

        for inf in self._version.inferences:
            for c in inf.grounds:
                link(inf.id, c)
            for w in inf.warrants:
                link(inf.id, w)
            link(inf.id, inf.target)

        seen = {id}
        frontier = {id}
        for _ in range(max(hops, 0)):
            nxt = set()
            for n in frontier:
                nxt |= adj.get(n, set()) - seen
            if not nxt:
                break
            seen |= nxt
            frontier = nxt

        out: Dict[str, object] = {}
        for nid in seen:
            node = self._version.node(nid)
            if node is not None:
                out[nid] = node
        return out

    def find_by_tag(self, tag: str) -> List[Claim]:
        """Claims carrying `tag` (only claims have a tag)."""
        self._ensure_open()
        return sorted(
            (c for c in self._version.claims if c.tag == tag), key=lambda c: c.id
        )

    def concludes(self, id: str) -> List[Inference]:
        """Inferences whose target is `id` with relation concludes."""
        self._ensure_open()
        return self._targeting(id, Relation.CONCLUDES)

    def contesting(self, id: str) -> List[Inference]:
        """Inferences whose target is `id` with relation contests."""
        self._ensure_open()
        return self._targeting(id, Relation.CONTESTS)

    def _targeting(self, id: str, relation: Relation) -> List[Inference]:
        return sorted(
            (
                inf
                for inf in self._version.inferences
                if inf.target == id and inf.relation == relation
            ),
            key=lambda i: i.id,
        )

    def grounds_citing(self, id: str) -> List[Inference]:
        """Inferences that cite `id` in their grounds."""
        self._ensure_open()
        return sorted(
            (inf for inf in self._version.inferences if id in inf.grounds),
            key=lambda i: i.id,
        )

    def warrants_citing(self, id: str) -> List[Inference]:
        """Inferences that cite `id` in their warrants."""
        self._ensure_open()
        return sorted(
            (inf for inf in self._version.inferences if id in inf.warrants),
            key=lambda i: i.id,
        )

    # -- commit ------------------------------------------------------------

    def commit(self, summary: str) -> str:
        """Serialize, validate (I1-I8), write through the store, return the sha.

        Behaves like a database commit. The session closes the moment commit is
        entered, so any outcome — success or any of the three terminal failures
        — leaves the session dead with no commit-and-retry path.
        """
        self._ensure_open()
        self._closed = True  # any outcome closes the session

        text = serialize(self._version)

        errs, _warns = check(yaml.safe_load(text), self._name)
        if errs:
            raise ValidationFailed(errs)

        message = self._render_message(summary)
        # Store guards (HeadMoved / WorkingTreeDirty) run before any write, so a
        # failure here also creates no commit.
        sha = self._store.commit(
            self._name, text, message, parent_sha=self._bound_head
        )
        self._sha = sha
        return sha

    # -- diff / message rendering -----------------------------------------

    def diff(self) -> SessionDiff:
        """The recorded op lines plus a unified diff of bound vs current."""
        current = serialize(self._version)
        patch = "".join(
            difflib.unified_diff(
                self._bound_serialized.splitlines(keepends=True),
                current.splitlines(keepends=True),
                fromfile=f"{self._name}@{self._bound_head[:12]}",
                tofile=f"{self._name}@session",
            )
        )
        return SessionDiff(ops=tuple(self._op_lines()), patch=patch)

    @staticmethod
    def _rel_word(relation) -> str:
        return relation.value if isinstance(relation, Relation) else str(relation)

    def _tag_of(self, node_id: str) -> str:
        node = self._version.node(node_id)
        return getattr(node, "tag", "?") if node is not None else "?"

    def _op_lines(self) -> List[str]:
        """Render the recorded ops. Generated from records, never the agent —
        tags and the target-tag lookup resolve against the final version so a
        same-session revision is reflected."""
        lines = []
        for r in self._records:
            kind = r["kind"]
            if kind == "add_claim":
                lines.append(f'add_claim {r["id"]} "{r["tag"]}"')
            elif kind == "add_inference":
                lines.append(
                    f'add_inference {r["id"]} {self._rel_word(r["relation"])} '
                    f'{r["target"]} "{self._tag_of(r["target"])}"'
                )
            elif kind == "revise_claim":
                fields = " ".join(r["fields"])
                lines.append(
                    f'revise_claim {r["id"]} "{self._tag_of(r["id"])}" {fields}'.rstrip()
                )
        return lines

    def _render_message(self, summary: str) -> str:
        op_lines = self._op_lines()
        body = [
            f"{self._name}: {len(self._records)} ops — {summary}",
            "",
            f"bound: {self._bound_head}",
            "ops:",
        ]
        body.extend(f"  {line}" for line in op_lines)
        return "\n".join(body) + "\n"
