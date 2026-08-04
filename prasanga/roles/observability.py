#!/usr/bin/env python3
"""Local trace observability (Directive: Phoenix + OpenInference).

Orthogonal to the commit path. This wires OpenTelemetry tracing for the
harness's two spines — the raw Anthropic SDK call (guarded_client.create) and
the LangGraph role protocol (prasanga.roles.role) — and exports spans to a local
Phoenix collector (localhost:6006 by default; SQLite-backed, no egress). It
touches neither validate.py, the writer, nor the store.

Design points honoured here:

  * register() runs at most ONCE per process (idempotent guard below), never
    per request. auto_instrument=True lets the installed openinference
    instrumentors (Anthropic + LangChain/LangGraph) patch their libraries — no
    manual .instrument() calls are needed.

  * The harness runs identically when Phoenix is down or absent. Export is via
    the OTLP exporter, which fails non-blockingly when nothing is listening; and
    a missing package or any register() error here degrades to a no-op with a
    warning. Tracing is never a runtime dependency of the commit path.

  * Opt out with PARSANGA_TRACE=0. Override the collector with the standard
    PHOENIX_COLLECTOR_ENDPOINT env var (default http://localhost:6006).
"""
from __future__ import annotations

import os
import sys

_STARTED = False


def init_tracing(project_name: str = "parsanga") -> bool:
    """Register the Phoenix tracer provider + auto-instrumentation, once.

    Returns True if tracing is active after this call, False if it was skipped
    (opt-out) or failed (package missing / register error). Safe to call
    repeatedly and from more than one entrypoint: only the first call does work.
    """
    global _STARTED
    if _STARTED:
        return True
    if os.environ.get("PARSANGA_TRACE", "1") == "0":
        return False
    try:
        from phoenix.otel import register

        register(project_name=project_name, auto_instrument=True)
    except Exception as exc:  # tracing must never break a run
        print(f"[observability] tracing disabled: {exc}", file=sys.stderr)
        return False

    _STARTED = True
    return True
