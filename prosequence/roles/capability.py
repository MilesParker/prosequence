#!/usr/bin/env python3
"""Capability enforcement at the apply boundary.

A role declares the write ops it holds (its `capability`). This wraps the writer
session so that only those ops may be called; any other write op raises at the
moment it is invoked — enforcement at apply, independent of anything the prompt
does or does not say. Reads always pass through: capability governs writes.

The write-op universe below is exactly the mutating surface of `session.Session`
(add_claim / add_inference / revise_claim). Anything not in it — every read
query, every non-op attribute — is returned untouched, so an apply step reads
the graph freely and only its writes are gated.
"""
from __future__ import annotations

from typing import Iterable


# The full set of session write ops. A name in this set is gated against the
# role's capability; a name outside it (reads, properties) is never gated.
WRITE_OPS = frozenset({"add_claim", "add_inference", "revise_claim"})


class CapabilityError(RuntimeError):
    """A role invoked a write op it does not hold. Terminal — the run dies.

    Raised at the call site (apply), not by inspecting the prompt: a role can
    only write what its `capability` grants regardless of what the model asked.
    """


class CapabilityGuardedSession:
    """Proxy over a writer session that permits only the role's capability ops.

    Passed to a role's apply step in place of the raw session. Read queries and
    non-op attributes forward unchanged; a write op outside `capability` returns
    a stub that raises CapabilityError when called.
    """

    def __init__(self, session, capability: Iterable[str]):
        self._session = session
        self._capability = frozenset(capability)
        unknown = self._capability - WRITE_OPS
        if unknown:
            raise ValueError(
                f"capability names non-write ops {sorted(unknown)}; "
                f"capability governs writes only ({sorted(WRITE_OPS)})")

    def __getattr__(self, name):
        attr = getattr(self._session, name)
        if name in WRITE_OPS and name not in self._capability:
            def _refused(*_a, **_k):
                raise CapabilityError(
                    f"role does not hold capability {name!r} "
                    f"(holds {sorted(self._capability)})")
            return _refused
        return attr
