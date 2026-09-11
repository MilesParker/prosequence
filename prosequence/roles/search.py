#!/usr/bin/env python3
"""Web search, issued by the harness on the collection agent's behalf.

The collection agent never holds a web tool. It calls `search(phrases)`, the
harness runs each phrase through a provider, and what comes back is a list of
`SearchResult` records the ledger assigns ids to. Every url the harness later
fetches is one it recorded here, so provenance is copied rather than generated —
the same rule that keeps a fetch tool out of the ingestion loop (SESSION_FEED,
Staging Stage 2).

Three providers behind one protocol:

  * `GoogleCSE` — the Google Custom Search JSON API. Needs GOOGLE_API_KEY and
    GOOGLE_CSE_ID in the environment (a Programmable Search Engine configured to
    search the whole web). Returns title, url and a snippet.
  * `AnthropicWebSearch` — one guarded model call with Anthropic's server-side
    `web_search` tool, harvested for its result blocks. Needs only
    ANTHROPIC_API_KEY, which is why it is the fallback: the collection agent is
    runnable with the credentials this repo already has. The API returns title,
    url and page age but no snippet, so results from it carry `snippet=None`.
  * `StubProvider` — scripted, for tests. No network.

`default_provider` picks Google when its two keys are set and Anthropic web
search otherwise. Both go through the harness; neither is bound into the
collection agent's own tool list, which is what keeps `max_searches` countable
and the ledger authoritative about where a url came from.

An `AnthropicWebSearch` call is guarded like everything else, but through its
OWN `GuardedClient`, not the collection agent's — same reason each ingestion run
gets one. It is a separate model call with its own messages and nothing to do
with the agent's reasoning trace, and it is expensive: a single phrase measured
at ~13k tokens, because the server runs the search loop internally and the page
results are billed as input on that request. Twelve phrases through the
collection agent's own guard would breach a 200k per-run cap before the agent
had reasoned about anything. The structural bound on searches is `max_searches`,
exactly as `max_ingests` bounds the ingestion cascade.

Google CSE costs no tokens at all — it is plain HTTP. The two providers have
wildly different cost profiles and the same interface, which is worth knowing
when setting a phrase budget.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass
from typing import Optional, Protocol, Sequence
from urllib.parse import urlparse

import requests

GOOGLE_ENDPOINT = "https://www.googleapis.com/customsearch/v1"

# Anthropic's server-side web search tool. Pinned rather than "latest": a
# provider version change alters what comes back, and that should be a visible
# edit rather than something that happens on an SDK bump.
WEB_SEARCH_TOOL_TYPE = "web_search_20250305"

# Output ceiling for a search call. The model is not asked to reason or
# summarise here — it runs the tool and stops — so this only has to cover the
# tool_use block plus a sentence. It is also the whole of the projected cost the
# guard adds on top of the input estimate.
SEARCH_MAX_TOKENS = 1024


class SearchError(RuntimeError):
    """A provider could not answer. Raised out of `search`; the collection
    agent's tool wrapper turns it into a tool result rather than a dead run —
    a provider that 429s on one phrase should not cost the whole collection."""


def host_of(url: str) -> str:
    """The registrable-ish host of a url, lowercased, `www.` stripped. Used for
    the ledger's dedup key and for the source histogram the agent reads as its
    only mechanical proxy for breadth of sourcing."""
    netloc = (urlparse(url).netloc or "").lower()
    return netloc[4:] if netloc.startswith("www.") else netloc


@dataclass(frozen=True)
class SearchResult:
    """One provider hit, before the ledger has seen it.

    `snippet` is the provider's own summary where it has one (Google) and None
    where it does not (Anthropic web search). It is the ONLY page-derived prose
    that reaches the collection agent — document text never does; see
    `sources.py`.

    `published` is whatever the provider says about the page's date, verbatim
    and unparsed — Anthropic returns `page_age` ("April 30, 2025"), Google
    carries an ISO timestamp in its metatags when the page has one, and often
    neither has anything. It is here because the prompt asks the agent to check
    that a source is from the period the thesis is about, and asking for a check
    while withholding the only evidence for it is how an instruction turns into
    a guess. Not normalised into a date type: it is shown to a model, not
    compared, and half of what arrives is not a parseable date anyway.
    """
    title: str
    url: str
    snippet: Optional[str] = None
    provider: str = ""
    published: Optional[str] = None

    @property
    def host(self) -> str:
        return host_of(self.url)


class SearchProvider(Protocol):
    name: str

    def search(self, query: str, limit: int) -> list[SearchResult]:
        ...


def _google_date(item: dict) -> Optional[str]:
    """A publication date off a CSE result, if the page declared one.

    Best-effort and openly so: Google exposes whatever structured data it
    scraped, under keys that vary by page. These are the three that carry a date
    on most news and article pages. Returned verbatim; no parsing, because a
    wrong parse is worse than no date."""
    pagemap = item.get("pagemap") or {}
    for group, key in (("metatags", "article:published_time"),
                       ("newsarticle", "datepublished"),
                       ("metatags", "og:updated_time")):
        entries = pagemap.get(group) or []
        if entries and isinstance(entries[0], dict):
            value = entries[0].get(key)
            if value:
                return str(value)
    return None


# --------------------------------------------------------------------------
# Google Custom Search JSON API — what was actually asked for.
# --------------------------------------------------------------------------

class GoogleCSE:
    name = "google"

    def __init__(self, api_key: str, cse_id: str, timeout: int = 20):
        self._key = api_key
        self._cx = cse_id
        self._timeout = timeout

    @classmethod
    def from_env(cls) -> Optional["GoogleCSE"]:
        key = os.environ.get("GOOGLE_API_KEY")
        cx = os.environ.get("GOOGLE_CSE_ID")
        if key and cx:
            return cls(key, cx)
        return None

    def search(self, query: str, limit: int) -> list[SearchResult]:
        # The API caps `num` at 10 per request. Paging past that is deliberately
        # not implemented: a collection run wants breadth across phrases, not
        # depth down one result page, and the agent has a phrase budget to spend
        # instead.
        params: dict[str, str] = {
            "key": self._key, "cx": self._cx, "q": query,
            "num": str(max(1, min(int(limit), 10))),
        }
        try:
            resp = requests.get(GOOGLE_ENDPOINT, params=params, timeout=self._timeout)
            resp.raise_for_status()
            data = resp.json()
        except Exception as exc:
            raise SearchError(f"google search for {query!r} failed: {exc}") from exc
        out = []
        for item in data.get("items", []) or []:
            url = item.get("link")
            if not url:
                continue
            out.append(SearchResult(
                title=item.get("title") or url,
                url=url,
                snippet=item.get("snippet"),
                provider=self.name,
                published=_google_date(item),
            ))
        return out


# --------------------------------------------------------------------------
# Anthropic server-side web search — the fallback that needs no new credential.
# --------------------------------------------------------------------------

class AnthropicWebSearch:
    """Search through one guarded model call with the server-side `web_search`
    tool bound and forced.

    This is a HARNESS call, not part of the collection agent's loop: it has its
    own messages, its own tiny output ceiling, and its only output is the list
    of (title, url) pairs harvested from the tool result blocks. The model in
    this call reads nothing of the corpus and writes nothing.
    """

    name = "anthropic-web-search"

    def __init__(self, guard, model: Optional[str] = None):
        self._guard = guard
        self._model = model

    def search(self, query: str, limit: int) -> list[SearchResult]:
        tool = {
            "type": WEB_SEARCH_TOOL_TYPE,
            "name": "web_search",
            "max_uses": 1,
        }
        prompt = (
            f"Run one web search for this query and then stop:\n\n{query}\n\n"
            f"Do not summarise or answer anything. The search results "
            f"themselves are the output.")
        try:
            resp = self._guard.create(
                model=self._model,
                max_tokens=SEARCH_MAX_TOKENS,
                messages=[{"role": "user", "content": prompt}],
                tools=[tool],
                # Only one tool is bound, so "any" forces web_search without
                # naming it — a server tool is not addressable by
                # {"type": "tool", "name": ...} the way a client tool is.
                tool_choice={"type": "any"},
            )
        except Exception as exc:
            # A guard refusal must not be swallowed here: it is governance, and
            # the collection run has to die on it. Re-raised untouched; every
            # other failure becomes a SearchError the caller can report.
            from ..core.guarded_client import Refused
            if isinstance(exc, Refused):
                raise
            raise SearchError(
                f"anthropic web search for {query!r} failed: {exc}") from exc

        out: list[SearchResult] = []
        for block in getattr(resp, "content", []) or []:
            if getattr(block, "type", None) != "web_search_tool_result":
                continue
            content = getattr(block, "content", None)
            # The union is [WebSearchResultBlock] on success and a single error
            # object on failure; the error has no __iter__ worth walking.
            if not isinstance(content, list):
                raise SearchError(
                    f"anthropic web search for {query!r} returned an error: "
                    f"{getattr(content, 'error_code', content)}")
            for item in content:
                url = getattr(item, "url", None)
                if not url:
                    continue
                out.append(SearchResult(
                    title=getattr(item, "title", None) or url,
                    url=url,
                    snippet=None,   # the API returns no snippet
                    provider=self.name,
                    published=getattr(item, "page_age", None),
                ))
        return out[:limit]


# --------------------------------------------------------------------------
# Stub — tests, and any run that must not touch the network.
# --------------------------------------------------------------------------

class StubProvider:
    """Scripted results. `results` maps a query substring to the hits it yields;
    an unmatched query yields `default`."""

    name = "stub"

    def __init__(self, results: dict[str, Sequence[SearchResult]] | None = None,
                 default: Sequence[SearchResult] = ()):
        self._results = dict(results or {})
        self._default = list(default)
        self.queries: list[str] = []

    def search(self, query: str, limit: int) -> list[SearchResult]:
        self.queries.append(query)
        for key, hits in self._results.items():
            if key.lower() in query.lower():
                return list(hits)[:limit]
        return list(self._default)[:limit]


def default_provider(guard) -> SearchProvider:
    """Google when its two credentials are in the environment, Anthropic web
    search otherwise. `guard` is only used by the latter."""
    google = GoogleCSE.from_env()
    if google is not None:
        return google
    return AnthropicWebSearch(guard)


def main(argv: list[str]) -> int:
    """`python -m prosequence.roles.search <query>` — run one phrase through
    whichever provider is configured and print what comes back.

    Here so the provider can be checked on its own, without starting a
    collection run. Which matters mostly for Google: it needs two credentials
    this repo does not ship, and the failure mode of a misconfigured
    Programmable Search Engine is not an error but a plausible-looking empty
    result list (the default engine searches a site list, not the web). An
    empty result for an obviously-answerable query is the symptom.

    On the Anthropic provider this costs a model call — ~14k tokens — and says
    so before making one.
    """
    if not argv:
        print("usage: python -m prosequence.roles.search <query>", file=sys.stderr)
        return 2
    query = " ".join(argv)

    from .run import GUARD_CONFIG, load_env
    load_env()

    google = GoogleCSE.from_env()
    if google is not None:
        provider: SearchProvider = google
        print("provider: google (GOOGLE_API_KEY + GOOGLE_CSE_ID found)")
    else:
        import anthropic
        from ..core.guarded_client import GuardConfig, GuardedClient
        missing = [k for k in ("GOOGLE_API_KEY", "GOOGLE_CSE_ID")
                   if not os.environ.get(k)]
        print(f"provider: anthropic web search — {', '.join(missing)} not set. "
              f"This costs a guarded model call (~14k tokens).")
        cfg = GuardConfig.load(GUARD_CONFIG)
        provider = AnthropicWebSearch(
            GuardedClient(anthropic.Anthropic(), cfg, "search-cli"))

    try:
        hits = provider.search(query, 10)
    except SearchError as exc:
        print(f"FAILED: {exc}", file=sys.stderr)
        return 1

    if not hits:
        print("no results — on Google this usually means the Programmable "
              "Search Engine is scoped to a site list rather than the whole web")
        return 1
    for h in hits:
        print(f"  {h.host:<32} {h.title[:70]}")
        if h.snippet:
            print(f"    {h.snippet[:100]}")
    print(f"{len(hits)} result(s) from {provider.name}")
    return 0


if __name__ == "__main__":
    import sys as _sys
    raise SystemExit(main(_sys.argv[1:]))
