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
from typing import Generic, Optional, Sequence, TypeVar, Union

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

def check_plan(plan: Sequence[Op], known_ids: frozenset) -> None:
    """Everything about a plan that can be checked without a session.

    Three rules, all raising before any write:

      * every `Existing` names a node in the corpus. Previously unchecked — an
        id that resolved to nothing reached commit and failed as an invariant
        violation pointing at a uuid found nowhere.
      * every `New` is bound by an op EARLIER in the plan. Covers both an
        unbound key and a use that precedes its binding.
      * every binding is referenced by something. A created node no op
        references is attached to nothing, which is extraction without
        attachment — observed twice in practice (an empty-corpus seed, and
        separately a populated corpus) that prompt instruction alone did not
        prevent the model treating attachment as optional.

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
    orphans = sorted(seen - used)
    if orphans:
        problems.append(
            f"{len(orphans)} new node(s) no op references -- not attached to "
            f"anything, existing or new: {orphans}")
    if problems:
        raise PlanError("; ".join(problems))


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
