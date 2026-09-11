#!/usr/bin/env python3
"""The model loop every agent in this harness runs.

Extracted from `role.Role` when a second kind of agent appeared. What lives
here is everything that has nothing to do with the corpus: graph construction,
the conditional edge, message accumulation, tool binding, the iteration-cap
check, the truncation check, and the forced finding call. What `Role` adds on
top is the session, the capability check and the apply/commit boundary — see
`role.py`.

The graph is always:

    START -> call -> (tools -> call)* -> apply -> END

The conditional edge after `call` is the only control point: it enforces the
hard iteration cap and routes on whether the model's tool call was an
interaction tool (loop back through `tools`) or the finding tool (terminal,
apply). An agent that binds no interaction tools (single-shot ingestion does
exactly this) has `tool_choice` pinned to its finding tool, so `call` always
returns the finding in one turn and routes straight to `apply`; it simply never
takes the `tools` edge.

The finding is never parsed from text: every agent declares a `finding_tool`
schema, and the model must call it (forced via `tool_choice` when there are no
interaction tools to choose between first). The Anthropic API enforces which
tool is called, so `apply_node` reads the tool call's `input` directly — there
is no fenced-JSON-in-prose format to go missing or truncate.

`apply_finding` is the one place a subclass turns that finding into an effect.
For `Role` that is a plan of session writes; for the collection agent it is
nothing at all, because its effects already happened in its tools. Either way
the raw finding lands in `state.finding` first, so a caller can read what the
model actually submitted without the subclass having to hand it back.
"""
from __future__ import annotations

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from .bridge import from_anthropic, to_anthropic
from .prompts import OPERATIONS
from .state import RoleState


class TruncatedResponseError(RuntimeError):
    """The model's response hit the output ceiling (`stop_reason == "max_tokens"`).

    Terminal, and deliberately not retried. A finding cut off mid-emission is a
    PARTIAL finding — some claims extracted, the inferences attaching them
    missing — and applying it would commit a mutilated subgraph that looks
    well-formed. There is no way to tell a truncated finding from a complete one
    by inspecting it, so the stop_reason is the only signal, and it is treated as
    fatal wherever it appears in a run.
    """


class FindingCallError(RuntimeError):
    """The model's final message did not call the agent's declared finding tool.

    Terminal — apply cannot proceed without a finding. With `tool_choice`
    pinned (an agent with no interaction tools) this should not happen; it is
    checked rather than assumed so a cap-cut run mid-interaction-tool-loop (an
    agent with interaction tools, cut before it ever calls the finding tool)
    fails here with a clear message instead of a downstream KeyError.
    """


class Agent:
    # -- declaration (subclasses set this) ---------------------------------
    role_prompt: str = ""

    # Per-call output ceiling. A deliberate constant, not a config knob (config
    # supplies model + iteration cap); a subclass may override.
    #
    # It has to be generous for a single-shot role: at 8192 an ingestion run
    # spent 7990 tokens emitting claims and then closed the finding tool call
    # with an EMPTY inferences array. That is not truncation — `stop_reason` was
    # not `max_tokens`, so nothing here caught it — it is a complete,
    # well-formed, entirely unattached finding, which surfaced two layers down
    # as a PlanError about orphaned claims and read like a modelling mistake
    # rather than a budget one.
    #
    # The ceiling this can be raised to is the model's (128K on the current
    # Sonnet and Opus), not the transport's — `guarded_client` streams, so there
    # is no wall-clock limit on the request to trip. A non-streaming call would
    # cap this at ~21,333 whatever the model allows.
    MAX_TOKENS = 32 * 1024

    def __init__(self, *, guard, model: str, iteration_cap: int,
                 max_tokens: int | None = None):
        self.guard = guard
        self.model = model
        self.iteration_cap = iteration_cap
        self.max_tokens = max_tokens if max_tokens is not None else self.MAX_TOKENS
        self._lc_tools, self._schemas = self.build_tools()
        self._graph = self._build_graph()

    # -- subclass hooks ----------------------------------------------------

    def build_tools(self) -> tuple[list, list[dict]]:
        """Return (LangChain tools for ToolNode, Anthropic tool schemas)."""
        raise NotImplementedError

    def system_prompt(self) -> str:
        """The operations prompt, then this agent's own.

        Concrete, not a hook: composing the two halves is harness business, and
        an agent that assembled its own would be free to drop the shared half.
        Rendered as ONE cached system block — splitting it so OPERATIONS caches
        separately across agents is a change to `call_node`, and only worth
        making if OPERATIONS alone clears the model's minimum cacheable prefix.
        """
        if not self.role_prompt:
            raise NotImplementedError(
                f"{type(self).__name__} declares no role_prompt; set it to the "
                f"agent's prompt constant (see roles/prompts/)")
        return f"{OPERATIONS}\n\n{self.role_prompt}"

    def cached_context(self) -> str | None:
        """Large, stable reference context to place in front of the model as its
        own cached system block (e.g. a full corpus snapshot for single-shot
        ingestion). None by default — a tool-driven agent reaches its data through
        tools and does not override this. Rendered order is system prompt, then
        this block, then the per-run messages, so `[system | context]` cache
        together and the document stays the variable suffix."""
        return None

    def finding_tool(self) -> dict:
        """The Anthropic tool schema the model must call to submit its finding.
        `input` on that call IS the finding object `apply_finding` consumes —
        there is no free-text finding format. Forced via `tool_choice` when the
        agent binds no interaction tools; left to the model's discretion
        (`tool_choice: auto`, alongside the interaction tools) otherwise."""
        raise NotImplementedError

    def apply_finding(self, finding: dict) -> dict:
        """Turn the submitted finding into this agent's effect, returning a
        state partial. The default does nothing, which is correct for an agent
        whose effects happened in its tools; `Role` overrides it to build and
        execute a plan of session writes."""
        return {}

    # -- the run -----------------------------------------------------------

    def _invoke(self, init_state: RoleState) -> dict:
        """Run the graph to END and return the final state dict. Everything an
        agent does AFTER the model is finished — `Role`'s commit, the collection
        agent's report — is the caller's, deliberately outside the graph."""
        return self._graph.invoke(init_state)

    # -- graph -------------------------------------------------------------

    def _build_graph(self):
        has_tools = bool(self._lc_tools)
        tool_node = ToolNode(self._lc_tools) if has_tools else None
        finding_schema = self.finding_tool()
        finding_name = finding_schema["name"]

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
            context = self.cached_context()
            if context:
                system_param.append(
                    {"type": "text", "text": context,
                     "cache_control": {"type": "ephemeral"}}
                )
            create_kwargs = dict(
                model=self.model,
                max_tokens=self.max_tokens,
                messages=messages,
                system=system_param,
                thinking={"type": "disabled"},
                tools=[*self._schemas, finding_schema],
            )
            if not has_tools:
                # No interaction tools to choose between: pin tool_choice to the
                # finding tool so the model always returns a call, never prose
                # (which is exactly what let a "thinking"/preamble response
                # starve the whole output budget with nothing left to submit).
                create_kwargs["tool_choice"] = {"type": "tool", "name": finding_name}
            resp = self.guard.create(**create_kwargs)
            # Truncation is terminal. Checked here, at the wire, rather than at
            # apply: this is the only place stop_reason is visible (the LC
            # AIMessage does not carry it), and for a single-shot role this IS
            # the response carrying the finding. Nothing partial is committed.
            if getattr(resp, "stop_reason", None) == "max_tokens":
                raise TruncatedResponseError(
                    f"response hit the {self.max_tokens}-token output ceiling "
                    f"(stop_reason=max_tokens); the finding is partial and the "
                    f"run fails rather than committing it — there is no retry")
            ai = from_anthropic(resp)
            return {"messages": [ai], "iterations": state.iterations + 1}

        def tools_node(state: RoleState) -> dict:
            # Only ever wired up on the has_tools branch below, where tool_node
            # is constructed. Asserted rather than assumed: a future edit that
            # routes here without binding tools fails loudly, not with None.
            assert tool_node is not None
            out = tool_node.invoke(state)
            msgs = out["messages"] if isinstance(out, dict) else out.messages
            return {"messages": msgs}

        def apply_node(state: RoleState) -> dict:
            # Last message must carry a call to the finding tool — its `args`
            # IS the finding, already shaped by the API's schema enforcement.
            # The finding is recorded into state before `apply_finding` runs, so
            # what the model submitted survives even when applying it raises.
            final = state.messages[-1]
            calls = getattr(final, "tool_calls", None) or []
            finding = next((c["args"] for c in calls if c["name"] == finding_name), None)
            if finding is None:
                raise FindingCallError(
                    f"model's final message did not call {finding_name!r} to "
                    f"submit its finding (iteration cap may have cut the run "
                    f"short before it reached the finding tool)")
            return {"finding": finding, **self.apply_finding(finding)}

        def route_after_call(state: RoleState) -> str:
            # Cap first: a terminal stop, even mid-conversation. Then route on
            # whether the call was an interaction tool (loop) or the finding
            # tool / no call at all (terminal — apply_node raises cleanly on
            # the latter rather than routing somewhere invalid).
            if state.iterations >= self.iteration_cap:
                return "apply"
            last = state.messages[-1]
            calls = getattr(last, "tool_calls", None) or []
            if calls and not any(c["name"] == finding_name for c in calls):
                return "tools"
            return "apply"

        graph = StateGraph(RoleState)
        graph.add_node("call", call_node)
        graph.add_node("apply", apply_node)
        graph.add_edge(START, "call")

        if has_tools:
            graph.add_node("tools", tools_node)
            graph.add_conditional_edges("call", route_after_call,
                                        {"tools": "tools", "apply": "apply"})
            graph.add_edge("tools", "call")
        else:
            # No interaction tools bound: tool_choice is pinned, so `call`
            # always returns the finding call in one turn and routes straight
            # to apply. route_after_call never yields "tools" here, so a single
            # target keeps the graph valid.
            graph.add_conditional_edges("call", route_after_call,
                                        {"apply": "apply"})
        graph.add_edge("apply", END)

        # No checkpointer: invoked once, never resumed.
        return graph.compile(checkpointer=None)
