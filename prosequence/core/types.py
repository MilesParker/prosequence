#!/usr/bin/env python3
"""types.py — the Python mirror of src/types.ts.

src/types.ts is canonical. This file exists to be read BESIDE it: same section
order, same declaration order within a section, same names wherever Python
allows. Nothing here loads, emits, or validates — `yaml_io` does the I/O and
imports these, `validate.py` does the invariants. If you are changing behaviour
you are probably in the wrong file.

Two things Python cannot mirror directly, and one it currently does not:

  * A TS string-union has no Python equivalent that is both closed and
    ergonomic, so a union becomes either an `Enum` (Relation, ArgumentScheme —
    where call sites should hold the type) or a tuple of legal strings
    (GROUNDS_SOURCE_TYPES, SUBMISSION_STATUSES — where the value stays a `str`
    on the dataclass and the closed set is enforced at a boundary).
  * TS branded ids are `NewType`s here. They are declared, and the harness's op
    layer uses them, but the dataclasses below still type their id fields as
    plain `str` — see "Known divergences" at the foot of this file.

The `*_KEYS` tuples are the schema's declaration ORDER. The emitter walks them
so that YAML field order matches types.ts rather than dataclass field order
(which differs: fields with defaults must come last). A data key outside the
matching tuple is a hard error in the loader.

Every deliberate difference from types.ts is listed at the bottom. Add to that
list rather than letting a divergence sit unrecorded.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import NewType, Optional, Tuple

# --------------------------------------------------------------------------
# Branded IDs  (types.ts: "Branded IDs")
# --------------------------------------------------------------------------
# NewType is erased at runtime and checked statically, which is as close as
# Python gets to a TS brand. See "Known divergences" — the dataclasses do not
# yet use these.

ClaimId = NewType("ClaimId", str)
InferenceId = NewType("InferenceId", str)
DiscourseSpaceId = NewType("DiscourseSpaceId", str)


# --------------------------------------------------------------------------
# Enums  (types.ts: "Enums")
# --------------------------------------------------------------------------

class ArgumentScheme(Enum):
    """The kind of inferential move an inference makes. Required on every
    inference — there is no "unclassified" state, only `UNKNOWN`, which IS a
    classification: "a real inferential move that none of the other values
    names". `DEDUCTIVE` is the top of every AND-decomposition — grounds plus
    warrants entail the target, and any objection names a missing premise
    rather than a reason the step fails.

    A plain Enum, deliberately not a str-mixin: a str-enum compares equal to
    its own wire string, which lets a bare "FromExample" sail through every
    call site that should have adopted the type.
    """
    FROM_EXAMPLE = "FromExample"
    FROM_GENERALIZATION = "FromGeneralization"
    FROM_ANALOGY = "FromAnalogy"
    FROM_AUTHORITY = "FromAuthority"
    FROM_CONSEQUENCE = "FromConsequence"
    FROM_SIGN = "FromSign"
    FROM_CAUSE = "FromCause"
    FROM_DEFINITION = "FromDefinition"
    DEDUCTIVE = "Deductive"
    UNKNOWN = "Unknown"


# `SubmissionStatus` in types.ts. A tuple rather than an Enum because the
# dataclass field stays a `str` (see "Known divergences").
SUBMISSION_STATUSES = ("Pending", "Interrogating", "Rejected", "Accepted")


class Relation(Enum):
    """How an inference relates to its single target claim.

      - CONCLUDES: the inference derives the target
      - CONTESTS:  the inference attacks the target

    A plain Enum for the same reason as ArgumentScheme. Members keep their wire
    strings as values; the serializer emits `relation.value`, the loader
    constructs `Relation(raw)` and raises on anything else, so
    `Inference.relation` is always a Relation, never a bare string.
    """
    CONCLUDES = "concludes"
    CONTESTS = "contests"


# --------------------------------------------------------------------------
# Attribution  (types.ts: "Attribution")
# --------------------------------------------------------------------------

# `GroundsSourceType` in types.ts — the five discriminants of GroundsSource,
# named so the tool boundary can constrain `source.type` against the same
# closed set the union spells.
GROUNDS_SOURCE_TYPES = ("Citation", "SelfEvident", "CommonKnowledge",
                        "LogicalNecessity", "None")


@dataclass(frozen=True)
class GroundsSource:
    """types.ts spells this as a discriminated union where only the `Citation`
    case carries `reference`. Python flattens it to one dataclass with an
    optional `reference`; the discriminant stays a `str` constrained against
    GROUNDS_SOURCE_TYPES at the tool boundary."""
    type: str
    reference: Optional[str] = None


@dataclass(frozen=True)
class Attribution:
    """Present on claims whose text is attributive ("Source X reports Y").
    Such claims are the empirical leaves of the graph: they bottom out by
    checkability against the cited source, not by a terminal flag. `quote` is
    verbatim provenance, captured at extraction time."""
    source: GroundsSource
    quote: Optional[str]


# --------------------------------------------------------------------------
# Nodes  (types.ts: "Nodes")
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Claim:
    """The only content-bearing node. One node per distinct claim; multiple
    people asserting the same claim on different evidence share this node and
    contribute separate inferences concluding it.

    `terminal` true means bedrock: the gatekeeper must reject any inference
    concluding it. That distinguishes "cannot be supported within this space"
    from "not yet supported" (GAP 6).

    `attribution` is present iff the claim is attributive. Optional, so it is
    declared last — the emitter uses CLAIM_KEYS for order, not field order.
    """
    id: str
    tag: str
    text: str
    terminal: bool
    uncertain: bool
    submissionStatus: str
    attribution: Optional[Attribution] = None


@dataclass(frozen=True)
class Inference:
    """A single inferential act. Carries no content — it binds specific
    grounds-claims and warrant-claims to exactly one target claim, with
    `relation` saying how it bears on that target (contesting an attributive
    target is undermining; any other target is rebutting).

    Attacks always target a claim. An attack on an inferential step is not
    representable and is not meant to be: the gatekeeper surfaces the
    suppressed warrant the attack denies, adds it to the target inference's
    `warrants`, and the attack becomes an ordinary rebut of that claim.

    Multiple warrants on one inference are conjoint (all required);
    alternative warrants are alternative inferences.

    `schemeDescriptor` is optional, so it is declared last — the emitter uses
    INFERENCE_KEYS for order, not field order.
    """
    id: str
    scheme: ArgumentScheme
    uncertain: bool
    submissionStatus: str
    grounds: Tuple[str, ...]   # 1..*
    warrants: Tuple[str, ...]  # 0..* — empty means implicit, not yet surfaced
    target: str
    relation: Relation
    schemeDescriptor: Optional[str] = None

    def __post_init__(self) -> None:
        # I1 — a single target and a relation in {concludes, contests}.
        # I4 — grounds non-empty (an empty required list is a validation error,
        # never something to emit). Reference lists are stored ascending by
        # uuid so serialize() need not re-sort.
        if not self.target:
            raise ValueError(f"inference {self.id!r} has no target")
        # scheme is the enum, never a bare string and never None: a plain str
        # is a call site that skipped the type.
        if not isinstance(self.scheme, ArgumentScheme):
            raise ValueError(
                f"inference {self.id!r} scheme must be an ArgumentScheme, got "
                f"{self.scheme!r} (scheme is required; use "
                f"ArgumentScheme.UNKNOWN when no other value names the move)")
        # I9 — a descriptor only ever accompanies UNKNOWN. Enforced at
        # construction as well as in validate.py: the node cannot exist wrong.
        if (self.schemeDescriptor is not None
                and self.scheme is not ArgumentScheme.UNKNOWN):
            raise ValueError(
                f"inference {self.id!r} has schemeDescriptor "
                f"{self.schemeDescriptor!r} with scheme {self.scheme.value!r} "
                f"(I9: a descriptor implies scheme Unknown)")
        # relation is the enum, never a bare string: a plain str (even the
        # correct "concludes") is a call site that skipped the type, and is
        # rejected here rather than serialised or compared as text.
        if not isinstance(self.relation, Relation):
            raise ValueError(
                f"inference {self.id!r} relation must be a Relation, got "
                f"{self.relation!r} (pass Relation.CONCLUDES/CONTESTS)")
        if not self.grounds:
            raise ValueError(f"inference {self.id!r} has empty grounds")
        object.__setattr__(self, "grounds", tuple(sorted(self.grounds)))
        object.__setattr__(self, "warrants", tuple(sorted(self.warrants)))


# --------------------------------------------------------------------------
# Discourse space  (types.ts: "Discourse space")
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class Definition:
    term: str
    text: str
    importedFrom: Optional[str]


@dataclass(frozen=True)
class Corpus:
    """`DiscourseSpace` in types.ts — see "Known divergences" for the name.

    Constituted by its definition layer. Propositions are not owned structure:
    `roots` designates which claims are currently treated as contested
    questions (entry points for views and traversal).
    """
    id: str
    title: str
    definitions: Tuple[Definition, ...]
    roots: Tuple[str, ...]
    claims: Tuple[Claim, ...]
    inferences: Tuple[Inference, ...]

    # Cached id -> node index, filled by __post_init__. Declared as a real
    # field so it is a visible attribute rather than one smuggled in by
    # object.__setattr__; init/compare/repr are all off, so Corpus still
    # constructs, compares and prints as the six schema fields alone, and
    # `replace()` rebuilds the index instead of copying it.
    _index: dict = field(
        init=False, compare=False, repr=False, default_factory=dict)

    def __post_init__(self) -> None:
        # Canonical order established here, once, at construction: nodes and
        # roots ascending by uuid; definitions keep authoring order (the
        # schema does not designate them a sortable reference list).
        object.__setattr__(self, "roots", tuple(sorted(self.roots)))
        object.__setattr__(
            self, "claims", tuple(sorted(self.claims, key=lambda c: c.id)))
        object.__setattr__(
            self, "inferences",
            tuple(sorted(self.inferences, key=lambda i: i.id)))
        # Cached id -> node index (a non-field; a plain assignment would be
        # rejected by the frozen dataclass, and a linear scan would be O(n)).
        index: dict = {}
        for claim in self.claims:
            index[claim.id] = claim
        for inference in self.inferences:
            index[inference.id] = inference
        object.__setattr__(self, "_index", index)

    def node(self, node_id: str):
        """The claim or inference with this id, or None."""
        return self._index.get(node_id)


# --------------------------------------------------------------------------
# Schema declaration order (from src/types.ts)
#
# The emitter walks these so YAML field order follows types.ts rather than
# dataclass field order; the loader rejects any data key outside the matching
# tuple. Keep each tuple in the order the TS interface declares.
# --------------------------------------------------------------------------

CORPUS_KEYS = ("id", "title", "definitions", "roots", "claims", "inferences")
DEFINITION_KEYS = ("term", "text", "importedFrom")
CLAIM_KEYS = ("id", "tag", "text", "terminal", "attribution",
              "uncertain", "submissionStatus")
INFERENCE_KEYS = ("id", "scheme", "schemeDescriptor", "uncertain",
                  "submissionStatus", "grounds", "warrants", "target",
                  "relation")
ATTRIBUTION_KEYS = ("source", "quote")
SOURCE_KEYS = ("type", "reference")


# --------------------------------------------------------------------------
# Known divergences from src/types.ts
#
# Each line is a deliberate difference, not a bug. Anything NOT listed here
# that differs is drift — add it or fix it.
#
#   1. `DiscourseSpace` is named `Corpus` here. Historical; renaming would
#      touch every Python call site and the class is never serialized by name.
#
#   2. Id fields on the dataclasses are plain `str`, not the branded NewTypes
#      declared at the top of this file. The brands ARE used in the harness's
#      op layer (roles/plan.py), so a Ref[ClaimId] cannot hold an InferenceId;
#      the model layer has not adopted them. Adopting them is mechanical but
#      touches every construction site.
#
#   3. `GroundsSource` is one dataclass with an optional `reference`, where
#      types.ts is a discriminated union in which only `Citation` carries a
#      reference. The union's constraint is enforced at the tool boundary
#      (roles/apply.py `_check_source_types`), not by the type.
#
#   4. `submissionStatus` is a `str`, not a closed type. SUBMISSION_STATUSES
#      above spells the legal set; nothing currently checks a value against it.
#      This is the loosest divergence in the file.
#
#   5. `GroundsSource.type` is a `str` for the same reason, constrained
#      against GROUNDS_SOURCE_TYPES at the tool boundary.
#
#   6. types.ts declares `grounds`/`warrants`/`roots` as arrays; they are
#      tuples here, because a list field makes a frozen dataclass unhashable.
#      Ordering is canonicalized in __post_init__ rather than by the schema.
#
#   7. Invariants I1-I10 are comments in types.ts and executable in
#      validate.py. Two of them (I1, I4, I9) are additionally enforced in
#      `Inference.__post_init__`, so a malformed node cannot be constructed at
#      all — stricter than types.ts, deliberately.
# --------------------------------------------------------------------------
