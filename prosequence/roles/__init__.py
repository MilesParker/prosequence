"""Ingestion role and its shared harness pieces.

Promoted from the round-trip spike. The role:
  ingestion  — IngestionRole (declares capability + objective).
Shared machinery it sits on:
  role       — Role base class (graph, conditional edge, cap, capability, commit).
  capability — capability enforcement at the apply boundary.
  state      — graph state (frozen dataclass, add_messages reducer).
  bridge     — LangChain <-> Anthropic message translation.
Ingestion-specific:
  read_tools — the read-only tool surface.
  prompt     — objective + YAML generation rules + finding contract.
  apply      — finding parser and session-write application.
  run        — harness entry (config -> guard/session -> role).
Orthogonal:
  observability — OpenTelemetry/Phoenix tracing (never gates a run).
"""
