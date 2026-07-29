#!/usr/bin/env python3
"""Canonical load/serialize pair for v2 discourse-space corpora.

The single guarantee: the same graph always produces the same bytes, so a
commit diff shows exactly the nodes that changed. Parsing is delegated to
`yaml.safe_load` (stable). Emitting is hand-written — never through a YAML
library — so the canonical form depends on nothing but this file.

Object model mirrors src/types.ts (the "parsanga.ts" schema). All dataclasses
are frozen; ops transform whole versions rather than mutating nodes in place.
Canonical ordering (nodes ascending by uuid, reference lists ascending by uuid)
is established at construction time in __post_init__, so serialize() emits
stored order without re-sorting.

No uuid is ever minted here. load() reads ids; it never creates them.
"""
from __future__ import annotations

import os
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Tuple

import yaml


# --------------------------------------------------------------------------
# Relation — mirrors the `Relation` type in src/types.ts ("concludes" |
# "contests"). Lives with the model so ops/session import it rather than
# redefining the two polarities. A PLAIN Enum, deliberately not a str-mixin: a
# str-enum compares equal to its own wire string, which lets bare "concludes"
# sail through every call site that should have adopted the enum (and lets a
# typo like "concludez" reach validation instead of being rejected at the
# boundary). Members keep their wire strings as values; the serializer emits
# `relation.value`, the loader constructs `Relation(raw)` and raises on anything
# else, so `Inference.relation` is always a Relation, never a bare string.
# --------------------------------------------------------------------------

class Relation(Enum):
    CONCLUDES = "concludes"
    CONTESTS = "contests"


# --------------------------------------------------------------------------
# Schema declaration order (from src/types.ts). The emitter walks these; a
# data key outside the corresponding set is a hard error in the loader.
# --------------------------------------------------------------------------

CORPUS_KEYS = ("id", "title", "definitions", "roots", "claims", "inferences")
DEFINITION_KEYS = ("term", "text", "importedFrom")
CLAIM_KEYS = ("id", "tag", "text", "terminal", "attribution",
              "uncertain", "submissionStatus")
INFERENCE_KEYS = ("id", "scheme", "uncertain", "submissionStatus",
                  "grounds", "warrants", "target", "relation")
ATTRIBUTION_KEYS = ("source", "quote")
SOURCE_KEYS = ("type", "reference")


# --------------------------------------------------------------------------
# Object model — frozen dataclasses mirroring src/types.ts.
#
# Reference collections are tuples (a list field would make the dataclass
# unhashable). The optional field (`attribution`) carries a None default and
# so is declared last, after the required fields; the emitter uses the *_KEYS
# constants above for order, not dataclass field order.
# --------------------------------------------------------------------------

@dataclass(frozen=True)
class GroundsSource:
    type: str
    reference: Optional[str] = None


@dataclass(frozen=True)
class Attribution:
    source: GroundsSource
    quote: Optional[str]


@dataclass(frozen=True)
class Definition:
    term: str
    text: str
    importedFrom: Optional[str]


@dataclass(frozen=True)
class Claim:
    id: str
    tag: str
    text: str
    terminal: bool
    uncertain: bool
    submissionStatus: str
    attribution: Optional[Attribution] = None


@dataclass(frozen=True)
class Inference:
    id: str
    scheme: Optional[str]
    uncertain: bool
    submissionStatus: str
    grounds: Tuple[str, ...]
    warrants: Tuple[str, ...]
    target: str
    relation: Relation

    def __post_init__(self):
        # I1 — a single target and a relation in {concludes, contests}.
        # I4 — grounds non-empty (empty required list is a validation error,
        # never something to emit). Reference lists are stored ascending by
        # uuid so serialize() need not re-sort.
        if not self.target:
            raise ValueError(f"inference {self.id!r} has no target")
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


@dataclass(frozen=True)
class Corpus:
    id: str
    title: str
    definitions: Tuple[Definition, ...]
    roots: Tuple[str, ...]
    claims: Tuple[Claim, ...]
    inferences: Tuple[Inference, ...]

    def __post_init__(self):
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
        index = {}
        for node in self.claims:
            index[node.id] = node
        for node in self.inferences:
            index[node.id] = node
        object.__setattr__(self, "_index", index)

    def node(self, node_id):
        return self._index.get(node_id)


# --------------------------------------------------------------------------
# Loading — yaml.safe_load then a strict cast. Unknown keys fail loudly.
# --------------------------------------------------------------------------

def _reject_unknown(where, data, allowed):
    extra = set(data) - set(allowed)
    if extra:
        raise ValueError(f"{where}: unknown key(s) {sorted(extra)} "
                         f"(schema allows {list(allowed)})")


def _load_source(raw) -> GroundsSource:
    _reject_unknown("attribution.source", raw, SOURCE_KEYS)
    return GroundsSource(type=raw["type"], reference=raw.get("reference"))


def _load_attribution(raw) -> Optional[Attribution]:
    if raw is None:
        return None
    _reject_unknown("attribution", raw, ATTRIBUTION_KEYS)
    return Attribution(source=_load_source(raw["source"]),
                       quote=raw.get("quote"))


def _load_definition(raw) -> Definition:
    _reject_unknown("definition", raw, DEFINITION_KEYS)
    return Definition(term=raw["term"], text=raw["text"],
                      importedFrom=raw.get("importedFrom"))


def _load_claim(raw) -> Claim:
    _reject_unknown(f"claim {raw.get('id')!r}", raw, CLAIM_KEYS)
    return Claim(
        id=raw["id"],
        tag=raw["tag"],
        text=raw["text"],
        terminal=raw.get("terminal", False),
        uncertain=raw.get("uncertain", False),
        submissionStatus=raw.get("submissionStatus", "Accepted"),
        attribution=_load_attribution(raw.get("attribution")),
    )


def _load_relation(raw_id, value) -> Relation:
    """Construct the Relation enum from a wire string, raising on anything else
    (the parse boundary is where a bad relation dies)."""
    try:
        return Relation(value)
    except ValueError:
        raise ValueError(
            f"inference {raw_id!r} has relation {value!r} "
            f"(need one of concludes/contests)")


def _load_inference(raw) -> Inference:
    _reject_unknown(f"inference {raw.get('id')!r}", raw, INFERENCE_KEYS)
    return Inference(
        id=raw["id"],
        scheme=raw.get("scheme"),
        uncertain=raw.get("uncertain", False),
        submissionStatus=raw.get("submissionStatus", "Accepted"),
        grounds=tuple(raw.get("grounds") or ()),
        warrants=tuple(raw.get("warrants") or ()),
        target=raw.get("target"),
        relation=_load_relation(raw.get("id"), raw.get("relation")),
    )


def _corpus_from_dict(data) -> Corpus:
    _reject_unknown("corpus", data, CORPUS_KEYS)
    return Corpus(
        id=data["id"],
        title=data["title"],
        definitions=tuple(_load_definition(d)
                          for d in data.get("definitions") or ()),
        roots=tuple(data.get("roots") or ()),
        claims=tuple(_load_claim(c) for c in data.get("claims") or ()),
        inferences=tuple(_load_inference(i)
                         for i in data.get("inferences") or ()),
    )


def load(path_or_text: str) -> Corpus:
    """Load a corpus from a file path or a YAML string."""
    if "\n" not in path_or_text and os.path.exists(path_or_text):
        with open(path_or_text, "r", encoding="utf-8") as fh:
            text = fh.read()
    else:
        text = path_or_text
    return _corpus_from_dict(yaml.safe_load(text))


# --------------------------------------------------------------------------
# Emitting — hand-written. No PyYAML/ruamel dump path exists by design.
# --------------------------------------------------------------------------

def _q(s: str) -> str:
    """Double-quote a string scalar with the fixed escape set: \\ " \\n \\t."""
    out = ['"']
    for ch in s:
        if ch == "\\":
            out.append("\\\\")
        elif ch == '"':
            out.append('\\"')
        elif ch == "\n":
            out.append("\\n")
        elif ch == "\t":
            out.append("\\t")
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def _scalar(value) -> str:
    if value is None:
        return "null"
    if value is True:
        return "true"
    if value is False:
        return "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, str):
        return _q(value)
    raise TypeError(f"unserializable scalar: {value!r}")


def _kv(indent, key, value):
    return f"{' ' * indent}{key}: {_scalar(value)}"


def _emit_source(source: GroundsSource, indent, out):
    out.append(f"{' ' * indent}type: {_scalar(source.type)}")
    if source.reference is not None:
        out.append(f"{' ' * indent}reference: {_scalar(source.reference)}")


def _emit_attribution(attr: Attribution, indent, out):
    out.append(f"{' ' * indent}attribution:")
    out.append(f"{' ' * (indent + 2)}source:")
    _emit_source(attr.source, indent + 4, out)
    out.append(_kv(indent + 2, "quote", attr.quote))


def _emit_definition(d: Definition, indent, out):
    # indent is the dash column; first key rides the dash, rest align under it.
    out.append(f"{' ' * indent}- term: {_scalar(d.term)}")
    inner = indent + 2
    out.append(_kv(inner, "text", d.text))
    out.append(_kv(inner, "importedFrom", d.importedFrom))


def _emit_claim(c: Claim, indent, out):
    out.append(f"{' ' * indent}- id: {_scalar(c.id)}")
    inner = indent + 2
    out.append(_kv(inner, "tag", c.tag))
    out.append(_kv(inner, "text", c.text))
    out.append(_kv(inner, "terminal", c.terminal))
    if c.attribution is not None:
        _emit_attribution(c.attribution, inner, out)
    out.append(_kv(inner, "uncertain", c.uncertain))
    out.append(_kv(inner, "submissionStatus", c.submissionStatus))


def _emit_id_list(key, ids, indent, out):
    out.append(f"{' ' * indent}{key}:")
    for i in ids:
        out.append(f"{' ' * (indent + 2)}- {_scalar(i)}")


def _emit_inference(inf: Inference, indent, out):
    out.append(f"{' ' * indent}- id: {_scalar(inf.id)}")
    inner = indent + 2
    out.append(_kv(inner, "scheme", inf.scheme))
    out.append(_kv(inner, "uncertain", inf.uncertain))
    out.append(_kv(inner, "submissionStatus", inf.submissionStatus))
    _emit_id_list("grounds", inf.grounds, inner, out)
    # warrants is 0..*; an empty warrant list is omitted (block YAML cannot
    # spell an empty sequence, and flow `[]` is disallowed). The loader
    # defaults a missing warrants back to ().
    if inf.warrants:
        _emit_id_list("warrants", inf.warrants, inner, out)
    out.append(_kv(inner, "target", inf.target))
    # Emit the wire string; relation is the Relation enum, not a str scalar.
    out.append(_kv(inner, "relation", inf.relation.value))


def serialize(corpus: Corpus) -> str:
    """Emit the canonical byte form of a corpus (UTF-8, LF, one trailing \\n)."""
    out = []
    out.append(_kv(0, "id", corpus.id))
    out.append(_kv(0, "title", corpus.title))

    out.append("definitions:")
    for d in corpus.definitions:
        _emit_definition(d, 2, out)

    _emit_id_list("roots", corpus.roots, 0, out)

    out.append("claims:")
    for n, c in enumerate(corpus.claims):
        if n:
            out.append("")            # one blank line between nodes
        _emit_claim(c, 2, out)

    out.append("inferences:")
    for n, inf in enumerate(corpus.inferences):
        if n:
            out.append("")            # one blank line between nodes
        _emit_inference(inf, 2, out)

    return "\n".join(out) + "\n"
