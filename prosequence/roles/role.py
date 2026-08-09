#!/usr/bin/env python3
"""Role base class.

Extracted from the working ingestion role. What lives here is everything that is
NOT ingestion-specific: graph construction, the conditional edge, message
accumulation, tool binding, the iteration-cap check, capability enforcement, and
the apply/commit boundary. A subclass supplies what is specific — its read
tools, its system prompt, its finding tool schema, its finding-to-ops
application, and its run-parameter type (which builds the initial state).

The graph is always:

    START -> call -> (tools -> call)* -> apply -> END

The conditional edge after `call` is the only control point: it enforces the
hard iteration cap and routes on whether the model's tool call was an
interaction tool (loop back through `tools`) or the finding tool (terminal,
apply). commit() is called in `_execute`, OUTSIDE the graph; the graph has no
path to a store write. A role that binds no interaction tools (single-shot
ingestion does exactly this — see `cached_context`) has `tool_choice` pinned to
its finding tool, so `call` always returns the finding in one turn and routes
straight to `apply`; it simply never takes the `tools` edge.

The finding itself is never parsed from text: every role declares a
`finding_tool` schema, and the model must call it (forced via `tool_choice`
when there are no interaction tools to choose between first). The Anthropic API
enforces the shape, so `apply_node` reads the tool call's `input` directly —
there is no fenced-JSON-in-prose format to go missing or truncate.

Two class attributes DECLARE a role:
  * `capability` — the op TYPES the role holds (`plan.Op` subclasses). Checked
    across the whole plan before the first write, never by prompt instruction.
  * `objective`  — the mission prose the subclass folds into its system prompt.

Apply is two steps, and only the second touches the corpus: `build_plan` turns
the finding into a list of ops (pure, no session), `plan.execute` runs it. A
role that overreaches fails at the capability check with nothing written.

Extension points: `build_tools`, `system_prompt`, `finding_tool`, `build_plan`,
and `cached_context`. The last is a seam ingestion needs and a tool-driven role
does not — a role that must put bulk data in front of the model up front (a full
corpus snapshot) overrides it; the harness appends it as its own cached system
block.
"""
from __future__ import annotations

from langgraph.graph import StateGraph, START, END
from langgraph.prebuilt import ToolNode

from .bridge import from_anthropic, to_anthropic
from .capability import validate_capability
from .plan import Op, execute
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
    """The model's final message did not call the role's declared finding tool.

    Terminal — apply cannot proceed without a finding. With `tool_choice`
    pinned (a role with no interaction tools) this should not happen; it is
    checked rather than assumed so a cap-cut run mid-interaction-tool-loop (a
    role with interaction tools, cut before it ever calls the finding tool)
    fails here with a clear message instead of a downstream KeyError.
    """


class Role:
    # -- declaration (subclasses set these) --------------------------------
    capability: tuple[type[Op], ...] = ()
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
        # A malformed capability declaration fails here, at construction, not at
        # apply — a bare containment check would otherwise just match nothing.
        validate_capability(self.capability)
        # Read tools see the raw session (reads are never capability-gated);
        # writes are gated by checking the plan against `capability` at apply.
        self._lc_tools, self._schemas = self.build_tools(session)
        self._graph = self._build_graph()

    # -- subclass hooks ----------------------------------------------------

    def build_tools(self, session) -> tuple[list, list[dict]]:
        """Return (LangChain tools for ToolNode, Anthropic tool schemas)."""
        raise NotImplementedError

    def system_prompt(self) -> str:
        """The system prompt (folds in `objective`)."""
        raise NotImplementedError

    def cached_context(self) -> str | None:
        """Large, stable reference context to place in front of the model as its
        own cached system block (e.g. a full corpus snapshot for single-shot
        ingestion). None by default — a tool-driven role reaches its data through
        tools and does not override this. Rendered order is system prompt, then
        this block, then the per-run messages, so `[system | context]` cache
        together and the document stays the variable suffix."""
        return None

    def finding_tool(self) -> dict:
        """The Anthropic tool schema the model must call to submit its finding.
        `input` on that call IS the finding object `build_plan` consumes —
        there is no free-text finding format. Forced via `tool_choice` when the
        role binds no interaction tools; left to the model's discretion
        (`tool_choice: auto`, alongside the interaction tools) otherwise."""
        raise NotImplementedError

    def build_plan(self, finding) -> tuple[Op, ...]:
        """A parsed finding -> the plan of ops that applies it. Pure: builds and
        checks the plan without touching the session. `plan.execute` runs it,
        after the capability check."""
        raise NotImplementedError

    # -- the run (apply/commit boundary) -----------------------------------

    def _execute(self, init_state: RoleState, *, commit_summary: str) -> dict:
        """Run the graph to apply, then commit OUTSIDE the graph. Returns a
        report dict (sha, plan, op_lines, diff, iterations, tokens).

        `plan` is the executed ops themselves; `op_lines` is the session's own
        rendering of what it recorded. There is deliberately no third,
        caller-authored rendering — the previous `ops` key was exactly that, and
        it was both staler (it could not resolve a target's tag against the
        final version) and unread: the CLI prints `op_lines`.
        """
        final_state = self._graph.invoke(init_state)
        plan = tuple(final_state["plan"])
        iterations = final_state["iterations"]

        diff = self.session.diff()
        sha = self.session.commit(commit_summary)

        return {
            "sha": sha,
            "plan": plan,
            "op_lines": list(diff.ops),
            "diff": diff.patch,
            "iterations": iterations,
            "tokens": self.guard.run_tokens,
        }

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
            out = tool_node.invoke(state)
            msgs = out["messages"] if isinstance(out, dict) else out.messages
            return {"messages": msgs}

        def apply_node(state: RoleState) -> dict:
            # Last message must carry a call to the finding tool — its `args`
            # IS the finding, already shaped by the API's schema enforcement.
            # The finding becomes a plan (pure), the plan is checked against
            # `capability` in full, and only then does anything get written: an
            # op outside the role's capability leaves the session untouched.
            final = state.messages[-1]
            calls = getattr(final, "tool_calls", None) or []
            finding = next((c["args"] for c in calls if c["name"] == finding_name), None)
            if finding is None:
                raise FindingCallError(
                    f"model's final message did not call {finding_name!r} to "
                    f"submit its finding (iteration cap may have cut the run "
                    f"short before it reached the finding tool)")
            plan = self.build_plan(finding)
            execute(self.session, plan, self.capability)
            return {"plan": plan}

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
