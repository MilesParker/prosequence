#!/usr/bin/env python3
"""The finding tool schema, and applying a finding as session write ops.

The finding is not parsed from free text. The model must call
`FINDING_TOOL_SCHEMA` (`role.py` pins `tool_choice` to it for a single-shot
role), so `response.content` carries exactly one `tool_use` block whose `input`
IS the finding dict — no fenced-block regex, no top-level json.loads. But
`tool_choice` only forces WHICH tool is called; Anthropic does not validate the
argument VALUES against `input_schema` (no required-field or type enforcement
at the API layer), so a large finding can still come back with a field's type
wrong — observed in practice: `claims` arriving as a JSON-encoded string
(the model dumping the array as text into one field) instead of an actual
array. `_coerce_list` below recovers that one known shape; anything else
malformed raises `FindingShapeError` rather than a confusing TypeError three
frames into apply_finding. The shape (a `claims` array and an `inferences`
array, where a new claim carries a local `key` an inference can cite alongside
real corpus uuids) is a contract this module chose (see prompt.py's prose
description of the same contract, which must stay in sync).

Validation is NOT done here — the session validates the whole graph once at
commit() (I1-I8). apply deliberately does no invariant checking; a bad
attachment surfaces as a ValidationFailed at commit, which is where the spec
wants it.

Writes go straight to session ops (add_claim / add_inference). No write op is a
tool; the model never calls these. apply is harness code and calls them
directly, which is the only place in the whole run that touches session writes.
"""
from __future__ import annotations

import json
from typing import Tuple

from ..core.yaml_io import Attribution, GroundsSource, Relation


class FindingShapeError(Exception):
    """The finding tool call's `input` does not match `FINDING_TOOL_SCHEMA` in a
    way `_coerce_list` cannot recover. Terminal."""


FINDING_TOOL_NAME = "submit_finding"

# Mirrors the JSON contract described in prompt.py's finding-shape prose.
FINDING_TOOL_SCHEMA = {
    "name": FINDING_TOOL_NAME,
    "description": (
        "Submit the finding: the new claims this document introduces and the "
        "inferences that attach them (or existing corpus uuids) to the corpus. "
        "Call this exactly once, when ingestion is complete."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "claims": {
                "type": "array",
                "description": "New claims to add. Empty if the document warrants none.",
                "items": {
                    "type": "object",
                    "properties": {
                        "key": {
                            "type": "string",
                            "description": "Local handle for this new claim, invented here; an inference below cites it in grounds/warrants/target.",
                        },
                        "tag": {
                            "type": "string",
                            "description": "Short content tag naming what the claim says, <=50 chars, unique in the corpus.",
                        },
                        "text": {"type": "string", "description": "One atomic assertion."},
                        "terminal": {"type": "boolean"},
                        "attribution": {
                            "type": "object",
                            "description": "Required for a grounds/evidence claim; omit for a value or generalisation claim.",
                            "properties": {
                                "source": {
                                    "type": "object",
                                    "properties": {
                                        "type": {"type": "string"},
                                        "reference": {"type": "string"},
                                    },
                                    "required": ["type"],
                                },
                                "quote": {"type": "string"},
                            },
                            "required": ["source"],
                        },
                    },
                    "required": ["key", "tag", "text", "terminal"],
                },
            },
            "inferences": {
                "type": "array",
                "description": "Inferences attaching the claims above (by key) or existing corpus claims (by uuid) to the corpus. Every claim in `claims` must appear in at least one inference here, as grounds, warrant, or target -- a claim with no inference referencing it is not attached to anything. Empty only when `claims` is also empty (nothing in the document warrants any new attachment).",
                "items": {
                    "type": "object",
                    "properties": {
                        "grounds": {"type": "array", "items": {"type": "string"}},
                        "warrants": {"type": "array", "items": {"type": "string"}},
                        "target": {"type": "string", "description": "Uuid-or-key of the claim this inference attaches to."},
                        "relation": {"type": "string", "enum": ["concludes", "contests"]},
                    },
                    "required": ["grounds", "target", "relation"],
                },
            },
        },
        "required": ["claims", "inferences"],
    },
}


def _coerce_list(value, key: str) -> list:
    """Recover `finding[key]` when the model returned a JSON-encoded string
    instead of an array — the one malformed shape observed in practice on a
    large finding (see module docstring). Two string cases:

      * the string decodes to the array itself                    -> use it
      * the string decodes to an object still carrying `key`       -> the model
        nested the whole sub-object (occasionally the whole finding) inside
        this one field; pull `key` back out of it

    Anything else that isn't already a list (or None/absent) is a genuinely
    malformed finding, not a recoverable formatting quirk: raises.
    """
    if value is None:
        return []
    if isinstance(value, str):
        try:
            decoded = json.loads(value)
        except json.JSONDecodeError as e:
            raise FindingShapeError(
                f"finding[{key!r}] was a string but not valid JSON: {e}") from e
        value = decoded.get(key) if isinstance(decoded, dict) else decoded
    if value is None:
        return []
    if not isinstance(value, list):
        raise FindingShapeError(
            f"finding[{key!r}] must be a list, got {type(value).__name__}")
    return value


def _normalize_finding(finding: dict) -> dict:
    """Recover the two ways a large finding call has been observed to arrive
    malformed: `claims`/`inferences` individually stringified, or the WHOLE
    finding dumped as a JSON string into one of those two fields. The latter
    is checked first per field — if a decoded string turns out to itself carry
    a `claims` or `inferences` key, it IS the finding (the other field's raw
    value, if any, is superseded, not merged: a nested full finding is
    authoritative over a stray sibling)."""
    for k in ("claims", "inferences"):
        v = finding.get(k)
        if isinstance(v, str):
            try:
                decoded = json.loads(v)
            except json.JSONDecodeError as e:
                raise FindingShapeError(
                    f"finding[{k!r}] was a string but not valid JSON: {e}") from e
            if isinstance(decoded, dict) and ("claims" in decoded or "inferences" in decoded):
                return {"claims": _coerce_list(decoded.get("claims"), "claims"),
                        "inferences": _coerce_list(decoded.get("inferences"), "inferences")}
            finding = {**finding, k: decoded}
    return {"claims": _coerce_list(finding.get("claims"), "claims"),
            "inferences": _coerce_list(finding.get("inferences"), "inferences")}


def _check_all_claims_attached(claims: list, inferences: list) -> None:
    """Every new claim's `key` must appear in at least one inference's grounds,
    warrants, or target. Enforced here, not just asked for in the prompt:
    observed twice in practice (an empty-corpus seed, and separately a
    populated corpus) that prompt instruction alone did not stop the model
    from extracting a batch of claims and submitting zero inferences — treating
    attachment as optional rather than the point. This raises before any
    session write happens, so a bad finding fails cleanly instead of silently
    committing a pile of claims disconnected from the graph."""
    referenced: set = set()
    for inf in inferences:
        referenced.update(inf.get("grounds") or [])
        referenced.update(inf.get("warrants") or [])
        target = inf.get("target")
        if target is not None:
            referenced.add(target)
    unattached = [c.get("key") for c in claims if c.get("key") not in referenced]
    if unattached:
        raise FindingShapeError(
            f"{len(unattached)} new claim(s) added with no inference "
            f"referencing them (grounds/warrants/target) -- not attached to "
            f"anything: {unattached}")


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
    finding = _normalize_finding(finding)
    _check_all_claims_attached(finding["claims"], finding["inferences"])
    ops: list[str] = []
    key_to_uuid: dict[str, str] = {}

    for c in finding["claims"]:
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

    for inf in finding["inferences"]:
        grounds = [resolve(g) for g in inf.get("grounds", [])]
        warrants = [resolve(w) for w in inf.get("warrants", [])]
        target = resolve(inf["target"])
        relation = Relation(inf["relation"])
        iid = session.add_inference(
            grounds=grounds, warrants=warrants, target=target, relation=relation
        )
        ops.append(f"add_inference {iid} {relation.value} -> {target}")

    return tuple(ops)
