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
frames into plan_from_finding. The shape (a `claims` array and an `inferences`
array, where a new claim carries a local `key` an inference can cite alongside
real corpus uuids) is a contract this module chose (see prompts/ingestion.py's
prose description of the same contract, which must stay in sync).

GRAPH validation is NOT done here — the session validates the whole graph once
at commit() (I1-I10). apply deliberately does no invariant checking; a bad
attachment surfaces as a ValidationFailed at commit, which is where the spec
wants it.

What apply DOES check is field well-formedness, because the API will not: the
enum and required constraints in `input_schema` are guidance the model usually
follows, not a gate the wire enforces. `_check_schemes` and
`_check_source_types` are that gate. Structural checks over the resulting plan
(references that resolve to nothing, created nodes nothing attaches) belong to
`plan.check_plan`, which this calls. All of it runs before any session write, so
a malformed finding fails the run without touching the corpus. What such a
failure leaves behind on disk is `roles/salvage.py`'s business, not this
module's: apply stays pure and writes nothing, which is why the ops-building
step is exposed separately as `ops_from_finding` for salvage to consume.

This module NO LONGER WRITES. It turns a finding into a `plan.Op` list and
nothing else — pure, session-free, and testable without a corpus. `plan.execute`
is what touches the session, called from the role's apply node. The wire shape
below is unchanged by that split: a ref is still a bare string, disambiguated
here by whether it matches a key the finding declares, and turned into a typed
`New`/`Existing` at this boundary.
"""
from __future__ import annotations

import json
from typing import Tuple

from ..core.yaml_io import (
    ArgumentScheme,
    Attribution,
    GROUNDS_SOURCE_TYPES,
    GroundsSource,
    Relation,
)
from .plan import (
    AddClaim,
    AddInference,
    ClaimId,
    Existing,
    New,
    Op,
    Ref,
    check_plan,
)

_SCHEME_VALUES = [s.value for s in ArgumentScheme]
_UNKNOWN = ArgumentScheme.UNKNOWN.value


class FindingShapeError(Exception):
    """The finding tool call's `input` does not match `FINDING_TOOL_SCHEMA` in a
    way `_coerce_list` cannot recover. Terminal."""


FINDING_TOOL_NAME = "submit_finding"

# Mirrors the JSON contract described in prompts/ingestion.py's prose.
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
                            # Role is positional — it is not a property of a
                            # claim, so it cannot be read off this field.
                            # Attribution tracks the claim's TEXT: present iff
                            # the text is attributive ("Source X reports Y"),
                            # absent when the claim asserts something directly.
                            "description": "Present iff this claim's text is attributive -- it reports what a source says (\"Source X reports Y\") rather than asserting Y directly. Omit for a claim that asserts in its own voice.",
                            "properties": {
                                "source": {
                                    "type": "object",
                                    "properties": {
                                        "type": {
                                            "type": "string",
                                            "enum": list(GROUNDS_SOURCE_TYPES),
                                            "description": "How the claim's text bottoms out. Citation carries a `reference`; the rest do not.",
                                        },
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
                        # grounds/warrants are REFERENCE lists, and saying so is
                        # load-bearing: undescribed, they were filled with the
                        # proposition's prose instead of a handle to it, while
                        # `target` — the one slot that said "uuid-or-key" — was
                        # never once got wrong. A warrant is a claim like any
                        # other; the only way to cite one is to declare it.
                        "grounds": {
                            "type": "array",
                            "description": "Uuid-or-key REFERENCES to the claims this inference reasons from. Each entry is either a uuid copied from the corpus above or a `key` of a claim in `claims`. Never the claim's text: to use a proposition not already in the corpus, add it to `claims` and cite its key here.",
                            "items": {"type": "string"},
                        },
                        "warrants": {
                            "type": "array",
                            "description": "Uuid-or-key REFERENCES to the claims that license this step (0 or more). Same rule as `grounds` — a warrant IS a claim, so a warrant you are surfacing from the document must be added to `claims` with its own key and cited here by that key. Never put the warrant's text in this array.",
                            "items": {"type": "string"},
                        },
                        "target": {"type": "string", "description": "Uuid-or-key of the claim this inference attaches to."},
                        "relation": {"type": "string", "enum": ["concludes", "contests"]},
                        "scheme": {
                            "type": "string",
                            "enum": _SCHEME_VALUES,
                            "description": (
                                "The kind of inferential move this step makes. Required on every inference. "
                                "Deductive: the grounds, together with the stated warrants, entail the target -- "
                                "any objection to the step names a missing premise rather than a reason the step "
                                "fails; this is the top of every AND-decomposition. "
                                "Unknown: a real inferential move that none of the other values names -- give it "
                                "a schemeDescriptor. Unknown is a classification, not a way to skip classifying."
                            ),
                        },
                        "schemeDescriptor": {
                            "type": "string",
                            "description": (
                                "A few words naming the inferential move. Required when scheme is \"Unknown\"; "
                                "must be omitted for every other scheme. It classifies the inference and nothing "
                                "else goes in it -- it is not a note field."
                            ),
                        },
                    },
                    "required": ["grounds", "target", "relation", "scheme"],
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
    """Recover a finding whose two arrays arrived JSON-encoded as strings.

    The API does not validate argument values against `input_schema` (see the
    module docstring), and on a large finding the model has been observed to
    serialize its own output rather than emit arrays: `claims` and/or
    `inferences` come back as strings, and a decoded string may be the bare
    array OR a dict wrapping one or both fields.

    HARVEST, NEVER SUPERSEDE. An earlier version returned the first decoded
    dict that carried either key, on the reasoning that a nested full finding
    was authoritative over a stray sibling. That destroyed real work: a model
    split one finding across both fields as two independent JSON strings —
    `claims` holding `{"claims": [57], "inferences": []}` and `inferences`
    holding `{"inferences": [40]}` — and the early return took the nested EMPTY
    inferences and discarded the sibling's 40. The finding was complete and
    well-formed; it surfaced as `check_plan` reporting that none of the 57
    claims was attached, which reads as a modelling failure and was ours.

    So every field of every decoded value is examined, and each of the two
    arrays is filled from the first non-empty candidate found for it, with a
    field's own value preferred over one nested inside the other field's blob.
    A field that is genuinely absent or empty everywhere stays empty.
    """
    def decode(key: str):
        v = finding.get(key)
        if not isinstance(v, str):
            return v
        try:
            return json.loads(v)
        except json.JSONDecodeError as e:
            raise FindingShapeError(
                f"finding[{key!r}] was a string but not valid JSON: {e}") from e

    decoded = {k: decode(k) for k in ("claims", "inferences")}
    out: dict[str, list] = {}

    # Own field first: a list under `inferences` is what `inferences` means,
    # and outranks anything found nested inside the `claims` blob.
    for k in ("claims", "inferences"):
        v = decoded[k]
        if not isinstance(v, dict):
            out[k] = _coerce_list(v, k)

    # Then fill what is still missing or empty from any decoded wrapper dict,
    # whichever field it arrived in.
    for k in ("claims", "inferences"):
        if out.get(k):
            continue
        for source in ("claims", "inferences"):
            v = decoded[source]
            if isinstance(v, dict) and v.get(k):
                out[k] = _coerce_list(v.get(k), k)
                break
        out.setdefault(k, [])

    return {"claims": out["claims"], "inferences": out["inferences"]}


def _scheme_faults(inferences: list) -> dict[int, str]:
    """Index -> why that inference's scheme is malformed. Empty when all are
    well-formed.

    `scheme` must be present and in the enum, and `schemeDescriptor` present IFF
    the scheme is Unknown.

    Enforced here rather than left to the tool's `input_schema`: `tool_choice`
    forces WHICH tool is called, but Anthropic does not validate argument values
    against the schema (see the module docstring), so `required` and `enum` in
    FINDING_TOOL_SCHEMA are guidance to the model, not a gate. This is the gate.

    The biconditional is the tool boundary's half of I9. I9 itself is only
    one-directional over the corpus — Unknown with no descriptor is legal there,
    because migration produced exactly that — but nothing NEW should arrive
    classified as Unknown without saying what the move actually was.
    """
    faults: dict[int, str] = {}
    for n, inf in enumerate(inferences):
        scheme = inf.get("scheme")
        descriptor = inf.get("schemeDescriptor")
        if scheme not in _SCHEME_VALUES:
            faults[n] = (f"scheme is {scheme!r}, need one of "
                         + "/".join(_SCHEME_VALUES))
        elif scheme == _UNKNOWN and not descriptor:
            faults[n] = (f"scheme {_UNKNOWN!r} with no schemeDescriptor "
                         f"(name the inferential move)")
        elif scheme != _UNKNOWN and descriptor:
            faults[n] = (f"schemeDescriptor {descriptor!r} with scheme "
                         f"{scheme!r} (a descriptor belongs only to "
                         f"{_UNKNOWN!r})")
    return faults


def _check_schemes(inferences: list) -> None:
    """Raise `FindingShapeError` if any scheme is malformed. The gate that runs
    inside `ops_from_finding`, after `prune_bad_schemes` has had its chance to
    remove the isolated cases — so what reaches here is either a clean finding
    or the systemic failure that should stop the run."""
    faults = _scheme_faults(inferences)
    if faults:
        raise FindingShapeError(
            f"{len(faults)} inference(s) with a malformed scheme:\n  "
            + "\n  ".join(f"inference[{n}]: {why}"
                           for n, why in sorted(faults.items())))


def prune_bad_schemes(finding: dict) -> tuple[dict, list[str]]:
    """Drop inferences whose scheme is malformed. Returns (finding, notes).

    Same policy as `plan.prune_unresolvable`, one stage earlier: an inference
    the tool boundary must refuse is a broken edge and nothing more, and it
    should not cost the rest of the finding. One inference naming 'FromEvidence'
    — an invented enum member, on a step whose descriptor was already written
    correctly — discarded 51 claims and 24 sound inferences, a whole document's
    ingestion thrown away over one token.

    Pruned, never coerced. Rewriting 'FromEvidence' to Unknown would launder an
    invented scheme into the corpus, and refusing values the API does not
    enforce is this gate's entire job. The edge is dropped and the note says
    why; the claims it cited stay, and `check_plan` decides whether anything is
    left orphaned by its absence.

    THE SYSTEMIC CASE IS LEFT ALONE, exactly as in `prune_unresolvable`: if
    every inference is malformed, nothing is pruned and the finding is returned
    untouched, so `_check_schemes` raises naming all of them. A model that got
    the scheme wrong everywhere has misunderstood the contract, and the accurate
    error is the one that says so — not a silent run that commits only claims.
    """
    inferences = finding.get("inferences") or []
    faults = _scheme_faults(inferences)
    if not faults or len(faults) >= len(inferences):
        return finding, []

    notes = [f"inference dropped: {why}" for _, why in sorted(faults.items())]
    kept = [inf for n, inf in enumerate(inferences) if n not in faults]
    return {**finding, "inferences": kept}, notes


def prune_malformed_entries(finding: dict) -> Tuple[dict, list]:
    """Drop entries in `claims`/`inferences` that are not objects. Returns
    (finding, notes).

    The API enforces WHICH tool is called, never the shape of its arguments, so
    an array declared as objects can come back holding a bare string — a model
    emitting a claim's text where the claim should be. Observed live: three of
    nine sources in one collection run died on the same
    `AttributeError: 'str' object has no attribute 'get'` out of
    `_check_source_types`, which reads `c.get("attribution")` of every entry.

    That was the wrong failure twice over. It escaped as an AttributeError
    rather than a `FindingShapeError`, so no salvage call site caught it and the
    whole finding — every other claim in it — was lost with no error corpus
    written. And it was fatal where it did not need to be: one malformed entry
    among fifty is a broken entry, not a broken finding.

    So this prunes and notes, on exactly the precedent of `prune_bad_schemes`
    and `plan.prune_unresolvable`. An inference left citing a dropped claim's
    key is picked up downstream by `prune_unresolvable`. THE SYSTEMIC CASE IS
    LEFT ALONE: if nothing in `claims` survives, the finding is malformed rather
    than dented, and `ops_from_finding` raises `FindingShapeError` naming it.
    """
    notes: list[str] = []
    out = dict(finding)
    for field in ("claims", "inferences"):
        entries = out.get(field) or []
        if not isinstance(entries, list):
            continue
        kept = [e for e in entries if isinstance(e, dict)]
        dropped = len(entries) - len(kept)
        if dropped and kept:
            out[field] = kept
            notes.append(
                f"{dropped} {field[:-1]} entr{'y' if dropped == 1 else 'ies'} "
                f"dropped: not an object (the model emitted a bare value where "
                f"the schema declares one)")
        elif dropped and not kept:
            # Everything malformed: leave it, so the shape gate below raises
            # naming the field rather than reporting an empty finding.
            pass
    return out, notes


def _check_source_types(claims: list) -> None:
    """`attribution.source.type` names one of the five GroundsSource
    discriminants. Same reason as `_check_schemes`: the schema's `enum` does not
    bind, and `GroundsSource.type` is a plain str in the model, so an invented
    source type would otherwise reach the corpus unchallenged."""
    bad = []
    for n, c in enumerate(claims):
        if not isinstance(c, dict):
            # Reached only when EVERY entry is malformed (`prune_malformed_
            # entries` keeps the partial case). A FindingShapeError here is
            # salvageable; the AttributeError this replaces was not.
            raise FindingShapeError(
                f"claim[{n}] is {type(c).__name__}, not an object: {c!r:.80}")
        attr = c.get("attribution")
        if not attr:
            continue
        stype = (attr.get("source") or {}).get("type")
        if stype not in GROUNDS_SOURCE_TYPES:
            bad.append(f"claim[{n}] ({c.get('key')!r}): source.type is "
                       f"{stype!r}, need one of "
                       + "/".join(GROUNDS_SOURCE_TYPES))
    if bad:
        raise FindingShapeError(
            f"{len(bad)} claim(s) with a malformed attribution source:\n  "
            + "\n  ".join(bad))


def _attribution(raw) -> Attribution | None:
    if not raw:
        return None
    src = raw.get("source") or {}
    # No default for `type`: _check_source_types has already established it is
    # one of the five discriminants, so defaulting here would only mask a bug.
    return Attribution(
        source=GroundsSource(type=src["type"], reference=src.get("reference")),
        quote=raw.get("quote"),
    )


def ops_from_finding(finding: dict) -> Tuple[Op, ...]:
    """A finding -> the ops it asks for, UNCHECKED. Pure: no session, no writes,
    nothing minted.

    Split out from `plan_from_finding` so the structural check is a separate
    step a caller can fail around. `roles/salvage.py` needs the ops that
    `check_plan` refused in order to write them out as an error corpus, and it
    cannot get them from a raised exception.

    Field well-formedness IS checked here (`_check_source_types`,
    `_check_schemes`), because those are the gate the API does not provide and a
    finding that fails them yields no ops at all — there is nothing to salvage
    from a scheme that names no enum member. What is deferred is only the
    structural check over the assembled plan.

    Claims come first so that every `New` is bound before anything uses it, then
    inferences. That ordering is produced here and VERIFIED by `check_plan`
    rather than trusted — every op after the claims references without binding,
    so any order among them would do, but the check is what makes that a fact
    rather than an assumption.

    There is no `thesis` flag on the wire. The schema carried one and turned
    every claim a document led with into a candidate corpus question; what a
    corpus argues about is not a per-document decision, so the field is gone and
    ingestion no longer holds `DesignateThesis` (see `IngestionRole`).

    A ref on the wire is a bare string carrying two different kinds of thing. It
    is a `New` iff it matches a key this finding declares, and an `Existing`
    otherwise — the same rule the old resolver used, except that an `Existing`
    is checked against the corpus by `check_plan` instead of being assumed to
    name something. A key typo used to pass through here as though it were a
    corpus uuid; now it is a PlanError naming the ref.
    """
    finding = _normalize_finding(finding)
    _check_source_types(finding["claims"])
    _check_schemes(finding["inferences"])

    keys = {c.get("key") for c in finding["claims"] if c.get("key")}

    def ref(raw: str) -> Ref[ClaimId]:
        return New(raw) if raw in keys else Existing(ClaimId(raw))

    plan: list[Op] = [
        AddClaim(
            key=c["key"],
            tag=c["tag"],
            text=c["text"],
            terminal=bool(c.get("terminal", False)),
            attribution=_attribution(c.get("attribution")),
        )
        for c in finding["claims"]
    ]
    plan += [
        AddInference(
            grounds=tuple(ref(g) for g in inf.get("grounds") or ()),
            warrants=tuple(ref(w) for w in inf.get("warrants") or ()),
            target=ref(inf["target"]),
            relation=Relation(inf["relation"]),
            # Both already checked by _check_schemes, so the enum construction
            # cannot raise and the descriptor cannot be a stray note field.
            scheme=ArgumentScheme(inf["scheme"]),
            scheme_descriptor=inf.get("schemeDescriptor"),
        )
        for inf in finding["inferences"]
    ]

    return tuple(plan)


def plan_from_finding(finding: dict, known_ids: frozenset) -> Tuple[Op, ...]:
    """A finding -> a plan that is structurally executable, or a PlanError.

    The composition of the two steps above: build the ops, then check them. Kept
    as one function because "a finding becomes a checked plan" is the operation
    every caller actually wants; the seam exists for the one caller (salvage)
    that needs the rejected ops rather than only the rejection.
    """
    plan = ops_from_finding(finding)
    check_plan(plan, known_ids)
    return plan
