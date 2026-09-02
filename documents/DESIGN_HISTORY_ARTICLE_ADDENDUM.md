# Design History — Article surface addendum

Rationale and rejected alternatives from the article-view session. Settled outcomes are in
SESSION_FEED.

## Principles that survived

### Reach and depth are opposite measures and must not share a name

The article prints `›N` after each claim: how many hops of argument run on beneath it. That is
not the corpus's computed depth, which is BFS from the theses and counts hops *above* a claim,
toward what it serves. The two run in opposite directions from the same node and would have
collided under one word.

The collision was not cosmetic. Two rules depend on the distinction. "Depth must never be
rendered to a reader" survives intact only because the article renders reach, and the ordering
rule — arguments follow by the reach of their grounds, descending — is near-noise if read as
depth, since a claim's grounds all sit at roughly the same distance from a thesis. Naming the
downward measure `reach` makes both statements true as written instead of true by careful
reading.

Separating the terms also dissolved a tension the first draft was managing. Bedrock-first
ordering had been justified partly as a safeguard against depth-as-importance. It does not need
that job. It stands on its own reason: a value commitment is undeveloped by definition rather
than by neglect, so ranking on development alone buries exactly the claims the space rests on.

### Stance needs a second token set to survive as type

The stance poles carry from fill to ink unchanged. `divided` cannot. It is generated at low
chroma and lifted so that it recedes as a fill — which is precisely what makes it unreadable as
text. `deriveDividedInk` restores chroma and drops lightness to sit between the poles.

The point of the derivation is that it stays a derivation. `divided` was made a transform of the
poles rather than a hand-picked colour so that re-tuning the poles carries it along; an ink
variant chosen by eye would have quietly broken that and reintroduced the hand-picked value the
HSL conversion existed to remove.

### One colour family on a prose surface

For/Against carries no colour in the article. It is already stated in words by the section heads,
whereas stance has no other channel on this surface — position, which carries for/against in the
focus view, does not survive into a single column of prose.

The second palette would also have been misleading more often than not. A supporting argument's
grounds are usually aligned and an attacking argument's usually opposed, so the two channels run
nearly parallel: the reader learns to hunt for a distinction that is absent in most cases, and is
worst served in exactly the cases where the two genuinely diverge.

### A single breadcrumb would present a choice as a fact

The structure is a DAG, so "the path from the thesis to this claim" does not exist. Up to three
shortest routes are shown, one line each, with "and other routes" beyond. Route length replaces a
stated hop count and crumb colour replaces a stated stance phrase, so the trail carries the two
facts the torn-sheet divider carries in the focus view without asserting a route that was picked
arbitrarily.

## Rejected alternatives

| Rejected | Why |
|---|---|
| A single breadcrumb trail | The DAG has no unique path; a chosen route reads as the route |
| A second palette for For/Against | Runs nearly parallel to stance, so it teaches a distinction that is usually absent and misleads where it is real |
| Column tint in the article | Chrome tint has no chrome to sit on in a prose column, and any tint on a claim-bearing surface competes with stance |
| Corpus order within a section | Order in prose reads as ranking whether or not it is meant to; if the surface is going to imply a ranking it should own one |
| Ordering on development alone | Buried bedrock commitments, which are undeveloped by definition |
| `depth` as the name for the `›N` cue | Opposite direction from computed depth — see above |
| A stated hop count and stance phrase on the trail | Both are already carried by route length and crumb ink |
| A single `assumes` label over a merged italic run | Role is positional in the model, so presentation is the only channel the grounds/warrant distinction has; one label cannot carry it across a merged run |

## Unverified on screen

Written and typechecked, never seen to render on either corpus:

- trail elision — needs a claim more than five crumbs from the thesis
- the `divided` ink colour — needs a divided claim on a rendered page
## Method notes

### The audit found one contradiction because it was not looking for contradictions

The implementation pass returned a supersede block for SESSION_FEED covering the article change,
and correctly flagged that the standing "`tag` is never rendered" line contradicted the code.
It reported that as a documentation defect. It was not: `tag` came off the never-render list
deliberately when full-text rows became tag tiles, and the reversal is recorded here. The line in
SESSION_FEED was one of several left stale by the same tile rework — paging, the per-box
`assumes` label, and the focus view's stance channel were all stale in the same block, and none
of them surfaced, because a pass reading its own change against the doc sees only the
contradictions its change happens to touch.

This is the standing audit note in its sharpest form so far. A pass that lands a change should
report the block its change lands in, not the lines its change touches. Contradiction-hunting
finds the line; only reading the whole block against the code finds the other four.
 
