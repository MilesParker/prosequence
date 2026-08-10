#!/usr/bin/env python3
"""Capability enforcement over a plan.

A role declares the write ops it holds as op TYPES (`plan.Op` subclasses). This
checks a plan against that declaration before any of it executes: an op whose
type the role does not hold raises, and nothing is written.

This replaced a proxy over the writer session that intercepted attribute access
and matched METHOD NAMES against a `WRITE_OPS` frozenset. Two things were wrong
with that. The name set was a hand-maintained mirror of `Session`'s mutating
surface, free to drift from it — a rename on either side broke the grant
silently, surfacing as an AttributeError mid-run. And enforcement happened at
the call, so a plan whose third op was disallowed had already written the first
two by the time it raised; refusal was not atomic.

With ops reified there is nothing to intercept. A capability is a set of types,
a plan is a list of instances, and the check is containment run over the whole
list up front. No proxy, no name mirror, no strings.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Sequence

if TYPE_CHECKING:
    # Import for annotations only: plan.py imports this module at runtime, so a
    # real import here would be circular.
    from .plan import Op


class CapabilityError(RuntimeError):
    """A plan contains a write op the role does not hold. Terminal — the run
    dies, and it dies before anything is written.

    Raised from the declared capability, never by inspecting the prompt: a role
    can only write what its `capability` grants regardless of what the model
    asked for.
    """


def validate_capability(capability: Sequence[type["Op"]]) -> None:
    """Every entry names an op type. Checked when a role is constructed, so a
    malformed declaration fails at startup rather than silently matching
    nothing at apply — the failure mode a bare containment check would
    otherwise have."""
    from .plan import Op

    bad = [c for c in capability
           if not (isinstance(c, type) and issubclass(c, Op))]
    if bad:
        raise ValueError(
            f"capability entries must be Op subclasses, got {bad}; "
            f"capability governs session writes only")


def check_capability(plan: Sequence["Op"], capability: Sequence[type["Op"]]) -> None:
    """Refuse a plan containing any op outside `capability`. Runs over the whole
    plan before the first write, so refusal leaves the session untouched."""
    held = tuple(capability)
    refused = sorted({type(op).__name__ for op in plan if type(op) not in held})
    if refused:
        raise CapabilityError(
            f"role does not hold {refused} "
            f"(holds {sorted(c.__name__ for c in held)})")
