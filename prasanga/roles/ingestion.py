#!/usr/bin/env python3
"""The ingestion role.

Promoted from the round-trip spike. One document -> traverse the corpus through
read tools -> return a finding -> apply it as session writes -> commit, once,
outside the graph.

The shared machinery (graph construction, the conditional edge, message
accumulation, tool binding, the cap check, capability enforcement, the
apply/commit boundary) lives in `role.Role`. What stays here is
ingestion-specific: the read tools, the system prompt, the finding parser, the
finding-to-ops application, and the (url, document_text) run parameter.

Declaration is two class attributes:
  * `capability` — the write ops the role holds. Enforced at apply, never by
    prompt instruction.
  * `objective`  — the mission prose, folded into the system prompt.

Model and iteration cap are supplied by the caller (from config).
"""
from __future__ import annotations

from langchain_core.messages import HumanMessage

from .apply import apply_finding, parse_finding
from .prompt import OBJECTIVE, SYSTEM_PROMPT
from .read_tools import build_read_tools
from .role import Role
from .state import RoleState


class IngestionRole(Role):
    capability: tuple[str, ...] = ("add_claim", "add_inference")
    objective: str = OBJECTIVE

    # -- subclass hooks ----------------------------------------------------

    def build_tools(self, session):
        return build_read_tools(session)

    def system_prompt(self) -> str:
        return SYSTEM_PROMPT

    def parse_finding(self, text: str) -> dict:
        return parse_finding(text)

    def apply_finding(self, session, finding: dict) -> tuple:
        return apply_finding(session, finding)

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
        # here and never inferred by the model (no fetch tool is bound).
        seed = (
            f"Ingest the following document into the corpus. Use the tools to "
            f"find attachment points, then return the finding JSON.\n\n"
            f"Source reference (use for attribution): {url}\n\n"
            f"--- DOCUMENT ---\n{document_text}\n--- END DOCUMENT ---"
        )
        init = RoleState(messages=[HumanMessage(content=seed)])
        summary = commit_summary or f"ingest of {url}"
        return self._execute(init, commit_summary=summary)
