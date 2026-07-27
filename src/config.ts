// ── File locations ──────────────────────────────────────────────────────────
// v2 corpus (claim/inference model). Swap to another *.v2.yaml to view it.
export const DEFAULT_MODEL = 'gaza'

// Resolve the corpus file, honouring a `?model=<name>` query param
// (e.g. ?model=gaza → discourse-spaces/gaza.v2.yaml). The name is sanitised to
// a safe slug so it can only reference files within discourse-spaces/.
export function resolveDataFile(): string {
  let model = DEFAULT_MODEL
  if (typeof window !== 'undefined') {
    const param = new URLSearchParams(window.location.search).get('model')
    if (param) model = param
  }
  const slug = model.replace(/[^a-zA-Z0-9_-]/g, '')
  return `discourse-spaces/${slug || DEFAULT_MODEL}.v2.yaml`
}

export const DATA_FILE = resolveDataFile()

// ── Highlight accent ──────────────────────────────────────────────────────────
// Amber — the single "attention" hue. One definition feeds both the graph's search
// highlight and the focus view's "came from" ring/wash, so the two surfaces cannot
// drift apart (they are meant to match). Each view previously spelled it out on its
// own; DISCLOSURE and FOCUS both read it from here.
const HIGHLIGHT = 'hsl(35, 95%, 48%)'
const HIGHLIGHT_WASH = 'hsla(35, 95%, 48%, 0.13)'   // the same amber, pale wash

// ── Progressive disclosure ────────────────────────────────────────────────────
// Inferences render in one of three states (P/J/X). The master layout is frozen
// (the fully-expanded, all-X geometry); disclosure toggles visibility only. See
// src/viz/disclosure.ts.
export const DISCLOSURE = {
  fadeMs: 200,          // enter/exit fade for revealed/hidden marks
  chipMaxChars: 14,     // truncation for folded-warrant chips
  chipHeight: 16,
  chipGap: 4,
  chipFontSize: 9,
  badgeFontSize: 9,
  fanGap: 18,           // vertical drop from a J junction to its chip/badge fan
  hiddenFontSize: 9,    // persistent "something is hidden" count on a claim
  highlightStroke: HIGHLIGHT,   // amber — reads on the paper ground
  highlightWidth: 3,
  // Persistent selection ring on the graph (the retired sidebar used to be the
  // "this is selected" signal; now the node itself carries it).
  selectionStroke: 'hsl(215, 60%, 40%)',  // ink blue — high-contrast on white
  selectionWidth: 2.5,
} as const

// ── Layout ──────────────────────────────────────────────────────────────────
export const TITLE_BAR_HEIGHT = 44
export const PANEL_WIDTH = 380

// ── Detail-panel typography (px) ──────────────────────────────────────────────
// Font sizes for the right-hand inset panel, bumped up from the original
// cramped 10–14px scale. Tune here rather than in the component.
export const PANEL_FONT = {
  base:  15,   // panel default / Output / Source body
  title: 16,   // header h2
  body:  15,   // claim statement
  meta:  14,   // ids, quotes, list rows, grounds/warrants
  label: 12,   // uppercase section labels
  chip:  13,   // property chips
  badge: 12,   // relation badges
  close: 24,   // × close button
} as const

// ── Focus view (band-stack surface) ───────────────────────────────────────────
// The focus view centres one claim and stacks parent band / focus band /
// For+Against columns. Layout tokens live here alongside the graph's.
// Feature flag: show each claim's `tag` as a mini header above its text on every
// focus-view item (root line, parent band, focus band, For/Against cells). Flip
// to false to hide them everywhere.
export const SHOW_FOCUS_TAGS = true

// Feature flag: show each claim's main `text` on every focus-view item. On by
// default; flip to false to show just the tag headers (SHOW_FOCUS_TAGS). Turning
// both off leaves items with no content, so keep at least one on.
export const SHOW_FOCUS_TEXT = true

export const FOCUS = {
  columnMaxWidth: 860,   // max width of the centred stack
  rowFont: 14.5,         // attribution, empty-state text
  labelFont: 11,         // uppercase region headings, counts, subheads, bedrock
  // The tag is the primary identifier everywhere (tile, focus band, root line) and
  // reads as plain, prominent text; the claim's full text is secondary DETAIL shown
  // muted beneath it (or on dwell, on a tile). One tag look throughout — see TAG_STYLE.
  tagFont: 15,           // the tag — primary, plain text
  detailFont: 13,        // the claim's full text, shown as muted detail
  connector: 22,         // vertical rule between bands
  cellRadius: 8,         // dashed empty-state card

  // Claim tiles — a claim rendered as its tag, a rounded rect echoing the graph
  // node and the centred claim (stance fill). The tag text shares one look with
  // the tag header everywhere (see TAG_STYLE). Full text on dwell.
  tileRadius: 5,         // rounded-rect corner (graph node = 4, centred claim = 10)
  tileGap: 6,            // gap between tiles inside a bag / a box's internals

  // Inference boxes — one per inference below the focus, full column width and
  // stacked. A thick stance-hue "spine" down the left edge carries the grouping
  // (these claims conjoin into one argument), a hairline neutral border closes the
  // other three sides, and a light stance wash fills the interior.
  spineWidth: 1,         // stance-hue left edge, same weight as the neutral border
  boxRadius: 7,          // rounded on the right; the stance edge keeps the left square
  boxPad: 11,            // padding inside a box
  boxGap: 10,            // gap between stacked boxes within a region half

  // Bracket leader — the interior tree that hangs the inputs off the output tile.
  // A solid unbroken spine drops from just below the output tile to the last input;
  // one stub reaches from the spine to each input tile, SOLID into grounds and
  // DASHED into warrants (the only mark carrying the grounds/warrant distinction).
  // The indent is produced by the bracket, not specified separately.
  bracketIndent: 22,     // connector width = indent + stub length
  bracketInset: 4,       // spine sits this far in from the output tile's left edge
  bracketWidth: 1.5,     // spine + stub stroke weight
  bracketRiser: 6,       // spine segment above the first stub (reads "just below output")
  bracketTickDrop: 4,    // contest tick nudged down so it clears the output tile above it
  tileVPad: 3,           // vertical breathing room around each input tile (spine stays continuous)

  // Position is the layout channel (For/Supports left, Against/Contests right);
  // this gap separates the two halves in both regions.
  parentColGap: 16,

  // "Came from" trace: the claim you navigated from wears this ring/wash while
  // the focus-band icon is engaged. Reuses the shared HIGHLIGHT accent, so it is
  // the same amber as the graph's search highlight — one definition, both views.
  fromRing: HIGHLIGHT,
  fromTint: HIGHLIGHT_WASH,

  // Stage 4 — the reference root pinned at the top ("what's ultimately at
  // stake"), the inert "torn sheet" that stands in for the hidden chain of hops
  // between it and the parent band, and the bullseye that marks the origin.
  targetIcon: 16,        // bullseye glyph — root line + focus-band root header
  rootLineGap: 8,        // breathing room above/below the tear
  tearHeight: 13,        // torn-edge zigzag band height
  tearToothW: 14,        // width of one zigzag tooth (the pattern tile)

  // Reserved heights keep the landscape from shifting as you refocus. Both region
  // frames are fixed and scroll internally with a scroll-edge fade — paging retired.
  focusMinHeight: 120,     // focus band floor (~3 lines)
  aboveHeight: 220,        // consumers region (inference boxes → destinations) — fixed, scrolls
  columnHeight: 360,       // For/Against region (inference boxes) — fixed, scrolls
  scrollFade: 16,          // scroll-edge fade depth

  // Refocus flight — the "your click is travelling to the centre" hint. On a tile
  // click the surface fades out, a ghost of the clicked box flies from where it sat
  // to where the new focus band lands (measured after the swap), then the redrawn
  // surface fades in under it. Three legs; the crossfade hides that the ghost is an
  // approximation, so it never has to morph shape. Skipped under prefers-reduced-motion.
  flight: {
    fadeOut: 120,          // ms — old surface fades before the ghost sets off
    move: 240,             // ms — ghost travels source → focus band
    fadeIn: 150,           // ms — redrawn surface fades in as the ghost fades out
    ease: 'cubic-bezier(0.4, 0, 0.2, 1)',
  },
} as const

// ── Node dimensions (half-width / half-height) ───────────────────────────────
export const NODE = {
  halfWidth: 60,
  halfHeight: 30,
  rootHalfWidth: 66,
  rootHalfHeight: 38,
  lineHeight: 12,
  wordsPerLine: 2,
  rx: 4,
  strokeWidth: 1.5,
  rootStrokeWidth: 2.5,
  // Inference junction marks are small and visually subordinate — wiring, not
  // peers. Rendered as a small circle of this radius.
  infRadius: 7,
} as const

// ── Color palette (all values in HSL) ────────────────────────────────────────
// Light "living document" theme: warm paper ground, ink text. The graph's
// type-chip hues are necessarily less punchy here than on the old dark ground —
// an accepted trade for the document feel — so fills are pale tints and the
// legibility is carried by the darker, saturated strokes and by ink text.
export const COLORS = {
  background:  'hsl(43, 30%, 97%)',        // warm paper
  surface:     'hsl(0, 0%, 100%)',         // cards lift a shade off the paper
  surfaceBlur: 'hsla(43, 40%, 98%, 0.85)',
  border:      'hsl(40, 16%, 84%)',
  borderFaint: 'hsl(40, 16%, 90%)',
  text:        'hsl(220, 18%, 18%)',       // ink
  textMuted:   'hsl(220, 12%, 34%)',
  textFaint:   'hsl(220, 10%, 50%)',
  textDim:     'hsl(220, 10%, 58%)',
  textDimmer:  'hsl(220, 10%, 70%)',
  error:       'hsl(2, 62%, 50%)',         // error-state text only

  // Inference junction marks — subordinate wiring.
  inference: { fill: 'hsl(230, 16%, 90%)', stroke: 'hsl(230, 12%, 55%)' },

  // Claim-TYPE chips in tooltips — the argumentative function a claim serves
  // (its stance/valence is carried by STANCE, not here). Each type keeps its own
  // hue; Pro/Anti claims have no functional type and get no chip.
  chip: {
    default:     { bg: 'hsl(40, 16%, 91%)',  color: 'hsl(220, 10%, 40%)' },
    empirical:   { bg: 'hsl(205, 38%, 92%)', color: 'hsl(205, 32%, 36%)' },
    analogy:     { bg: 'hsl(280, 40%, 93%)', color: 'hsl(282, 38%, 42%)' },
    root:        { bg: 'hsl(212, 80%, 92%)', color: 'hsl(212, 64%, 38%)' },
    terminal:    { bg: 'hsl(45, 88%, 86%)',  color: 'hsl(34, 72%, 34%)'  },
    attributive: { bg: 'hsl(210, 18%, 92%)', color: 'hsl(210, 14%, 38%)' },
    inference:   { bg: 'hsl(230, 16%, 90%)', color: 'hsl(230, 14%, 40%)' },
  },

  // For / Against column families (focus view). Green = For (concludes family),
  // red = Against (contests family). Column-derived, not content-.
  column: {
    for:     { tint: 'hsl(140, 46%, 40%)', bg: 'hsl(140, 46%, 96%)', border: 'hsl(140, 34%, 82%)', label: 'hsl(140, 46%, 30%)' },
    against: { tint: 'hsl(2, 62%, 52%)',   bg: 'hsl(2, 66%, 97%)',   border: 'hsl(2, 52%, 86%)',   label: 'hsl(2, 56%, 43%)' },
  },
} as const

// ── Shared text look ──────────────────────────────────────────────────────────
// The weight + colour of the two text roles, size-free so each surface picks its
// own font-size. The tag is the primary identifier — plain, ink; the claim's full
// text is secondary detail — muted. Shared by the focus view AND the graph tooltip
// so a tag reads the same everywhere and its detail text the same everywhere.
export const TAG_TEXT = { fontWeight: 500, color: COLORS.text } as const
export const DETAIL_TEXT = { fontWeight: 400, color: COLORS.textMuted } as const

// ── Stance colours (LCH-canonical) ────────────────────────────────────────────
// A four-value vocabulary for the *stance* of a claim/edge — how the sides of a
// dispute line up — kept deliberately separate from the type-chip/role hues in
// COLORS above. Nothing consumes these yet; later stages do.
//
// Canonical values are LCH. The sRGB value baked here — now written as HSL — is the
// standard CSS Color 4 `lch()` / d3-color rendering (CIELAB, D50 white point), so any
// in-gamut triple below regenerates it (each HSL is round-trip-exact to that sRGB).
// Keep the LCH comment on each pole line — it is the source of truth; the HSL is
// derived. `divided` is the exception: it is regenerated from the two poles at load
// (RULE 2, `deriveDivided` below), so it tracks them and is never hand-picked.
//
// TWO RULES — comments here so nobody "fixes" them later:
//   1. `aligned` and `opposed` are matched on PERCEIVED weight ("loudness"), not
//      on equal L and C. They cannot be equal in L and C: `aligned` is a blue and
//      blue is gamut-limited to ~C44 in sRGB, while `opposed` orange reaches far
//      higher — so equal chroma is physically impossible for this pair. Instead
//      `opposed` was darkened/muted until it FEELS as prominent as the gamut-capped
//      blue (both land at the same crude weight ≈ C·0.75 + (100−L)·0.55). The point
//      is unchanged: neither side of a dispute should look more important. Do NOT
//      "rebalance" them to equal C — that would make the blue impossible and re-load
//      the orange. Tune by eye against thin EDGES, not against big swatches.
//   2. `divided` is set apart by LOW CHROMA, not by hue. Blue + orange average to a
//      hue near red (a dusty rose, ~H1); its reduced colourfulness (15 vs ~44/50) is
//      the ONLY thing keeping it from reading as a pole or as a valence of its own.
//      Do NOT raise its chroma. Its slight warmth is intended: it must not twin with
//      the blue, and low chroma keeps it clear of the orange and of `neutral`.
//
// `aligned` at LCH(48, 44, 258) sits just outside the sRGB gamut; its HSL is the
// standard gamut-clamped rendering. The LCH triple stays the source of truth.
//
// Poles are blue / orange on purpose: it is the canonical colour-blind-safe pair
// and the only one that survived rendering at thin-EDGE scale — teal/violet and
// teal/magenta both collapsed toward green/red on 2–3px strokes. `aligned` is a
// pure blue (no green to shift toward); `opposed` a warm orange that reads as a
// team colour, not a hazard, because `aligned` carries the distinction.
const STANCE_ALIGNED = 'hsl(201.5, 100%, 35.5%)'   // LCH(48, 44, 258) — blue (gamut-clamped)
const STANCE_OPPOSED = 'hsl(26.9, 54.5%, 45.7%)'   // LCH(54, 50,  60) — orange, loudness-matched to blue

// `divided` DERIVED from the two poles, never hand-picked (RULE 2): hue is their
// circular midpoint flipped off the green side (so it can never twin with either
// pole and follows them if re-tuned); saturation is crushed to a fraction of the
// poles' — low chroma is the ONLY thing setting it apart — and lightness lifted so
// it recedes. Lands at ~hsl(294, 8%, 62%): the dusty rose the LCH hand-pick used to
// spell out (LCH ~339, "near red"), regenerated as a function of the poles.
function deriveDivided(aligned: string, opposed: string): string {
  const [ha, sa] = aligned.match(/[\d.]+/g)!.map(Number)
  const [ho, so] = opposed.match(/[\d.]+/g)!.map(Number)
  let h = (ha + ho) / 2                              // midpoint of the two pole hues …
  if (Math.abs(h - 120) < 90) h = (h + 180) % 360    // … flipped away from green
  const s = Math.min(sa, so) * 0.15                  // crushed chroma
  const l = 62                                       // lifted to recede
  return `hsl(${h.toFixed(1)}, ${s.toFixed(1)}%, ${l}%)`
}

export const STANCE = {
  aligned: STANCE_ALIGNED,
  opposed: STANCE_OPPOSED,
  divided: deriveDivided(STANCE_ALIGNED, STANCE_OPPOSED),
  neutral: 'none',                      // no fill — outline only (see STANCE_NEUTRAL_STROKE)
} as const

// Neutral stance carries no hue: an outline/stroke-only treatment on a muted
// border, never a fill. Per the spec it needs no colour token beyond this.
export const STANCE_NEUTRAL_STROKE = COLORS.border

// The stance "wash" paints a node with its stance hue: the full-chroma token as
// the stroke, over a pale fill of the same token at this opacity. Matches the
// paper theme's "pale fill, saturated stroke" language and keeps ink text legible.
// (Neutral nodes get no fill — outline only.)
export const STANCE_FILL_OPACITY = 0.18

// The selected/centred node is emphasised, not re-coloured: same stance hue, a
// denser fill and a heavier border, so "you are here" reads at a glance without a
// competing ring.
export const STANCE_SELECTED_FILL_OPACITY = 0.34
export const STANCE_SELECTED_STROKE_BUMP = 1.4

// A container (the inference box interior) washes lighter than a claim, so the
// regular-weight tiles inside it read as sitting on top rather than blending in.
export const STANCE_CONTAINER_FILL_OPACITY = 0.08

// ── Reference root marker ─────────────────────────────────────────────────────
// The reference root is the origin all stance is measured from (a movable viewing
// choice, not a property of the claim). It IS painted — always its ALIGNED valence
// (it is on its own side by definition; `divided` is reserved for nodes whose paths
// reach both sides) — and surrounded by a single strong ink ring so it's
// unmistakable, its whole-box outline reading even at overview zoom.
export const REF_ROOT = {
  ringColor: 'hsl(220, 18%, 26%)',   // ink — legible on paper and over any stance fill
  ringWidth: 2.6,                     // one bold rounded-rect ring around the box
  ringGap:   4.5,                     // gap from the box edge out to the ring
} as const

// ── Layered layout (dagre) ────────────────────────────────────────────────────
// Clarity of relationships is the top priority: every edge must be easy to
// follow and must not run through unrelated nodes. dagre runs the full Sugiyama
// pipeline — cycle-breaking (contests edges can point "up"), layer assignment,
// crossing minimisation, Brandes–Köpf coordinates, and, crucially, EDGE ROUTING
// (dummy nodes give each edge a set of waypoints that steer it around nodes).
// We render edges along those waypoints rather than as straight lines.
//
// Both claims and inference junctions are ranked, so every edge connects
// adjacent ranks and stays short. `ranksep` is generous to leave routing room.
// The layout is wide; that is an accepted cost of legibility.
export const LAYOUT = {
  // Grouped layout: disjoint subtrees are laid out independently (ELK layered,
  // routed edges), then their boxes are rect-packed toward `aspectRatio`, with
  // the root above and one bundled edge per group/role.
  nodeSpacing: 28,      // gap between nodes in a layer (within a group)
  layerSpacing: 46,     // gap between layers (routing room, within a group)
  aspectRatio: 1.6,     // target width/height for the packed group boxes
  groupGap: 50,         // gap between packed group boxes
  rootGap: 90,          // vertical gap between the root and the packed block
  // Initial zoom-to-fit leaves this much of the viewport as margin.
  fitPadding: 0.92,
} as const

// ── Viewport / rendering ──────────────────────────────────────────────────────
export const VIEW = {
  zoomMin: 0.08,
  zoomMax: 5,
  arrowSourcePad: 2,
  arrowTargetPad: 9,
  // Focus-view "show in graph" return: centre the claim at this fixed zoom so
  // just its one or two immediate neighbours frame it (vs the generic back
  // button's wider reveal). Clamped to the zoom extent.
  neighborhoodZoom: 2.0,
} as const

// ── Edge rendering ────────────────────────────────────────────────────────────
export const EDGE = {
  strokeWidthDefault: 1.6,
  strokeWidthWarrants: 1.4,
  opacity: 0.72,
  // SVG stroke-dasharray: 'dash-length, gap-length' (px at scale 1)
  dashWarrants: '5,3',

  // Edge relation mark — concluding vs contesting — carried by GEOMETRY, not
  // colour. A concluding edge is a plain line; a contesting edge is a plain line
  // with a short double tick (two parallel strokes) crossing it near the target
  // end. The tick is colour-independent: it can overlay ANY stance colour, and
  // it stays legible when the line is thin or zoomed out — where a filled-vs-
  // hollow arrowhead would vanish. Do NOT swap this for an arrowhead-fill cue.
  // Built by contestTickForPolyline()/contestTickSegments() in graphData.ts.
  contestTick: {
    count: 2,          // two short parallel strokes
    length: 8,         // full length of each cross-stroke (±4 across the line)
    gap: 4,            // spacing between the two strokes, measured along the edge
    offset: 15,        // distance back from the (padded) target end to the tick centre
    strokeWidth: 1.6,
  },
} as const
