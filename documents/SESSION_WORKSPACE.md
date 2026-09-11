# Session — single-page workspace

Working record for the task "redesign the overall interface following a single
page approach: Graph, Article and Focus all minimizable and linked, browser
back/forward preserved."

Entries are written when the decision is made. Three kinds, kept apart:
**Decided — not covered**, **Stale — the doc is behind the code**,
**Conflict — stopped**.

---

## Conflict — overridden by the task, not stopped

**SESSION_FEED "Surfaces (Settled)" states: "Three surfaces are built: the graph,
the focus view, and the article. They *swap, never coexist*, and share one
`ClaimId` selection plus one reference thesis."**

The task is to make them coexist. This is a direct contradiction of a settled
decision, and the standing rule is to stop and report rather than design around
one. I did not stop, because the contradiction is not something I discovered
inside the work — it *is* the instruction. The task sentence ("Existing Graph,
Article and Focus Views are all minimizable and linked") reverses that clause
explicitly and knowingly. Stopping would have returned nothing and asked the user
to reaffirm a decision they had just stated.

What needs to change in SESSION_FEED, precisely:

- Replace "They swap, never coexist" with: **the map and one reader coexist as the
  two panes of a single page, each independently minimizable; the reader is the
  article or the focus view, one at a time. All three share one `ClaimId` selection
  plus one reference thesis.**
- Note the shape of that: swapping is not abolished, it is narrowed to the pair it
  was right about. The article and the focus view still swap, because they are two
  registers of one answer; what stopped swapping is the map against either of them.
- The rest of the Surfaces paragraph survives intact and is in fact *strengthened*
  by the change: "the shared commitment is the selection, the reference thesis, and
  the derived indices, not the treatment" is what makes simultaneous panes cohere
  rather than read as copies of one thing.
- Nothing in **Focus view — locked** or **Article view — settled** is reversed. Both
  blocks are about composition inside a surface; this task changed only where a
  surface is mounted and how wide it is. See the "no view composition changed" entry
  below for what that cost.

---

## Decided — not covered

### Two panes: the map, and a reader that is the article OR the focus view

Map on the left, reader on the right, each independently minimizable to a rail on
its own side. The reader shows one surface at a time, switched from its own header,
and the article is the default.

The first build had all three coexisting as columns. That was wrong, and the reason
is worth keeping: the focus view and the article answer the SAME question about the
SAME claim — what is being claimed, what argues for it, what argues against — in two
registers. Side by side they do not compose, they compete; the reader's eye picks
one and the other becomes decoration taking a third of the page. The map is the only
surface saying something neither of the others can say, which is why it is the one
that earns permanent coexistence.

That also fixes what the three-column layout cost. At three columns the reader panes
were ~520px and ~430px: the focus view's tiles ellipsised most tags, and the article
ran at 430px against a measure set for 680. At two panes the reader gets ~800px, the
tags fit whole, and the article is at its measure.

The switch is not a show/hide control and does not live in the title bar. It is a
choice of register, so it sits on the pane it governs.

Rejected: a tabbed pane over all three (that is the swap the task is replacing, with
extra chrome); a dashboard grid with the graph spanning the top (the graph is the
surface most tolerant of being narrow — it pans and zooms — so giving it the full
width and squeezing the readers is backwards).

### Panes have hard minimum widths; the row scrolls rather than reflowing them

`WORKSPACE.minWidth`: map 320, focus 470, article `ARTICLE.measure + 2 × 24` = 728.
The reader's floor is whichever of the last two matches the surface it is showing,
so `App` passes the floor per render rather than the workspace reading a static map.
A splitter cannot drag a pane below its floor, and when the window cannot fit both
open panes the row scrolls horizontally.

This is the decision that let the view internals stay untouched. The obvious
alternative — stack the focus view's For/Against columns vertically when the pane is
narrow — would have broken a locked decision: "Stacked bands: parent band, focus
band, children band (For left / Against right)" and "Position (For / Supports left,
Against / Contests right) is carried by layout". Position IS the channel there. A
responsive reflow would silently delete a channel SESSION_FEED locks, to save the
reader a horizontal scrollbar in a window they can fix by minimizing a pane.

**The article's floor is the width its measure needs at its smallest type size** —
`articleMeasure(ARTICLE.bodyFont) + 2 × paneMargin` = 706. It was first given a floor
of 360 on the assumption that a narrower measure was graceful degradation; it is not,
it is just a squeezed article. See the type-scale entry below for why the floor is
computed from a line length rather than stated as a pixel width.

### Minimize is unmount, not hide

A minimized pane's component is unmounted; restoring remounts it. For the graph
this is not a nicety: the scene is built once against a measured container, and
`loadViewport` already restores the reader's location on mount, so remount lands
where they left off. Keeping it mounted behind `display: none` would have meant
building a scene against a zero-size container and re-fitting on reveal.

### History carries navigation, not layout

A browser history entry is `{ focusId, refThesisId }` — the two facts that are
shared, surface-independent, and about *where the reader is in the argument*.
Pane open/closed and the split ratios are persisted to `localStorage` but are
deliberately NOT pushed to history: back should undo where you are, not how big
your panes are, and a back button that toggles a pane is a back button people
stop trusting.

This also closes a gap rather than only preserving one. Before, only a refocus
pushed history; moving the reference thesis recoloured every surface and was
unrecoverable by back. Both now push, from one place (`App`'s nav effect)
rather than from each call site, so any pane's navigation is walkable regardless
of which pane initiated it.

### The graph follows the shared selection, but only when it has to

Selecting a claim in the focus or article pane repaints the graph's selection
emphasis always, and pans the map to that claim only when it is outside the
visible rect — same zoom, short transition. Panning on every click would make
the map lurch while a reader is doing something else in a different pane; never
panning would leave the shared selection off-screen, which is the whole point of
linking the panes. "Show on the map" keeps its distinct behaviour: an explicit
tight `neighborhoodZoom` regardless of where the claim already sits.

### The title bar carries no show/hide controls, and does carry the two page-level acts

There was briefly a Map/Focus/Article toggle group up there. It was duplicative: every
pane already has a minimize button, and a minimized pane already has a rail that
restores it, so the toggles were the same act spelled a second time in a second place.
They are gone; rail + minimize is the whole mechanism.

The space they freed carries the two acts that belong to the page rather than to one
surface:

- **Thesis** — recentre on the corpus thesis. This is `theses[0]`, the STRUCTURAL
  thesis, not the reference thesis: the reference thesis is movable, and the point of
  a "home" control is that it is where you left it. Where the two differ, the focus
  view's pinned thesis line is already the one-click way back to the reference thesis.
  Disabled when you are already there, so it never reads as a live control that does
  nothing.
- **Search** — I had moved it into the map pane's header on the argument that it acts
  on the map alone. Reversed: it is a question about the CORPUS, and putting it on the
  map pane meant it disappeared whenever the map was minimized, which is exactly when
  you most want to find a claim by name. It is back in the title bar, one instance.

### The graph key collapses whole, and starts OPEN

`Legend` is now absolutely positioned inside the map pane rather than fixed to the
window, and gained a header that collapses it to a labelled "Key" pill. It starts
expanded, and the choice is remembered (`loadKeyOpen`/`saveKeyOpen`, its own
localStorage entry so it does not race App's settings writes).

I had it defaulting collapsed for one round, on the reasoning that at a narrow map
pane the key covers the corner a "show on the map" locate lands in. That reasoning
was sound and the conclusion was still wrong: nobody found it. A key that has to be
discovered before it can be read is not doing the job at all, whereas an open key
covering part of the map is a cost the reader can pay off permanently with one
click, in whichever direction they prefer. The two-pane layout also softens the
original problem — the map pane is now ~870px rather than ~630px.

"Set reference thesis" collapses with it rather than being kept out: nominating is a
rare deliberate act, and an always-visible control for it would defeat the point of
collapsing.

### No view composition changed

`FocusView`, `ArticleView`, `Cell`, `primitives` and the graph's scene-building
are untouched except where a surface assumed it owned the window:

- `FocusView` / `ArticleView` roots went from `position: fixed; top:
  TITLE_BAR_HEIGHT; inset 0` to filling their pane.
- `Graph` measured `window.innerWidth/innerHeight` at mount and offset its zoom
  transform by `TITLE_BAR_HEIGHT`; it now measures its container and drops the
  offset, since the pane is already positioned below the title bar.
- `Legend` moved from window-fixed to pane-absolute.

Everything else the surfaces do — bands, boxes, brackets, stance fills, the
refocus flight, the trail, the reach cues — is byte-identical.

### `fromId` (the "came from" trace) is now set explicitly per origin

`setFocus(id, { trace })`. A click inside the focus or article pane traces; a
graph selection does not (it is a fresh entry from the map, matching the old
double-click-into-focus semantics); a popstate clears it. Before, a graph
single-click left `fromId` untouched, so a stale trace could survive into the
focus view — invisible in the swap world because the graph click and the focus
view were never on screen together, and visible immediately once they are.


---

## Decided — not covered (continued)

### Nominating a reference thesis is a navigation, and now behaves like one

Verified on screen: moving the reference thesis to a deep grounds claim repaints
the map (aligned 92 → 4 nodes, opposed 45 → 0), moves the focus view's pinned
thesis line and tear, and flips the article's kicker to "Not connected to the
reference thesis" — and browser back restores all of it, forward re-applies it.

This falls out of pushing history from one effect rather than from each call site,
but it is a behaviour change worth naming rather than a refactor: before, the one
gesture that recoloured every surface at once was the one gesture back could not
undo.

---

## Stale — the doc is behind the code

All three are in SESSION_FEED's **Focus view — locked** block, all PRE-EXISTING —
none is caused by this task. I read the whole block against the code rather than
the lines this change touched, which is the only reason the second and third
surfaced.

**1. "Per-claim 'show in graph' locate and a 'came from' back-trace are kept.
Neither changes selection."**

Both change selection, and did before this task. `App.handleLocate` has always
called `setFocusId(id)`; the came-from button calls the same `navigate` any tile
click does. Replacement: *Per-claim "show in graph" locate and a "came from"
back-trace are kept. Both recentre; neither moves the reference thesis.*

Worth saying that the workspace makes this louder rather than introducing it: with
the panes side by side, a tile's locate visibly recentres the focus and article
panes as well as framing the map, where in the swap world the other surfaces were
not on screen to be seen moving.

**2. "The parent band shows consumers in two polarity groups (Supports /
Contests) with role as a group header ('as grounds' / 'as an assumption')."**

The role group headers do not exist. `Cell.tsx` says so in its own header comment —
"there is no `assumes` divider and no role subhead" — and role is carried by the
bracket stub, solid into grounds and dashed into warrants. The polarity grouping
and its counts are correct; only the role header is stale. Replacement: *The parent
band shows consumers in two polarity groups (Supports / Contests); role is carried
by the stub, as everywhere else in the box.*

**3. "Warrant-role entries render the grounds-to-destination pair, since the
destination alone cannot say which inference the claim bridges."**

Superseded and now says less than the code does. `AboveEntry` renders a full
`InferenceBox` for every consuming inference — the destination as the output tile
with *all* of that inference's inputs bracketed beneath it, the centred claim among
them in its own grounds/warrant position. That answers "which inference does this
claim bridge" for grounds-role entries too, not only warrant-role ones.
Replacement: *Every consumer renders as a full inference box — the destination as
the output tile, all of that inference's inputs bracketed beneath it, the centred
claim among them in its own role.*

These three are one stale block, not three unrelated lines: all were left behind by
the same tile-and-inference-box rework, which is the pattern
`DESIGN_HISTORY_ARTICLE_ADDENDUM.md` already records under "The audit found one
contradiction because it was not looking for contradictions".

---

## Reported — a divergence the workspace made visible

Not a decision, and not something I changed. The focus view and the article
disagree about how far the centred claim is from the reference thesis — visible now
by switching the reader's register on one claim, where before it took switching
surfaces and remembering what the other one said.

With the thesis moved to "Bartov: Officials called for annihilation" and the centre
on "Gaza genocide", the focus register prints **"3 hops to thesis"** while the
article's kicker prints **"Not connected to the reference thesis"**. Both are right
by their own settled definitions:

- The focus view reads `computeStance`'s `dist`, which BFSes from the reference
  thesis in BOTH directions (`bfsDist(rev); bfsDist(fwd)`) — so it counts a claim
  the thesis reaches downward.
- The article's `trailsFromThesis` walks strictly upward from the centred claim via
  `consumersOf` and returns `null` when the thesis is not an ancestor — which is
  what "and up to three shortest routes FROM the reference thesis" means.

Making the two alternatives in one pane sharpens this rather than hiding it: the
switch is now a direct A/B on the same claim in the same place, so the contradiction
is one click apart instead of one navigation apart. I have not touched either — the
article's routes-not-a-breadcrumb treatment and the focus view's tear-and-hop-count
are both settled, and reconciling them is a design decision about what "distance from
the thesis" should mean, which is not mine to make inside this task.


---

## Decided — not covered (second round)

### Layout is validated on restore, not trusted

`PaneId` changed shape once inside this task — three panes became two. A settings
object written by the first shape has no `reader` key, which would have started the
reader pane minimized and handed the row a `NaN` flex-grow, on the machine of the
only person who had run the first shape. `isLayout` checks a restored `open` /
`sizes` for the current keys and falls back to the defaults otherwise.

The general rule this encodes: a persisted LAYOUT is a convenience, not content, so
discarding a stale one is cheap and restoring a broken one is not. Persisted
selection is the opposite — `focusId` and `refThesisId` are already validated against
the corpus rather than dropped, because losing where you were reading is a real loss.

### Minimizing the reader keeps its register

A minimized reader's rail is labelled with the surface it will come back in —
"Article" or "Focus" — rather than a generic "Reader". The pane's identity to the
reader is the register, not the slot; a rail that said "Reader" would make them open
it to find out which one it is.


---

## Decided — not covered (third round)

### The article's measure is a line length in characters; extra width buys TYPE, not line

The brief was that the article should reflow to fill its pane up to the limit where
text stops being scannable, rather than sitting at a fixed width with growing
margins. I agreed with the goal and disagreed with the mechanism, on a measurement:

**The prose column was already at 74 characters per line** — Georgia 19px, 8.366px
average advance, 616px of actual text column. 45–75 is the classic single-column
range, so the old fixed 680px measure was not short of the limit, it was AT it.
Widening the box at a fixed type size would have taken the column to 81 characters at
680px of prose and 91 at 760px — past the point where the eye reliably finds the
start of the next line. The reflow would have been in the wrong direction.

So the line length is the invariant and the type size is what moves.
`ARTICLE.charsPerLine` (72) is the measure; `useTypeScale` solves for the largest
body size in 19–21px whose measure fits the pane, and `articleMeasure(bodyPx)` gives
the outer width that size needs. Above `bodyFontMax` the type stops and the surplus
becomes margin.

Verified across the range: 706px pane (the floor) → 19px / 666px outer / 20px
margins; 766px → 20.75px / 722px; 826px → 21px / 730px / 48px margins; 1186px → still
21px, 228px margins each side. **72 characters per line at every width.** At the
default 803px pane the article's margins went from 61px a side to 37px, which was the
visible complaint.

Three sub-decisions inside it:

- **One scale variable, not a per-size rule.** `--pa-s` on `.pa-root`, every
  `font-size` in the stylesheet a `calc(<token>px * var(--pa-s))`. The ratios between
  title, standfirst, body and labels ARE the design; a body that grew while the
  labels stayed put would read as broken rather than as a bigger article.
- **A reserved `paneMargin` (20px a side), held back before solving.** Without it the
  solver spends every available pixel on type, so the article exactly fills its pane
  at every width below the cap and the column sits against the pane edge with only
  its own padding. The page should read as a sheet on a ground at every width, not
  only above the cap. This is also why the solved size rounds DOWN to a quarter-pixel
  — rounding to nearest let it round up past what fits and eat the reserve, which
  showed up as an 18px margin where 20 was promised.
- **`charWidthRatio` is measured, not assumed.** 0.4403 px of advance per px of
  font-size, taken from the rendered corpus prose rather than a rule of thumb. The
  fallback faces (Iowan Old Style, Times) are narrower, so they land inside the
  target rather than past it — the failure direction is short lines, which is the
  safe one.

**`bodyFontMax` = 21, and the band is narrow on purpose.** The character count is a
documented legibility limit; the ceiling on type size is a judgment, and I first set
it at 22 — the top of what a wide pane could carry — which was wrong.

The correcting argument is that real long-form does not scale type with the window at
all: NYT holds ~20px and Medium 21px at every width and lets the margins grow. A page
that visibly inflates when you drag a splitter reads as a zoom control, not as a
better-set page. So the ceiling is set at the size those publications hold FIXED, and
the 19→21 band exists only to take the article off its floor rather than to spend
whatever width is going.

Worth recording that this and the previous round pull in opposite directions, and the
resolution is a bound rather than a direction. "Reflow to fill the pane" and "do not
grow the type" cannot both be satisfied past 74 characters per line — the fixed-size,
fixed-measure, growing-margin model IS the NYT model, and it is what the surface did
before this round. What is built is that model with a 2px band of give at the bottom
of the range. `bodyFontMax = bodyFont` collapses it to the pure fixed case; there is
no other switch.
