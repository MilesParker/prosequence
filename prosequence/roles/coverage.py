#!/usr/bin/env python3
"""What the collection agent reads to judge how well a corpus is covered.

A collection run's goal is "a broad range of views", and the agent needs a
signal for that. Everything here is derived from code that already exists — the
loaded `Corpus` and `validate.check_violations`.

## The agent is collecting arguments, so it is shown arguments

This used to hand back a flat list of every claim tag, and nothing else with any
structure in it. That is the wrong shape twice over. The corpus IS a graph of
arguments; a bag of claim tags is its nodes with every edge deleted, so the
agent could see that a corpus contained "Death toll inconsistent with genocidal
intent" but not that this was an ATTACK on the thesis, nor that nothing in the
corpus answered it. And it was expensive for what it carried: 85% of the
payload, a third of that spent on claim uuids the collection agent has no tool
that accepts and has never once used.

What replaces it, at roughly the same size:

  * `claim_tags` — the accumulated picture, without uuids, and (see below) only
    the ones the agent has not already been shown. Enough to say whether a point
    is in the corpus, which is most of what a collector needs.
  * `arguments_on_thesis` and `arguments_unanswered` — the two things a tag
    cannot carry: which side an argument is on, and where nobody is standing.
    Both rendered by tag, `from` / `rel` / `to` plus `assuming`. See the
    selector section below for why those two and not any of the three sets that
    preceded them.

## Only what is new — all of it, not just the tags

`corpus_state` is read several times in a run and full message history goes out
on every call, so every earlier reading is still in context when a later one
arrives. Anything re-sent whole is duplication paid for on every subsequent
turn, and it compounds.

A first version deltafied only the claim tags and re-sent the rest, on the
grounds that the rest was small. It was not: arguments, unanswered claims, hosts
and open ends together came to 5,763 chars on an 81-claim corpus — 23,052 across
four reads, most of it identical to the read before.

So a read takes a `CoverageMark` of what the agent has already been shown and
returns only what changed, plus the new mark. What is always re-sent is the
scoreboard alone — counts and the per-thesis concludes/contests split — because
it is a few hundred bytes and it is the balance picture the whole run turns on.

`answered_since` is in there for a reason a pure additive delta would miss: a
claim leaving the unanswered set means a source answered it, which is the run
working. Only sending additions would make its own progress invisible.

## Why arguments at all, when tags are cheaper

Tags tell the agent what is THERE. They cannot tell it what is missing, and
missing is what it is collecting for. A tag cannot say whether "Death toll
inconsistent with genocidal intent" supports the thesis or attacks it, and the
balance between those two is the run's whole objective.

## Selected by what is UNANSWERED, not by what is disputed

Three wrong selectors preceded this one, and the sequence is the point.

Depth 2, then depth 1 to save chars a round — and then the delta below removed
the per-round cost that justified the cut, leaving a decision standing after its
own argument had gone. Then dispute: every inference caught up in a live fight,
wherever it sat, which fixed depth's real defect (26 of 33 disputed inferences
sit BELOW depth 1, so a shallow read hid nearly all of them).

Dispute was still wrong, and wrong in the direction that matters most. An
argument in dispute is one where opposing sides are ALREADY PRESENT. Rendering
those richly — 33 full argument structures — while leaving the unanswered ones
as a bare tag list put the detail, and therefore the agent's attention, on
explored ground. A collection run exists to find what is missing; a read that
foregrounds what is already contested biases it toward deepening fights the
corpus has instead of finding the ones it lacks.

So the selector is inverted:

  * `arguments_on_thesis` — every inference targeting a thesis. The top-level
    balance, always, because it is the run's own scoreboard.
  * `arguments_unanswered` — every inference concluding a claim that nothing in
    the corpus contests. This is the frontier. Each entry shows what is
    asserted, on what grounds, under which assumptions — three attack surfaces,
    which is what a search for the opposing view is actually built from. A bare
    tag ("Public genocidal statements by leaders") does not tell you what to
    search against; "Bartov: Officials called for annihilation, assuming public
    statements evidence specific intent" does.

`unopposed` as a separate tag list is gone with this: every unopposed claim is
by definition concluded by something, so it appears as the `to` of an
unanswered argument, with its reasoning attached instead of naked.

What is disputed is reported as a COUNT (`claims_in_dispute`) and nothing more.
The agent should know that ground is occupied without attention flowing to it.

## What is NOT here

Stance. `computeStance` exists only in `src/viz/`; there is no Python stance
query anywhere in the harness, and `read_tools.py` already declines to fabricate
one. An agent told "three claims are opposed" by an algorithm invented for this
module would be reading a number nothing else in the project agrees with.

The host histogram is a PROXY. Ten hostile pieces on one host and one friendly
piece on another read as "one host dominates", which is not the same fact as
"one view dominates". The prompt says so rather than handing the agent a number
to optimise.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

from ..core.validate import check_violations
from ..core.yaml_io import Corpus, Inference, Relation

# Ceiling on rendered arguments, for a corpus whose disputed region grows past
# what is worth reading in one go. Thesis-level arguments are kept first, so a
# truncation loses the periphery rather than the balance picture.
MAX_ARGUMENTS = 60

# Cap on the tag tail, for a first read where nothing has been seen yet.
MAX_TAGS = 400


def _reachable_from_theses(corpus: Corpus) -> int:
    """How many claims are connected to a thesis at all, by any chain of
    inference in either direction.

    Not a nicety. Measured across the corpora on disk, an ingestion-built one
    had 1 of 52 claims reachable from its thesis: 23 inferences forming a graph
    with no connection to the question the corpus exists to argue. Every other
    number in this read looked healthy — 52 claims, 21 unanswered arguments —
    and `concluded_by: 0` reads like "early days" rather than "nothing here
    argues the thesis". This is the number that tells them apart.
    """
    adj: dict[str, set] = {}
    for i in corpus.inferences:
        for x in (*i.grounds, *i.warrants):
            adj.setdefault(i.target, set()).add(x)
            adj.setdefault(x, set()).add(i.target)
    claims = {c.id for c in corpus.claims}
    seen = set(corpus.theses)
    frontier = set(seen)
    while frontier:
        nxt = {y for x in frontier for y in adj.get(x, ())} - seen
        seen |= nxt
        frontier = nxt
    return len(seen & claims)


def _host(reference: str | None) -> str:
    if not reference:
        return "(no reference)"
    parsed = urlparse(reference)
    netloc = (parsed.netloc or "").lower()
    if not netloc:
        # Not a url — a book, a case name, an inline document marker. Kept
        # whole and short rather than coerced into a fake host.
        return reference[:60]
    return netloc[4:] if netloc.startswith("www.") else netloc


def _argument(inf: Inference, tag_of, contested: set) -> dict:
    d: dict = {
        "from": [tag_of(g) for g in inf.grounds],
        "rel": inf.relation.value,
        "to": tag_of(inf.target),
    }
    if inf.warrants:
        d["assuming"] = [tag_of(w) for w in inf.warrants]
    # Whether this step's own premises are under attack. The collection-relevant
    # part: an argument nothing disputes is a place the other side is absent.
    disputed = [tag_of(c) for c in (*inf.grounds, *inf.warrants) if c in contested]
    if disputed:
        d["disputed_premises"] = disputed
    return d


def _arguments(corpus: Corpus, tag_of, contested: set, unanswered: set,
               thesis_set: set) -> tuple[list[tuple[str, dict]],
                                         list[tuple[str, dict]]]:
    """(thesis-level, unanswered) inferences, each as (id, rendering) pairs.

    Selected by what nothing answers rather than by what is already disputed —
    see the module docstring. Ids come back so a `CoverageMark` can record what
    was already sent; they never reach the agent.
    """
    on_thesis, standing = [], []
    for i in corpus.inferences:
        if i.target in thesis_set:
            on_thesis.append(i)
        elif i.target in unanswered:
            standing.append(i)
    render = lambda infs: [(i.id, _argument(i, tag_of, contested)) for i in infs]
    return render(on_thesis)[:MAX_ARGUMENTS], render(standing)[:MAX_ARGUMENTS]


@dataclass(frozen=True)
class CoverageMark:
    """What a collection agent has already been shown. Opaque to the agent; the
    harness holds one per run and hands it back on the next read."""
    tags: frozenset = frozenset()
    inferences: frozenset = frozenset()     # inference ids already rendered
    unopposed: frozenset = frozenset()      # claim tags
    hosts: frozenset = frozenset()


def corpus_coverage(corpus: Corpus, raw: dict, path: str = "",
                    mark: Optional[CoverageMark] = None) -> tuple[dict, CoverageMark]:
    """The coverage read, as (payload, new mark).

    `raw` is the same corpus as parsed YAML, which is what `check_violations`
    consumes — passed in rather than re-serialized here, so there is one parse
    per call and the invariants run on exactly the bytes the store holds.

    Pass the `mark` from the previous read to get back only what changed since.
    Hand the returned mark to the next read."""
    by_id = {c.id: c for c in corpus.claims}
    theses = list(corpus.theses)

    def tag_of(cid: str) -> str:
        node = by_id.get(cid)
        return node.tag if node is not None else "?"

    concludes = [i for i in corpus.inferences if i.relation is Relation.CONCLUDES]
    contests = [i for i in corpus.inferences if i.relation is Relation.CONTESTS]
    contested = {i.target for i in contests}
    concluded = {i.target for i in concludes}
    thesis_set = set(theses)

    hosts: dict[str, int] = {}
    attributed = 0
    for c in corpus.claims:
        if c.attribution is None:
            continue
        attributed += 1
        h = _host(c.attribution.source.reference)
        hosts[h] = hosts.get(h, 0) + 1

    # GAP-6 warnings, resolved to tags. `check_violations` returns `Violation`
    # records for warnings as well as errors, so the claim id is read off
    # `target` rather than parsed back out of the prose.
    _errs, warns = check_violations(raw, path)
    open_ends = {tag_of(v.target) for v in warns if v.target in by_id}

    # Concluded by something, contested by nothing, and not itself a thesis: the
    # corpus asserts it and no source has answered it. Attributive claims cannot
    # appear here at all — I5 forbids concluding one — so source-reports never
    # masquerade as unanswered positions.
    unopposed_ids = {t for t in concluded
                     if t not in contested and t not in thesis_set}

    all_tags = {c.tag for c in corpus.claims}
    on_thesis, standing = _arguments(corpus, tag_of, contested,
                                     unopposed_ids, thesis_set)

    new_mark = CoverageMark(
        tags=frozenset(all_tags),
        inferences=frozenset(i for i, _ in (*on_thesis, *standing)),
        unopposed=frozenset(tag_of(t) for t in unopposed_ids),
        hosts=frozenset(hosts),
    )

    # The scoreboard: always sent, a few hundred bytes, and the balance picture
    # the whole run turns on.
    payload: dict = {
        "title": corpus.title,
        "theses": [{
            "tag": tag_of(t),
            "text": getattr(by_id.get(t), "text", "(missing claim)"),
            "concluded_by": sum(1 for i in concludes if i.target == t),
            "contested_by": sum(1 for i in contests if i.target == t),
        } for t in theses],
        "claims": len(corpus.claims),
        "inferences": len(corpus.inferences),
        "concludes": len(concludes),
        "contests": len(contests),
        "attributed_claims": attributed,
        # The health check. A corpus whose claims are mostly unreachable from
        # its thesis is accumulating material that argues nothing about the
        # question, and every other number here will still look fine.
        "claims_connected_to_thesis": _reachable_from_theses(corpus),
        # Reported as a number, not as renderings: the agent should know this
        # ground is occupied without its attention flowing there.
        "claims_in_dispute": len(contested - thesis_set),
        "claim_tags_total": len(all_tags),
    }

    if mark is None:
        payload.update({
            "citation_sources": dict(sorted(hosts.items(),
                                            key=lambda kv: (-kv[1], kv[0]))),
            "arguments_on_thesis": [a for _i, a in on_thesis],
            "arguments_unanswered": [a for _i, a in standing],
            "open_ends": sorted(open_ends),
            "claim_tags": sorted(all_tags)[:MAX_TAGS],
        })
        return payload, new_mark

    # Delta. Everything the agent has already been shown is still above in this
    # conversation, so only movement is sent.
    payload["since_your_last_read"] = {
        "new_claim_tags": sorted(all_tags - mark.tags)[:MAX_TAGS],
        "new_arguments_on_thesis": [a for i, a in on_thesis
                                    if i not in mark.inferences],
        "new_unanswered_arguments": [a for i, a in standing
                                     if i not in mark.inferences],
        # A claim LEAVING the unanswered set means a source answered it. A purely
        # additive delta would make the run's own progress invisible.
        "answered_since": sorted(
            mark.unopposed - {tag_of(t) for t in unopposed_ids}),
        "new_open_ends": sorted(open_ends),
        "new_citation_sources": sorted(set(hosts) - mark.hosts),
    }
    payload["note"] = ("only what changed since your last corpus_state; "
                       "everything else is unchanged and still above in this "
                       "conversation")
    return payload, new_mark
