"""The agents, and the harness pieces they sit on.

Agents:
  ingestion   — IngestionRole: one document + the whole corpus -> one finding
                -> session writes -> one commit. Declares a capability.
  collection  — CollectionAgent: searches, selects sources, and drives
                ingestion runs. Declares no capability and never commits; its
                effect on a corpus is entirely mediated by those runs.

Shared machinery:
  agent       — Agent base class: the model loop (graph, conditional edge,
                iteration cap, truncation check, forced finding call).
  role        — Role(Agent): the corpus half — session, capability, plan,
                apply/commit boundary, salvage on a failed commit.
  capability  — capability enforcement over a whole plan, before the first write.
  plan        — session writes reified as ops, with typed New/Existing refs.
  state       — graph state (frozen dataclass, add_messages reducer).
  bridge      — LangChain <-> Anthropic message translation.
  prompts/    — prompt text, one module per agent plus the shared OPERATIONS.

Ingestion-specific:
  corpus_view — the whole corpus rendered into a cached system block.
  apply       — the finding tool schema, and a finding -> a list of plan ops.
                It does not write; `plan.execute` does.
  repair      — drops the inferences that would fail I1-I10, keeping the rest.
  salvage     — writes a failed run's graph and finding under prosequence/logs/failed/.
  read_tools  — the read-only tool surface, for a traversal-shaped role. Not
                bound by ingestion (single-shot) and not yet by anything else.

Collection-specific:
  search      — SearchProvider protocol: Google CSE, Anthropic web search, stub.
  sources     — the source ledger, the parallel fetch, the serial ingest batch.
  coverage    — what the agent reads to judge how well a corpus is covered.
  fetch       — url -> plain article text. Shared with run.py.

Harness entries:
  run         — ingest one document into one corpus.
  collect     — populate a corpus from (name, thesis, scope).

Orthogonal:
  observability — OpenTelemetry/Phoenix tracing (never gates a run).
"""
