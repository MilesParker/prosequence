#!/usr/bin/env python3
"""Pure corpus transforms for the writer session (Directive 1d).

Each function is `(corpus, args) -> corpus`. No io, no uuid generation, no
validation. A function never mutates the corpus it is given or any node inside
it: it constructs a new `Corpus` that shares every unchanged node object. The
session (session.py) is what mints ids, records the call, rebinds its version,
and validates — none of that lives here.

`Relation` is imported from the model (yaml_io), never redefined. There is
no `contest` transform: polarity is the `relation` argument to `add_inference`.
"""
from __future__ import annotations

from dataclasses import replace
from typing import Optional, Sequence

from .yaml_io import (
    ArgumentScheme,
    Attribution,
    Claim,
    Corpus,
    Inference,
    Relation,
)


# --------------------------------------------------------------------------
# Write transforms. The id is supplied by the caller (the session mints it);
# these functions never touch a clock or uuid module.
# --------------------------------------------------------------------------

def add_claim(
    corpus: Corpus,
    *,
    id: str,
    text: str,
    tag: str,
    attribution: Optional[Attribution] = None,
    terminal: bool = False,
) -> Corpus:
    """Return a new corpus with one claim appended.

    Defaults (`uncertain=False`, `submissionStatus="Accepted"`) match the
    loader's defaults for an authored node. Canonical ordering is re-established
    by `Corpus.__post_init__`, so the append position here is irrelevant.
    """
    claim = Claim(
        id=id,
        tag=tag,
        text=text,
        terminal=terminal,
        uncertain=False,
        submissionStatus="Accepted",
        attribution=attribution,
    )
    return replace(corpus, claims=corpus.claims + (claim,))


def add_inference(
    corpus: Corpus,
    *,
    id: str,
    grounds: Sequence[str],
    warrants: Sequence[str],
    target: str,
    relation: Relation,
    scheme: ArgumentScheme,
    scheme_descriptor: Optional[str] = None,
) -> Corpus:
    """Return a new corpus with one inference appended.

    `relation` carries the polarity (there is no separate contest transform).
    `scheme` is required — every inference is classified, and there is no
    default: a caller with nothing better passes `ArgumentScheme.UNKNOWN`
    explicitly, which is a classification, not a gap. `scheme_descriptor` names
    the move when the scheme is UNKNOWN; `Inference.__post_init__` rejects one
    beside any other scheme (I9).

    `grounds`/`warrants` are captured as tuples; `Inference.__post_init__`
    stores them ascending by uuid.
    """
    inference = Inference(
        id=id,
        scheme=scheme,
        schemeDescriptor=scheme_descriptor,
        uncertain=False,
        submissionStatus="Accepted",
        grounds=tuple(grounds),
        warrants=tuple(warrants),
        target=target,
        relation=relation,
    )
    return replace(corpus, inferences=corpus.inferences + (inference,))


def revise_claim(
    corpus: Corpus,
    id: str,
    text: Optional[str] = None,
    tag: Optional[str] = None,
) -> Corpus:
    """Return a new corpus with claim `id` revised in place (same uuid).

    Only the fields passed are changed; every other field — and the id — is
    preserved via `dataclasses.replace` on the frozen node. Passing neither
    `text` nor `tag` is a no-op revision (a new corpus equal to the old).
    """
    old = corpus.node(id)
    if old is None or not isinstance(old, Claim):
        raise KeyError(f"revise_claim: {id!r} is not a claim in this corpus")
    changed = {}
    if text is not None:
        changed["text"] = text
    if tag is not None:
        changed["tag"] = tag
    new_claim = replace(old, **changed)
    claims = tuple(new_claim if c.id == id else c for c in corpus.claims)
    return replace(corpus, claims=claims)
