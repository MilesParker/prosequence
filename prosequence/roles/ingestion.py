#!/usr/bin/env python3
"""The ingestion role.

Single-shot. One document + the WHOLE corpus in front of the model at once ->
one finding -> apply it as session writes -> commit, once, outside the graph.
The corpus is a stable text/argument transformation, not an interaction: with
the full corpus visible there is no attachment point to discover step by step,
so no read-tool loop and none of its O(n^2) re-sent-history cost. The corpus is
rendered into a cached system block (see `cached_context`); the model reasons
over it in a single turn.

The shared machinery (graph construction, message accumulation, the cap check,
capability enforcement, the apply/commit boundary) lives in `role.Role`. What
stays here is ingestion-specific: the corpus view, the system prompt, the
finding tool schema, the finding-to-ops application, and the (url,
document_text) run parameter. The harness's tool loop is retained but unused by
this role — it is there for interaction-shaped roles (contest, revise) still to
come. The finding itself is a forced tool call (see `role.py`), not text: the
API enforces the shape, so there is nothing here to parse.

Declaration is two class attributes:
  * `capability`  — the write ops the role holds. Enforced at apply, never by
    prompt instruction.
  * `role_prompt` — ingestion's half of the system prompt (roles/prompts/
    ingestion.py). `Role.system_prompt` prepends the shared operations prompt;
    this role does not assemble either one.

Model and iteration cap are supplied by the caller (from config).
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage

from . import salvage
from .apply import FINDING_TOOL_SCHEMA, FindingShapeError, ops_from_finding
from .corpus_view import render_corpus
from .plan import AddClaim, AddInference, Op, PlanError, check_plan
from .prompts import INGESTION
from .repair import Unrepairable, repair_plan
from .role import Role
from .state import RoleState


class IngestionRole(Role):
    # `ReviseClaim` is deliberately absent. Ingestion is additive: it adds
    # claims and inferences and reuses existing uuids, and it never changes the
    # text of a claim already in the corpus. Rewriting settled claims is a
    # different role's business, and a plan containing that op is refused here
    # before any of it runs.
    capability: tuple[type[Op], ...] = (AddClaim, AddInference)
    role_prompt: str = INGESTION

    # -- subclass hooks ----------------------------------------------------

    def build_tools(self, session):
        # Single-shot: no read tools. The whole corpus is placed in front of the
        # model via `cached_context`, so there is nothing to traverse.
        return [], []

    def cached_context(self) -> str:
        # The committed corpus (the session's bound version), rendered in full
        # and cached as its own system block. Reads uncommitted writes are
        # irrelevant here — a single call, no writes precede it.
        return render_corpus(self.session.bound_version)

    def finding_tool(self) -> dict:
        return FINDING_TOOL_SCHEMA

    def build_plan(self, finding: dict) -> tuple[Op, ...]:
        """Finding -> checked plan, salvaging the work if the check refuses it.

        Both failures here are terminal and stay terminal: nothing is committed,
        and the exception propagates unchanged. What changes is that the run's
        output no longer evaporates with it — the plan the model asked for is
        written out as an error corpus under `logs/failed/` first (see
        `salvage`). That is the difference between diagnosing a bad finding by
        reading a graph and diagnosing it by re-running the ingestion.

        The two failures salvage differently because they leave different
        amounts behind: a malformed FIELD (`FindingShapeError`) yields no ops at
        all, so only the raw finding can be written; a malformed PLAN
        (`PlanError`) yields a full op list, which becomes a corpus.
        """
        # `Existing` refs are checked against the bound version: no write has
        # happened yet at plan time, so it is also the current one.
        known = frozenset(
            n.id for n in (*self.session.bound_version.claims,
                           *self.session.bound_version.inferences))

        try:
            plan = ops_from_finding(finding)
        except FindingShapeError as exc:
            salvage.capture(
                lambda: salvage.write_finding_only(
                    corpus_file=self.session.name, run_id=self.guard.run_id,
                    stage="finding shape", error=exc, finding=finding),
                label="finding")
            raise

        try:
            plan_notes = check_plan(plan, known)
        except PlanError as exc:
            corpus, notes = salvage.salvage_corpus(
                self.session.bound_version, plan)
            salvage.capture(
                lambda: salvage.write_error_corpus(
                    corpus, corpus_file=self.session.name,
                    run_id=self.guard.run_id, stage="plan check", error=exc,
                    bound_head=self.session.bound_head, notes=notes,
                    finding=finding),
                label="error corpus")
            raise

        # Drop the inferences that would fail I1-I10, keeping the rest, so three
        # bad edges do not cost 45 claims. Nothing is written yet: this rewrites
        # the plan, and the session still executes and commits exactly once.
        # A graph that no drop can fix (`Unrepairable`) fails as it did before.
        try:
            plan, repair_notes = repair_plan(self.session.bound_version, plan)
            # Both records land in the commit message: what the plan check found
            # odd but survivable, then what repair removed to make it commit.
            self._repair_notes = (*plan_notes, *repair_notes)
        except Unrepairable as exc:
            corpus, notes = salvage.salvage_corpus(
                self.session.bound_version, plan)
            salvage.capture(
                lambda: salvage.write_error_corpus(
                    corpus, corpus_file=self.session.name,
                    run_id=self.guard.run_id, stage="repair", error=exc,
                    bound_head=self.session.bound_head, notes=notes,
                    finding=finding),
                label="error corpus")
            raise

        return plan

    # -- run parameter -----------------------------------------------------

    def run(self, url: str, document_text: str, *,
            commit_summary: str | None = None) -> dict:
        """Ingest one document and commit the result. Returns a report dict.

        `url` is the source reference — a run parameter, supplied by the harness
        and never inferred by the model (no fetch tool is bound). `document_text`
        is the text to ingest.
        """
        # The reference url and document are folded into the seed message, not
        # threaded through graph state — the url is a run parameter, supplied
        # here and never inferred by the model (no fetch tool is bound). The
        # corpus itself rides in a cached system block (cached_context), not the
        # seed.
        seed = (
            f"Ingest the following document into the corpus. The full corpus is "
            f"provided above — attach new nodes to existing uuids drawn from it, "
            f"then call submit_finding with your finding.\n\n"
            f"Source reference (use for attribution): {url}\n\n"
            f"--- DOCUMENT ---\n{document_text}\n--- END DOCUMENT ---"
        )
        init = RoleState(messages=[HumanMessage(content=seed)])
        summary = commit_summary or f"ingest of {url}"
        return self._execute(init, commit_summary=summary)
