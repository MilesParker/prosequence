#!/usr/bin/env python3
"""Harness entry for the collection agent.

    collect(corpus_name, thesis, scope=None)

The whole run shape. The corpus is seeded from `(name, thesis)` if it does not
exist — deterministic, no model, the same `seed_corpus` `ingest()` uses — and
then the collection agent searches, selects, and dispatches ingestion runs into
it until it reports.

Everything the agent's tools need is assembled here and injected as a
`CollectionContext`, so nothing inside the loop reaches for a store, a config
path, or an API client of its own:

  * `read_corpus`  — reads the store's CURRENT head each call, not a version
    bound at the start. The whole point of the loop is that the corpus changes
    underneath it, and a bound version would show the agent the corpus as it
    was before its own ingestions landed.
  * `ingest_one`   — one ingestion run: fresh session on current head, fresh
    guard, one commit. Guards are per-run on purpose (see below).
  * `provider`     — Google when its credentials are set, else Anthropic web
    search (search.py), on its own guard.
  * `fetcher`      — Safari through AppleScript where it can be driven, plain
    HTTP otherwise (fetch.py). Resolved once, here, so every fetch in a run uses
    one transport and the choice is visible at the entry point.

## A guard per run, not one per cascade

The collection agent gets its own `GuardedClient`; so does every ingestion run
it dispatches, and so does the search provider. All of them share one
`GuardConfig` and one token log.
`per_run_token_cap` is 200k; a cascade of ten ingestions through a single guard
would breach it on the third and kill the collection run, which would quietly
redefine a config value called "per run" to mean "per cascade". Separate guards
keep it meaning what it says. The cascade is bounded instead by `max_ingests`,
and the rolling `cumulative_token_cap` — read from disk, so it spans processes
— still covers every call in it. The token log's `run_id` is what stitches a
cascade back together afterwards.

The search provider needed the same treatment for a reason that was invisible
until it was measured: one Anthropic web search costs ~13k tokens, so twelve
phrases on the agent's own guard would spend three quarters of a 200k per-run
cap before the agent had reasoned about anything.

## The report is written down, including when the run dies

A collection run produces no commit, so without this its reasoning — which
positions it went looking for, which it failed to find, why it stopped —
evaporates with the process. It is written to `logs/collection/<run_id>.json`,
beside the error corpora salvage writes. Gitignored, outside the corpus repo,
same as every other run artifact.

A run that fails terminally gets one too. Both of the bounds that can stop a
collection agent mid-conversation lose the model's report: the per-run token
cap raises, and the iteration cap routes to apply where the last message is a
tool call rather than a finding, so `FindingCallError`. Neither is worth
softening — they are the bounds doing their job — but a measured run reached
112k tokens in ten iterations against a 200k cap, so a longer one WILL hit one
of them, and by then several ingestions have committed real work.

What survives is the harness's own record rather than the model's: the ledger
(which sources were found, fetched, skipped, failed, ingested, with what
delta), the tool trace, and the exception. That is most of what the model's
report would have said about what happened, minus its judgment about what it
means. Written with `partial: true` so the two are never confused.
"""
from __future__ import annotations

import json
import os
import sys
from typing import Optional

import anthropic
import yaml

from ..core.corpus_store import CorpusStore
from ..core.guarded_client import GuardConfig, GuardedClient
from ..core.session import Session
from ..core.yaml_io import load

from .collection import CollectionAgent, CollectionContext
from .ingestion import IngestionRole
from .observability import init_tracing
from .run import CORPUS_DIR, GUARD_CONFIG, REPO_ROOT, load_env, seed_corpus, view_url
from .fetch import Fetcher, default_fetcher
from .search import SearchProvider, default_provider

COLLECTION_LOG_DIR = os.path.join(REPO_ROOT, "logs", "collection")

# Run bounds. Not in guard_config.toml: that file holds GOVERNANCE (token caps,
# kill file, iteration cap) — the bounds that apply to every run of everything.
# These two are this agent's own budget and belong with its call site, the way
# a run parameter does.
#
# The search default is set from the expensive provider, not the cheap one. A
# measured Anthropic web search runs ~14k tokens, so ten phrases is ~140k
# against the search guard's 200k per-run cap — room to spare, where twelve sat
# on the edge and a phrase returning more results than usual would push it over.
# Google CSE costs no tokens at all and could take far more; the default has to
# be safe for whichever provider is actually configured.
DEFAULT_MAX_SEARCHES = 10
DEFAULT_MAX_INGESTS = 8

# Turns the collection agent may take. Higher than the shared `iteration_cap`
# (15) because a collection run is inherently a loop — read state, search,
# ingest, read state again — where ingestion is single-shot and never loops at
# all. A collection run cut off at 15 turns would routinely die before its
# report.
DEFAULT_ITERATION_CAP = 40

# Tokens the whole cascade may spend, across every guard in it. This is the one
# bound `guard_config.toml` cannot express: `per_run_token_cap` (200k) bounds
# each GUARD, and a cascade holds up to ten of them — the collection agent, the
# search provider, and one per ingestion run — so the ceiling without this is
# 2,000,000 tokens. A measured run (5 searches, 6 ingests) came to ~337,000, so
# this sits at roughly twice a real run and a quarter of the unbounded ceiling.
# Checked before each ingestion, because that is the expensive call; on breach
# the tool refuses as a tool result and the agent still writes its report.
DEFAULT_RUN_TOKEN_BUDGET = 750_000


def _write_report(report: dict, run_id: str) -> Optional[str]:
    """Write the run report under `logs/collection/`. Best-effort: a failure to
    write it must not fail a run whose corpus work already committed."""
    try:
        os.makedirs(COLLECTION_LOG_DIR, exist_ok=True)
        path = os.path.join(COLLECTION_LOG_DIR, f"{run_id}.json")
        with open(path, "w", encoding="utf-8") as fh:
            json.dump(report, fh, indent=2, ensure_ascii=False, default=str)
        return path
    except OSError as exc:
        print(f"[collect] could not write run report: {exc}", file=sys.stderr)
        return None


def collect(corpus_name: str, thesis: str, scope: Optional[str] = None, *,
            title: Optional[str] = None,
            max_searches: int = DEFAULT_MAX_SEARCHES,
            max_ingests: int = DEFAULT_MAX_INGESTS,
            iteration_cap: int = DEFAULT_ITERATION_CAP,
            run_token_budget: Optional[int] = DEFAULT_RUN_TOKEN_BUDGET,
            client=None, provider: Optional[SearchProvider] = None,
            fetcher: Optional[Fetcher] = None,
            store: Optional[CorpusStore] = None) -> dict:
    """Populate `corpus_name` with sources arguing `thesis` from a range of
    positions. Returns the run report (also written under `logs/collection/`).

    `scope` is optional prose narrowing what the thesis is about — the same
    role a scope note plays in a brief. It is passed to the agent and to nothing
    else; it never becomes corpus content.

    `client`, `provider`, `fetcher` and `store` are injection points for tests:
    a stub Anthropic client with the same `.messages.stream` surface, a
    `StubProvider`, a scripted fetcher, and a temp-repo store drive the entire
    path without network or API.
    """
    load_env()
    init_tracing()

    corpus_file = f"{corpus_name}.v2.yaml"
    store = store or CorpusStore(CORPUS_DIR)
    config = GuardConfig.load(GUARD_CONFIG)
    if client is None:
        client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY from the env

    if corpus_file not in store.list_corpora():
        # Deterministic harness step, no model — same seeding `ingest()` does.
        # A corpus with zero claims gives ingestion nothing to attach to.
        seed_corpus(store, corpus_file, corpus_name, title or corpus_name, thesis)

    def read_corpus():
        """Current head, every call. A version bound once would show the agent
        the corpus as it was before its own ingestions landed."""
        text = store.read(corpus_file, store.head())
        return load(text), yaml.safe_load(text)

    # Every guard the cascade creates, so the run's total spend is knowable.
    # An ingestion guard is registered at creation, before its call, so a run
    # that dies mid-ingestion still has its tokens counted.
    guards: list = []

    def spent_tokens() -> int:
        return sum(g.run_tokens for g in guards)

    def ingest_one(url: str, document_text: str) -> dict:
        """One ingestion run: fresh session on current head, fresh guard, one
        commit. Serialized by `sources.ingest_batch`, which never calls this
        concurrently — two sessions bound to one head cannot both commit."""
        session = Session(store, corpus_file)
        guard = GuardedClient(client, config, corpus_file)
        guards.append(guard)
        role = IngestionRole(guard=guard, session=session, model=config.model,
                             iteration_cap=config.iteration_cap)
        return role.run(url, document_text,
                        commit_summary=f"collect: ingest of {url}")

    collection_guard = GuardedClient(client, config, corpus_file)
    # Its own guard, for the same reason each ingestion run has one: a search is
    # a separate call, and on the Anthropic provider an expensive one (~13k
    # tokens a phrase, since the server runs the search loop and bills the page
    # results as input). Charging those to the agent's per-run cap would spend
    # it on retrieval rather than reasoning.
    search_guard = GuardedClient(client, config, corpus_file)
    guards.extend((collection_guard, search_guard))
    ctx = CollectionContext(
        provider=provider or default_provider(search_guard),
        read_corpus=read_corpus,
        ingest_one=ingest_one,
        corpus_file=corpus_file,
        max_searches=max_searches,
        max_ingests=max_ingests,
        # Safari where it can be driven, plain HTTP otherwise. Resolved here,
        # once, so the choice is visible at the entry point and every fetch in
        # the run uses the same transport.
        fetcher=fetcher or default_fetcher(),
        token_budget=run_token_budget,
        spent_tokens=spent_tokens,
    )
    agent = CollectionAgent(guard=collection_guard, ctx=ctx, model=config.model,
                            iteration_cap=iteration_cap)

    try:
        report = agent.run(thesis, scope)
    except Exception as exc:
        # The bounds are terminal and stay terminal — this re-raises. What it
        # refuses to lose is the account of a run whose ingestions already
        # committed: same posture as `salvage`, which writes a failed
        # ingestion's graph out before letting the exception through.
        partial = {
            "partial": True,
            "corpus": corpus_file,
            "thesis": thesis,
            "scope": scope,
            "error": f"{type(exc).__name__}: {exc}",
            "run_id": collection_guard.run_id,
            "tokens": collection_guard.run_tokens,
            "search_tokens": search_guard.run_tokens,
            "cascade_tokens": spent_tokens(),
            "searches_used": ctx.searches_used,
            "ingests_used": ctx.ingests_used,
            "head": store.head(),
            "sources": [s.render() | {"url": s.url} for s in ctx.ledger.all()],
            "trace": ctx.trace,
        }
        path = _write_report(partial, collection_guard.run_id)
        print(f"[collect] run failed ({type(exc).__name__}); partial report at "
              f"{path}", file=sys.stderr)
        raise

    # Three token figures, because there are three kinds of run in a cascade and
    # one number would hide which of them was expensive. Ingestion runs are not
    # summed here: each has its own guard and its own line in the token log,
    # which is where a per-cascade total is computed from `run_id`.
    report["search_tokens"] = search_guard.run_tokens
    report["cascade_tokens"] = spent_tokens()
    report["token_budget"] = run_token_budget
    report["view"] = view_url(corpus_file)
    report["head"] = store.head()
    report["report_path"] = _write_report(report, report["run_id"])
    return report


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: python -m prosequence.roles.collect <corpus_name> "
              "<thesis> [scope]", file=sys.stderr)
        return 2
    corpus_name, thesis = argv[0], argv[1]
    scope = argv[2] if len(argv) > 2 else None

    report = collect(corpus_name, thesis, scope)
    finding = report.get("report") or {}

    print(f"corpus:     {report['corpus']}")
    print(f"view:       {report['view']}")
    print(f"head:       {report['head']}")
    print(f"iterations: {report['iterations']}")
    print(f"tokens:     {report['cascade_tokens']:,} of "
          f"{report['token_budget']:,} budget "
          f"({report['tokens']:,} agent + {report['search_tokens']:,} search, "
          f"rest ingestion)")
    print(f"searches:   {report['searches_used']} phrases -> "
          f"{len(report['sources'])} distinct sources")
    print(f"ingested:   {report['ingests_used']}")
    print(f"stopped:    {finding.get('stopped_because', '?')}")
    print(f"report:     {report.get('report_path')}")
    if finding.get("summary"):
        print(f"\n{finding['summary']}")
    print("\npositions:")
    for pos in finding.get("positions") or ():
        mark = "+" if pos.get("covered") else "-"
        print(f"  {mark} {pos.get('label')}")
        if not pos.get("covered") and pos.get("note"):
            print(f"      {pos['note']}")
    gaps = finding.get("gaps") or ()
    if gaps:
        print("\ngaps:")
        for g in gaps:
            print(f"  - {g}")
    print("\nsources:")
    for s in report["sources"]:
        print(f"  {s['id']:>4} {s['state']:<9} {s['host']}  {s['title'][:70]}")
        if s.get("detail"):
            print(f"       {s['detail']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
