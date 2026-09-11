#!/usr/bin/env python3
"""Guarded Anthropic client — the only path a model call may take (Directive 1e).

The point is bounded spend: no single run, and no crash-loop of runs, can spend
without limit, and anyone can halt everything from outside the process by
touching a file.

Design seams that matter:

* The underlying client is a **constructor parameter**, never a module-level
  singleton. A test substitutes a stub returning scripted usage and exercises
  every commit path without touching the API or the network. Nothing in the
  session/ops/store needs to know which client it is. The surface required of
  that client is `messages.stream(...)` as a context manager yielding an object
  with `get_final_message()` — see `create` for why it is the streaming one.
* The **pre-flight check runs before every API call**, never after — a cap
  checked after the call has already spent the tokens. Three gates, in order:
  the kill file, the per-run cap, the cumulative (rolling-window) cap. The
  cumulative gate reads the token log **from disk**, so it bounds a loop of
  separate processes, not just calls within one.
* Every refusal is **terminal**: it raises and the run dies. No wait, no
  backoff, no retry, no loop that responds to a refusal. Because a run commits
  once at the very end, a refusal at any point leaves the corpus repo untouched
  — there is no partial-run state.
* **Server-tool requests are counted as well as tokens.** A web search is billed
  per request ON TOP of the tokens its results add to the context, so a log that
  records only tokens under-reports the bill by a term it cannot even see. The
  COUNT goes in the log, beside the token counts, and the price is applied
  retrospectively like every other price here. It is not in the pre-flight
  projection: the caps are token caps, and the structural bound on searches is
  the calling agent's own budget (`collect.DEFAULT_MAX_SEARCHES`).

The API key is never handled here: the caller constructs the real client
(`anthropic.Anthropic()` reads `ANTHROPIC_API_KEY` from the environment) and
passes it in. No key sits in this module, in the config, or in the log.

Cost in dollars appears nowhere: the log records model, token counts and
server-tool request counts, and a price table is applied retroactively when a
dollar figure is wanted. A stale table must never be able to make a cap silently
wrong, so it stays out of the pre-flight path entirely.
"""
from __future__ import annotations

import json
import math
import os
import time
import tomllib
import uuid
from dataclasses import dataclass
from typing import Any, Callable, Optional, Sequence

from ..paths import LOG_DIR


# Default token-log path: `prosequence/logs/`, gitignored, outside the corpus
# repo (see `..paths`). Not a config key (the config enumerates caps/window/
# kill-file/model only); it is a constructor parameter so a test can point it at
# a temp file. The dir is created on demand at write time (see _append_log).
DEFAULT_TOKEN_LOG = os.path.join(LOG_DIR, "token_log.jsonl")


# --------------------------------------------------------------------------
# Refusals. Each is terminal for the run; the harness catches them to log the
# reason apart, not to respond. There is no retry path anywhere.
# --------------------------------------------------------------------------

class Refused(Exception):
    """Base class for every pre-flight refusal. Terminal — the run dies."""


class KillFilePresent(Refused):
    """The external stop signal exists. Presence is the signal; contents ignored."""


class RunCapExceeded(Refused):
    """This call's projected cost would breach the per-run token cap."""


class CumulativeCapExceeded(Refused):
    """This call's projected cost would breach the rolling-window cumulative cap."""


# --------------------------------------------------------------------------
# Config — a file, not environment variables. Caps set invisibly get set wrong.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class GuardConfig:
    per_run_token_cap: int
    cumulative_token_cap: int
    cumulative_window_seconds: int
    kill_file: str
    model: str
    # Hard cap on a role's traversal loop — the number of model turns before the
    # graph is forced to apply. A run bound, like the token caps above; the guard
    # itself never reads it (the role does), it lives here so every run bound is
    # set in one open file. Defaulted so configs predating it still load.
    iteration_cap: int = 15

    @classmethod
    def load(cls, path: str) -> "GuardConfig":
        with open(path, "rb") as fh:
            data = tomllib.load(fh)
        # No prices, no api key: reject anything that smells like either, so a
        # stale price table or a leaked key can never enter the guard through
        # config drift.
        forbidden = {"price", "prices", "cost", "api_key", "apikey", "key", "token"}
        bad = [k for k in data if k.lower() in forbidden]
        if bad:
            raise ValueError(
                f"config {path!r} contains forbidden key(s) {bad}: prices and "
                f"keys must never live in the guard config")
        return cls(
            per_run_token_cap=int(data["per_run_token_cap"]),
            cumulative_token_cap=int(data["cumulative_token_cap"]),
            cumulative_window_seconds=int(data["cumulative_window_seconds"]),
            kill_file=str(data["kill_file"]),
            model=str(data["model"]),
            iteration_cap=int(data.get("iteration_cap", 15)),
        )


def _default_estimate_input(messages: Sequence[dict]) -> int:
    """Cheap upper-ish estimate of input tokens for the pre-flight projection.

    Pre-call the true input count is unknown, so this is a heuristic (~4 chars /
    token) over the message text. The projection only needs to be positive and
    roughly proportional; the authoritative accounting is the *actual* token
    counts logged after the call returns."""
    chars = 0
    for m in messages or ():
        content = m.get("content", "")
        if isinstance(content, str):
            chars += len(content)
        elif isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    chars += len(str(block.get("text", "")))
                else:
                    chars += len(str(block))
    return max(1, math.ceil(chars / 4))


def _server_tool_counts(usage: Any) -> dict:
    """Per-request server-tool counts off a response's `usage`, as a plain dict.

    `usage.server_tool_use` is None on every call that used no server tool,
    and the zero counts on a call that declared one but did not use it are
    dropped, so the log line only grows when something was actually billed."""
    stu = getattr(usage, "server_tool_use", None)
    if stu is None:
        return {}
    counts = {}
    for field in ("web_search_requests", "web_fetch_requests"):
        n = int(getattr(stu, field, 0) or 0)
        if n:
            counts[field] = n
    return counts


# --------------------------------------------------------------------------
# The guarded client.
# --------------------------------------------------------------------------

class GuardedClient:
    def __init__(
        self,
        client: Any,
        config: GuardConfig,
        corpus: str,
        run_id: Optional[str] = None,
        token_log: str = DEFAULT_TOKEN_LOG,
        estimate_input: Callable[[Sequence[dict]], int] = _default_estimate_input,
        now: Callable[[], float] = time.time,
    ):
        self._client = client                 # injected — real or stub
        self._config = config
        self._corpus = corpus
        self._run_id = run_id or uuid.uuid4().hex
        self._log_path = token_log
        self._estimate_input = estimate_input
        self._now = now
        self._run_tokens = 0                  # in-process, this run only

    @property
    def run_id(self) -> str:
        return self._run_id

    @property
    def run_tokens(self) -> int:
        """Tokens actually spent so far this run (in-process)."""
        return self._run_tokens

    # -- pre-flight --------------------------------------------------------

    def _cumulative_tokens_in_window(self) -> int:
        """Sum input+output tokens over the rolling window, read from the log on
        disk. Reading disk (not process memory) is what bounds a crash-loop of
        separate processes."""
        if not os.path.exists(self._log_path):
            return 0
        cutoff = self._now() - self._config.cumulative_window_seconds
        total = 0
        with open(self._log_path, "r", encoding="utf-8") as fh:
            for line in fh:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError:
                    # A torn final line from a crash mid-write: skip it rather
                    # than crash the guard. One write per line keeps this rare.
                    continue
                if rec.get("timestamp", 0) >= cutoff:
                    total += int(rec.get("input_tokens", 0)) + int(rec.get("output_tokens", 0))
        return total

    def _preflight(self, projected: int) -> None:
        """Run before every API call. Raises (terminal) if any gate trips."""
        # 1. Kill file — presence is the signal, checked every call.
        if os.path.exists(self._config.kill_file):
            raise KillFilePresent(
                f"kill file {self._config.kill_file!r} present — refusing")
        # 2. Per-run cap — spent so far this run plus this call's projection.
        if self._run_tokens + projected > self._config.per_run_token_cap:
            raise RunCapExceeded(
                f"per-run cap {self._config.per_run_token_cap} would be breached: "
                f"{self._run_tokens} spent + {projected} projected")
        # 3. Cumulative cap — rolling window summed from disk, plus projection.
        cumulative = self._cumulative_tokens_in_window()
        if cumulative + projected > self._config.cumulative_token_cap:
            raise CumulativeCapExceeded(
                f"cumulative cap {self._config.cumulative_token_cap} would be "
                f"breached: {cumulative} in window + {projected} projected")

    # -- the call ----------------------------------------------------------

    def create(
        self,
        *,
        max_tokens: int,
        messages: Sequence[dict],
        model: Optional[str] = None,
        committed: bool = False,
        projected_input_tokens: Optional[int] = None,
        **kwargs,
    ):
        """Pre-flight, then one API call, then one log line. Returns the response.

        `projected` cost = an input estimate (or the caller's precise count) plus
        `max_tokens`, the hard ceiling on output — the knowable upper bound on
        what this call can add. A refusal raises before the client is ever
        touched: no API call, no log line, nothing spent.
        """
        model = model or self._config.model
        est_in = (
            projected_input_tokens
            if projected_input_tokens is not None
            else self._estimate_input(messages)
        )
        projected = est_in + max_tokens

        self._preflight(projected)  # raises => terminal, nothing below runs

        # Streamed, then accumulated back into one message. Nothing here
        # consumes deltas — `get_final_message()` returns the same Message a
        # non-streaming call would, so `usage`, `content`, and `stop_reason`
        # below are unchanged, and so is every caller.
        #
        # The transport matters anyway, because it is what makes a large
        # `max_tokens` legal at all. A non-streaming call is capped by the
        # request's wall-clock: the SDK estimates it as
        # `3600 * max_tokens / 128000` and REFUSES with ValueError above ten
        # minutes — any max_tokens over ~21,333 — because an idle HTTP
        # connection held open that long is liable to be dropped by something in
        # the middle. A stream is never idle, so the ceiling is the model's
        # (128K for the current Sonnet/Opus), not the transport's.
        #
        # Non-streaming was never a decision here; it was the shape this class
        # was written in for Directive 1e, when the output ceiling was 8192 and
        # the limit was invisible. It stops being invisible the moment a
        # single-shot role needs room for a whole corpus of findings.
        with self._client.messages.stream(
            model=model, max_tokens=max_tokens, messages=list(messages), **kwargs
        ) as stream:
            resp = stream.get_final_message()

        usage = resp.usage
        in_tok = int(usage.input_tokens)
        out_tok = int(usage.output_tokens)
        self._run_tokens += in_tok + out_tok
        self._append_log(model, in_tok, out_tok, committed,
                         _server_tool_counts(usage))
        return resp

    # -- token log ---------------------------------------------------------

    def _append_log(self, model: str, input_tokens: int, output_tokens: int,
                    committed: bool, server_tools: Optional[dict] = None) -> None:
        """One JSONL line per API call, written after the call returns.

        Append mode, the whole line in a single write, flush + fsync — so an
        append survives a crash mid-write and the cumulative gate can trust what
        it reads. No cost figure: model + counts only, priced retroactively.

        `server_tools` carries the per-request counts a server tool reports
        (`web_search_requests`, `web_fetch_requests`). Omitted from the line
        entirely when the call used none, so the log's shape is unchanged for
        every call that is just a model call."""
        rec = {
            "timestamp": self._now(),
            "run_id": self._run_id,
            "corpus": self._corpus,
            "model": model,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "committed": committed,
        }
        if server_tools:
            rec["server_tool_use"] = server_tools
        line = json.dumps(rec, separators=(",", ":")) + "\n"
        os.makedirs(os.path.dirname(self._log_path) or ".", exist_ok=True)
        with open(self._log_path, "a", encoding="utf-8") as fh:
            fh.write(line)
            fh.flush()
            os.fsync(fh.fileno())


# --------------------------------------------------------------------------
# Reporting helpers — cost/reporting concerns kept OUT of the pre-flight path.
# --------------------------------------------------------------------------

def read_log(path: str) -> list[dict]:
    """Parse the token log into records (skipping any torn final line)."""
    out: list[dict] = []
    if not os.path.exists(path):
        return out
    with open(path, "r", encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            try:
                out.append(json.loads(line))
            except json.JSONDecodeError:
                continue
    return out


def cumulative_tokens(path: str) -> int:
    """Total input+output tokens across the whole log (no window). For reporting
    and for cross-checking the guard against a hand-summed total."""
    return sum(int(r.get("input_tokens", 0)) + int(r.get("output_tokens", 0))
               for r in read_log(path))


def server_tool_requests(path: str) -> dict:
    """Total server-tool requests across the whole log, by kind.

    These are billed PER REQUEST, separately from the tokens their results add
    to the context, so a spend figure computed from tokens alone is short by
    this term. Reporting only — nothing in the pre-flight path reads it."""
    totals: dict = {}
    for rec in read_log(path):
        for kind, n in (rec.get("server_tool_use") or {}).items():
            totals[kind] = totals.get(kind, 0) + int(n)
    return totals
