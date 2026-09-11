#!/usr/bin/env python3
"""Role base class — an agent that writes to a corpus.

The model loop is `agent.Agent`: graph, conditional edge, message accumulation,
tool binding, the iteration cap, the truncation check, the forced finding call.
None of that is corpus business, and a second agent that drives ingestion runs
without ever committing (`collection.CollectionAgent`) needs it without any of
what follows. What stays HERE is the half that is corpus business: the session,
the capability declaration, and the apply/commit boundary.

A role is declared by two class attributes:
  * `capability`  — the op TYPES the role holds (`plan.Op` subclasses). Checked
    across the whole plan before the first write, never by prompt instruction.
  * `role_prompt` — this role's half of the system prompt (inherited from
    `Agent`): its job, its input, its finding contract. The other half is
    `prompts.OPERATIONS`, shared by every agent.

Apply is two steps, and only the second touches the corpus: `build_plan` turns
the finding into a list of ops (pure, no session), `plan.execute` runs it. A
role that overreaches fails at the capability check with nothing written.
`commit()` is called in `_execute`, OUTSIDE the graph; the graph has no path to
a store write.
"""
from __future__ import annotations

from ..core.session import HeadMoved, ValidationFailed, WorkingTreeDirty
from . import salvage
from .agent import Agent, FindingCallError, TruncatedResponseError  # noqa: F401
from .capability import validate_capability
from .plan import Op, execute
from .state import RoleState


class Role(Agent):
    # -- declaration (subclasses set these) --------------------------------
    capability: tuple[type[Op], ...] = ()

    # What the apply step decided not to write, recorded for the commit message.
    # A class-level default so a role that never repairs needs no constructor
    # ceremony, and `_execute` can read it unconditionally.
    _repair_notes: tuple = ()

    def __init__(self, *, guard, session, model: str, iteration_cap: int,
                 max_tokens: int | None = None):
        # A malformed capability declaration fails here, at construction, not at
        # apply — a bare containment check would otherwise just match nothing.
        validate_capability(self.capability)
        # Read tools see the raw session (reads are never capability-gated);
        # writes are gated by checking the plan against `capability` at apply.
        # Bound before `super().__init__`, which calls `build_tools`.
        self.session = session
        super().__init__(guard=guard, model=model, iteration_cap=iteration_cap,
                         max_tokens=max_tokens)

    # -- subclass hooks ----------------------------------------------------

    def build_plan(self, finding) -> tuple[Op, ...]:
        """A parsed finding -> the plan of ops that applies it. Pure: builds and
        checks the plan without touching the session. `plan.execute` runs it,
        after the capability check."""
        raise NotImplementedError

    def apply_finding(self, finding: dict) -> dict:
        """The finding becomes a plan (pure), the plan is checked against
        `capability` in full, and only then does anything get written: an op
        outside the role's capability leaves the session untouched."""
        plan = self.build_plan(finding)
        execute(self.session, plan, self.capability)
        return {"plan": plan}

    # -- the run (apply/commit boundary) -----------------------------------

    def _execute(self, init_state: RoleState, *, commit_summary: str) -> dict:
        """Run the graph to apply, then commit OUTSIDE the graph. Returns a
        report dict (sha, plan, op_lines, diff, iterations, tokens).

        `plan` is the executed ops themselves; `op_lines` is the session's own
        rendering of what it recorded. There is deliberately no third,
        caller-authored rendering — the previous `ops` key was exactly that, and
        it was both staler (it could not resolve a target's tag against the
        final version) and unread: the CLI prints `op_lines`.

        A failed commit is salvaged, not just reported. `ValidationFailed` is
        the most expensive failure in the harness: the model answered, the plan
        checked out, every op ran, and the completed graph is discarded on
        I1-I10. That graph is exactly what someone needs to read to understand
        which invariant it broke and why, so it is written out under
        `prosequence/logs/failed/` before the exception propagates. This is generic — every
        role commits — which is why it lives here rather than in a subclass.
        """
        final_state = self._invoke(init_state)
        plan = tuple(final_state["plan"])
        iterations = final_state["iterations"]

        diff = self.session.diff()
        try:
            sha = self.session.commit(commit_summary, self._repair_notes)
        except (ValidationFailed, HeadMoved, WorkingTreeDirty) as exc:
            # All three of the session's terminal commit failures, not just the
            # invariant one. The graph is equally finished and equally lost
            # whichever refused it, and the two store guards are the ones a
            # caller can do nothing about from inside the run: a stale
            # working-tree file left by an earlier failed run blocks commits to
            # that corpus until it is cleaned up, and losing a whole run to that
            # would be the harshest failure of the three.
            #
            # `current_version` survives the failed commit: the session closes
            # on any outcome, but the version it would have written is still
            # bound to it, and this is the only chance to read it.
            salvage.capture(
                lambda: salvage.write_error_corpus(
                    self.session.current_version,
                    corpus_file=self.session.name, run_id=self.guard.run_id,
                    stage=f"commit ({type(exc).__name__})", error=exc,
                    bound_head=self.session.bound_head),
                label="error corpus")
            raise

        return {
            "sha": sha,
            "plan": plan,
            "op_lines": list(diff.ops),
            "diff": diff.patch,
            "iterations": iterations,
            "tokens": self.guard.run_tokens,
            # What apply decided not to write, same lines the commit message
            # carries under `not applied`. In the report because a caller that
            # dispatched this run (the collection agent) has no other way to
            # learn that three inferences were dropped from a clean commit.
            "notes": list(self._repair_notes),
        }
