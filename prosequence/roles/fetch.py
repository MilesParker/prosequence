#!/usr/bin/env python3
"""URL -> plain article text. Deterministic harness I/O; the model never fetches.

Lifted out of `run.py` when a second caller appeared. `run.ingest()` fetches one
page before an ingestion run; `sources.fetch_many` fetches a batch of them
before a batch of ingestion runs. Both want the same extraction, and neither
entry point should be importing the other.

No model is involved and no model-supplied url reaches here: the collection
agent selects sources by ledger id, and the harness resolves the id to the url
it recorded from the search provider. This is what "provenance must be copied
rather than generated" means in practice.

## Two ways of getting the bytes

The extraction step is shared; only the transport differs.

`RequestsFetcher` is `requests` + a browser user-agent. Fast, parallel, no
dependencies beyond what the harness already has — and it loses about half of
what a collection run names. Measured over two live runs: 403s, bot walls that
answer 200 with a JavaScript challenge page, and stubs under the document
floor. That is not a random filter. The sites most likely to refuse a plain HTTP
client are not evenly distributed across positions, so it silently drops whole
camps out of a corpus — one run produced zero contesting inferences because
every opposition source it picked was refused.

`SafariFetcher` drives the operator's own running Safari through AppleScript and
reads `source of tab`. It is a real browser making a real request from a real
session, so it gets pages a plain client cannot.

What was actually measured, stated carefully because the first two numbers here
were briefly recorded as more decisive than they are:

  * mta.info — `requests` 403, Safari 5,472 chars of article. Reproduced.
  * cato.org — `requests` first returned a 950-byte Incapsula challenge page
    (which is what cost a live run its entire opposition side), and LATER
    returned the full 21,205 chars, same as Safari. So that wall is
    intermittent, not a property of the site. Which is worse for the plain
    client, not better: an intermittent refusal cannot be predicted, retried
    around, or reasoned about from a failure log.
  * A subscription the operator holds SHOULD carry, since this is their own
    browser and their own cookies. Not verified — it needs a real paywalled
    article to test, and guessing at markers in a logged-in page is not
    evidence. Treat it as the expected behaviour of the mechanism rather than
    as a measured result.

What it costs: it drives a VISIBLE browser (tabs open and close while a run is
going), and it is strictly serial — one Safari, one tab at a time. Serial is
less of a loss than it sounds, because politeness wants spacing anyway (see
`HostThrottle`).

Deliberately NOT used: `safaridriver`. It is the sanctioned WebDriver path, but
it needs `sudo safaridriver --enable`, it runs one session per host (so no
parallelism either), and its sessions are isolated from the operator's browsing
data — which is precisely the thing worth having here. AppleScript needs no
privilege escalation and no Safari setting: `source of tab` is a plain
scripting-dictionary property, unlike `do JavaScript`, which would require
"Allow JavaScript from Apple Events".
"""
from __future__ import annotations

import platform
import subprocess
import threading
import time
from html.parser import HTMLParser
from typing import Optional, Protocol
from urllib.parse import urlparse

import requests
import trafilatura

# A plausible browser UA; many sites reject the default python-requests agent.
FETCH_UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36")

# Minimum seconds between two fetches of the same host, enforced across the
# whole process. Politeness, not rate-limit avoidance: a collection run that
# pulls six pages off one site in two seconds looks like scraping, and it is the
# operator's own browser and IP doing it on the Safari path.
MIN_HOST_INTERVAL = 3.0


class FetchError(RuntimeError):
    """A page could not be retrieved. Carries the transport's own message; the
    ledger records it against the source and the run continues."""


class Fetcher(Protocol):
    name: str
    #: How many of these may run at once. 1 means the caller must serialize.
    max_concurrency: int

    def fetch(self, url: str) -> str:
        """Return the page's HTML, or raise `FetchError`."""
        ...


# --------------------------------------------------------------------------
# Politeness. Shared by every fetcher, because it is about the server, not us.
# --------------------------------------------------------------------------

class HostThrottle:
    """Enforces `MIN_HOST_INTERVAL` between fetches of one host, process-wide.

    Holds a lock per host rather than one global lock, so two different hosts
    still overlap on a parallel fetcher while two pages from one host never do.
    On a serial fetcher it degrades to a sleep, which is all it needs to be.
    """

    def __init__(self, interval: float = MIN_HOST_INTERVAL):
        self._interval = interval
        self._guard = threading.Lock()
        self._locks: dict[str, threading.Lock] = {}
        self._last: dict[str, float] = {}

    def _lock_for(self, host: str) -> threading.Lock:
        with self._guard:
            return self._locks.setdefault(host, threading.Lock())

    def wait(self, url: str) -> None:
        host = (urlparse(url).netloc or "").lower()
        lock = self._lock_for(host)
        with lock:
            last = self._last.get(host)
            if last is not None:
                gap = self._interval - (time.monotonic() - last)
                if gap > 0:
                    time.sleep(gap)
            self._last[host] = time.monotonic()


# Process-wide, so two collection runs in one process still space their hits.
THROTTLE = HostThrottle()


# --------------------------------------------------------------------------
# Extraction. Shared: only the transport differs between fetchers.
# --------------------------------------------------------------------------

class _TextExtractor(HTMLParser):
    """Naive HTML -> text fallback for when trafilatura's boilerplate-removal
    heuristics find nothing extractable (e.g. a non-article page): drop
    script/style/head, break on block tags, keep the data. No boilerplate
    stripping of its own — nav/ads/footers survive — so this stays honest about
    being crude rather than pretending to be article extraction."""

    _SKIP = {"script", "style", "head", "noscript", "template"}
    _BLOCK = {"p", "br", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6",
              "tr", "section", "article", "header", "footer", "blockquote"}

    def __init__(self):
        super().__init__()
        self._parts: list[str] = []
        self._skip_depth = 0

    def handle_starttag(self, tag, attrs):
        if tag in self._SKIP:
            self._skip_depth += 1
        elif tag in self._BLOCK:
            self._parts.append("\n")

    def handle_endtag(self, tag):
        if tag in self._SKIP and self._skip_depth:
            self._skip_depth -= 1
        elif tag in self._BLOCK:
            self._parts.append("\n")

    def handle_data(self, data):
        if self._skip_depth == 0:
            self._parts.append(data)

    def text(self) -> str:
        lines = ("".join(self._parts)).splitlines()
        out: list[str] = []
        for ln in (ln.strip() for ln in lines):
            if ln or (out and out[-1]):  # collapse runs of blank lines
                out.append(ln)
        return "\n".join(out).strip()


def extract(html: str, url: str = "") -> str:
    """HTML -> plain article text. trafilatura does the boilerplate removal
    (nav/ads/footers/comments stripped, main content kept); when its heuristics
    find no extractable article this falls back to the naive block-tag splitter,
    which keeps everything rather than nothing."""
    text = trafilatura.extract(html, include_comments=False, include_tables=False)
    if not text:
        parser = _TextExtractor()
        parser.feed(html)
        text = parser.text()
    if not text:
        raise FetchError(f"fetched {url or 'page'} but extracted no text")
    return text


# --------------------------------------------------------------------------
# Transports.
# --------------------------------------------------------------------------

class RequestsFetcher:
    """Plain HTTP. Fast and parallel; refused by roughly half of what a
    collection run names."""

    name = "requests"
    max_concurrency = 6

    def __init__(self, timeout: int = 30):
        self._timeout = timeout

    def fetch(self, url: str) -> str:
        try:
            resp = requests.get(url, headers={"User-Agent": FETCH_UA},
                                timeout=self._timeout)
            resp.raise_for_status()
        except Exception as exc:
            raise FetchError(f"{type(exc).__name__}: {exc}") from exc
        return resp.text


# The url is passed as `argv`, never interpolated into this source. Search
# results are attacker-influenceable, and a url containing a quote would
# otherwise close the AppleScript string literal and run whatever followed —
# `do shell script` is one `&` away. With argv it arrives as data.
_SAFARI_SCRIPT = '''on run argv
    set theURL to item 1 of argv
    tell application "Safari"
        if (count of windows) is 0 then make new document
        set t to make new tab at end of tabs of window 1 with properties {URL:theURL}
        try
            -- Wait for the source to stop growing rather than for a load event:
            -- `source of tab` is available without the "Allow JavaScript from
            -- Apple Events" setting that reading document.readyState would need.
            set prevLen to -1
            set n to 0
            set s to ""
            repeat while n < 40
                delay 0.5
                -- `source` must be bound before it can be measured: `length of
                -- (source of t)` is not a reference AppleScript can resolve
                -- (-2700). It also errors outright on a tab that has not
                -- produced a document yet, which is an ordinary state here.
                try
                    set s to (source of t)
                on error
                    set s to ""
                end try
                set curLen to (count of s)
                if curLen > 0 and curLen is prevLen then exit repeat
                set prevLen to curLen
                set n to n + 1
            end repeat
        on error errMsg
            close t
            error errMsg
        end try
        close t
        return s
    end tell
end run'''


class SafariFetcher:
    """Drives the operator's running Safari through AppleScript.

    Serial by construction: one browser, one tab at a time. Uses the operator's
    real session, so their subscriptions apply and bot walls that fingerprint
    HTTP clients do not fire.

    `available()` is a cheap check the caller uses to decide whether to pick
    this fetcher at all — it asks Safari for its version, which triggers the
    macOS automation permission prompt on first use and returns False if the
    operator declines.
    """

    name = "safari"
    max_concurrency = 1

    def __init__(self, timeout: int = 60):
        self._timeout = timeout

    @staticmethod
    def available() -> bool:
        if platform.system() != "Darwin":
            return False
        try:
            probe = subprocess.run(
                ["osascript", "-e",
                 'tell application "Safari" to return version'],
                capture_output=True, text=True, timeout=20)
        except (OSError, subprocess.SubprocessError):
            return False
        return probe.returncode == 0

    def fetch(self, url: str) -> str:
        try:
            proc = subprocess.run(
                ["osascript", "-e", _SAFARI_SCRIPT, url],
                capture_output=True, text=True, timeout=self._timeout)
        except subprocess.TimeoutExpired as exc:
            raise FetchError(
                f"Safari did not return within {self._timeout}s") from exc
        except OSError as exc:
            raise FetchError(f"could not run osascript: {exc}") from exc
        if proc.returncode != 0:
            raise FetchError(
                f"Safari refused: {(proc.stderr or '').strip()[:200]}")
        html = proc.stdout
        if not html.strip():
            raise FetchError("Safari returned an empty page source")
        return html


def default_fetcher() -> Fetcher:
    """Safari where it can be driven, plain HTTP otherwise.

    Safari is the default rather than the fallback on purpose. Trying `requests`
    first and escalating on failure sounds cheaper and is wrong: a paywalled
    article answers a plain client with a preview stub, which is a SUCCESS as
    far as the transport is concerned. The run would ingest the stub as if it
    were the piece and never try the browser that could read the whole thing.
    Failure is not the only thing the cheap path gets wrong.
    """
    if SafariFetcher.available():
        return SafariFetcher()
    return RequestsFetcher()


def fetch_text(url: str, fetcher: Optional[Fetcher] = None,
               throttle: Optional[HostThrottle] = None) -> str:
    """Fetch `url` and reduce it to plain article text. Raises `FetchError`."""
    fetcher = fetcher or default_fetcher()
    (throttle or THROTTLE).wait(url)
    return extract(fetcher.fetch(url), url)
