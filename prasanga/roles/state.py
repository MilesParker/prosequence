#!/usr/bin/env python3
"""Graph state for a role's traversal loop.

Role-agnostic: this carries only what every role's graph reduces over — the
message history, the iteration count, and the ops the apply step emitted. A
role's run parameters (a document + reference for ingestion, a query for a
query-seeded role) are not state; they are folded into the seed message the run
builds, so nothing role-specific rides here.

Frozen dataclass: LangGraph never mutates state in place; each superstep
constructs a new instance from the partial dict a node returns, so `frozen=True`
costs nothing and buys the immutability guarantee the rest of the model assumes.

`messages` accumulates through the `add_messages` reducer (LangChain message
objects: Human/AI/Tool); nodes append, never replace. Every other field is a
plain last-value-wins slot: `iterations` is overwritten with an incremented
value by the `call` node; `ops_applied` is written once by `apply`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Tuple

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages


@dataclass(frozen=True)
class RoleState:
    # Full history. add_messages is the reducer; nodes append, never replace.
    messages: Annotated[list[AnyMessage], add_messages] = field(default_factory=list)

    # Iteration count — number of completed `call` turns. Checked against the
    # hard cap in the conditional edge, not inside the model loop.
    iterations: int = 0

    # Ops the `apply` node emitted (one string per session write). Empty until
    # the graph reaches apply.
    ops_applied: Tuple[str, ...] = ()
