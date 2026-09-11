#!/usr/bin/env python3
"""The collection agent — finds the sources a corpus needs and drives ingestion.

Run parameter is `(corpus name, thesis, optional scope)`. The agent searches,
reads corpus state, dispatches ingestion runs, and stops by submitting a
collection report. Its goal is an initial corpus holding a broad range of
views on the thesis, not a large one.

**It is an agent, not a Role.** It holds no `Session`, no `capability`, and it
never commits. Every corpus write it causes is an ingestion run, each with its
own session and its own single commit. That is forced rather than stylistic: a
session binds head at construction and dies on its one commit, so nothing that
spans many commits can hold one, and `capability` is defined over session write
ops the collection agent never produces. What it inherits from `agent.Agent` is
the model loop; `Role`'s half — session, capability, plan, commit — is exactly
what does not apply. It is also the first agent to bind interaction tools, so
the `tools` edge in that graph runs for the first time here.

Four tools, all harness callbacks:

    search(phrases, purpose)        run each phrase through the search provider
    corpus_state()                  the coverage read (coverage.py)
    ingest_sources(ids, reason)     fetch in parallel, ingest one at a time
    submit_collection(...)          the finding: stop, and say what was covered

The agent never sees a url or a line of document text — see `sources.py`. It
selects by ledger id; the harness resolves the id to the url it recorded from
the provider.

Bounding and stopping are separate, as SESSION_FEED requires. `max_searches`
and `max_ingests` are checked in the dispatch below and refuse as TOOL RESULTS,
not exceptions: hitting the ingest budget is a normal end to a collection run
and the agent should report it, whereas raising would lose the report. Stopping
is the agent calling `submit_collection`. Guard refusals (kill file, token
caps) are the third thing and are neither: they raise and kill the run.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field, replace
from typing import Callable, Optional

from langchain_core.messages import HumanMessage
from langchain_core.tools import tool

from .agent import Agent
from .coverage import CoverageMark, corpus_coverage
from .prompts import COLLECTION
from .fetch import Fetcher
from .search import SearchError, SearchProvider
from .sources import MAX_INGESTS_PER_CALL, SourceLedger, ingest_batch
from .state import RoleState

# Results requested per search phrase. Ten is the Google API's per-request
# ceiling and about as many titles as are worth reading per phrase; breadth
# comes from spending more phrases, not from paging one.
RESULTS_PER_PHRASE = 10

FINDING_TOOL_NAME = "submit_collection"

COLLECTION_FINDING_SCHEMA = {
    "name": FINDING_TOOL_NAME,
    "description": (
        "Stop collecting and report. Call this exactly once, when the corpus "
        "holds a broad enough range of views on the thesis, or when a budget "
        "is exhausted, or when further searching has stopped producing usable "
        "sources."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "summary": {
                "type": "string",
                "description": "What the corpus now argues about and from which directions, in a few sentences.",
            },
            "positions": {
                "type": "array",
                "description": "The distinct positions on the thesis you set out to cover, one entry each -- including the ones you did NOT find a source for.",
                "items": {
                    "type": "object",
                    "properties": {
                        "label": {"type": "string", "description": "The position, stated as someone holding it would state it."},
                        "covered": {"type": "boolean", "description": "True only if a source arguing it was actually ingested."},
                        "sources": {
                            "type": "array",
                            "description": "Ledger ids (s1, s2, ...) of the ingested sources arguing this position. Empty when covered is false.",
                            "items": {"type": "string"},
                        },
                        "note": {"type": "string", "description": "For an uncovered position: what you searched and what came back instead."},
                    },
                    "required": ["label", "covered"],
                },
            },
            "gaps": {
                "type": "array",
                "description": "What a reader of this corpus would still be missing. Be specific; 'more sources' is not a gap.",
                "items": {"type": "string"},
            },
            "stopped_because": {
                "type": "string",
                "enum": ["covered", "budget", "unproductive"],
                "description": "covered = the range is broad enough; budget = a search or ingest bound was reached; unproductive = searches stopped returning usable sources.",
            },
        },
        "required": ["summary", "positions", "stopped_because"],
    },
}


@dataclass
class CollectionContext:
    """Everything the tools close over. One per run.

    `ingest_one(url, text) -> report` is injected rather than imported so the
    whole path is drivable without the API; the harness passes a closure over
    the store and the guard config (`collect.py`). Same seam as the guard's
    injected client, for the same reason.
    """
    provider: SearchProvider
    read_corpus: Callable[[], tuple]        # () -> (Corpus, raw dict)
    ingest_one: Callable[[str, str], dict]
    corpus_file: str
    max_searches: int
    max_ingests: int
    # How pages are retrieved. Injected like `ingest_one` and for the same
    # reason: a test drives the whole path with a scripted one, and the harness
    # picks Safari or plain HTTP at the entry point rather than in here.
    fetcher: Optional[Fetcher] = None
    # Tokens the whole cascade may spend, and how to ask what it has spent.
    # `per_run_token_cap` bounds each GUARD, and a cascade holds ten of them, so
    # without this the ceiling is ten times the cap. Injected rather than read
    # here because only the entry point knows which guards exist.
    token_budget: Optional[int] = None
    spent_tokens: Optional[Callable[[], int]] = None

    ledger: SourceLedger = field(default_factory=SourceLedger)
    searches_used: int = 0
    ingests_used: int = 0
    # What the agent has already been shown. Every earlier `corpus_state` is
    # still in the message history when a later one arrives, so re-sending
    # anything unchanged is duplication paid for on every subsequent turn.
    seen: Optional[CoverageMark] = None
    # Every tool result the run produced, kept for the report. The message
    # history holds the same thing, but as wire text; this is the structured
    # record a human or a later pass reads.
    trace: list = field(default_factory=list)

    def spent(self) -> int:
        """Tokens this cascade has spent across every guard in it."""
        return self.spent_tokens() if self.spent_tokens else 0

    def within_budget(self) -> bool:
        """False once the cascade's token budget is gone. No budget set means
        no ceiling — the guards' own per-run caps still apply."""
        if not self.token_budget:
            return True
        return self.spent() < self.token_budget


def _dump(obj) -> str:
    return json.dumps(obj, ensure_ascii=False)


def build_collection_tools(ctx: CollectionContext) -> tuple[list, list[dict]]:
    """The four harness callbacks, as (LangChain tools, Anthropic schemas).

    Same convention as `read_tools.build_read_tools`: the description the model
    reads is the tool's own docstring, taken off the LangChain object, so there
    is one copy of it. Only `input_schema` is hand-written.
    """

    @tool
    def search(phrases: list[str], purpose: str) -> str:
        """Run web searches. Give several phrases at once, each aimed at a different position on the thesis; you get back titles and hosts for new sources, each with a ledger id to ingest by. Say in `purpose` which position each phrase is meant to find."""
        out: list[dict] = []
        for phrase in phrases:
            if ctx.searches_used >= ctx.max_searches:
                out.append({"query": phrase, "refused": (
                    f"search budget spent ({ctx.max_searches} phrases). "
                    f"Ingest what the ledger already holds, or submit your "
                    f"collection report.")})
                continue
            ctx.searches_used += 1
            try:
                hits = ctx.provider.search(phrase, RESULTS_PER_PHRASE)
            except SearchError as exc:
                # A provider that fails on one phrase must not cost the run;
                # a guard refusal is NOT a SearchError and is not caught here.
                out.append({"query": phrase, "error": str(exc)})
                continue
            added, dupes = ctx.ledger.add(hits, phrase)
            out.append({
                "query": phrase,
                "new": [s.render() for s in added],
                "already_seen": dupes,
                "searches_left": ctx.max_searches - ctx.searches_used,
            })
        record = {"tool": "search", "purpose": purpose, "results": out}
        ctx.trace.append(record)
        return _dump(out)

    @tool
    def corpus_state() -> str:
        """Read the corpus as it stands: the thesis and how many inferences conclude and contest it, the arguments that target it directly, which of its claims nothing has answered, its open ends, which sources it cites, and every claim tag. After the first call you get the running totals plus only what has CHANGED since you last read -- new tags, new arguments, newly unanswered claims, and any claim a source has since answered. Call this before deciding what to search for next."""
        corpus, raw = ctx.read_corpus()
        # First read sends the whole picture; later ones send only movement,
        # since the earlier readings are still in this conversation.
        cov, ctx.seen = corpus_coverage(corpus, raw, ctx.corpus_file,
                                        mark=ctx.seen)
        cov["sources_ingested"] = ctx.ledger.hosts_ingested()
        cov["ingests_left"] = ctx.max_ingests - ctx.ingests_used
        cov["searches_left"] = ctx.max_searches - ctx.searches_used
        return _dump(cov)

    @tool
    def ingest_sources(source_ids: list[str], reason: str) -> str:
        """Ingest sources by ledger id. Every id you name is fetched; at most a few of the ones that come back readable are then ingested, each by a separate ingestion run that extracts its arguments into the corpus. You get back what landed (claims, inferences, tags), never the document. Name several candidates per position -- about half will be unreadable, and a candidate that is readable but does not fit this call's ingest cap simply waits on the ledger, already fetched, costing nothing. Say in `reason` which position each source is meant to bring in."""
        budget = ctx.max_ingests - ctx.ingests_used
        if budget <= 0:
            return _dump({"refused": (
                f"ingest budget spent ({ctx.max_ingests} sources). Submit your "
                f"collection report.")})
        if not ctx.within_budget():
            return _dump({"refused": (
                f"this run's token budget is spent "
                f"({ctx.spent()} of {ctx.token_budget}). Submit your "
                f"collection report."), "tokens_spent": ctx.spent()})

        # The whole id list goes through: `ingest_batch` owns both caps (how
        # many to fetch, how many of those to ingest) and hands anything over
        # them back unspent. Slicing here would have spent a FETCH slot on a
        # source it then refused to ingest, which is the opposite of what
        # over-naming is for.
        results = ingest_batch(ctx.ledger, list(source_ids),
                               ingest_one=ctx.ingest_one, fetcher=ctx.fetcher,
                               ingest_budget=budget,
                               budget_ok=ctx.within_budget)
        ctx.ingests_used += sum(1 for r in results if r.get("status") == "ingested")

        # Each result lists the tags its source contributed — which is the part
        # corpus_state cannot give, since it knows what was added but not by
        # whom. Marking them shown here stops the next corpus_state repeating
        # the same tags back as "new since your last read": the agent has just
        # been told them, attributed, one line up.
        if ctx.seen is not None:
            landed = {t for r in results for t in (r.get("tags") or ())}
            if landed:
                ctx.seen = replace(ctx.seen, tags=ctx.seen.tags | landed)

        payload: dict = {
            "results": results,
            "ingests_left": ctx.max_ingests - ctx.ingests_used,
            "per_call_ingest_cap": MAX_INGESTS_PER_CALL,
        }
        if ctx.token_budget:
            payload["tokens_spent"] = ctx.spent()
            payload["token_budget"] = ctx.token_budget
        ctx.trace.append({"tool": "ingest_sources", "reason": reason, **payload})
        return _dump(payload)

    lc_tools = [search, corpus_state, ingest_sources]

    _schemas = {
        "search": {
            "type": "object",
            "properties": {
                "phrases": {"type": "array", "items": {"type": "string"},
                            "description": "Search phrases, one per position or angle you are trying to find. Write them as someone arguing that position would; a neutral phrase returns the same consensus coverage every time."},
                "purpose": {"type": "string",
                            "description": "What each phrase is meant to surface. Read back in the run report."},
            },
            "required": ["phrases", "purpose"],
        },
        "corpus_state": {"type": "object", "properties": {}, "required": []},
        "ingest_sources": {
            "type": "object",
            "properties": {
                "source_ids": {"type": "array", "items": {"type": "string"},
                               "description": "Ledger ids from a search result, e.g. [\"s3\", \"s7\"]. Name candidates for the positions you are trying to fill; the harness decides how many are fetched and how many of those are ingested, and tells you which. Pick sources that bring in a position the corpus does not have."},
                "reason": {"type": "string",
                           "description": "Which position each named source is meant to bring in."},
            },
            "required": ["source_ids", "reason"],
        },
    }
    missing = {t.name for t in lc_tools} ^ set(_schemas)
    if missing:
        raise RuntimeError(
            f"collection tool surface mismatch: no input_schema/tool pairing "
            f"for {sorted(missing)}")

    schemas = [{"name": t.name, "description": t.description,
                "input_schema": _schemas[t.name]} for t in lc_tools]
    return lc_tools, schemas


class CollectionAgent(Agent):
    role_prompt: str = COLLECTION

    # Lower than ingestion's 32K: the collection agent emits tool calls and one
    # report, never a corpus of findings. The report is the only large output
    # and 8K is generous for it.
    MAX_TOKENS = 8 * 1024

    def __init__(self, *, guard, ctx: CollectionContext, model: str,
                 iteration_cap: int, max_tokens: int | None = None):
        # Bound before super(), which calls build_tools().
        self.ctx = ctx
        super().__init__(guard=guard, model=model, iteration_cap=iteration_cap,
                         max_tokens=max_tokens)

    def build_tools(self):
        return build_collection_tools(self.ctx)

    def finding_tool(self) -> dict:
        return COLLECTION_FINDING_SCHEMA

    # `apply_finding` is inherited and does nothing. Correct here: this agent's
    # effects already happened in its tools, and there is no plan to execute.
    # The report itself lands in `state.finding`, which `run` reads below.

    def run(self, thesis: str, scope: Optional[str] = None) -> dict:
        """Collect for one corpus. Returns the run report.

        The thesis and scope are folded into the seed message rather than
        threaded through graph state — they are run parameters, same as
        ingestion's (url, document).
        """
        seed = [
            f"Build out the corpus {ctx_name(self.ctx)!r} on this thesis.",
            "",
            f"THESIS: {thesis}",
        ]
        if scope:
            seed += ["", f"SCOPE: {scope}"]
        seed += [
            "",
            f"Budget: {self.ctx.max_searches} search phrases, "
            f"{self.ctx.max_ingests} ingestions. Start by reading corpus_state.",
        ]
        final = self._invoke(RoleState(messages=[HumanMessage(content="\n".join(seed))]))
        finding = final.get("finding") or {}
        return {
            "corpus": self.ctx.corpus_file,
            "thesis": thesis,
            "scope": scope,
            "report": finding,
            "iterations": final.get("iterations", 0),
            "tokens": self.guard.run_tokens,
            "run_id": self.guard.run_id,
            "searches_used": self.ctx.searches_used,
            "ingests_used": self.ctx.ingests_used,
            "sources": [s.render() | {"url": s.url} for s in self.ctx.ledger.all()],
            "trace": self.ctx.trace,
        }


def ctx_name(ctx: CollectionContext) -> str:
    """The corpus slug, for the seed message. The blob name is what the store
    keys on; the slug is what a person calls it."""
    name = ctx.corpus_file
    return name[:-len(".v2.yaml")] if name.endswith(".v2.yaml") else name
