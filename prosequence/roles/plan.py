#!/usr/bin/env python3
"""Session writes, reified — the op, the reference, and the plan they form.

A role's apply step used to call `session.add_claim(...)` directly, and
capability was a set of METHOD NAMES enforced by a proxy that intercepted
attribute access. Both are gone. An op is now an object: a frozen dataclass
carrying its parameters, generic in what applying it yields
(`AddClaim(Op[ClaimId])`, `ReviseClaim(Op[None])`). A capability is a set of op
TYPES, and enforcement is `type(op) in capability` — a containment check over
data, run across the whole plan before the first write lands.

That removes the proxy, the WRITE_OPS name mirror, and every string from the
enforcement path. It also splits apply in two: building the plan is pure and
needs no session (`apply.plan_from_finding`), executing it is the only thing
that touches the corpus.

## References and identity

Ids are minted by the session at add time — nothing has a uuid before the thing
it names exists. So an op cannot carry the id of a node the same plan creates;
it carries a REFERENCE, and the two kinds are distinct types:

    New("c1")        a name in this plan's local scope, bound when the op that
                     creates it runs
    Existing(uuid)   the identity of a node already in the corpus

This is the load-bearing distinction. The previous resolver was
`key_to_uuid.get(ref, ref)` — a ref that was not a known key fell through AS a
uuid, so a mistyped key was indistinguishable from a corpus id and surfaced far
downstream as an invariant failure naming a uuid that appeared nowhere. With the
kinds separated, `New` with no binding and `Existing` not in the corpus are both
errors, at plan time, with the bad ref named.

`Ref[ClaimId]` also says what the reference points AT. `AddInference.target` is
a `Ref[ClaimId]`, which makes "contests targets a claim, never an inference"
unrepresentable rather than merely forbidden in prose.

`ClaimId`/`InferenceId` mirror the branded id types in `src/types.ts`; the model
is unchanged, this just stops the harness being looser than the schema it
serves.

## Ordering

A plan is executable only in an order where every `New` is bound before it is
used. `check_plan` enforces exactly that rather than relying on the
claims-then-inferences ordering the builder happens to produce — that ordering
works only because the two current op types partition cleanly (claims bind and
never reference, inferences reference and never bind), which stops holding the
moment a third op does both.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import ClassVar, Generic, Optional, Sequence, TypeVar, Union

# The branded ids are declared once, in the model mirror, and imported here —
# not redefined. The model's own dataclasses do not yet use them (see "Known
# divergences" in types.py); this op layer does.
from ..core.types import ArgumentScheme, Attribution, ClaimId, InferenceId, Relation
from .capability import check_capability

T = TypeVar("T")
T_co = TypeVar("T_co", covariant=True)


class PlanError(Exception):
    """A plan that cannot be executed as written: a reference that resolves to
    nothing, a binding used before it is created, or a created node nothing
    references. Raised before any session write. Terminal."""


# --------------------------------------------------------------------------
# References
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class New(Generic[T]):
    """A node this plan creates, named by a local key. Not an id — the id does
    not exist until the op that binds this key runs."""
    key: str


@dataclass(frozen=True)
class Existing(Generic[T]):
    """A node already in the corpus, by its minted id."""
    id: T


Ref = Union[New[T], Existing[T]]

# Local key -> the id minted for it, built up as a plan executes.
Env = dict[str, ClaimId]


def resolve(ref: Ref[ClaimId], env: Env) -> ClaimId:
    """A reference to the id it names. `Existing` is already an id; `New` must
    have been bound by an earlier op in the same plan."""
    if isinstance(ref, Existing):
        return ref.id
    bound = env.get(ref.key)
    if bound is None:
        raise PlanError(
            f"reference to {ref.key!r} but nothing in this plan bound it "
            f"(bound so far: {sorted(env)})")
    return bound


# --------------------------------------------------------------------------
# Ops
# --------------------------------------------------------------------------

class Op(Generic[T_co]):
    """One session write. Generic in what applying it yields: an id for the ops
    that mint one, None for the ops that do not."""

    #: Whether this op's references ATTACH the claims they name — bind them into
    #: the argument structure, as an inference's grounds/warrants/target do.
    #: `check_plan`'s orphan rule counts only these, so an op that merely says
    #: something ABOUT a claim (`DesignateThesis`) cannot pass a claim off as
    #: attached. Without the distinction, one designation in a finding of
    #: thirty unconnected claims would demote the fatal "nothing is attached"
    #: case to a survivable note. A ClassVar, not a field: the subclasses are
    #: frozen dataclasses, and an annotated attribute there would become a
    #: constructor argument.
    attaches: ClassVar[bool] = True

    def apply(self, session, env: Env) -> T_co:
        """Perform the write. `env` resolves this op's `New` references; the
        return is whatever the session minted (see the class parameter)."""
        raise NotImplementedError

    def refs(self) -> tuple[Ref[ClaimId], ...]:
        """Every reference this op consumes. Drives `check_plan`."""
        return ()

    def binds(self) -> Optional[str]:
        """The local key this op's minted id binds, or None if it mints
        nothing. Only ops that yield an id can bind."""
        return None


@dataclass(frozen=True)
class AddClaim(Op[ClaimId]):
    key: str
    tag: str
    text: str
    terminal: bool = False
    attribution: Optional[Attribution] = None

    def binds(self) -> str:
        return self.key

    def apply(self, session, env: Env) -> ClaimId:
        return ClaimId(session.add_claim(
            text=self.text,
            tag=self.tag,
            attribution=self.attribution,
            terminal=self.terminal,
        ))


@dataclass(frozen=True)
class AddInference(Op[InferenceId]):
    grounds: tuple[Ref[ClaimId], ...]
    warrants: tuple[Ref[ClaimId], ...]
    target: Ref[ClaimId]
    relation: Relation
    scheme: ArgumentScheme
    scheme_descriptor: Optional[str] = None

    def refs(self) -> tuple[Ref[ClaimId], ...]:
        return (*self.grounds, *self.warrants, self.target)

    def apply(self, session, env: Env) -> InferenceId:
        return InferenceId(session.add_inference(
            grounds=[resolve(g, env) for g in self.grounds],
            warrants=[resolve(w, env) for w in self.warrants],
            target=resolve(self.target, env),
            relation=self.relation,
            scheme=self.scheme,
            scheme_descriptor=self.scheme_descriptor,
        ))


@dataclass(frozen=True)
class DesignateThesis(Op[None]):
    """Add a claim to `theses` — the claims designated as the contested
    questions the space is about.

    Held by NO role. It was granted to ingestion, on the argument that a
    document arguing FROM the standing thesis to a further claim had nowhere to
    record the consequent — it landed as an unconcluded node, warned as a GAP-6
    gap, and sank in the graph view because depth is a BFS from `theses`. The
    grant outlived the prompt paragraph that governed it, and what it actually
    produced was each source document's own headline claim promoted to a corpus
    question. Designation is curatorial: it says what the corpus is about, which
    is not a judgement a single document supports. The op stays declared, like
    `ReviseClaim`, so the op universe is the session's whole write surface —
    ready for a role that promotes an existing claim on purpose.

    `attaches = False`: designating a claim says something about it, it does not
    bind it into any inference. A claim that is only designated is still an
    orphan as far as `check_plan` is concerned, which is correct — a thesis with
    no argument reaching it has extracted nothing.

    `target` is a `Ref[ClaimId]`, so a later role can promote an existing claim.
    No finding path produces this op any more — the per-claim `thesis` flag is
    off the wire (see `apply.ops_from_finding`), so no model-authored plan can
    contain one at all.
    """
    attaches = False

    target: Ref[ClaimId]

    def refs(self) -> tuple[Ref[ClaimId], ...]:
        return (self.target,)

    def apply(self, session, env: Env) -> None:
        session.designate_thesis(resolve(self.target, env))


@dataclass(frozen=True)
class ReviseClaim(Op[None]):
    """Not held by ingestion (see `IngestionRole.capability`). Declared here so
    the op universe is the session's write surface, not just the subset one role
    happens to use."""
    target: Ref[ClaimId]
    text: Optional[str] = None
    tag: Optional[str] = None

    def refs(self) -> tuple[Ref[ClaimId], ...]:
        return (self.target,)

    def apply(self, session, env: Env) -> None:
        session.revise_claim(
            resolve(self.target, env), text=self.text, tag=self.tag)


# --------------------------------------------------------------------------
# The plan
# --------------------------------------------------------------------------

def prune_unresolvable(
    plan: Sequence[Op], known_ids: frozenset,
) -> tuple[tuple[Op, ...], list[str]]:
    """Drop inferences that cite something which does not exist. Returns
    (plan, notes).

    An `Existing` ref is any ref that is not a key the finding declared, so a
    key the model CITED BUT NEVER DECLARED arrives here indistinguishable from a
    corpus uuid — and fails as "id not in the corpus". Two invented keys, one
    inference each, were enough to discard 22 claims and 11 sound inferences.
    The edge is genuinely broken and unrecoverable (there is no text anywhere
    from which to mint the missing claim), but it is one edge, and the rest of
    the finding is unaffected by it.

    This runs BEFORE `check_plan`, which is what keeps that ordering meaningful
    rather than breaking it: check_plan's job is to guarantee that every
    reference resolves before repair is allowed to start dropping things, and it
    still does. This only removes the edges that would have made it refuse,
    and only when doing so leaves something behind.

    THE SYSTEMIC CASE IS LEFT ALONE. If every inference in the plan cites
    something unresolvable, nothing is pruned and the plan is returned untouched
    so `check_plan` raises naming the refs. A wholesale reference failure is a
    broken finding, not a few bad edges, and the accurate error is the one that
    names what did not resolve — not a downstream complaint that no claim ended
    up attached.
    """
    def unresolved(op: Op) -> list[str]:
        return [str(r.id) for r in op.refs()
                if isinstance(r, Existing) and r.id not in known_ids]

    doomed = {n: bad for n, op in enumerate(plan)
              if isinstance(op, AddInference) and (bad := unresolved(op))}
    if not doomed:
        return tuple(plan), []

    total = sum(1 for op in plan if isinstance(op, AddInference))
    if len(doomed) >= total:
        return tuple(plan), []      # systemic — let check_plan report it

    notes = [f"inference dropped: cites {', '.join(repr(b) for b in bad)}, "
             f"which is neither a claim this finding declares nor a node in "
             f"the corpus" for bad in doomed.values()]
    return tuple(op for n, op in enumerate(plan) if n not in doomed), notes


def check_plan(plan: Sequence[Op], known_ids: frozenset) -> list[str]:
    """Everything about a plan that can be checked without a session.

    Returns notes on what is odd but survivable; raises `PlanError` on what is
    not. Two rules are fatal, and both are fatal because the plan cannot be
    executed or repaired as written:

      * every `Existing` names a node in the corpus. Previously unchecked — an
        id that resolved to nothing reached commit and failed as an invariant
        violation pointing at a uuid found nowhere.
      * every `New` is bound by an op EARLIER in the plan. Covers both an
        unbound key and a use that precedes its binding.

    Orphans split by degree, and the split is the point:

      * SOME new claims unattached — a NOTE. Repair depends on this being legal,
        since dropping an inference to satisfy an invariant is exactly how it
        creates orphans on purpose. I1-I10 have no rule against them either, so
        the graph commits and validates clean.
      * EVERY new claim unattached — FATAL. A finding with no inference
        referencing anything it created has extracted no argument, only
        sentences, and most of what it produces cannot be salvaged later:
        grounds-claims are attributive by the attributive discipline, and an
        attributive claim with nothing to ground is an orphan quote. Observed
        at 22 attributive out of 30.

    Failing the second case is cheap now in a way it was not before: salvage
    writes the graph AND the finding to logs/failed/ ahead of the raise, so the
    run's output survives for inspection and nothing is lost by refusing to
    commit it. The loud failure is what keeps a prompt defect visible instead of
    letting it accumulate as corpus sediment — which matters because the corpus
    would not show it: GAP-6 skips terminal and attributive claims, so an
    unattached grounds-claim leaves no trace in the graph at all. That is also
    why the surviving note exists for the partial case.

    GRAPH invariants are not checked here; the session validates the whole graph
    at commit (I1-I10). These are structural facts about the plan itself.
    """
    seen: set[str] = set()
    used: set[str] = set()
    unknown: list[str] = []
    unbound: list[str] = []

    for op in plan:
        for r in op.refs():
            if isinstance(r, Existing):
                if r.id not in known_ids:
                    unknown.append(str(r.id))
            else:
                # `attaches` gates only the orphan tally — a `New` must be
                # bound by an earlier op whatever the op does with it.
                if op.attaches:
                    used.add(r.key)
                if r.key not in seen:
                    unbound.append(r.key)
        key = op.binds()
        if key is not None:
            seen.add(key)

    problems: list[str] = []
    if unknown:
        problems.append(
            f"{len(unknown)} reference(s) to ids not in the corpus: {unknown}")
    if unbound:
        problems.append(
            f"{len(unbound)} reference(s) to keys nothing creates earlier in "
            f"the plan: {unbound}")

    if problems:
        raise PlanError("; ".join(problems))

    orphans = sorted(seen - used)
    if not orphans:
        return []

    # Nothing attached to anything. The claims may each be sound, but a finding
    # with no inference in it has extracted no ARGUMENT — and most of what it
    # produces is unrecoverable rather than merely unfinished: grounds-claims
    # are attributive by the attributive discipline, and an attributive claim
    # with no inference to ground is an orphan quote. In one such run 22 of 30
    # were attributive. Failing costs nothing now that salvage writes the graph
    # and the finding to logs/failed/ first, and the loud failure is what makes
    # the prompt defect visible instead of accumulating as corpus sediment.
    if seen and len(orphans) == len(seen):
        raise PlanError(
            f"none of the {len(seen)} new claims is attached -- the finding "
            f"extracted content and connected none of it (no inference "
            f"references any new claim): {orphans}")

    # Some attached, some not: a miss, not a systemic failure. Recorded and
    # carried into the commit message, because the corpus mostly will not show
    # it — GAP-6 skips terminal and attributive claims, so an unattached
    # grounds-claim leaves no trace in the graph at all.
    return [f"claim {key!r} added unattached -- no inference references it "
            f"(legal, and warned as a GAP-6 gap by the validator)"
            for key in orphans]


def execute(session, plan: Sequence[Op], capability: Sequence[type[Op]]) -> tuple:
    """Run a plan against the session, returning the ops executed.

    Capability is checked across the WHOLE plan first, so a plan containing one
    op the role does not hold writes nothing at all — the old proxy refused at
    the offending call, after earlier ops had already landed in the session.

    Ids are minted by the session as each op runs and bound into `env` for the
    ops that follow. Nothing here formats a description of what happened: the
    session records its own ops and renders them in `Session._op_lines()`,
    generated from records rather than authored by the caller.
    """
    check_capability(plan, capability)
    env: Env = {}
    for op in plan:
        minted = op.apply(session, env)
        key = op.binds()
        if key is not None:
            env[key] = minted
    return tuple(plan)
