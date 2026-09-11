#!/usr/bin/env python3
"""Collection-agent checks — the search/select/ingest cascade end to end.

No API, no network: a scripted Anthropic-shaped stub drives BOTH loops (the
collection agent's and each ingestion run's), a `StubProvider` answers the
searches, a monkeypatched `fetch_text` answers the fetches, and everything runs
against an isolated temp corpus repo (`fresh_store`).

What these are written to hold, in order of what would hurt most if it broke:

  * the cascade actually works — search, select, ingest, commit, report, and
    the commits chain on main rather than forking;
  * the collection agent never sees document text or a url;
  * an ingestion failure costs its source and not the run, while a GUARD
    refusal costs the run;
  * the harness bounds refuse as tool results (the run still reports) and the
    short-document gate drops a stub before it reaches a model;
  * the ledger dedups one article arriving under two search phrases;
  * a terminal stop still leaves an account of what the run did.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import time
import types

os.environ.setdefault("PROSEQUENCE_TRACE", "0")  # no exporter during tests

from prosequence.core.guarded_client import GuardConfig, GuardedClient, KillFilePresent
from prosequence.core.session import Session
from prosequence.core.yaml_io import load
from prosequence.roles.collect import collect
from prosequence.roles.fetch import FetchError, HostThrottle
from prosequence.roles.collection import (
    RESULTS_PER_PHRASE, CollectionAgent, CollectionContext)
from prosequence.roles.ingestion import IngestionRole
from prosequence.roles.search import SearchError, SearchResult, StubProvider
from prosequence.roles.sources import (
    MAX_FETCH_PER_CALL, MAX_INGESTS_PER_CALL, MAX_PER_HOST, MIN_DOCUMENT_CHARS,
    Source, SourceLedger, dedup_key, fetch_many)
from prosequence.tests.test_1d import CORPUS, SRC as SRC_CORPORA, fresh_store
from prosequence.tests.test_role import StubClient, _Resp, _block, _cfg


# --------------------------------------------------------------------------
# Fixtures.
# --------------------------------------------------------------------------

DOC = "A long enough document. " * 200          # comfortably over the floor
STUB_HITS = [
    SearchResult(title="The case for", url="https://alpha.example/for",
                 snippet="argues for", provider="stub"),
    SearchResult(title="The case against", url="https://beta.example/against",
                 snippet="argues against", provider="stub"),
    SearchResult(title="A third angle", url="https://gamma.example/third",
                 snippet="argues sideways", provider="stub"),
]


def _tool_call(name, args, tid="t1"):
    return _Resp([_block(type="tool_use", name=name, input=args, id=tid)],
                 stop="tool_use")


def _ingest_finding(target_id: str, tag: str) -> dict:
    """A minimal valid ingestion finding against `target_id`."""
    return {
        "claims": [{
            "key": "c1", "tag": tag,
            "text": f"An assertion introduced by {tag}.",
            "terminal": False,
            "attribution": {"source": {"type": "Citation",
                                       "reference": "http://x"}, "quote": None},
        }],
        "inferences": [{
            "grounds": ["c1"], "warrants": [], "target": target_id,
            "relation": "concludes", "scheme": "Unknown",
            "schemeDescriptor": "report to fact",
        }],
    }


class _Harness:
    """One temp corpus repo plus the two injected seams the agent's tools need.

    `ingest_client` is a SEPARATE stub from the collection agent's, mirroring
    the real shape: each ingestion run gets its own guard over the same client,
    and the collection agent's own script must not be consumed by them.
    """

    def __init__(self, *, ingest_findings=None, ingest_raises=None):
        self.tmp = tempfile.mkdtemp(prefix="collect-")
        self.store, self.dst = fresh_store()
        self.log = os.path.join(self.tmp, "tok.jsonl")
        self.cfg = _cfg(self.tmp)
        self.ingested: list[str] = []
        self.ingest_guards: list = []
        self.texts_seen: list[str] = []
        self._ingest_findings = list(ingest_findings or [])
        self._ingest_raises = dict(ingest_raises or {})

    def target(self) -> str:
        corpus = load(self.store.read(CORPUS, self.store.head()))
        return next(c.id for c in corpus.claims
                    if not c.terminal and c.attribution is None)

    def read_corpus(self):
        import yaml
        text = self.store.read(CORPUS, self.store.head())
        return load(text), yaml.safe_load(text)

    def ingest_one(self, url: str, text: str) -> dict:
        self.ingested.append(url)
        self.texts_seen.append(text)
        if url in self._ingest_raises:
            raise self._ingest_raises[url]
        finding = (self._ingest_findings.pop(0) if self._ingest_findings
                   else _ingest_finding(self.target(), f"Tag {len(self.ingested)}"))
        session = Session(self.store, CORPUS)
        stub = StubClient([_tool_call("submit_finding", finding)])
        guard = GuardedClient(stub, self.cfg, CORPUS, token_log=self.log)
        self.ingest_guards.append(guard)
        role = IngestionRole(guard=guard, session=session, model="stub-model",
                             iteration_cap=15)
        return role.run(url, text, commit_summary=f"collect: ingest of {url}")

    def agent(self, script, *, provider=None, pages=None, max_searches=12,
              max_ingests=8, iteration_cap=20):
        self.stub = StubClient(script)
        self.guard = GuardedClient(self.stub, self.cfg, CORPUS, token_log=self.log)
        self.fetcher = StubFetcher(pages if pages is not None
                                   else {s.url: DOC for s in STUB_HITS})
        self.ctx = CollectionContext(
            provider=provider or StubProvider(default=STUB_HITS),
            read_corpus=self.read_corpus,
            ingest_one=self.ingest_one,
            corpus_file=CORPUS,
            max_searches=max_searches,
            max_ingests=max_ingests,
            fetcher=self.fetcher,
        )
        return CollectionAgent(guard=self.guard, ctx=self.ctx,
                               model="stub-model", iteration_cap=iteration_cap)


class StubFetcher:
    """A scripted transport, injected through the same seam the harness uses to
    choose Safari or plain HTTP. Returns HTML, because that is what a `Fetcher`
    returns — extraction is shared and runs for real over it."""

    name = "stub"
    max_concurrency = 6

    def __init__(self, pages: dict[str, str]):
        self._pages = dict(pages)
        self.requested: list[str] = []

    def fetch(self, url: str) -> str:
        self.requested.append(url)
        if url not in self._pages:
            raise FetchError("404 Not Found")
        return f"<html><body><p>{self._pages[url]}</p></body></html>"


# --------------------------------------------------------------------------
# Checks. Each returns (ok, detail).
# --------------------------------------------------------------------------

def check_cascade_end_to_end():
    """Search -> select -> ingest -> report, with the corpus growing under it.

    The whole point of the agent in one check. Two sources are ingested in one
    call; both must commit, the second must build on the first (accumulation,
    not sibling commits), and the report must come back with the agent's
    positions in it.
    """
    h = _Harness()
    pages = {"https://alpha.example/for": DOC,
                             "https://beta.example/against": DOC}
    head0 = h.store.head()
    script = [
        _tool_call("search", {"phrases": ["case for x", "case against x"],
                              "purpose": "both sides"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2"],
                                      "reason": "one each way"}, "t2"),
        _tool_call("corpus_state", {}, "t3"),
        _tool_call("submit_collection", {
            "summary": "Both directions represented.",
            "positions": [{"label": "for", "covered": True, "sources": ["s1"]},
                          {"label": "against", "covered": True, "sources": ["s2"]}],
            "gaps": [], "stopped_because": "covered"}, "t4"),
    ]
    agent = h.agent(script, pages=pages)
    report = agent.run("X should happen", "scoped to the UK")

    head1 = h.store.head()
    log = h.store.log(CORPUS)
    # Two ingest commits on top of whatever the fixture started from, and
    # the newer one's parent chain reaches the older: log() walks main, so
    # both appearing in one linear history is the accumulation check.
    ingest_commits = [m for _s, m, _t in log if "collect: ingest of" in m]
    both_ingested = sorted(h.ingested) == [
        "https://alpha.example/for", "https://beta.example/against"]
    final = load(h.store.read(CORPUS, head1))
    base = load(h.store.read(CORPUS, head0))
    grew_by_two = len(final.claims) - len(base.claims) == 2
    reported = (report["report"]["stopped_because"] == "covered"
                and len(report["report"]["positions"]) == 2)
    ok = (head1 != head0 and len(ingest_commits) == 2 and both_ingested
          and grew_by_two and reported and report["ingests_used"] == 2)
    return ok, (f"head_advanced={head1 != head0} ingest_commits="
                f"{len(ingest_commits)} claims_grew_by={len(final.claims) - len(base.claims)} "
                f"ingested={len(h.ingested)} stopped="
                f"{report['report']['stopped_because']}")


def check_agent_never_sees_text_or_url():
    """No document text and no url reaches the collection agent's context.

    The property the whole fetch/ingest design exists to hold. Checked against
    the actual wire messages, not against intent: every user-turn string the
    stub was handed is scanned for the document body and for the url of a
    source that WAS fetched and ingested.
    """
    h = _Harness()
    marker = "UNIQUE-DOCUMENT-MARKER-9F3A"
    pages = {"https://alpha.example/for": DOC + marker}
    script = [
        _tool_call("search", {"phrases": ["case for x"], "purpose": "for"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1"], "reason": "for"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages)
    agent.run("X should happen")

    # Everything that went out on the wire, across all three calls.
    wire = json.dumps(h.stub.sent, default=str)
    text_leaked = marker in wire
    url_leaked = "https://alpha.example/for" in wire
    # ... while the harness did receive it.
    harness_got_it = any(marker in t for t in h.texts_seen)
    ok = (not text_leaked) and (not url_leaked) and harness_got_it
    return ok, (f"text_in_context={text_leaked} url_in_context={url_leaked} "
                f"harness_received_text={harness_got_it}")


def check_ingest_failure_costs_the_source_only():
    """One ingestion raising does not end the collection run.

    Failure-is-terminal is a property of a RUN: the failed ingestion committed
    nothing and its session is dead. The next source is a different run, not a
    retry — so the cascade continues, and the failure is reported back to the
    agent as that source's state.
    """
    h = _Harness(ingest_raises={
        "https://alpha.example/for": RuntimeError("model produced nonsense")})
    pages = {"https://alpha.example/for": DOC,
                             "https://beta.example/against": DOC}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "both"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2"],
                                      "reason": "both"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "one failed", "positions": [],
            "gaps": ["s1 failed"], "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages)
    report = agent.run("X should happen")

    states = {s["id"]: s["state"] for s in report["sources"]}
    # The tool result the agent actually read.
    result = json.loads(h.stub.sent[2]["messages"][-1]["content"][0]["content"])
    failed = next(r for r in result["results"] if r["id"] == "s1")
    ok = (states["s1"] == "failed" and states["s2"] == "ingested"
          and failed["stage"] == "ingest"
          and "model produced nonsense" in failed["detail"]
          and report["ingests_used"] == 1)
    return ok, (f"s1={states['s1']} s2={states['s2']} "
                f"stage={failed['stage']} run_continued=True")


def check_guard_refusal_ends_the_run():
    """A guard refusal inside an ingestion run is NOT swallowed per-source.

    The kill file and the token caps are governance, not a fact about one
    document. `ingest_batch` re-raises `Refused` where it catches everything
    else, so the collection run dies with it.
    """
    h = _Harness(ingest_raises={
        "https://alpha.example/for": KillFilePresent("STOP present")})
    pages = {"https://alpha.example/for": DOC,
                             "https://beta.example/against": DOC}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "both"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2"],
                                      "reason": "both"}, "t2"),
    ]
    agent = h.agent(script, pages=pages)
    raised = None
    try:
        agent.run("X should happen")
    except KillFilePresent as exc:
        raised = type(exc).__name__
    # s2 must never have been attempted: the refusal stops the batch.
    attempted_second = "https://beta.example/against" in h.ingested
    ok = raised == "KillFilePresent" and not attempted_second
    return ok, f"raised={raised} second_source_attempted={attempted_second}"


def check_short_document_is_gated_in_the_harness():
    """A page too short to be a document is dropped before any model sees it.

    The paywall-stub case. It is a length fact, so it is decided here rather
    than shown to the agent to judge — which is what removes the motive for
    ever putting page text in its context.
    """
    h = _Harness()
    pages = {"https://alpha.example/for": "Subscribe to read.",
                             "https://beta.example/against": DOC}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "both"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2"],
                                      "reason": "both"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "one paywalled", "positions": [],
            "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages)
    report = agent.run("X should happen")

    states = {s["id"]: s["state"] for s in report["sources"]}
    never_ingested = "https://alpha.example/for" not in h.ingested
    detail = next(s["detail"] for s in report["sources"] if s["id"] == "s1")
    ok = (states["s1"] == "skipped" and never_ingested
          and str(MIN_DOCUMENT_CHARS) in detail
          and report["ingests_used"] == 1)
    return ok, (f"s1={states['s1']} reached_a_model={not never_ingested} "
                f"floor_named={str(MIN_DOCUMENT_CHARS) in detail}")


def check_bounds_refuse_as_tool_results():
    """Spending the ingest budget refuses in the tool, and the run still reports.

    Bounding is harness-enforced and stopping is the agent's; a bound that
    RAISED would conflate them and lose the report, which is the one artifact a
    collection run produces.
    """
    h = _Harness()
    pages = {s.url: DOC for s in STUB_HITS}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "all"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1"], "reason": "a"}, "t2"),
        _tool_call("ingest_sources", {"source_ids": ["s2", "s3"],
                                      "reason": "b"}, "t3"),
        _tool_call("submit_collection", {
            "summary": "budget spent", "positions": [],
            "stopped_because": "budget"}, "t4"),
    ]
    agent = h.agent(script, pages=pages, max_ingests=2)
    report = agent.run("X should happen")

    second = json.loads(h.stub.sent[3]["messages"][-1]["content"][0]["content"])
    # One of the two named fit the run budget. The other is reported as held
    # back BY THE RUN BUDGET — not by the per-call cap, which would mean
    # something different (come back for it) — and as a tool result, not an
    # exception, so the run still reaches its report.
    held = [r for r in second["results"]
            if r["status"] == "fetched-not-ingested"]
    ok = (report["ingests_used"] == 2 and len(held) == 1
          and held[0]["id"] == "s3" and held[0]["bound_by"] == "run-budget"
          and report["report"]["stopped_because"] == "budget")
    return ok, (f"ingests_used={report['ingests_used']} "
                f"held_back={[(r['id'], r['bound_by']) for r in held]} "
                f"run_reported=True")


def check_search_budget_refuses_per_phrase():
    """The search bound is spent per PHRASE, not per call, and refuses in place."""
    h = _Harness()
    script = [
        _tool_call("search", {"phrases": ["a", "b", "c"], "purpose": "p"}, "t1"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "budget"}, "t2"),
    ]
    agent = h.agent(script, max_searches=2)
    report = agent.run("X should happen")
    results = json.loads(h.stub.sent[1]["messages"][-1]["content"][0]["content"])
    refused = [r for r in results if "refused" in r]
    ok = (report["searches_used"] == 2 and len(refused) == 1
          and refused[0]["query"] == "c")
    return ok, (f"searches_used={report['searches_used']} refused="
                f"{[r['query'] for r in refused]}")


def check_ledger_dedups_one_article_across_phrases():
    """One article found by two phrases costs one ledger id and one ingestion.

    Checked at the ledger rather than through the agent, because this is where
    it happens and the url variations are the point.
    """
    ledger = SourceLedger()
    a = SearchResult(title="T", url="https://x.example/a?utm_source=news",
                     provider="stub")
    b = SearchResult(title="T", url="https://www.x.example/a/", provider="stub")
    c = SearchResult(title="U", url="https://x.example/b", provider="stub")
    first, d1 = ledger.add([a], "phrase one")
    second, d2 = ledger.add([b, c], "phrase two")
    ok = (len(first) == 1 and d1 == 0 and len(second) == 1 and d2 == 1
          and dedup_key(a.url) == dedup_key(b.url)
          and [s.id for s in ledger.all()] == ["s1", "s2"])
    return ok, (f"first={[s.id for s in first]} second={[s.id for s in second]} "
                f"dupes={d2} keys_match={dedup_key(a.url) == dedup_key(b.url)}")


def check_provider_error_does_not_end_the_run():
    """A provider failing on one phrase is reported, not raised.

    One 429 must not cost a collection run that has already spent ingestions.
    """
    class _Angry(StubProvider):
        def search(self, query, limit):
            if "bad" in query:
                raise SearchError("provider said 429")
            return super().search(query, limit)

    h = _Harness()
    script = [
        _tool_call("search", {"phrases": ["bad phrase", "good phrase"],
                              "purpose": "p"}, "t1"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "unproductive"}, "t2"),
    ]
    agent = h.agent(script, provider=_Angry(default=STUB_HITS))
    report = agent.run("X should happen")
    results = json.loads(h.stub.sent[1]["messages"][-1]["content"][0]["content"])
    errored = [r for r in results if "error" in r]
    ok = (len(errored) == 1 and "429" in errored[0]["error"]
          and len(report["sources"]) == len(STUB_HITS))
    return ok, (f"errors={len(errored)} sources_found={len(report['sources'])} "
                f"run_completed=True")


def check_terminal_stop_still_writes_a_partial_report():
    """A run cut short still leaves an account of what it did.

    Both bounds that stop a collection agent mid-conversation lose the model's
    report — the token cap raises, and the iteration cap routes to apply where
    the last message is a tool call, so FindingCallError. The failure stays
    terminal; what must not be lost is the ledger and trace of a run whose
    ingestions already committed. Driven through `collect()` because the
    salvage lives at the entry point, not in the agent.
    """
    h = _Harness()
    pages = {s.url: DOC for s in STUB_HITS}
    # One stub client serves BOTH loops, so the script is in consumption
    # order: agent turn 1, agent turn 2, the ingestion run that turn 2's
    # tool call spawns, then agent turn 3 — which the cap converts into a
    # terminal apply with a tool call, not a finding, as its last message.
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1"], "reason": "r"}, "t2"),
        _tool_call("submit_finding", _ingest_finding(h.target(), "Salvaged"), "t3"),
        _tool_call("corpus_state", {}, "t4"),
    ]
    raised = None
    try:
        collect("freedman", "A thesis.", None,
                max_searches=4, max_ingests=4, iteration_cap=3,
                client=StubClient(script),
                provider=StubProvider(default=STUB_HITS),
                fetcher=StubFetcher(pages),
                store=h.store)
    except Exception as exc:
        raised = type(exc).__name__

    # The newest report on disk is this run's. Found by run_id would need
    # the guard, which `collect` owns; newest-by-mtime is enough here.
    import glob
    from prosequence.roles.collect import COLLECTION_LOG_DIR
    newest = max(glob.glob(os.path.join(COLLECTION_LOG_DIR, "*.json")),
                 key=os.path.getmtime)
    with open(newest) as fh:
        saved = json.load(fh)
    ingested = [s for s in saved.get("sources", []) if s["state"] == "ingested"]
    ok = (raised == "FindingCallError" and saved.get("partial") is True
          and "FindingCallError" in saved.get("error", "")
          and len(ingested) == 1 and saved["ingests_used"] == 1)
    return ok, (f"raised={raised} partial={saved.get('partial')} "
                f"ingested_recorded={len(ingested)} "
                f"file={os.path.basename(newest)}")


def check_host_cap_stops_leaning_on_one_site():
    """A run stops drawing from a host once it has taken MAX_PER_HOST pages.

    Two things want this and they agree: a burst off one site looks like
    scraping — and on the Safari path it is the operator's own browser and IP
    making it — while a corpus leaning on one outlet is the concentration the
    breadth goal is against. Checked at the point that matters: the capped
    source must never reach the network at all.
    """
    hits = [SearchResult(title=f"Piece {n}", url=f"https://one.example/{n}",
                         provider="stub") for n in range(MAX_PER_HOST + 2)]
    h = _Harness()
    pages = {r.url: DOC for r in hits}
    ids = [f"s{n + 1}" for n in range(len(hits))]
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ids, "reason": "all"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages,
                    provider=StubProvider(default=hits), max_ingests=99)
    report = agent.run("X should happen")

    ingested = [s for s in report["sources"] if s["state"] == "ingested"]
    capped = [s for s in report["sources"]
              if s["state"] == "skipped" and "already drawn" in (s["detail"] or "")]
    # The decisive part: a capped source costs no request.
    never_requested = all(s["id"] not in [c["id"] for c in capped]
                          for s in report["sources"] if s["id"] in
                          [i for i, u in enumerate(h.fetcher.requested)])
    requested_hosts = len(h.fetcher.requested)
    ok = (len(ingested) == MAX_PER_HOST and len(capped) == 2
          and requested_hosts == MAX_PER_HOST and never_requested)
    return ok, (f"ingested={len(ingested)} capped={len(capped)} "
                f"pages_actually_requested={requested_hosts} "
                f"(cap={MAX_PER_HOST})")


def check_fetch_width_follows_the_fetcher():
    """`fetch_many` never runs wider than the transport allows.

    Safari is one browser, so `max_concurrency` is 1 and the pool has to degrade
    to a serial loop. Asserted by watching actual overlap rather than by reading
    the width off the pool, because the pool size is the thing under test.
    """
    import threading

    class _Counting:
        name, max_concurrency = "counting", 1

        def __init__(self):
            self.live = 0
            self.peak = 0
            self._lock = threading.Lock()

        def fetch(self, url):
            with self._lock:
                self.live += 1
                self.peak = max(self.peak, self.live)
            time.sleep(0.3)
            with self._lock:
                self.live -= 1
            return f"<html><body><p>{DOC}</p></body></html>"

    serial = _Counting()
    srcs = [Source(id=f"s{n}", url=f"https://h{n}.example/a", title="t",
                   host=f"h{n}.example", snippet=None, provider="stub",
                   found_for="q") for n in range(4)]
    free = HostThrottle(interval=0)   # not hitting a server; no politeness owed
    fetch_many(srcs, fetcher=serial, throttle=free)

    wide = _Counting()
    wide.max_concurrency = 4
    fetch_many(srcs, fetcher=wide, throttle=free)

    ok = serial.peak == 1 and wide.peak > 1
    return ok, (f"serial_peak_concurrency={serial.peak} (want 1) "
                f"parallel_peak_concurrency={wide.peak} (want >1)")


def check_host_throttle_spaces_same_host_hits():
    """Two fetches of one host are spaced; two hosts are not made to wait."""
    t = HostThrottle(interval=0.3)
    start = time.monotonic()
    t.wait("https://a.example/1")
    t.wait("https://a.example/2")
    same_host = time.monotonic() - start

    start = time.monotonic()
    t.wait("https://b.example/1")
    t.wait("https://c.example/1")
    diff_hosts = time.monotonic() - start

    ok = same_host >= 0.3 and diff_hosts < 0.2
    return ok, (f"same_host_gap={same_host:.2f}s (want >=0.30) "
                f"two_different_hosts={diff_hosts:.2f}s (want <0.20)")


def check_over_naming_cannot_overspend_ingestions():
    """Naming many candidates costs at most MAX_INGESTS_PER_CALL ingestions.

    The prompt tells the agent to over-name, because half of what it names is
    unreadable. That instruction is only safe if the harness guarantees the
    other half cannot all be ingested — otherwise "name five to survive the
    failure rate" and "spend five ingestions" are the same act. Enforced in
    code, so it holds whatever the model asks for.

    The surplus must also stay SPENDABLE: fetched, cached, and still `found`.
    """
    hits = [SearchResult(title=f"P{n}", url=f"https://h{n}.example/a",
                         provider="stub") for n in range(6)]
    h = _Harness()
    pages = {r.url: DOC for r in hits}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": [f"s{n+1}" for n in range(6)],
                                      "reason": "everything at once"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages, provider=StubProvider(default=hits),
                    max_ingests=99)
    report = agent.run("X should happen")

    result = json.loads(h.stub.sent[2]["messages"][-1]["content"][0]["content"])
    ingested = [r for r in result["results"] if r["status"] == "ingested"]
    waiting = [r for r in result["results"]
               if r["status"] == "fetched-not-ingested"]
    # Every readable candidate was fetched; only the cap's worth was ingested.
    fetched_all = len(h.fetcher.requested) == 6
    surplus = [h.ctx.ledger.get(r["id"]) for r in waiting]
    surplus_reusable = all(
        src is not None and src.state == "found" and src.text is not None
        for src in surplus)
    ok = (len(ingested) == MAX_INGESTS_PER_CALL and len(waiting) == 3
          and fetched_all and surplus_reusable
          and report["ingests_used"] == MAX_INGESTS_PER_CALL)
    return ok, (f"named=6 fetched={len(h.fetcher.requested)} "
                f"ingested={len(ingested)} (cap={MAX_INGESTS_PER_CALL}) "
                f"waiting={len(waiting)} surplus_cached={surplus_reusable}")


def check_deferred_candidate_is_not_refetched():
    """Re-naming a `fetched-not-ingested` source costs no second request.

    The point of leaving the surplus in `found` state with its text cached: the
    agent is meant to come back for it, and coming back must not re-hit the
    server — which would also double-count it against the per-host cap.
    """
    hits = [SearchResult(title=f"P{n}", url=f"https://h{n}.example/a",
                         provider="stub") for n in range(4)]
    h = _Harness()
    pages = {r.url: DOC for r in hits}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2", "s3", "s4"],
                                      "reason": "first pass"}, "t2"),
        _tool_call("ingest_sources", {"source_ids": ["s4"],
                                      "reason": "the one that waited"}, "t3"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t4"),
    ]
    agent = h.agent(script, pages=pages, provider=StubProvider(default=hits),
                    max_ingests=99)
    report = agent.run("X should happen")

    second = json.loads(h.stub.sent[3]["messages"][-1]["content"][0]["content"])
    took_it = [r for r in second["results"] if r["status"] == "ingested"]
    # Four fetches across both calls, not five: the deferred one was cached.
    ok = (len(h.fetcher.requested) == 4
          and [r["id"] for r in took_it] == ["s4"]
          and report["ingests_used"] == MAX_INGESTS_PER_CALL + 1)
    return ok, (f"total_fetches={len(h.fetcher.requested)} (want 4, not 5) "
                f"second_call_ingested={[r['id'] for r in took_it]}")


def check_fetch_per_call_cap_leaves_extras_unspent():
    """Past MAX_FETCH_PER_CALL, extra ids are not even fetched — and unchanged.

    A bound on the burst one call can produce. The extras must stay `found`:
    refusing to fetch something is not the same as consuming it.
    """
    # Bounded by what one search phrase yields (RESULTS_PER_PHRASE), so the
    # extras are genuinely deferred candidates rather than ids that never
    # existed on the ledger.
    n = min(RESULTS_PER_PHRASE, MAX_FETCH_PER_CALL + 3)
    hits = [SearchResult(title=f"P{i}", url=f"https://h{i}.example/a",
                         provider="stub") for i in range(n)]
    h = _Harness()
    pages = {r.url: DOC for r in hits}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": [f"s{i+1}" for i in range(n)],
                                      "reason": "far too many"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t3"),
    ]
    agent = h.agent(script, pages=pages, provider=StubProvider(default=hits),
                    max_ingests=99)
    agent.run("X should happen")

    result = json.loads(h.stub.sent[2]["messages"][-1]["content"][0]["content"])
    skipped = [r for r in result["results"] if r["status"] == "not-attempted"]
    deferred = [h.ctx.ledger.get(r["id"]) for r in skipped]
    unchanged = all(src is not None and src.state == "found" for src in deferred)
    ok = (len(h.fetcher.requested) == MAX_FETCH_PER_CALL
          and len(skipped) == n - MAX_FETCH_PER_CALL and unchanged)
    return ok, (f"named={n} fetched={len(h.fetcher.requested)} "
                f"(cap={MAX_FETCH_PER_CALL}) not_attempted={len(skipped)} "
                f"left_spendable={unchanged}")


def check_coverage_foregrounds_the_unanswered_not_the_disputed():
    """Rendered arguments are the UNANSWERED ones, not the ones already in dispute.

    A collection run exists to find what is missing. Rendering disputed
    arguments richly — where opposing sides are already present — while leaving
    the unanswered ones as bare tags puts the detail, and so the agent's
    attention, on explored ground. Every rendered argument must therefore either
    target a thesis (the run's scoreboard) or conclude something nothing
    contests (the frontier); a claim already under attack must appear as a
    COUNT and nowhere else.

    Run against a real corpus, because the property is about graph shape and a
    two-node fixture cannot exhibit it.
    """
    import yaml
    from prosequence.core.yaml_io import load, Relation
    from prosequence.roles.coverage import corpus_coverage

    text = open(os.path.join(SRC_CORPORA, "gaza.v2.yaml")).read()
    corpus = load(text)
    cov, _mark = corpus_coverage(corpus, yaml.safe_load(text), "gaza.v2.yaml")

    by_id = {c.id: c for c in corpus.claims}
    tag = lambda i: getattr(by_id.get(i), "tag", "?")
    theses = set(corpus.theses)
    contested = {i.target for i in corpus.inferences
                 if i.relation is Relation.CONTESTS}
    concluded = {i.target for i in corpus.inferences
                 if i.relation is Relation.CONCLUDES}
    unanswered = {t for t in concluded if t not in contested and t not in theses}

    on_thesis = cov["arguments_on_thesis"]
    standing = cov["arguments_unanswered"]
    blob = json.dumps(cov, ensure_ascii=False)

    thesis_tags = {tag(t) for t in theses}
    unanswered_tags = {tag(t) for t in unanswered}
    contested_tags = {tag(t) for t in contested if t not in theses}

    # Every thesis-level inference is present, both directions.
    all_thesis = len(on_thesis) == sum(1 for i in corpus.inferences
                                       if i.target in theses)
    both_ways = {a["rel"] for a in on_thesis} == {"concludes", "contests"}
    # Every rendered frontier argument concludes something nothing answers...
    frontier_only = all(a["to"] in unanswered_tags and a["rel"] == "concludes"
                        for a in standing)
    # ...and no argument INTO a contested claim is rendered anywhere.
    no_disputed_rendered = not any(
        a["to"] in contested_tags for a in (*on_thesis, *standing)
        if a["to"] not in thesis_tags)
    # The disputed region is acknowledged as a number and nothing else.
    counted = cov["claims_in_dispute"] == len(contested - theses)
    # And the old bare tag list is gone: its content lives in the renderings.
    no_bare_list = "unopposed" not in cov
    no_uuid = not any(len(p) == 36 and p.count("-") == 4
                      for p in blob.replace('"', " ").split())

    ok = (all_thesis and both_ways and frontier_only and no_disputed_rendered
          and counted and no_bare_list and no_uuid and len(standing) > 0)
    return ok, (f"thesis={len(on_thesis)} (all={all_thesis}, both={both_ways}) "
                f"unanswered={len(standing)} frontier_only={frontier_only} "
                f"disputed_rendered={not no_disputed_rendered} "
                f"claims_in_dispute={cov['claims_in_dispute']}")


def check_unopposed_names_only_unanswered_claims():
    """`unopposed` is claims something concludes and nothing contests.

    The sharpest collection signal in the read: each entry is a place the corpus
    asserts something no source has answered. A thesis is excluded — it is the
    question, not an unanswered assertion — and anything already contested is
    excluded by definition.
    """
    import yaml
    from prosequence.core.yaml_io import load, Relation
    from prosequence.roles.coverage import corpus_coverage

    text = open(os.path.join(SRC_CORPORA, "gaza.v2.yaml")).read()
    corpus = load(text)
    cov, _mark = corpus_coverage(corpus, yaml.safe_load(text), "gaza.v2.yaml")

    by_tag = {c.tag: c.id for c in corpus.claims}
    contested = {i.target for i in corpus.inferences
                 if i.relation is Relation.CONTESTS}
    concluded = {i.target for i in corpus.inferences
                 if i.relation is Relation.CONCLUDES}
    # The unanswered claims are now the targets of the frontier arguments.
    ids = {by_tag[a["to"]] for a in cov["arguments_unanswered"]
           if a["to"] in by_tag}

    none_contested = not (ids & contested)
    all_concluded = ids <= concluded
    no_theses = not (ids & set(corpus.theses))
    # And no attributive claims, which falls out of I5 rather than being
    # filtered here: nothing may conclude an attributive claim, so a
    # source-report can never enter `concluded` and never appear as an
    # unanswered position. Asserted so a future I5 change surfaces here.
    by_id = {c.id: c for c in corpus.claims}
    no_attributive = all(by_id[i].attribution is None for i in ids)
    ok = (bool(ids) and none_contested and all_concluded and no_theses
          and no_attributive)
    return ok, (f"unopposed={len(ids)} none_are_contested={none_contested} "
                f"all_are_concluded={all_concluded} theses_excluded={no_theses} "
                f"attributive_excluded_by_I5={no_attributive}")


def check_a_tag_is_never_reported_twice():
    """What an ingestion reported is not repeated by the next `corpus_state`.

    Two channels carry new claim tags, and each has something the other cannot:
    an `ingest_sources` result attributes tags to the SOURCE that produced them;
    a `corpus_state` delta carries everything added since the last read. Left
    alone they overlap completely on the common path — ingest, then read state —
    and the overlap is paid for on every subsequent turn, since full history
    goes out on every call.

    So an ingestion advances the coverage mark. What must hold: the first read
    is complete, the ingestion reports its tag attributed to its source, and the
    read after that does NOT list it again while still counting it in the total.
    """
    h = _Harness()
    pages = {s.url: DOC for s in STUB_HITS}
    script = [
        _tool_call("corpus_state", {}, "t1"),
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t2"),
        _tool_call("ingest_sources", {"source_ids": ["s1"], "reason": "r"}, "t3"),
        _tool_call("corpus_state", {}, "t4"),
        _tool_call("submit_collection", {
            "summary": "s", "positions": [], "stopped_because": "covered"}, "t5"),
    ]
    agent = h.agent(script, pages=pages)
    agent.run("X should happen")

    first = json.loads(h.stub.sent[1]["messages"][-1]["content"][0]["content"])
    ingest = json.loads(h.stub.sent[3]["messages"][-1]["content"][0]["content"])
    second = json.loads(h.stub.sent[4]["messages"][-1]["content"][0]["content"])

    landed = [t for r in ingest["results"] for t in (r.get("tags") or ())]
    delta = second.get("since_your_last_read", {})
    repeated = set(landed) & set(delta.get("new_claim_tags", []))

    full_keys = {"claim_tags", "arguments_on_thesis", "arguments_unanswered",
                 "open_ends", "citation_sources"}
    ok = (full_keys <= set(first)                    # first read is complete
          and not (full_keys & set(second))          # second is a delta
          and len(landed) == 1                       # attributed to its source
          and not repeated                           # and not said twice
          and second["claim_tags_total"] == first["claim_tags_total"] + 1
          # The scoreboard is always re-sent: it is the balance picture.
          and "theses" in second
          and "claims_connected_to_thesis" in second
          and len(json.dumps(second)) < len(json.dumps(first)))
    return ok, (f"ingestion reported {landed}; next read repeated "
                f"{sorted(repeated) or 'nothing'}; total still "
                f"{second['claim_tags_total']}; first="
                f"{len(json.dumps(first)):,}c second={len(json.dumps(second)):,}c")


def check_disconnected_corpus_is_visible():
    """A corpus whose claims are unreachable from its thesis says so.

    Found by measuring across every corpus on disk rather than the single one
    this module was developed against: an ingestion-built corpus had 1 of 52
    claims connected to its thesis — 23 inferences arguing about the right topic
    and nothing about the question. Every other number in the read looked
    healthy, and `concluded_by: 0` reads like an early run rather than a broken
    one.
    """
    import yaml
    from prosequence.core.yaml_io import load
    from prosequence.roles.coverage import corpus_coverage

    out = {}
    for name in ("china-ai-2", "gaza"):
        path = os.path.join(SRC_CORPORA, f"{name}.v2.yaml")
        if not os.path.exists(path):
            return False, f"fixture corpus {name} missing"
        text = open(path).read()
        cov, _ = corpus_coverage(load(text), yaml.safe_load(text), name)
        out[name] = (cov["claims_connected_to_thesis"], cov["claims"])

    broken, whole = out["china-ai-2"], out["gaza"]
    ok = broken[0] < broken[1] / 2 and whole[0] == whole[1]
    return ok, (f"china-ai-2 {broken[0]}/{broken[1]} connected (detected as "
                f"disconnected), gaza {whole[0]}/{whole[1]} (healthy)")


def check_cascade_token_budget_stops_further_ingestion():
    """A cascade cannot outspend its token budget, whatever the model asks for.

    `per_run_token_cap` bounds each GUARD, and a cascade holds up to ten of them
    — the collection agent, the search provider, and one per ingestion run — so
    without a cascade-level bound the ceiling is ten times the cap. This is the
    one control `guard_config.toml` cannot express.

    Checked BEFORE each ingestion, because the ingestion is the expensive call
    and the point is not to make it. What must hold: ingestion stops at the
    budget, the sources not taken are left spendable rather than consumed, and
    the run still reaches its report — a budget is a bound, not a kill.
    """
    hits = [SearchResult(title=f"P{n}", url=f"https://h{n}.example/a",
                         provider="stub") for n in range(3)]
    h = _Harness()
    pages = {r.url: DOC for r in hits}
    script = [
        _tool_call("search", {"phrases": ["x"], "purpose": "p"}, "t1"),
        _tool_call("ingest_sources", {"source_ids": ["s1", "s2", "s3"],
                                      "reason": "all three"}, "t2"),
        _tool_call("submit_collection", {
            "summary": "budget", "positions": [],
            "stopped_because": "budget"}, "t3"),
    ]
    agent = h.agent(script, pages=pages, provider=StubProvider(default=hits),
                    max_ingests=99)
    # Cascade spend is every guard, exactly as `collect.py` sums it. The stub
    # bills 140 tokens a call, so two agent turns (280) plus one ingestion (140)
    # crosses 400 and the second ingestion is refused before it is made.
    h.ctx.token_budget = 400
    h.ctx.spent_tokens = lambda: (h.guard.run_tokens
                                  + sum(g.run_tokens for g in h.ingest_guards))
    report = agent.run("X should happen")

    result = json.loads(h.stub.sent[2]["messages"][-1]["content"][0]["content"])
    ingested = [r for r in result["results"] if r["status"] == "ingested"]
    held = [r for r in result["results"]
            if r["status"] == "fetched-not-ingested"]
    # Everything was fetched (cheap); ingestion stopped at the budget.
    all_fetched = len(h.fetcher.requested) == 3
    by_budget = [r for r in held if r.get("bound_by") == "token-budget"]
    left_spendable = all(
        (lambda src: src is not None and src.state == "found")(
            h.ctx.ledger.get(r["id"])) for r in held)
    reported = report["report"]["stopped_because"] == "budget"

    ok = (all_fetched and len(ingested) < 3 and by_budget
          and left_spendable and reported)
    return ok, (f"fetched={len(h.fetcher.requested)}/3 "
                f"ingested={len(ingested)} held_by_token_budget={len(by_budget)} "
                f"left_spendable={left_spendable} run_reported={reported}")



# --------------------------------------------------------------------------

CHECKS = [
    ("collection cascade: search -> ingest -> report", check_cascade_end_to_end),
    ("agent context holds no document text and no url",
     check_agent_never_sees_text_or_url),
    ("an ingestion failure costs its source, not the run",
     check_ingest_failure_costs_the_source_only),
    ("a guard refusal ends the collection run", check_guard_refusal_ends_the_run),
    ("a too-short page is gated before any model",
     check_short_document_is_gated_in_the_harness),
    ("ingest bound refuses as a tool result", check_bounds_refuse_as_tool_results),
    ("search bound is spent per phrase", check_search_budget_refuses_per_phrase),
    ("ledger dedups one article across phrases",
     check_ledger_dedups_one_article_across_phrases),
    ("a provider error does not end the run",
     check_provider_error_does_not_end_the_run),
    ("a terminal stop still writes a partial report",
     check_terminal_stop_still_writes_a_partial_report),
    ("the per-host cap stops a run leaning on one site",
     check_host_cap_stops_leaning_on_one_site),
    ("fetch width follows the fetcher's concurrency",
     check_fetch_width_follows_the_fetcher),
    ("the host throttle spaces same-host hits",
     check_host_throttle_spaces_same_host_hits),
    ("over-naming cannot overspend the ingest budget",
     check_over_naming_cannot_overspend_ingestions),
    ("a deferred candidate is not fetched twice",
     check_deferred_candidate_is_not_refetched),
    ("the per-call fetch cap leaves extras unspent",
     check_fetch_per_call_cap_leaves_extras_unspent),
    ("coverage foregrounds the unanswered, not the disputed",
     check_coverage_foregrounds_the_unanswered_not_the_disputed),
    ("the unanswered frontier holds only unanswered claims",
     check_unopposed_names_only_unanswered_claims),
    ("a tag is never reported twice", check_a_tag_is_never_reported_twice),
    ("a thesis-disconnected corpus is visible",
     check_disconnected_corpus_is_visible),
    ("the cascade token budget stops further ingestion",
     check_cascade_token_budget_stops_further_ingestion),
]


def main() -> int:
    failed = 0
    for label, fn in CHECKS:
        try:
            ok, detail = fn()
        except Exception as exc:  # a check that blew up is a failure
            ok, detail = False, f"EXCEPTION {type(exc).__name__}: {exc}"
        print(f"[{'PASS' if ok else 'FAIL'}] {label}")
        print(f"        {detail}")
        failed += 0 if ok else 1
    print(f"\n{len(CHECKS) - failed}/{len(CHECKS)} checks passed")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
