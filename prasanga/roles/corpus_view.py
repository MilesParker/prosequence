#!/usr/bin/env python3
"""Render a committed corpus into a compact text block for in-prompt reading.

Ingestion is single-shot: the whole corpus is put in front of the model at once
(as a cached system block) instead of being reached through per-call read tools.
This renders a frozen `yaml_io.Corpus` into JSON Lines — one node per line,
claims first then inferences — a form that is compact, unambiguous, and complete
enough for the model to cite existing uuids and dedup against existing claims.

Rendered from the `Corpus` directly (the session's bound version), never through
the session's read ops, so it does not touch the session lifecycle or its
open/closed guard.
"""
from __future__ import annotations

import json

from ..core.yaml_io import Claim, Corpus, Inference


def _claim_line(c: Claim, roots: frozenset) -> dict:
    d = {
        "kind": "claim",
        "id": c.id,
        "tag": c.tag,
        "text": c.text,
        "terminal": c.terminal,
    }
    if c.id in roots:
        # Flagged explicitly: nothing else in this rendering distinguishes a
        # root, and it is the corpus's central thesis/question — the anchor a
        # first ingestion into an otherwise-bare space attaches to.
        d["root"] = True
    if c.attribution is not None:
        d["attribution"] = {
            "source": {
                "type": c.attribution.source.type,
                "reference": c.attribution.source.reference,
            },
            "quote": c.attribution.quote,
        }
    return d


def _inference_line(i: Inference) -> dict:
    return {
        "kind": "inference",
        "id": i.id,
        "grounds": list(i.grounds),
        "warrants": list(i.warrants),
        "target": i.target,
        "relation": i.relation.value,
    }


def render_corpus(corpus: Corpus) -> str:
    """The whole corpus as JSON Lines: every claim, then every inference.

    One node per line so the block is a clean, cacheable prefix. A root claim
    carries `"root": true` — the only marker distinguishing it from any other
    claim, and the anchor a first ingestion into an otherwise-bare space (one
    root claim, no inferences yet) attaches to. Returns "" only for a truly
    empty corpus, which `ingest()`'s seeding step no longer produces (a new
    corpus is seeded with a root claim, never zero nodes)."""
    roots = frozenset(corpus.roots)
    lines = [json.dumps(_claim_line(c, roots), ensure_ascii=False) for c in corpus.claims]
    lines += [json.dumps(_inference_line(i), ensure_ascii=False)
              for i in corpus.inferences]
    return "\n".join(lines)
