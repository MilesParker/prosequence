#!/usr/bin/env python3
"""Role base class.

Extracted from the working ingestion role. What lives here is everything that is
NOT ingestion-specific: graph construction, the conditional edge, message
accumulation, tool binding, the iteration-cap check, capability enforcement, and
the apply/commit boundary. A subclass supplies what is specific — its read
tools, its system prompt, its finding parser, its finding-to-ops application, and
its run-parameter type (which builds the initial state).

The graph is always:

    START -> call -> (tools -> call)* -> apply -> END

The conditional edge after `call` is the only control point: it enforces the
hard iteration cap and routes on whether the model asked for tools. commit() is
called in `_execute`, OUTSIDE the graph; the graph has no path to a store write.

Two class attributes DECLARE a role:
  * `capability` — the write ops the role holds. Enforced at apply, via the
    capability-guarded session, never by prompt instruction.
  * `objective`  — the mission prose the subclass folds into its system prompt.

No extension point here is unused by ingestion. Where a not-yet-existing role
would need a seam this one does not, that is flagged, not built.
"""
from __future__ import annotations

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from .bridge import from_anthropic, to_anthropic
from .capability import CapabilityGuardedSession
from .state import RoleState


class Role:
    # -- declaration (subclasses set these) --------------------------------
    capability: tuple[str, ...] = ()
    objective: str = ""

    # Per-call output ceiling. A deliberate constant, not a config knob (config
    # supplies model + iteration cap); a subclass may override.
    MAX_TOKENS = 8192

    def __init__(self, *, guard, session, model: str, iteration_cap: int,
                 max_tokens: int | None = None):
        self.guard = guard
        self.session = session
        self.model = model
        self.iteration_cap = iteration_cap
        self.max_tokens = max_tokens if max_tokens is not None else self.MAX_TOKENS
        # Read tools see the raw session (reads are never capability-gated); the
        # apply step writes only through the capability-guarded session.
        self._lc_tools, self._schemas = self.build_tools(session)
        self._guarded_session = CapabilityGuardedSession(session, self.capability)
        self._graph = self._build_graph()

    # -- subclass hooks ----------------------------------------------------

    def build_tools(self, session) -> tuple[list, list[dict]]:
        """Return (LangChain tools for ToolNode, Anthropic tool schemas)."""
        raise NotImplementedError

    def system_prompt(self) -> str:
        """The system prompt (folds in `objective`)."""
        raise NotImplementedError

    def parse_finding(self, text: str):
        """Extract the finding object from the model's final message text."""
        raise NotImplementedError

    def apply_finding(self, session, finding) -> tuple:
        """Apply a parsed finding as session writes, returning one line per op.
        `session` is the capability-guarded session: a write outside the role's
        capability raises here."""
        raise NotImplementedError

    # -- the run (apply/commit boundary) -----------------------------------

    def _execute(self, init_state: RoleState, *, commit_summary: str) -> dict:
        """Run the graph to apply, then commit OUTSIDE the graph. Returns a
        report dict (sha, ops, op_lines, diff, iterations, tokens)."""
        final_state = self._graph.invoke(init_state)
        ops = tuple(final_state["ops_applied"])
        iterations = final_state["iterations"]

        diff = self.session.diff()
        sha = self.session.commit(commit_summary)

        return {
            "sha": sha,
            "ops": list(ops),
            "op_lines": list(diff.ops),
            "diff": diff.patch,
            "iterations": iterations,
            "tokens": self.guard.run_tokens,
        }

    # -- graph -------------------------------------------------------------

    def _build_graph(self):
        tool_node = ToolNode(self._lc_tools)

        def call_node(state: RoleState) -> dict:
            # LC history -> Anthropic wire, one guard-wrapped call. The system
            # prompt goes out of band (top-level param), never into history; its
            # constant prefix is marked for ephemeral caching so calls 2..N read
            # it instead of re-billing it (full history is untouched).
            messages = to_anthropic(state.messages)
            system_param = [
                {"type": "text", "text": self.system_prompt(),
                 "cache_control": {"type": "ephemeral"}}
            ]
            resp = self.guard.create(
                model=self.model,
                max_tokens=self.max_tokens,
                messages=messages,
                system=system_param,
                tools=self._schemas,
            )
            ai = from_anthropic(resp)
            return {"messages": [ai], "iterations": state.iterations + 1}

        def tools_node(state: RoleState) -> dict:
            out = tool_node.invoke(state)
            msgs = out["messages"] if isinstance(out, dict) else out.messages
            return {"messages": msgs}

        def apply_node(state: RoleState) -> dict:
            # Last message is the model's final finding (no tool calls). Writes go
            # through the capability-guarded session: an op outside `capability`
            # raises here, at apply.
            final = state.messages[-1]
            text = final.content if isinstance(final.content, str) else str(final.content)
            finding = self.parse_finding(text)
            ops = self.apply_finding(self._guarded_session, finding)
            return {"ops_applied": ops}

        def route_after_call(state: RoleState) -> str:
            # Cap first: a terminal stop, even mid-conversation. Then route on
            # whether the model asked for tools.
            if state.iterations >= self.iteration_cap:
                return "apply"
            last = state.messages[-1]
            if getattr(last, "tool_calls", None):
                return "tools"
            return "apply"

        graph = StateGraph(RoleState)
        graph.add_node("call", call_node)
        graph.add_node("tools", tools_node)
        graph.add_node("apply", apply_node)

        graph.add_edge(START, "call")
        graph.add_conditional_edges("call", route_after_call,
                                    {"tools": "tools", "apply": "apply"})
        graph.add_edge("tools", "call")
        graph.add_edge("apply", END)

        # No checkpointer: invoked once, never resumed.
        return graph.compile(checkpointer=None)
