#!/usr/bin/env python3
"""Canonical load/serialize pair for v2 discourse-space corpora.

The single guarantee: the same graph always produces the same bytes, so a
commit diff shows exactly the nodes that changed. Parsing is delegated to
`yaml.safe_load` (stable). Emitting is hand-written — never through a YAML
library — so the canonical form depends on nothing but this file.

The object model is NOT here. It lives in `types.py`, the mirror of
src/types.ts, so the schema can be read beside the canonical declaration
without the loader and emitter in between. This file imports those types and
re-exports them, so existing `from ..core.yaml_io import Claim, ...` call sites
keep working; new code should prefer `from ..core.types import ...`.

Canonical ordering (nodes ascending by uuid, reference lists ascending by uuid)
is established at construction time in the dataclasses' __post_init__, so
serialize() emits stored order without re-sorting.

No uuid is ever minted here. load() reads ids; it never creates them.
"""
from __future__ import annotations

import os
from typing import Optional, Tuple

import yaml

# Re-exported for existing call sites; the declarations live in types.py.
from .types import (  # noqa: F401
    ATTRIBUTION_KEYS,
    ArgumentScheme,
    Attribution,
    CLAIM_KEYS,
    CORPUS_KEYS,
    Claim,
    ClaimId,
    Corpus,
    DEFINITION_KEYS,
    Definition,
    DiscourseSpaceId,
    GROUNDS_SOURCE_TYPES,
    GroundsSource,
    INFERENCE_KEYS,
    Inference,
    InferenceId,
    LEGACY_CORPUS_KEYS,
    Relation,
    SOURCE_KEYS,
    SUBMISSION_STATUSES,
)


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


def _load_scheme(raw_id, value) -> ArgumentScheme:
    """Construct the ArgumentScheme enum from a wire string, raising on anything
    else. `scheme` is required: a missing or null scheme is a malformed corpus,
    not a node to default — Unknown is a classification the author must make."""
    try:
        return ArgumentScheme(value)
    except ValueError:
        raise ValueError(
            f"inference {raw_id!r} has scheme {value!r} (need one of "
            + "/".join(s.value for s in ArgumentScheme) + ")")


def _load_inference(raw) -> Inference:
    _reject_unknown(f"inference {raw.get('id')!r}", raw, INFERENCE_KEYS)
    return Inference(
        id=raw["id"],
        scheme=_load_scheme(raw.get("id"), raw.get("scheme")),
        schemeDescriptor=raw.get("schemeDescriptor"),
        uncertain=raw.get("uncertain", False),
        submissionStatus=raw.get("submissionStatus", "Accepted"),
        grounds=tuple(raw.get("grounds") or ()),
        warrants=tuple(raw.get("warrants") or ()),
        target=raw.get("target"),
        relation=_load_relation(raw.get("id"), raw.get("relation")),
    )


def _corpus_from_dict(data) -> Corpus:
    # LEGACY_CORPUS_KEYS carries `roots`, the pre-rename spelling of `theses`:
    # read here so every corpus committed before the rename still loads, and
    # absent from the emitter below so nothing writes it back.
    _reject_unknown("corpus", data, CORPUS_KEYS + LEGACY_CORPUS_KEYS)
    if "theses" in data and "roots" in data:
        raise ValueError(
            "corpus: both `theses` and `roots` are present; `roots` is the "
            "pre-rename spelling of the same key and the two cannot be "
            "reconciled — keep `theses`")
    return Corpus(
        id=data["id"],
        title=data["title"],
        definitions=tuple(_load_definition(d)
                          for d in data.get("definitions") or ()),
        theses=tuple(data.get("theses") or data.get("roots") or ()),
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
    # Emit the wire string; scheme is the ArgumentScheme enum, not a str scalar.
    out.append(_kv(inner, "scheme", inf.scheme.value))
    # schemeDescriptor is present only on Unknown (I9), and a null one is
    # omitted entirely rather than emitted as `null` — absent and null carry
    # the same meaning, and the corpora are overwhelmingly the absent case.
    if inf.schemeDescriptor is not None:
        out.append(_kv(inner, "schemeDescriptor", inf.schemeDescriptor))
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

    _emit_id_list("theses", corpus.theses, 0, out)

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
