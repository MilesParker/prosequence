#!/usr/bin/env python3
"""The source ledger, and the fetch/ingest step the collection agent drives.

The collection agent never handles a url and never sees a document. It sees
LEDGER IDS — `s1`, `s2`, ... — assigned here when a search result first
arrives, and it spends them by asking for the sources behind them to be
ingested. The harness resolves an id to the url it recorded, fetches it, and
hands the text to an ingestion run. What comes back to the agent is the corpus
delta, never the text.

Two properties this module exists to hold:

* **Fetching is as parallel as the fetcher allows; ingesting is never.** Fetch
  is deterministic harness I/O with no store contact, so it parallelizes safely
  up to `fetcher.max_concurrency` — 6 for plain HTTP, 1 for Safari, which is one
  browser. Ingestion cannot overlap at any width: `Session` binds head at
  construction and passes it as `parent_sha`, so a second run started from the
  same head is refused with `HeadMoved` — terminal, no retry. Even if it
  committed, its model reasoned over a corpus missing the first run's claims,
  so every overlap between the two documents would land twice. Ingestion's
  whole attachment premise is that the corpus in front of it is current.

* **A run does not lean on one host.** `MAX_PER_HOST` caps how many pages a
  single collection run pulls from one site; past it a source is skipped with a
  reason the agent reads. Two things want this and they agree: pulling six pages
  off one site in a minute looks like scraping — and on the Safari path it is
  the operator's own browser and IP doing it — while a corpus drawing repeatedly
  on one outlet is exactly the concentration the breadth goal is against.
  `fetch.HostThrottle` handles the other half, spacing hits within a host.

* **An ingestion failure ends that ingestion run, not the collection run.**
  Failure-is-terminal is a property of a run: nothing is committed, the error
  corpus is salvaged under `logs/failed/`, and the session is dead. The next
  source is a DIFFERENT run with a different session — not a retry, not a
  recovery. Guard refusals are the exception and are re-raised: a kill file or
  a breached cap is not a fact about one source.
"""
from __future__ import annotations

import concurrent.futures
from dataclasses import dataclass, field
from typing import Callable, Iterable, Optional, Sequence
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ..core.guarded_client import Refused
from .fetch import (
    Fetcher, FetchError, HostThrottle, default_fetcher, fetch_text)
from .search import SearchResult, host_of

# Below this many characters of extracted text a page is not a document: it is a
# paywall stub, a cookie wall, a nav shell, or a redirect notice. Gated in the
# harness rather than shown to the agent to judge, because it is a length fact
# and because showing it text is exactly what the design is avoiding.
MIN_DOCUMENT_CHARS = 1200

# Ceiling on concurrent fetches. The FETCHER's own `max_concurrency` is the
# other half of the min() — Safari is 1, because there is one browser.
FETCH_WORKERS = 6

# Pages one collection run may take from a single host. Both a politeness bound
# (a burst off one site looks like scraping, and on the Safari path it is the
# operator's own browser making it) and a breadth one (a corpus leaning on one
# outlet is the concentration the run is trying to avoid). Skipped sources are
# reported to the agent with the reason, so it diversifies rather than retrying.
MAX_PER_HOST = 3

# How many candidates one `ingest_sources` call will FETCH, and how many of the
# ones that fetch cleanly it will INGEST. The two differ on purpose, and the gap
# between them is the whole point.
#
# The agent is told to over-name, because roughly half of what it names is
# unreadable and a failed fetch costs nothing. Under the old shape that
# instruction was a footgun: every named source that happened to fetch WAS
# ingested, so "name five to survive the failure rate" and "spend five
# ingestions" were the same act, and the only thing in the way was the run-level
# total. Now naming five costs at most MAX_INGESTS_PER_CALL ingestions whatever
# happens, and the surplus goes back on the ledger already fetched.
#
# Enforced here rather than asked for in the prompt: an instruction the model can
# reason its way past is not a cap.
MAX_FETCH_PER_CALL = 8
MAX_INGESTS_PER_CALL = 3

# Tracking parameters dropped before a url becomes a dedup key. Not an attempt at
# a general canonicaliser — these are the ones that make one article look like
# three across search phrases.
_TRACKING_PREFIXES = ("utm_",)
_TRACKING_KEYS = {"fbclid", "gclid", "mc_cid", "mc_eid", "ref", "ref_src", "cmpid"}


def dedup_key(url: str) -> str:
    """A url reduced to what identifies the document: scheme dropped, host
    lowercased and de-`www.`-ed, fragment dropped, tracking params removed,
    trailing slash removed. Two search phrases returning the same article under
    different campaign tags must cost one ingestion, not two."""
    parts = urlsplit(url)
    host = host_of(url)
    query = urlencode([
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in _TRACKING_KEYS
        and not any(k.lower().startswith(p) for p in _TRACKING_PREFIXES)
    ])
    path = parts.path.rstrip("/")
    return urlunsplit(("", host, path, query, ""))


@dataclass
class Source:
    """One candidate document, and what has happened to it.

    Mutable on purpose. The immutability rule in this codebase is about corpus
    NODES — a graph version shares every unchanged node — and a source is
    per-run bookkeeping that never reaches the store. Freezing it would mean
    rebuilding the ledger on every state change to record that a fetch failed.
    """
    id: str
    url: str
    title: str
    host: str
    snippet: Optional[str]
    provider: str
    found_for: str                       # the search phrase that surfaced it
    published: Optional[str] = None      # the provider's date string, verbatim

    # 'found' -> 'ingested' | 'skipped' | 'failed'
    state: str = "found"
    detail: Optional[str] = None          # why skipped/failed, in one line
    chars: Optional[int] = None           # extracted length, when fetched
    sha: Optional[str] = None             # the commit, when ingested
    claims_added: int = 0
    inferences_added: int = 0

    # Extracted text, held once fetched so a candidate the per-call ingest cap
    # deferred is not fetched twice. Never rendered and never leaves the harness
    # — `render()` is what the agent sees, and this is deliberately not in it.
    text: Optional[str] = field(default=None, repr=False)

    def render(self) -> dict[str, object]:
        """What the collection agent sees. Deliberately not the whole record:
        no text ever, and no url beyond its host — the agent selects by id, and
        a url in its context is a url it could put in a search phrase."""
        d: dict[str, object] = {"id": self.id, "title": self.title,
                                "host": self.host, "state": self.state}
        if self.snippet:
            d["snippet"] = self.snippet
        if self.published:
            d["published"] = self.published
        if self.detail:
            d["detail"] = self.detail
        if self.state == "ingested":
            d["claims_added"] = self.claims_added
            d["inferences_added"] = self.inferences_added
        return d


@dataclass
class SourceLedger:
    """Every source the run has seen, keyed by id, deduped by url.

    The ledger is the harness's, not the model's: it is the only thing that maps
    an id back to a url, which is what makes "provenance is copied, never
    generated" true of a run where a model chose what to fetch.
    """
    _by_id: dict[str, Source] = field(default_factory=dict)
    _by_key: dict[str, str] = field(default_factory=dict)   # dedup key -> id
    _next: int = 1

    def add(self, results: Iterable[SearchResult], query: str) -> tuple[list[Source], int]:
        """Record new results, returning (newly added, duplicates seen).

        A result whose url is already in the ledger is dropped rather than
        re-listed: the agent sees each document once, under one id, whichever
        phrase found it first."""
        added: list[Source] = []
        dupes = 0
        for r in results:
            key = dedup_key(r.url)
            if key in self._by_key:
                dupes += 1
                continue
            sid = f"s{self._next}"
            self._next += 1
            src = Source(id=sid, url=r.url, title=r.title, host=r.host,
                         snippet=r.snippet, provider=r.provider, found_for=query,
                         published=r.published)
            self._by_id[sid] = src
            self._by_key[key] = sid
            added.append(src)
        return added, dupes

    def get(self, sid: str) -> Optional[Source]:
        return self._by_id.get(sid)

    def all(self) -> list[Source]:
        return list(self._by_id.values())

    def in_state(self, state: str) -> list[Source]:
        return [s for s in self._by_id.values() if s.state == state]

    def hosts_ingested(self) -> dict[str, int]:
        counts: dict[str, int] = {}
        for s in self.in_state("ingested"):
            counts[s.host] = counts.get(s.host, 0) + 1
        return counts

    def hosts_used(self) -> dict[str, int]:
        """Hosts this run has actually REQUESTED a page from, ingested or not.

        What the per-host cap counts, and deliberately not `hosts_ingested`: a
        fetch that failed still hit the server, so it still counts against how
        hard the run is leaning on that site. A source skipped by the cap itself
        never reached the network and does not count."""
        counts: dict[str, int] = {}
        for s in self._by_id.values():
            if s.state in ("ingested", "failed") or (
                    s.state == "skipped" and s.chars is not None):
                counts[s.host] = counts.get(s.host, 0) + 1
        return counts


# --------------------------------------------------------------------------
# Fetching — parallel, deterministic, no model.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Fetched:
    source_id: str
    text: Optional[str]
    error: Optional[str]


def fetch_many(sources: Sequence[Source], workers: int = FETCH_WORKERS,
               fetcher: Optional[Fetcher] = None,
               throttle: Optional[HostThrottle] = None) -> dict[str, Fetched]:
    """Fetch every source, as wide as the fetcher allows. Never raises: a
    per-source failure is returned as a `Fetched` carrying its message, because
    one dead link must not cost the batch.

    Width is `min(workers, fetcher.max_concurrency)`. On Safari that is 1 and the
    pool degrades to a serial loop, which is correct rather than a compromise —
    there is one browser, and `fetch.HostThrottle` would be spacing same-host
    hits anyway.

    `throttle` defaults to the process-wide one. It is a parameter so a caller
    that is not actually hitting the network (a test) is not made to wait out a
    politeness interval that exists for servers.
    """
    out: dict[str, Fetched] = {}
    if not sources:
        return out
    fetcher = fetcher or default_fetcher()
    width = max(1, min(workers, fetcher.max_concurrency))
    with concurrent.futures.ThreadPoolExecutor(max_workers=width) as pool:
        futures = {pool.submit(fetch_text, s.url, fetcher, throttle): s
                   for s in sources}
        for fut in concurrent.futures.as_completed(futures):
            src = futures[fut]
            try:
                out[src.id] = Fetched(src.id, fut.result(), None)
            except FetchError as exc:
                out[src.id] = Fetched(src.id, None, str(exc))
            except Exception as exc:
                out[src.id] = Fetched(
                    src.id, None, f"{type(exc).__name__}: {exc}")
    return out


# --------------------------------------------------------------------------
# Ingesting — serial, one session and one commit per source.
# --------------------------------------------------------------------------

def ingest_batch(ledger: SourceLedger, ids: Sequence[str], *, ingest_one,
                 fetcher: Optional[Fetcher] = None,
                 ingest_budget: Optional[int] = None,
                 budget_ok: Optional[Callable[[], bool]] = None) -> list[dict]:
    """Fetch the named candidates, then ingest at most a few of the ones that
    came back readable.

    Fetching and ingesting are capped separately (`MAX_FETCH_PER_CALL`,
    `MAX_INGESTS_PER_CALL`), which is what makes over-naming safe: the agent is
    told to name several candidates per position because half of them will be
    unreadable, and the harness guarantees that naming five cannot cost five
    ingestions. A candidate that fetched cleanly but did not fit the ingest cap
    is left in `found` state with its text cached — it is ready, it cost nothing,
    and naming it again next call skips the network entirely.

    `ingest_one(url, text) -> report` is injected rather than imported so a test
    can drive the whole path without the API; the harness passes a closure over
    the store and guard config (see `collect.py`).

    Returns one result dict per id, in the order given. Mutates the ledger.
    """
    results: list[dict] = []
    candidates: list[Source] = []
    deferred: list[str] = []
    seen: set[str] = set()
    # Hosts already drawn on this run, so the cap counts across calls rather
    # than resetting each time the agent asks for another batch.
    host_count = dict(ledger.hosts_used())

    for sid in ids:
        src = ledger.get(sid)
        if src is None:
            results.append({"id": sid, "status": "unknown",
                            "detail": "no such source id in the ledger"})
            continue
        if sid in seen:
            results.append({"id": sid, "status": "duplicate-request",
                            "detail": "named twice in one call"})
            continue
        seen.add(sid)
        if src.state != "found":
            results.append({"id": sid, "status": "already-" + src.state,
                            "detail": src.detail or "seen in an earlier call"})
            continue
        if src.text is None and host_count.get(src.host, 0) >= MAX_PER_HOST:
            # Before the fetch, so the cap costs no request at all. A source
            # already fetched is exempt: its request has been made.
            src.state = "skipped"
            src.detail = (f"this run has already drawn {MAX_PER_HOST} pages "
                          f"from {src.host}; find this position somewhere else")
            results.append({"id": sid, "host": src.host, "status": "skipped",
                            "stage": "host-cap", "detail": src.detail})
            continue
        if len(candidates) >= MAX_FETCH_PER_CALL:
            deferred.append(sid)     # stays 'found'; nothing spent
            continue
        if src.text is None:
            host_count[src.host] = host_count.get(src.host, 0) + 1
        candidates.append(src)

    # Fetch only what is not already cached from a previous call's surplus.
    to_fetch = [c for c in candidates if c.text is None]
    fetched = fetch_many(to_fetch, fetcher=fetcher)

    ready: list[Source] = []
    for src in candidates:
        if src.text is not None:
            ready.append(src)
            continue
        got = fetched.get(src.id)
        if got is None or got.text is None:
            src.state = "failed"
            src.detail = (got.error if got else "fetch produced no result")
            results.append({"id": src.id, "host": src.host, "status": "failed",
                            "stage": "fetch", "detail": src.detail})
            continue
        src.chars = len(got.text)
        if src.chars < MIN_DOCUMENT_CHARS:
            # Harness gate, not a model judgment: too short to be a document.
            src.state = "skipped"
            src.detail = (f"extracted {src.chars} chars, below the "
                          f"{MIN_DOCUMENT_CHARS}-char floor (paywall stub, "
                          f"cookie wall or nav page)")
            results.append({"id": src.id, "host": src.host, "status": "skipped",
                            "stage": "fetch", "chars": src.chars,
                            "detail": src.detail})
            continue
        src.text = got.text
        ready.append(src)

    allowance = MAX_INGESTS_PER_CALL
    budget_bound = False
    if ingest_budget is not None and ingest_budget < allowance:
        allowance = max(0, ingest_budget)
        budget_bound = True

    taken = 0
    for src in ready[:allowance]:
        if budget_ok is not None and not budget_ok():
            # The cascade's token budget is spent. Checked BEFORE each run
            # rather than after, because an ingestion is the expensive call and
            # the point is not to make it. The source is left untouched.
            break
        taken += 1
        try:
            report = ingest_one(src.url, src.text or "")
        except Refused:
            # Governance, not a fact about this source. The kill file or a cap
            # says stop, and it stops the collection run too. The ledger keeps
            # the source at 'found' so the report shows it was never applied.
            raise
        except Exception as exc:
            src.state = "failed"
            src.detail = f"{type(exc).__name__}: {exc}"
            results.append({"id": src.id, "host": src.host, "status": "failed",
                            "stage": "ingest", "chars": src.chars,
                            "detail": src.detail})
            continue

        delta = summarize_report(report)
        src.state = "ingested"
        src.sha = delta["sha"]
        src.claims_added = delta["claims_added"]
        src.inferences_added = delta["inferences_added"]
        src.text = None          # committed; no reason to hold the document
        results.append({"id": src.id, "host": src.host, "status": "ingested",
                        "chars": src.chars, **delta})

    for src in ready[taken:]:
        # Fetched cleanly, did not fit. Still 'found', text cached: naming it
        # again costs no network. WHICH cap bound it decides what the agent
        # should do next, so the two are not collapsed into one message — one
        # says come back for it, the other says the run is over.
        spent = budget_ok is not None and not budget_ok()
        detail = (f"readable and waiting, but the run's token budget is spent; "
                  f"nothing more can be ingested this run" if spent else
                  f"readable and waiting, but the run's ingest budget is spent; "
                  f"nothing more can be ingested this run"
                  if budget_bound else
                  f"readable and waiting; this call ingested its "
                  f"{MAX_INGESTS_PER_CALL}. Name it again next call to take it, "
                  f"at no fetch cost")
        results.append({
            "id": src.id, "host": src.host, "status": "fetched-not-ingested",
            "chars": src.chars,
            "bound_by": ("token-budget" if spent else
                         "run-budget" if budget_bound else "per-call-cap"),
            "detail": detail})

    for sid in deferred:
        results.append({
            "id": sid, "status": "not-attempted",
            "detail": f"more than {MAX_FETCH_PER_CALL} candidates named in one "
                      f"call; this one was not fetched and is unchanged"})

    return results


def summarize_report(report: dict) -> dict:
    """An ingestion report reduced to the corpus delta the collection agent may
    see: what landed, not what the document said.

    Tags ARE model-generated from document content, so this is the one place
    page-derived prose crosses back. They are also the only thing that tells the
    agent what a source contributed, and they are already canonical corpus state
    by the time they are read. Named in the session file rather than pretended
    away.
    """
    from .plan import AddClaim, AddInference

    plan = report.get("plan") or ()
    claims = [op for op in plan if isinstance(op, AddClaim)]
    infs = [op for op in plan if isinstance(op, AddInference)]
    return {
        "sha": report.get("sha"),
        "claims_added": len(claims),
        "inferences_added": len(infs),
        "tags": [c.tag for c in claims],
        "not_applied": list(report.get("notes") or ()),
        "tokens": report.get("tokens"),
    }
