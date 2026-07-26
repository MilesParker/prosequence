# Focus View — Spec/Code Audit

Read-only audit. Spec: `FOCUS_VIEW_SPEC.md`. Code: `src/viz/focus/{FocusView,Cell,focusData}.tsx/ts`, `src/viz/focus/primitives.tsx`, with shared pieces in `src/viz/graphData.ts`, `src/config.ts`, `src/viz/App.tsx`, `src/types.ts`.

Classification: **A** = code matches spec · **B** = code diverges from spec · **C** = code decides something the spec does not cover. No judgement of correctness; no fixes proposed.

---

## §1 Model

**A — frame state is a single `ClaimId`.**
Spec `FOCUS_VIEW_SPEC.md:13`: "Frame state is a single value: `focusId: ClaimId`. Everything else is derived."
Code `src/viz/App.tsx:34`: "`const [focusId, setFocusId] = useState<string | null>(null)`" — passed as `focusId` prop, `FocusView.tsx:398`.

**A — `consumers(C)` = grounds ∪ warrants.**
Spec `FOCUS_VIEW_SPEC.md:18`: "`consumers(C)` = inferences where `C ∈ grounds ∪ warrants`".
Code `src/viz/graphData.ts:133`: "`for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])].map(String)) {`" … `push(consumers, c, inf)` (`:138`), consumed via `consumersOf` `focusData.ts:20`.

**A — `supports(C)` = concludes === C.**
Spec `FOCUS_VIEW_SPEC.md:19`: "`supports(C)` = inferences where `concludes === C`".
Code `src/viz/graphData.ts:129`: "`if (inf.concludes) push(supports, String(inf.concludes), inf)`".

**C — `attacks(C)` adds a claim-target guard the spec formula omits.**
Spec `FOCUS_VIEW_SPEC.md:20`: "`attacks(C)` = inferences where `contests === C`".
Code `src/viz/graphData.ts:131`: "`if (inf.contests && claimIds.has(String(inf.contests))) push(attacks, String(inf.contests), inf)`". The extra `claimIds.has(...)` filters out inference-targeted contests. (Consistent with the spec precondition `FOCUS_VIEW_SPEC.md:5` "assumes `contests: ClaimId` only"; the code decides how to behave when that precondition is violated. Comment `:130`: "A contest always targets a claim (I8); guard defensively all the same.")

**C — `consumers` is de-duplicated per inference.**
Spec gives the set formula only. Code `src/viz/graphData.ts:132`: "`// Grounds ∪ warrants — dedupe if a claim is both on the same inference.`" (`consumerSeen` map, `:134-138`) so a claim that is both a ground and a warrant of one inference yields a single consumer entry. Spec does not cover the double-membership case.

---

## §2 Zones

**A — vertical stack; focus band larger/heavier/bordered.**
Spec `FOCUS_VIEW_SPEC.md:37`: "**Focus band** — `C.text`. Larger, heavier, bordered."
Code `FocusView.tsx:343`: "`fontSize: FOCUS.focusFont, fontWeight: 600`" (`focusFont: 19` vs `rowFont: 14.5`, `config.ts:64,66`), border `FocusView.tsx:311` "`border: \`2px solid ${COLORS.border}\``".

**A — children band: two equal columns, For left / Against right.**
Spec `FOCUS_VIEW_SPEC.md:38`: "**Children band** — two columns, equal width: **For** (`supports(C)`) left, **Against** (`attacks(C)`) right."
Code `FocusView.tsx:476-477`: `Column ... column="for" inferences={supportsOf(...)}` then `column="against" inferences={attacksOf(...)}`; each column `flex: 1` (`FocusView.tsx:378`).

**A — connectors are a centered 1px rule, no badges/labels.**
Spec `FOCUS_VIEW_SPEC.md:39`: "Connectors between bands: 1px vertical rule, centered. No badges, no labels on connectors."
Code `FocusView.tsx:33`: "`<div style={{ width: 1, height: FOCUS.connector, background: COLORS.border, alignSelf: 'center' }} />`".

**A — empty parent band omits band + connector.**
Spec `FOCUS_VIEW_SPEC.md:41`: "Parent band when `consumers(C)` is empty: omit the band and its connector entirely. (Root state.)"
Code `FocusView.tsx:454`: "`{hasParents && (`" wraps both `<ParentBand>` and its `<Connector>`; `hasParents` = `consumersOf(...).length > 0` (`:400`).

**B — the parent band pages; the spec says it must not.**
Spec `FOCUS_VIEW_SPEC.md:26`: "**All entries render. The parent band never pages and never collapses.**"
Code pages it: `FocusView.tsx:216`: "`{n > 1 && <div style={{ width: '100%' }}><Pager i={i} n={n} onPrev={() => setPage(i - 1)} onNext={() => setPage(i + 1)} /></div>}`" inside `ParentColumn`, which shows only `current` (`:219`, one entry at a time). Comment `FocusView.tsx:106-107`: "two fixed columns, paged like For/Against."

**B — parent band is two polarity columns, not "one entry per `consumers(C)`."**
Spec `FOCUS_VIEW_SPEC.md:26`: "**Parent band** — one entry per `consumers(C)`."
Code splits consumers into two paged columns by output polarity: `FocusView.tsx:234-235`: "`const supports = entries.filter(e => e.out.kind === 'concludes').sort(byRole)`" / "`const contests = entries.filter(e => e.out.kind === 'contests').sort(byRole)`", rendered as `column="supports"` / `column="contests"` (`:239-240`).

**B — parent-band labels are column headings + a role sub-header, not the spec's predicate verb phrases.**
Spec `FOCUS_VIEW_SPEC.md:28-35` requires a predicate phrase with C as implicit subject, per a 4-row table, e.g. `FOCUS_VIEW_SPEC.md:32`: "| `grounds` | `concludes` | `is grounds for →` |" and `:34` "| `grounds` | `contests` | `is grounds for challenging →` |".
Code renders a polarity heading `FocusView.tsx:208`: "`{heading}`" (`heading = column === 'supports' ? 'Supports' : 'Contests'`, `:198`) plus a role sub-header `FocusView.tsx:212`: "`{current.role === 'grounds' ? 'as grounds' : 'as an assumption'}`". None of the four spec phrases (`is grounds for →`, `warrants →`, `is grounds for challenging →`, `warrants challenging →`) appear in the code.

**A (mechanism) — role label is not a badge on the tile.**
Spec `FOCUS_VIEW_SPEC.md:28`: "The label names the relationship … never a type badge on the tile."
Code puts the role text in a column-spanning header (`FocusView.tsx:210-214`), and the tile (`ParentEntryCard`) carries no role label; comment `FocusView.tsx:116-118`: "a header spanning the column … NOT a label on the tile (§2)". (Label *wording* still diverges — prior finding.)

**B — coral tint is applied per column, not per entry.**
Spec `FOCUS_VIEW_SPEC.md:36`: "Tint the entry coral when the output is `contests`."
Code tints by column membership, not by inspecting each entry's output: `FocusView.tsx:199`: "`const tint = column === 'supports' ? COLORS.column.for : COLORS.column.against`", passed to every card in that column (`:219`). (Because the Contests column contains exactly the `contests`-output entries (`:235`), coral does land on contests entries — but as a column property.)

**C — warrant-role parent entries show `{grounds} → {destination}`, not the output claim alone.**
Spec `FOCUS_VIEW_SPEC.md:26`: "Entry displays the *output claim* of that inference … not the inference."
Code, for a warrant-role entry, renders the grounds claims and the destination joined by `→`: `FocusView.tsx:171-182` (`grounds.map(...)` then `<span … >→</span><ClaimTap … id={out.id} />`); grounds-role entries do show the output claim alone (`:166`). Comment `FocusView.tsx:143-146`: "a warrant-role entry the `{grounds} → {destination}` pair (§3) — the destination alone can't say which inference C bridges."

**C — parent entries are sorted grounds-role before warrant-role.**
Spec does not specify parent-band ordering. Code `FocusView.tsx:233`: "`const byRole = (a: ParentEntry, b: ParentEntry) => (a.role === b.role ? 0 : a.role === 'grounds' ? -1 : 1)`", applied at `:234-235`.

**C — parent columns are fixed-height with an internal scroller.**
Spec does not specify parent-band sizing. Code `FocusView.tsx:206`: "`height: FOCUS.columnHeight`" (`columnHeight: 360`, `config.ts:94`); `ParentEntryCard` inner area `FocusView.tsx:164`: "`overflowY: 'auto'`".

---

## §3 Cell = one Inference

**A — exactly one inference per cell; OR-siblings never stacked.**
Spec `FOCUS_VIEW_SPEC.md:47`: "Never render two inferences in one cell. Never stack OR-siblings vertically."
Code `Cell.tsx:18-20` takes a single `inf`; the column renders only `inferences[i]` (`FocusView.tsx:388`).

**B — the hint row is not implemented.**
Spec `FOCUS_VIEW_SPEC.md:51`: "**Hint row** — `inference.hint` if present, muted, one line of prose above the grounds."
Code `Cell.tsx:2-4`: "`// Anatomy (§3, hint row intentionally dropped — the schema's \`note\` is`" / "`// non-rendered authoring margin, not a reader-facing disambiguator):`". No hint row is rendered; `Cell` begins with grounds (`Cell.tsx:40`). (Schema note: `src/types.ts` defines no `hint` field on `Inference`; the only free-text field is `note`, `types.ts:124`, documented "not rendered as argument content", `types.ts:120-121`.)

**A — grounds rows, one per `inference.grounds`.**
Spec `FOCUS_VIEW_SPEC.md:52`: "**Grounds rows** — one row per `inference.grounds`".
Code `Cell.tsx:40-42`: "`{grounds.map(g => (<ClaimRow key={String(g)} gd={gd} id={String(g)} onFocus={onFocus} />))}`".

**B — conjunction label reads `assumes` / `assumes, together`, not `because` / `because, together`.**
Spec `FOCUS_VIEW_SPEC.md:53`: "**Conjunction label** — `because` if one warrant, `because, together` if more than one."
Code `Cell.tsx:55`: "`{warrants.length > 1 ? 'assumes, together' : 'assumes'}`".

**A — label + bracket omitted when warrants empty.**
Spec `FOCUS_VIEW_SPEC.md:53`: "Omit the label and the bracket entirely if `warrants` is empty."
Code `Cell.tsx:44`: "`{warrants.length > 0 && (`" gates both label and bracket.

**A — warrant rows inside a 2px column-tinted left bracket.**
Spec `FOCUS_VIEW_SPEC.md:54`: "**Warrant rows** — one row per `inference.warrants`, inside a left-bracket rule (2px, tinted to column)."
Code `Cell.tsx:57`: "`borderLeft: \`${FOCUS.bracketWidth}px solid ${tint.tint}\``" (`bracketWidth: 2`, `config.ts:70`), `tint` column-derived (`Cell.tsx:21`).

**A — cell renders none of id/scheme/submissionStatus/uncertain/depth.**
Spec `FOCUS_VIEW_SPEC.md:55`: "Do not render `inference.id`, `inference.scheme`, `submissionStatus`, `uncertain`, or computed depth in a cell."
Code `Cell.tsx` renders only grounds/warrant `ClaimRow`s and the conjunction label; a grep of `src/viz/focus` for those fields returns nothing.

**A — tint is column-derived.**
Spec `FOCUS_VIEW_SPEC.md:59`: "Tint is column-derived, not content-derived."
Code `Cell.tsx:21`: "`const tint = column === 'for' ? COLORS.column.for : COLORS.column.against`".

**B — the cell is fixed-height with an inner scroller; spec says no scroller, cell grows, page scrolls.**
Spec `FOCUS_VIEW_SPEC.md:57`: "No caps, no "+N more", no inner scroller. Cell grows; page scrolls."
Code gives the column a fixed height (`FocusView.tsx:378`: "`height: FOCUS.columnHeight`") and the cell body an internal scroller (`Cell.tsx:39`: "`overflowY: 'auto'`"). Comment `Cell.tsx:8-9`: "rows sit at the top and scroll *within* the tile on the rare cell that exceeds the reserved height."

---

## §3a Attribution

**A — attribution (source + quote) renders in the focus band only.**
Spec `FOCUS_VIEW_SPEC.md:65`: "renders its `source` and `quote` in the **focus band only** … Never in a cell row."
Code `FocusView.tsx:347`: "`{claim?.attribution && <Attribution attribution={claim.attribution} />}`" inside `FocusBand`; the `Attribution` component renders quote + `sourceLabel` (`:247-260`). Cell rows use `ClaimRow`, which renders text + marks only, never attribution (`primitives.tsx:149-175`); comment `primitives.tsx:146-147`: "Attributive claims render text only here; source/quote read in the focus band (§3a)."

---

## §4 Pips

**B — pips are not implemented; a stance-based "frontier mark" system stands in their place.**
Spec `FOCUS_VIEW_SPEC.md:73`: "One shape (8px circle), two solid fills. A claim row may wear zero, one, or two pips." Table `:77-78`: Teal `#1D9E75` = supported (`supports(claim).length > 0`); Coral `#D85A30` = contested (`attacks(claim).length > 0`). `:82`: "Pips carry presence only. Never render counts … never derive a score or strength."
Code renders no teal/coral presence pip. The right-hand mark is `FrontierMark` `primitives.tsx:108-120`, a stance-coloured double-chevron whose colour is `stanceColor(st)` where `st = frontierStance(gd, ctx.sm, id, ctx.visible)` (`:113`). `frontierStance` (`focusData.ts:70-96`) is a transitive walk over `supports ∪ attacks → grounds ∪ warrants` returning `aligned | opposed | divided`. No teal/coral supported/contested pip exists anywhere in `src/viz/focus`. Config still carries the tokens: `config.ts:67`: "`pipSize: 8, // §4 pip diameter`" (unused) and `pipGap: 5` (reused as a flex gap, `FocusView.tsx:133`).

**A — terminal claims render a `bedrock` badge instead of a mark.**
Spec `FOCUS_VIEW_SPEC.md:86`: "**Terminal claims** (`terminal: true`) render no pips. They render a `bedrock` badge instead: small, muted, outlined, no fill."
Code `primitives.tsx:111`: "`if (claim?.terminal) return <BedrockBadge />`"; `BedrockBadge` (`:69-86`) is outlined, muted, `border: \`1px solid ${COLORS.textDim}\``, no fill.

**B — the mark placement differs from the pip placement rule.**
Spec `FOCUS_VIEW_SPEC.md:84`: "Pips render on: grounds rows, warrant rows, Against cell rows, Parent band entries. Not on the focus band."
Code renders `ClaimMarks` on every `ClaimRow` — grounds *and* warrant rows in **both** For and Against cells (`Cell.tsx:41,59` both call `ClaimRow`, which calls `ClaimMarks`, `primitives.tsx:172`) — and on parent-band `ClaimTap` (`FocusView.tsx:136`). Marks do not appear on the focus band (`FocusBand`, `FocusView.tsx:343-345`, renders text only). So "not on focus band" holds (A), but marks appear on For-column rows, which the spec's pip list does not include.

**C — a `divided`/two-sided state exists; the spec's pip model has no such third value.**
Spec `FOCUS_VIEW_SPEC.md:80`: "Both pips together = live dispute. Render both; do not collapse them into a third state."
Code's frontier mark collapses to a single `divided` value: `focusData.ts:94`: "`if (divided || (aligned && opposed)) return 'divided'`", drawn as one dusty-rose chevron (`stanceColor`, `graphData.ts:370`). (Different axis from the pip model — stance-relative-to-root, not supported+contested — but it is a single third state where the spec forbade one for pips.)

---

## §5 Deferred — unsettled-deeper signal

**C — a transitive-closure "look deeper" mark, whose *concept* §5 deferred, has been built (as stance, not as the third pip).**
Spec `FOCUS_VIEW_SPEC.md:92`: "Cut from this iteration. Do not implement. Do not re-derive it." `:94`: "It is purely derived — a memoized transitive closure over `grounds ∪ warrants` of `supports(claim)` — so it can be added later".
Code implements a transitive closure of exactly this shape (extended to `attacks` as well): `focusData.ts:70-96` `frontierStance` walks "`[...supportsOf(gd, u), ...attacksOf(gd, u)]`" → "`[...(inf.grounds ?? []), ...(inf.warrants ?? [])]`" recursively (`:78-79`) and reports where the hidden branch leads. It is surfaced as the frontier chevron (`primitives.tsx:113-118`), not as the deferred yellow "unsettled-deeper" third pip, and it reports stance (`aligned/opposed/divided`) rather than "not itself contested but something it rests on is." Comment `primitives.tsx:90-91`: "there's more this way, and here's where it leads." Reported here without judgement as to whether it constitutes the deferred signal.

---

## §6 Paging

**A — paging is the OR treatment for For/Against; siblings paged not stacked.**
Spec `FOCUS_VIEW_SPEC.md:107`: "When a column has more than one inference, page them. Never scroll them, never stack them."
Code `Column` shows one inference and pages: `FocusView.tsx:383` `{n > 1 && <Pager .../>}`, `:388` renders `inferences[i]`.

**A — pager control format `‹ {i} of {n} ›`, chevrons at the edges.**
Spec `FOCUS_VIEW_SPEC.md:112`: "Control: `‹  {i} of {n}  ›`, horizontally centered above the cell, chevrons at the outer edges."
Code `FocusView.tsx:357-359`: "`<button className="pz-chev" onClick={onPrev} …>‹</button>`" / "`<span>{i + 1} of {n}</span>`" / "`…>›</button>`", laid out `justifyContent: 'space-between'` (`:356`) in a slot above the cell.

**A — page state resets to 0 on refocus.**
Spec `FOCUS_VIEW_SPEC.md:118`: "Page state resets to index 0 on every refocus."
Code keys the columns to `focusId` so they remount: `FocusView.tsx:476`: "`<Column key={\`for-${focusId}\`} …>`" (and `against-`), each `useState(0)` (`:367`).

**A — For/Against preserve corpus order (no sort).**
Spec `FOCUS_VIEW_SPEC.md:116`: "Preserve corpus order; do not sort by pip status, degree, or anything else."
Code passes `supportsOf`/`attacksOf` straight through (`FocusView.tsx:476-477`); those return the index arrays in push/corpus order (`graphData.ts:129,131`) with no sort.

**B — paging is also applied to the parent band, which §6 excludes.**
Spec `FOCUS_VIEW_SPEC.md:106`: "Paging applies to the **For and Against columns only**. Not the parent band (§2)."
Code reuses the same `Pager` in `ParentColumn` (`FocusView.tsx:216`). (Same divergence as the §2 parent-band-pages finding, from §6's side.)

---

## §7 Interaction

**A — refocus sets `focusId` and re-renders the whole stack.**
Spec `FOCUS_VIEW_SPEC.md:126`: "**Refocus** — click any claim row, any parent band entry, any Against cell. Sets `focusId` to that claim."
Code `ClaimRow` `primitives.tsx:157`: "`onClick={() => onFocus(id)}`"; `ClaimTap` `FocusView.tsx:131`: "`onClick={() => onFocus(id)}`"; wired to `navigate` in App (`App.tsx:119-123`), which sets `focusId`.

**A — page changes the shown sibling without changing `focusId`.**
Spec `FOCUS_VIEW_SPEC.md:128`: "**Page** — click a pager chevron … Does not change `focusId`."
Code `Pager` calls `setPage` only (`FocusView.tsx:383`), local to the column; `focusId` untouched.

**A — no expand/collapse; everything visible at rest.**
Spec `FOCUS_VIEW_SPEC.md:130`: "There is no expand/collapse. There is no disclosure arrow."
Code has no disclosure control in `src/viz/focus`; comment `FocusView.tsx:5-6`: "No expand/collapse; everything visible at rest."

**A — back stack via browser history.**
Spec `FOCUS_VIEW_SPEC.md:132`: "Maintain a back stack of `focusId` values; browser back pops it."
Code `App.tsx:122`: "`window.history.pushState({ pzFocus: id }, '')`" on navigate/activate; popstate handler `App.tsx:138-141` restores `focusId`.

**B — more than two gestures exist; spec says "Two gestures. No others."**
Spec `FOCUS_VIEW_SPEC.md:124`: "Two gestures. No others."
Beyond refocus and page, the code adds interactive affordances:
- Per-claim "Show in graph" locate button on every row: `primitives.tsx:133-138` (`onClick={e => { e.stopPropagation(); onLocate(id) }}`).
- Focus-band "Show in graph" and "came from" buttons: `FocusView.tsx:327-341` (`IconBtn` with `onClick`/hover).
- Came-from hover trace: `FocusView.tsx:330-333` (`onMouseEnter`/`onFocus` → `onFromHover`), highlighting the origin row (`useFromHighlight`, `primitives.tsx:21-26`).
- Reference-root line click to recentre on the root: `FocusView.tsx:54` (`onClick={() => onFocus(rootId)}`).

---

## §8 Empty states

**A — empty For column → dashed `no argument yet`.**
Spec `FOCUS_VIEW_SPEC.md:139`: "`supports(C)` empty … → For column renders dashed `no argument yet`."
Code `FocusView.tsx:476`: "`emptyLabel="no argument yet"`", rendered via `EmptyCell` when `n === 0` (`:386-387`); `EmptyCell` is dashed (`primitives.tsx:184`: "`border: \`1px dashed ${COLORS.border}\``").

**A — empty Against column → dashed `no challenge yet`.**
Spec `FOCUS_VIEW_SPEC.md:138`: "`attacks(C)` empty and `C.terminal === false` → Against column renders a dashed-border cell, muted text `no challenge yet`."
Code `FocusView.tsx:477`: "`emptyLabel="no challenge yet"`".

**A — terminal claim omits the entire children band.**
Spec `FOCUS_VIEW_SPEC.md:140`: "`C.terminal === true` → omit the children band entirely, both columns … Frame degenerates to parent band + focus band, with the `bedrock` badge in the focus band."
Code `FocusView.tsx:472`: "`{!terminal && (`" gates the whole children band; `terminal` = `!!claim?.terminal` (`:401`); bedrock badge in focus band `FocusView.tsx:346`.

**A — empty-state cells are not clickable.**
Spec `FOCUS_VIEW_SPEC.md:138`: "Not clickable in this iteration."
Code `EmptyCell` (`primitives.tsx:178-199`) has no `onClick`.

---

## §9 Out of scope

**A — none of the out-of-scope items are implemented.**
Spec `FOCUS_VIEW_SPEC.md:145`: "Do not implement: inference frames, expand/collapse, undercut rendering, connector badges, counts on pips, strength or defeat indicators, editing, submission, agent commitments, cross-space navigation."
Code: inferences are never centred/openable (only claims are focus targets, `App.tsx:94`, `FocusView` takes a claim id); no disclosure; connectors carry no badges (`FocusView.tsx:33`); no counts/strength; no edit/submit/commitment UI; no cross-space navigation in `src/viz/focus`. (See §9a for the added same-space "show in graph" locate, which is a within-corpus view swap, not cross-space.)

---

## §9a Relationship to the graph view

**A — swap, not coexist; one toggle.**
Spec `FOCUS_VIEW_SPEC.md:165`: "**Swap, not coexist.** … A small toggle icon swaps between them. They never render simultaneously."
Code `App.tsx:172-196`: `view === 'graph' ? <Graph…> : <FocusView…>`; toggled by `ViewSwitch` (`App.tsx:16-24,169`).

**A — one shared selection, always a `ClaimId`, owned by neither view.**
Spec `FOCUS_VIEW_SPEC.md:157-158`: "Selection state: one value, always a `ClaimId`. Neither view owns it."
Code `App.tsx:34`: "`const [focusId, setFocusId] = useState<string | null>(null)`", comment `:32-33`: "The one shared selection (§9a): always a ClaimId, owned by neither view."

**A — derived indices computed once, shared, not recomputed per view.**
Spec `FOCUS_VIEW_SPEC.md:156`: "Derived indices: `supports`, `attacks`, `consumers`. Computed once on corpus load. Neither view recomputes them."
Code builds them in `buildGraphData` (`graphData.ts:123-138`); focus view reads via `supportsOf`/`attacksOf`/`consumersOf` (`focusData.ts:16-20`); comment `focusData.ts:4-5`.

**A — inference nodes are not selectable in the graph; selection stays a `ClaimId`.**
Spec `FOCUS_VIEW_SPEC.md:163`: "Inference nodes in the graph view are **not selectable and not openable**".
Code `App.tsx:94`: "`if (node._kind === 'claim') setFocusId(String(node.id))`" (inference clicks set nothing); double-click guard `App.tsx:101`: "`if (node._kind !== 'claim') return`".

**A — swap to graph reveals position (pan/centre on selection).**
Spec `FOCUS_VIEW_SPEC.md:171`: "**Swapping to graph must reveal position.** The graph pans/centers on the current selection."
Code passes `centerOn={focusId}` with a `centerMode` (`App.tsx:180-181`); locate uses neighbourhood centring `App.tsx:128-132`, `VIEW.neighborhoodZoom` (`config.ts:258`).

**A — null selection defaults to a root.**
Spec `FOCUS_VIEW_SPEC.md:172`: "**Null selection defaults to a root.** On fresh load with nothing selected, the stack centers a claim from `DiscourseSpace.roots`."
Code `App.tsx:151-153`: "`if (view === 'focus' && !focusId && rootId) setFocusId(rootId)`"; also `fid = focusId ?? rootId` (`App.tsx:160`).

**A — the focus view renders none of id/scheme/depth/cluster/tag/submissionStatus/uncertain.**
Spec `FOCUS_VIEW_SPEC.md:175`: "do not render `id`, `scheme`, computed depth, `cluster`, `tag`, `submissionStatus`, or `uncertain` anywhere in the focus view."
Code: a grep of `src/viz/focus` for `depth`/`submissionStatus`/`uncertain`/`.tag`/`.scheme` returns nothing; claims are rendered by `.text` only (`primitives.tsx:171`, `FocusView.tsx:344`).

**C — the code shares stance state (`computeStance` / reference root) between the views, which §9a's share-list does not enumerate.**
Spec `FOCUS_VIEW_SPEC.md:153-158` lists what to share (tokens, primitives, the three indices, selection) and `:159-163` what not to share; stance/reference-root is on neither list.
Code shares both: the focus view calls `computeStance(gd, referenceRootId)` (`FocusView.tsx:407`) — the same function the graph uses — and receives `referenceRootId` from the same App state the graph is driven by (`App.tsx:43,182,195`). Selection and reference root are deliberately decoupled (`App.tsx:38-43`).

---

## §10 Open decisions

Handled in the "Separate answers" section below (Q2).

---

## §11 Validation targets

**C — the default corpus and the `?model=` switch are not the three named validation files.**
Spec `FOCUS_VIEW_SPEC.md:190`: "Build against all three: `gaza_v2.yaml`, `freedman_v2.yaml`, `free-transit_v2.yaml`."
Code default is gaza and resolves `discourse-spaces/<slug>.v2.yaml`: `config.ts:3`: "`export const DEFAULT_MODEL = 'gaza'`"; `config.ts:15`: "`return \`discourse-spaces/${slug || DEFAULT_MODEL}.v2.yaml\``". Filename shape (`<name>.v2.yaml` in `discourse-spaces/`) differs from the spec's `<name>_v2.yaml`; this audit did not verify which corpus files exist on disk or hand-check the named frames. Reported as a naming/lo, not a behavioural, difference.

---

# Separate answers

## 1. Everything the code does that the spec does not mention at all

These have no counterpart anywhere in `FOCUS_VIEW_SPEC.md`:

1. **Reference-root line at the top of the stack** — `RootLine` (`FocusView.tsx:50-72`): a pinned banner for `DiscourseSpace.roots`-derived reference root, with a bullseye `TargetIcon` and the caption "reference root", clickable to recentre. The spec's parent band is one-hop; nothing in it describes a pinned root.
2. **Torn-sheet "hidden hops" divider + hop count** — `TornEdge`/`TearLine` (`FocusView.tsx:77-102`): an inert zigzag with "`{hops} hop{s} to root`" (`:98`), shown only when the centre is off-root (`showRootLine`, `:416`). `hops` is derived from a stance distance map (`:411-412`).
3. **Reference-root header inside the focus band** — `FocusView.tsx:318-325`: a `TargetIcon` + "reference root" when the centred claim *is* the root.
4. **The entire stance/frontier system** — `computeStance` consumption (`FocusView.tsx:407`), `FrontierContext` (`primitives.tsx:37`), `frontierStance` (`focusData.ts:57-96`), and the stance-coloured `FrontierGlyph`/`FrontierMark` chevrons (`primitives.tsx:91-120`). The spec's only status vocabulary is teal/coral pips (§4), which are deferred-adjacent to none of this; "aligned/opposed/divided" appears nowhere in the spec.
5. **"Show in graph" locate affordance on every claim and on the focus band** — `GraphIcon` + `LocateContext` (`primitives.tsx:30,53-65,133-138`; `FocusView.tsx:339-341`), centring the graph on that specific claim at `VIEW.neighborhoodZoom`. The spec describes only a whole-view swap (§9a), not per-claim locate buttons.
6. **"Came from" back-trace** — `CameFromIcon` + `FromHighlight` context + ring/wash (`FocusView.tsx:285-291,326-338`; `primitives.tsx:16-26`; tokens `config.ts:80-81`), highlighting the row you navigated from. The spec's only "back" is browser back (§7).
7. **`+` separator between multiple grounds** in a warrant-role parent tile — `FocusView.tsx:174` ("`{i > 0 && <span aria-hidden …>+</span>}`").
8. **Escape-key handling** — `App.tsx:136`: clears search, `focusId`, and nominating. (App-level, affects the focus view's centre.)
9. **The reference-root "nominate" mode and its decoupling from selection** — `App.tsx:43-48,84-95,115` — background/plumbing the focus view consumes via `referenceRootId`.

(Adjacent but *partially* covered, so not listed above: the browser-back stack is specced in §7; the graph-reveal-on-swap is specced in §9a — the code's per-claim/neighbourhood variants extend it.)

## 2. §10's three open decisions — still open, or answered in the build?

**10.1 Pager summary (does the pager surface hidden siblings' status?).**
Spec `FOCUS_VIEW_SPEC.md:183`: "Currently unspecified; implement without it and leave the seam."
**Still open / left as instructed.** The `Pager` shows only position — `FocusView.tsx:358`: "`<span>{i + 1} of {n}</span>`" — no per-sibling status. Note the code did build a hidden-branch status signal elsewhere (the frontier chevron on claim rows, `primitives.tsx:108-120`), but it does not ride on the pager control, so the specific seam §10.1 describes is left unfilled.

**10.2 Grounds-vs-warrant distinction within a cell (does position + `because` bracket suffice on 3+ grounds?).**
Spec `FOCUS_VIEW_SPEC.md:184`: "Currently carried by position and the `because` bracket alone. Verify this reads correctly on a cell with 3+ grounds; if not, this needs a decision, not a label."
**Still open / unaddressed.** The cell still distinguishes the two only by position and the bracketed conjunction label (now worded `assumes`) — `Cell.tsx:40-61`: grounds rows, then `assumes` label (`:55`), then bracketed warrant rows (`:57`). No additional distinguishing mechanism (and no per-row role label) was added.

**10.3 Default centre when `roots` has multiple entries.**
Spec `FOCUS_VIEW_SPEC.md:185`: "`roots[0]` is arbitrary. Needs either a designated primary or a root picker on entry." (`FOCUS_VIEW_SPEC.md:172`: "Which one, when `roots` has more than one entry, is unspecified — see §10.")
**Answered in the build — by taking `roots[0]`, silently.** Code `App.tsx:59`: "`const rootId = data?.roots?.[0] != null ? String(data.roots[0]) : null`". This single choice feeds both the default centre (`App.tsx:152`: "`if (view === 'focus' && !focusId && rootId) setFocusId(rootId)`", and `fid = focusId ?? rootId`, `:160`) and the default reference root (`App.tsx:64`: "`if (refRootId === undefined && rootId) setRefRootId(rootId)`"). No designated-primary field and no root picker were added; `roots[0]` is used directly.

## 3. The exported stance/polarity function and its module

**`computeStance(gd: GraphData, refRootId: string | null): StanceMap`**, exported from **`src/viz/graphData.ts`** (`graphData.ts:309`). It colours every node `aligned | opposed | divided | neutral` (type `Stance`, `graphData.ts:286`) relative to the reference root. Related exported helpers in the same module: `stanceColor` (`:367`), `edgeStance` (`:381`), and the `StanceMap` interface (`:288`). The focus view imports it at `FocusView.tsx:12` and calls it at `:407`.

If "polarity" instead means the parent-band output polarity (concludes vs contests), that is **`outputOf(inf): Output`** (`{ id, kind: 'concludes' | 'contests' }`) exported from **`src/viz/focus/focusData.ts`** (`focusData.ts:25`), with the companion `roleOf` (grounds vs warrants, `:32`).

## 4. Is `cluster` still referenced anywhere?

**Not in the live TypeScript source.** The `cluster` field was dropped from the schema (no `cluster` on `Claim` in `src/types.ts:70-87`; most recent commit "Dropped obsolete cluster field."), and a grep of `src/**` for `cluster` returns **no** `.ts`/`.tsx` hits. The graph's chip-kind logic no longer branches on it (`graphData.ts` retains only `export type ChipKind = keyof typeof COLORS.chip`, `:436`).

It still appears in these non-source / stale locations:
- **`dist/assets/index-DXkBPlQ7.js`** — the built bundle is stale (pre-drop): it still contains cluster-based logic, e.g. the chip-kind function `…const T=E.cluster;return T==="Pro"?"pro":…` and the tooltip `…re.attribution?"attributive":re.cluster`.
- **`viz.html`** — a standalone/legacy HTML viewer: `viz.html:149` (`const c = n.cluster;`), `:333`, `:384` (`<span class="p-chip">${d.cluster}</span>`).
- **Docs:** `DirectiveV2.md:31` and `FOCUS_VIEW_SPEC.md:175` (the latter naming it as a do-not-render field).
- **`.idea/workspace.xml`** — commit-message metadata ("Dropped obsolete cluster field.").

So within the running application source, `cluster` is gone; it survives only in a stale build artifact, the legacy `viz.html`, documentation, and IDE metadata.
