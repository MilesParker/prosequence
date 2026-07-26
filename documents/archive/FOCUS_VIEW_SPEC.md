# Focus View — Implementation Spec

Target: `index.html` (React, CDN, no build step). Data: v2 corpora YAML via js-yaml. Schema: `parsanga.ts`.

Precondition: assumes `contests: ClaimId` only. Do not implement any inference-targeting attack path.
 
---

## 1. Model

One frame type. The frame centers a **Claim**. Inferences are never centered and are never navigable targets.

Frame state is a single value: `focusId: ClaimId`. Everything else is derived.

Given focus claim `C`:

- `consumers(C)` = inferences where `C ∈ grounds ∪ warrants`
- `supports(C)` = inferences where `concludes === C`
- `attacks(C)` = inferences where `contests === C`
---

## 2. Zones

Vertical stack, full width, top to bottom:

1. **Parent band** — one entry per `consumers(C)`. **All entries render. The parent band never pages and never collapses.** Entry displays the *output claim* of that inference (`concludes` or `contests` target), not the inference.
   Consumers are not alternatives to each other — each is a different destination. Hiding any of them destroys information rather than deferring it. The fan-out is the only place the layout shows that a claim is load-bearing for several arguments at once, and it is the direction the reader traverses to ask "what does accepting this feed into." A claim supporting three arguments must not look like a claim supporting one.
   **Label is a predicate, not a noun.** The label names the relationship, with the focus claim as implicit subject — never a type badge on the tile. The tile's content is the *destination* claim; a bare `Grounds` sitting beside it reads as typing that claim, which contradicts role-from-position. A claim is never *a* grounds; it *acts as* grounds in one inference.
   Both dimensions — C's role, and the inference's output — go in one verb phrase. `contests` does not override the role label:
   | role of `C` | output | label |
   |---|---|---|
   | `grounds` | `concludes` | `is grounds for →` |
   | `warrants` | `concludes` | `warrants →` |
   | `grounds` | `contests` | `is grounds for challenging →` |
   | `warrants` | `contests` | `warrants challenging →` |
   Tint the entry coral when the output is `contests`.
2. **Focus band** — `C.text`. Larger, heavier, bordered.
3. **Children band** — two columns, equal width: **For** (`supports(C)`) left, **Against** (`attacks(C)`) right.
   Connectors between bands: 1px vertical rule, centered. No badges, no labels on connectors.

Parent band when `consumers(C)` is empty: omit the band and its connector entirely. (Root state.)
 
---

## 3. Cell = one Inference

Each cell renders exactly one inference. Never render two inferences in one cell. Never stack OR-siblings vertically.

Cell anatomy, top to bottom:

1. **Hint row** — `inference.hint` if present, muted, one line of prose above the grounds. This is what distinguishes OR-siblings from each other; it is the only text that explains why this inference exists separately from the one beside it in the pager. Omit the row entirely if `hint` is null.
2. **Grounds rows** — one row per `inference.grounds`, each showing that claim's text + pips. Multiple grounds stack; no separator between them.
3. **Conjunction label** — `because` if one warrant, `because, together` if more than one. Omit the label and the bracket entirely if `warrants` is empty.
4. **Warrant rows** — one row per `inference.warrants`, inside a left-bracket rule (2px, tinted to column). Each row: claim text + pips.
   Do not render `inference.id`, `inference.scheme`, `submissionStatus`, `uncertain`, or computed depth in a cell. Those are inspector fields (§9a).

All conjuncts always visible. No caps, no "+N more", no inner scroller. Cell grows; page scrolls.

Tint: For column green family, Against column coral family. Tint is column-derived, not content-derived.
 
---

## 3a. Attribution

A claim with `attribution` renders its `source` and `quote` in the **focus band only**, when that claim is centered. Never in a cell row — rows stay one line.

Attributive claims appearing as grounds rows in a cell render text only. To read the source, refocus on the claim.
 
---

## 4. Pips

One shape (8px circle), two solid fills. A claim row may wear zero, one, or two pips.

| Fill | Hex | Meaning | Predicate |
|---|---|---|---|
| Teal | `#1D9E75` | supported | `supports(claim).length > 0` |
| Coral | `#D85A30` | contested | `attacks(claim).length > 0` |

Both pips together = live dispute. Render both; do not collapse them into a third state.

Pips carry presence only. Never render counts, never render magnitude, never derive a score or strength.

Pips render on: grounds rows, warrant rows, Against cell rows, Parent band entries. Not on the focus band.

**Terminal claims** (`terminal: true`) render no pips. They render a `bedrock` badge instead: small, muted, outlined, no fill.
 
---

## 5. Deferred — unsettled-deeper signal

Cut from this iteration. Do not implement. Do not re-derive it.

A third pip was designed to mark "this claim is not itself contested, but something it rests on is." It is purely derived — a memoized transitive closure over `grounds ∪ warrants` of `supports(claim)` — so it can be added later with no schema or corpus change.

Reasons for deferral, recorded so it is not silently reinvented:
- It is the only pip not verifiable one click away. Teal and coral are facts about edges incident to the claim; this one is a rollup that says *look* without saying where.
- In a mature corpus it lights permanently near the root, making it noise rather than signal.
- Yellow is already the graph view's terminal color.
  Revisit only if a real corpus demonstrates the gap.

---

## 6. Paging

Paging applies to the **For and Against columns only**. Not the parent band (§2).

When a column has more than one inference, page them. Never scroll them, never stack them.

Paging is the OR treatment: it belongs only where entries are genuinely alternatives — independent routes to the same output, each sufficient on its own, so hiding some defers information rather than losing it. Do not page anything that is not an OR-sibling set.

Control: `‹  {i} of {n}  ›`, horizontally centered above the cell, chevrons at the outer edges.

No label. `hint` is specified as a sentence and will not fit a chevron control; it renders in the cell body instead (§3). `scheme` humanized is jargon, not a label. Nothing in the schema is a short label — the reader pages and reads.

OR-siblings are peers. No ordering that implies rank. Preserve corpus order; do not sort by pip status, degree, or anything else.

Page state resets to index 0 on every refocus.
 
---

## 7. Interaction

Two gestures. No others.

**Refocus** — click any claim row, any parent band entry, any Against cell. Sets `focusId` to that claim. Full stack re-renders. This is the only navigation.

**Page** — click a pager chevron. Changes which sibling inference the column shows. Does not change `focusId`.

There is no expand/collapse. There is no disclosure arrow. Everything in a cell is visible at rest.

Maintain a back stack of `focusId` values; browser back pops it.
 
---

## 8. Empty states

- `attacks(C)` empty and `C.terminal === false` → Against column renders a dashed-border cell, muted text `no challenge yet`. Not clickable in this iteration.
- `supports(C)` empty and `C.terminal === false` → For column renders dashed `no argument yet`.
- `C.terminal === true` → omit the children band entirely, both columns. Terminals cannot be concluded or contested (I7/I8), so the columns are not empty-pending-argument, they are structurally impossible. Do not render `no challenge yet` under a terminal — the challenge is not missing, it is impossible. Frame degenerates to parent band + focus band, with the `bedrock` badge in the focus band.
---

## 9. Out of scope

Do not implement: inference frames, expand/collapse, undercut rendering, connector badges, counts on pips, strength or defeat indicators, editing, submission, agent commitments, cross-space navigation.
 
---

## 9a. Relationship to the graph view

Build the two views separately. Do not refactor the graph view to accommodate this one, and do not abstract a shared layout layer.

**Share — single source, no duplication:**

- Design tokens: color palette (including the §4 pip fills), For/Against tint families, type scale, radii, border weights.
- Primitive components: pip, chip, badge (`bedrock`), dashed empty-state cell.
- Derived indices: `supports`, `attacks`, `consumers`. Computed once on corpus load. Neither view recomputes them.
- Selection state: one value, always a `ClaimId`. Neither view owns it.
  **Do not share:**

- Layout and composition. Force-directed positioning and band stacking have nothing in common; a shared abstraction over both deforms both.
- Cell/node rendering above the primitive level.
  Inference nodes in the graph view are **not selectable and not openable** — they render as junctions only. Selection is therefore always a `ClaimId` in both views and needs no translation. An inference's `scheme` and `hint` are read in the focus view cell, not the graph.

**Swap, not coexist.** The graph view and focus view are mutually exclusive surfaces. A small toggle icon swaps between them. They never render simultaneously.

Shared selection is what makes the swap free: click a node in the graph, swap, and the stack is already centered on it. There is no second state to synchronize.

Two rules the swap requires:

1. **Swapping to graph must reveal position.** The graph pans/centers on the current selection. A highlighted node off-viewport defeats the purpose of the swap.
2. **Null selection defaults to a root.** On fresh load with nothing selected, the stack centers a claim from `DiscourseSpace.roots`. Which one, when `roots` has more than one entry, is unspecified — see §10.
   **Sidebar.** Its reader role is retired: the graph's tooltip covers quick-look, the stack covers depth. Whether the sidebar persists as an author/debug surface is out of scope for this spec — but its inference case has no successor either way, since inference nodes are non-selectable.

Regardless: do not render `id`, `scheme`, computed depth, `cluster`, `tag`, `submissionStatus`, or `uncertain` anywhere in the focus view. `depth` especially — depth is inferential distance and explicitly not importance; rendering it to a reader invites the misreading the framework exists to prevent.
 
---

## 10. Open decisions — do not invent answers

Flag these and stop; do not choose silently.

1. **Pager summary.** Does the pager control surface pip status of *hidden* siblings (e.g. a coral dot meaning "a sibling back here is contested")? Discoverability vs. hoisting attacks out of their true home. Currently unspecified; implement without it and leave the seam.
2. **Grounds vs. warrant distinction within a cell.** Currently carried by position and the `because` bracket alone. Verify this reads correctly on a cell with 3+ grounds; if not, this needs a decision, not a label.
3. **Default center when `roots` has multiple entries.** A discourse space may hold more than one live proposition over one graph. `roots[0]` is arbitrary. Needs either a designated primary or a root picker on entry.
---

## 11. Validation targets

Build against all three: `gaza_v2.yaml`, `freedman_v2.yaml`, `free-transit_v2.yaml`.

Specific frames to check by hand:
- Regressivity claim — conjoint warrants, both load-bearing, mixed pips.
- Ridership claim — mediating, multi-entry parent band, fan-out fully visible.
- Any generalisation claim — paged OR-sibling case inferences.
- Both free-transit terminals — bedrock badge, no pips, no children band.