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
  highlightStroke: 'hsl(35, 95%, 48%)',   // amber — reads on the paper ground
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
  meta:  14,   // ids, quotes, list rows, grounds/warrants, notes
  label: 12,   // uppercase section labels
  chip:  13,   // property chips
  badge: 12,   // relation badges
  close: 24,   // × close button
} as const

// ── Focus view (band-stack surface) ───────────────────────────────────────────
// The focus view centres one claim and stacks parent band / focus band /
// For+Against columns. Layout tokens live here alongside the graph's.
export const FOCUS = {
  columnMaxWidth: 860,   // max width of the centred stack
  rowFont: 14.5,         // claim-row text
  focusFont: 19,         // centred claim text
  labelFont: 11,         // uppercase role labels, pager, bedrock badge
  pipSize: 8,            // §4 pip diameter
  pipGap: 5,
  connector: 22,         // vertical rule between bands
  cellRadius: 8,
  bracketWidth: 2,       // warrant bracket rule

  // Parent band: two fixed columns (Supports/Contests), role-bucketed, never
  // pages — sizes to content (max 4 tiles in the corpora), so no reserved height.
  parentColGap: 16,        // Supports/Contests gap (mirrors the For/Against gap)

  // "Came from" trace: the claim you navigated from wears this ring/wash while
  // the focus-band icon is engaged. Amber matches the graph's search highlight.
  fromRing: 'hsl(35, 95%, 48%)',
  fromTint: 'hsla(35, 95%, 48%, 0.13)',

  // Reserved heights that keep the landscape from shifting as you refocus
  // (best-guess maxima; tiles scroll internally on the rare overflow).
  focusMinHeight: 120,     // focus band floor (~3 lines)
  columnHeight: 360,       // For/Against: equal fixed height
  pagerHeight: 26,         // always reserved so paging never shifts the cell
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
// cluster hues are necessarily less punchy here than on the old dark ground —
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
  textLabel:   'hsl(220, 12%, 40%)',
  textCode:    'hsl(220, 12%, 45%)',

  // Claim nodes — coloured by role/cluster. Pale fills, saturated strokes.
  node: {
    root:        { fill: 'hsl(212, 90%, 95%)', stroke: 'hsl(212, 68%, 48%)' },
    terminal:    { fill: 'hsl(45, 92%, 90%)',  stroke: 'hsl(36, 76%, 44%)'  },
    pro:         { fill: 'hsl(131, 48%, 93%)', stroke: 'hsl(140, 44%, 36%)' },
    anti:        { fill: 'hsl(2, 72%, 95%)',   stroke: 'hsl(2, 58%, 50%)'   },
    empirical:   { fill: 'hsl(205, 40%, 94%)', stroke: 'hsl(205, 30%, 42%)' },
    analogy:     { fill: 'hsl(280, 45%, 95%)', stroke: 'hsl(282, 38%, 52%)' },
    attributive: { fill: 'hsl(210, 18%, 94%)', stroke: 'hsl(210, 12%, 46%)' },
  },

  // Inference junction marks — subordinate wiring.
  inference: { fill: 'hsl(230, 16%, 90%)', stroke: 'hsl(230, 12%, 55%)' },

  // Four edge roles, each distinct.
  edge: {
    grounds:   'hsl(205, 38%, 46%)',   // steel — evidence into an inference
    warrants:  'hsl(205, 38%, 46%)',   // steel (dashed) — an inference input like
                                       // grounds; the dash marks it a bridging
                                       // assumption. Green is reserved for Concludes.
    concludes: 'hsl(140, 46%, 38%)',   // green — was Support
    contests:  'hsl(2, 62%, 50%)',     // red — was Attack
  },

  // Role badges (kept for token parity; the detail panel is retired).
  rel: {
    grounds:   { bg: 'hsl(205, 40%, 92%)', color: 'hsl(205, 45%, 34%)' },
    warrants:  { bg: 'hsl(205, 40%, 92%)', color: 'hsl(205, 45%, 34%)' },
    concludes: { bg: 'hsl(140, 45%, 91%)', color: 'hsl(140, 48%, 28%)' },
    contests:  { bg: 'hsl(2, 60%, 93%)',   color: 'hsl(2, 58%, 42%)'   },
  },

  // Cluster / kind chips in tooltips.
  chip: {
    default:     { bg: 'hsl(40, 16%, 91%)',  color: 'hsl(220, 10%, 40%)' },
    pro:         { bg: 'hsl(131, 44%, 90%)', color: 'hsl(140, 46%, 28%)' },
    anti:        { bg: 'hsl(2, 62%, 93%)',   color: 'hsl(2, 56%, 42%)'   },
    empirical:   { bg: 'hsl(205, 38%, 92%)', color: 'hsl(205, 32%, 36%)' },
    analogy:     { bg: 'hsl(280, 40%, 93%)', color: 'hsl(282, 38%, 42%)' },
    root:        { bg: 'hsl(212, 80%, 92%)', color: 'hsl(212, 64%, 38%)' },
    terminal:    { bg: 'hsl(45, 88%, 86%)',  color: 'hsl(34, 72%, 34%)'  },
    attributive: { bg: 'hsl(210, 18%, 92%)', color: 'hsl(210, 14%, 38%)' },
    inference:   { bg: 'hsl(230, 16%, 90%)', color: 'hsl(230, 14%, 40%)' },
  },

  // Focus-view pip fills (§4). Presence markers only — teal = supported,
  // coral = contested. Shared token so both views read one source.
  pip: {
    supported: '#1D9E75',
    contested: '#D85A30',
  },

  // For / Against column tint families (focus view). Green = For (concludes
  // family), coral = Against (contests family). Column-derived, not content-.
  column: {
    for:     { tint: 'hsl(140, 46%, 40%)', bg: 'hsl(131, 46%, 96%)', border: 'hsl(131, 34%, 82%)', label: 'hsl(140, 46%, 32%)' },
    against: { tint: 'hsl(2, 62%, 52%)',   bg: 'hsl(2, 66%, 97%)',   border: 'hsl(2, 52%, 86%)',   label: 'hsl(2, 56%, 44%)' },
  },
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
} as const
