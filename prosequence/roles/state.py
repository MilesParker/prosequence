#!/usr/bin/env python3
"""Graph state for an agent's traversal loop.

One state class for every agent in the harness, because there is one graph
shape (`agent.Agent`). It carries what that graph reduces over — the message
history, the iteration count, the finding the apply step read, and the ops it
emitted. An agent's run parameters (a document + reference for ingestion, a
thesis for collection) are not state; they are folded into the seed message the
run builds, so nothing agent-specific rides here.

`plan` is the one field that is not universal: it is empty for an agent that
writes no session ops (`collection.CollectionAgent`, whose effects happen in its
tools). Splitting the schema per agent would mean making it a class attribute of
the graph builder, which buys nothing while there are two agents and one shape;
carrying an empty tuple is the cheaper honesty.

Frozen dataclass: LangGraph never mutates state in place; each superstep
constructs a new instance from the partial dict a node returns, so `frozen=True`
costs nothing and buys the immutability guarantee the rest of the model assumes.

`messages` accumulates through the `add_messages` reducer (LangChain message
objects: Human/AI/Tool); nodes append, never replace. Every other field is a
plain last-value-wins slot: `iterations` is overwritten with an incremented
value by the `call` node; `finding` and `plan` are written once by `apply`.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Annotated, Optional, Tuple

from langchain_core.messages import AnyMessage
from langgraph.graph.message import add_messages

from .plan import Op


@dataclass(frozen=True)
class RoleState:
    # Full history. add_messages is the reducer; nodes append, never replace.
    messages: Annotated[list[AnyMessage], add_messages] = field(default_factory=list)

    # Iteration count — number of completed `call` turns. Checked against the
    # hard cap in the conditional edge, not inside the model loop.
    iterations: int = 0

    # The finding the model submitted, exactly as it arrived on the finding
    # tool call. Recorded by `apply` BEFORE the subclass acts on it, so a caller
    # can read what was asked for even when applying it raised. None until the
    # graph reaches apply.
    finding: Optional[dict] = None

    # The plan the `apply` node executed — the reified ops themselves, not a
    # rendering of them. Empty until the graph reaches apply. The human-readable
    # op log is the session's (`Session._op_lines`), generated from what the
    # session actually recorded rather than authored here.
    plan: Tuple[Op, ...] = ()
