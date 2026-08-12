#!/usr/bin/env python3
"""Dropping the inferences that would make a commit fail, before it is made.

A run that builds 45 claims and 36 inferences and loses all of it to three bad
edges is failing far harder than the defect warrants. Repair keeps the workable
graph: it predicts the corpus the plan would produce, reads the invariant
violations off it, drops the inferences implicated in them, and returns a plan
that commits cleanly.

## What is dropped, and what is never dropped

ONLY inferences. Claims are never removed — they are the extracted content, they
cannot themselves violate an invariant (every I1-I10 error names an inference or
a thesis), and a claim left unattached by a dropped inference is legal: orphans
are not an invariant violation, so the material survives in the corpus for a
later role to attach. That is the whole reason this is worth doing rather than
failing: the expensive part of a run is the claims.

Thesis designations are likewise never dropped, and never need to be: the only
violation one can raise is I3 (a thesis id resolving to nothing), and
`check_plan` has already established that every reference in the plan resolves.
A designation also mints no node, so it never appears in the id-to-op index
repair decides from — it cannot be chosen even by accident.

## Why the PLAN and not the corpus

Repair runs before `execute`, on the ops, never on a built session. Three things
fall out of that, all of them load-bearing:

  * The write path keeps no repair loop. SESSION_FEED settles that commit
    failure is terminal and that there is no retry anywhere in the write path;
    a session that validated, failed, mutated itself and re-validated would be
    exactly the retry that rules out. Here the session is constructed once,
    executes once, and commits once — the loop lives in front of it, over pure
    data.
  * Ingestion needs no removal capability. Its grant is (AddClaim,
    AddInference); dropping an op from a list is not a session write.
  * Head stays valid by construction. Nothing invalid is ever written, so the
    property the no-gate role design rests on is untouched.

## Choosing what to drop

Most invariants name their own culprit: the violation carries the offending
inference id, and the op that produced it goes. A CYCLE does not — I6 is a
property of a path, and any edge on it would break the cycle if removed. The
policy here is the NEWEST inference on the cycle, which resolves to the highest
op index among the cycle's inferences. That biases toward keeping what the
corpus already had over what this run just added, consistent with ingestion
being additive; and an op index is stable across dry runs in a way a freshly
minted uuid is not.

Repair is iterative because dropping an edge can reveal a cycle that the first
pass reported only once. It is bounded, and it never reports success it did not
achieve: a violation naming nothing droppable (a thesis that does not resolve is
the real case) is returned as unrepairable and the run fails as it did before,
with the salvage file written.

Every drop is recorded and travels into the commit message. Silently discarding
model output would trade one invisible failure for another — the point is a
smaller, legible loss, not a quiet one.

## Repair runs AFTER check_plan, and the order is load-bearing

There is no floor on how much repair may drop, and it needs none, because the
one input that would make it drop everything cannot reach it. A plan whose refs
do not resolve produces an inference set that fails I3 wholesale — repair would
dutifully drop all of it and report a clean graph of nothing but claims.
`check_plan` rejects exactly that plan first (`Existing` ids not in the corpus,
`New` keys nothing binds), so what arrives here is a plan whose references all
resolve, where a violation is a genuine structural defect in a few edges rather
than a systemic one in every edge. Reversing the two would turn a loud,
accurate PlanError into a silent near-total deletion.
"""
from __future__ import annotations

from typing import Sequence, Tuple

import yaml

from ..core.types import Corpus
from ..core.validate import Violation, check_violations
from ..core.yaml_io import serialize
from .plan import AddInference, Op
from .salvage import apply_plan

# A pass can only ever shrink the plan, so this bounds nothing that would
# otherwise run long — it is here so a bug that fails to make progress stops
# instead of spinning.
MAX_PASSES = 12


class Unrepairable(Exception):
    """The graph violates an invariant that dropping an inference cannot fix.

    Carries the surviving violations. The run fails exactly as it would have
    without repair — this is not a new failure mode, it is the old one reached
    after trying.
    """

    def __init__(self, violations: Sequence[Violation]):
        self.violations = list(violations)
        super().__init__(
            f"{len(self.violations)} violation(s) no inference-drop can "
            f"resolve:\n  "
            + "\n  ".join(v.format("") .strip(": ") for v in self.violations))


def _describe(op: Op, index: int, violation: Violation) -> str:
    """One dropped inference, in terms a reader of the commit message can act
    on. Ids are useless here — the node never existed in the corpus — so the
    record names the scheme, the relation and the arity instead."""
    assert isinstance(op, AddInference)
    return (f"op[{index}] {op.relation.value} inference "
            f"(scheme {op.scheme.value}, {len(op.grounds)} grounds, "
            f"{len(op.warrants)} warrants) dropped: "
            f"{violation.inv} — {violation.msg}")


def repair_plan(
    bound: Corpus, plan: Sequence[Op],
) -> Tuple[Tuple[Op, ...], list[str]]:
    """Return (plan that validates, notes on what was dropped).

    The plan is returned unchanged, with no notes, when it already validates —
    the overwhelmingly common case, and one that costs a single dry run.
    """
    skip: set[int] = set()
    notes: list[str] = []

    for _ in range(MAX_PASSES):
        corpus, _, id_by_index = apply_plan(bound, plan, skip=frozenset(skip))
        violations, _warns = check_violations(yaml.safe_load(serialize(corpus)))
        if not violations:
            return tuple(op for n, op in enumerate(plan) if n not in skip), notes

        index_by_id = {nid: n for n, nid in id_by_index.items()}
        chosen: dict[int, Violation] = {}
        stuck: list[Violation] = []

        for v in violations:
            if v.iid in index_by_id:
                chosen.setdefault(index_by_id[v.iid], v)
                continue
            if v.nodes:
                # A cycle: drop the newest inference on it. Claims on the path
                # are not candidates — removing extracted content to break a
                # cycle would discard the very thing worth keeping.
                on_cycle = [index_by_id[n] for n in v.nodes
                            if n in index_by_id
                            and isinstance(plan[index_by_id[n]], AddInference)]
                if on_cycle:
                    chosen.setdefault(max(on_cycle), v)
                    continue
            stuck.append(v)

        if not chosen:
            raise Unrepairable(stuck or violations)

        for n, v in sorted(chosen.items()):
            skip.add(n)
            notes.append(_describe(plan[n], n, v))

    # Progress was made every pass and still did not converge: report honestly
    # rather than committing a graph that was never re-validated.
    corpus, _, _ = apply_plan(bound, plan, skip=frozenset(skip))
    violations, _ = check_violations(yaml.safe_load(serialize(corpus)))
    raise Unrepairable(violations)
