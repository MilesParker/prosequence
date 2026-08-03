#!/usr/bin/env python3
"""Parse the model's finding and apply it as session write ops.

DRAFT. This is the answer to spike question 2 ("what shape does a finding come
back in, and how much of apply is parsing vs validation"). The shape is a
contract this spike *chose* (see prompt.py): a JSON object of `claims` and
`inferences`, where a new claim carries a local `key` and an inference cites
either an existing corpus uuid or one of those local keys. That choice, not a
discovered fact, is what apply parses.

Parsing here is: pull the last ```json fenced block (or the raw trailing JSON),
json.loads it, then resolve local keys to freshly minted uuids. Validation is
NOT done here — the session validates the whole graph once at commit() (I1-I8).
apply deliberately does no invariant checking; a bad attachment surfaces as a
ValidationFailed at commit, which is where the spec wants it.

Writes go straight to session ops (add_claim / add_inference). No write op is a
tool; the model never calls these. apply is harness code and calls them
directly, which is the only place in the whole run that touches session writes.
"""
from __future__ import annotations

import json
import re
from typing import Tuple

from yaml_io import Attribution, GroundsSource, Relation


_FENCE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL)


class FindingParseError(Exception):
    """The final message did not carry a parseable finding. Terminal."""


def parse_finding(text: str) -> dict:
    """Extract the finding object from the model's final message text.

    Prefers the last fenced ```json block; falls back to the last top-level
    object in the raw text. Raises FindingParseError on neither.
    """
    blocks = _FENCE.findall(text or "")
    candidate = None
    if blocks:
        candidate = blocks[-1]
    else:
        # Fall back to the outermost { ... } span in the text.
        start = text.find("{")
        end = text.rfind("}")
        if start != -1 and end > start:
            candidate = text[start : end + 1]
    if candidate is None:
        raise FindingParseError("no JSON object found in the final message")
    try:
        obj = json.loads(candidate)
    except json.JSONDecodeError as e:
        raise FindingParseError(f"finding JSON did not parse: {e}") from e
    if not isinstance(obj, dict):
        raise FindingParseError("finding is not a JSON object")
    return obj


def _attribution(raw) -> Attribution | None:
    if not raw:
        return None
    src = raw.get("source") or {}
    return Attribution(
        source=GroundsSource(type=src.get("type", "Citation"),
                             reference=src.get("reference")),
        quote=raw.get("quote"),
    )


def apply_finding(session, finding: dict) -> Tuple[str, ...]:
    """Apply a parsed finding to the session, returning one line per op.

    Claims first (so their minted uuids exist), then inferences, whose id
    references are resolved: a local `key` -> the minted uuid, an existing
    corpus uuid -> itself. Ops are executed in listed order.
    """
    ops: list[str] = []
    key_to_uuid: dict[str, str] = {}

    for c in finding.get("claims", []) or []:
        cid = session.add_claim(
            text=c["text"],
            tag=c["tag"],
            attribution=_attribution(c.get("attribution")),
            terminal=bool(c.get("terminal", False)),
        )
        key = c.get("key")
        if key:
            key_to_uuid[key] = cid
        ops.append(f'add_claim {cid} "{c["tag"]}"')

    def resolve(ref: str) -> str:
        return key_to_uuid.get(ref, ref)

    for inf in finding.get("inferences", []) or []:
        grounds = [resolve(g) for g in inf.get("grounds", [])]
        warrants = [resolve(w) for w in inf.get("warrants", [])]
        target = resolve(inf["target"])
        relation = Relation(inf["relation"])
        iid = session.add_inference(
            grounds=grounds, warrants=warrants, target=target, relation=relation
        )
        ops.append(f"add_inference {iid} {relation.value} -> {target}")

    return tuple(ops)
