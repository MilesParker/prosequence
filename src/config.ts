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

// ── Inference rendering mode ──────────────────────────────────────────────────
// 'diamond' — inferences are free-floating junction nodes (original).
// 'port'    — an inference has exactly one target (invariant 1), so it collapses
//             to a coloured port (nub) on that target claim's border; grounds and
//             warrants attach to the port and the concludes/contests edge is
//             implicit. Layout is claims-only (no inference ranks). Undercuts
//             (contests an inference) hang a nub off the contested port.
export const INFERENCE_RENDER: 'diamond' | 'port' = 'port'

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
  meta:  14,   // ids, quotes, list rows, grounds/warrants, hints
  label: 12,   // uppercase section labels
  chip:  13,   // property chips
  badge: 12,   // relation badges
  close: 24,   // × close button
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
  // Inference junction marks are small and visually subordinate — wiring,
  // not peers. Rendered as a small diamond of this half-diagonal.
  infRadius: 7,
  // Port mode: the nub drawn on a claim's border. A half-disc whose flat
  // diameter sits flush on the claim's bottom edge and whose curve bulges
  // below — so it reads as fused to its host claim, not a dot floating beside
  // it. Grounds/warrants converge on the nub.
  portRadius: 10,     // half-extent used for layout bounds and edge clipping
  portHalfWidth: 10,  // half-width of the diameter (along the border)
  portHeight: 15,     // how far the curve bulges below the border
} as const

// ── Color palette (all values in HSL) ────────────────────────────────────────
export const COLORS = {
  background:  'hsl(225, 21%, 7%)',
  surface:     'hsla(228, 33%, 6%, 0.98)',
  surfaceBlur: 'hsla(228, 33%, 6%, 0.92)',
  border:      'hsl(234, 23%, 15%)',
  borderFaint: 'hsl(230, 23%, 10%)',
  text:        'hsl(0, 0%, 88%)',
  textMuted:   'hsl(0, 0%, 73%)',
  textFaint:   'hsl(0, 0%, 40%)',
  textDim:     'hsl(0, 0%, 33%)',
  textDimmer:  'hsl(0, 0%, 27%)',
  textLabel:   'hsl(0, 0%, 67%)',
  textCode:    'hsl(0, 0%, 40%)',

  // Claim nodes — coloured by role/cluster.
  node: {
    root:        { fill: 'hsla(212, 80%, 42%, 0.18)', stroke: 'hsl(212, 75%, 64%)' },
    terminal:    { fill: 'hsla(37, 95%, 56%, 0.15)',  stroke: 'hsl(45, 100%, 76%)' },
    pro:         { fill: 'hsla(131, 40%, 34%, 0.20)', stroke: 'hsl(123, 38%, 57%)' },
    anti:        { fill: 'hsla(0, 45%, 40%, 0.18)',   stroke: 'hsl(0, 60%, 70%)'   },
    empirical:   { fill: 'hsla(199, 18%, 40%, 0.18)', stroke: 'hsl(200, 16%, 62%)' },
    analogy:     { fill: 'hsla(280, 30%, 45%, 0.18)', stroke: 'hsl(285, 40%, 70%)' },
    attributive: { fill: 'hsla(210, 12%, 30%, 0.16)', stroke: 'hsl(210, 12%, 50%)' },
  },

  // Inference junction marks — subordinate wiring.
  inference: { fill: 'hsl(232, 20%, 20%)', stroke: 'hsl(232, 18%, 46%)' },

  // Four edge roles, each distinct.
  edge: {
    grounds:   'hsl(205, 30%, 55%)',   // steel — evidence into an inference
    warrants:  'hsl(205, 30%, 55%)',   // steel (dashed) — an inference input like
                                       // grounds; the dash marks it a bridging
                                       // assumption. Green is reserved for Concludes.
    concludes: 'hsl(122, 39%, 49%)',   // green — was Support
    contests:  'hsl(1, 77%, 55%)',     // red — was Attack
  },

  // Role badges in the detail panel.
  rel: {
    grounds:   { bg: 'hsl(205, 30%, 16%)', color: 'hsl(205, 40%, 62%)' },
    warrants:  { bg: 'hsl(205, 30%, 16%)', color: 'hsl(205, 40%, 62%)' },
    concludes: { bg: 'hsl(143, 44%, 14%)', color: 'hsl(122, 39%, 55%)' },
    contests:  { bg: 'hsl(0, 43%, 14%)',   color: 'hsl(1, 77%, 62%)'   },
  },

  // Cluster / kind chips in tooltips + panel.
  chip: {
    default:     { bg: 'hsl(234, 23%, 15%)', color: 'hsl(0, 0%, 53%)'    },
    pro:         { bg: 'hsl(131, 33%, 16%)', color: 'hsl(123, 38%, 57%)' },
    anti:        { bg: 'hsl(0, 39%, 17%)',   color: 'hsl(0, 73%, 77%)'   },
    empirical:   { bg: 'hsl(219, 30%, 17%)', color: 'hsl(200, 15%, 54%)' },
    analogy:     { bg: 'hsl(280, 30%, 20%)', color: 'hsl(285, 47%, 74%)' },
    root:        { bg: 'hsl(218, 76%, 21%)', color: 'hsl(207, 90%, 77%)' },
    terminal:    { bg: 'hsl(47, 100%, 12%)', color: 'hsl(48, 100%, 50%)' },
    attributive: { bg: 'hsl(210, 14%, 18%)', color: 'hsl(210, 14%, 62%)' },
    inference:   { bg: 'hsl(232, 20%, 18%)', color: 'hsl(232, 22%, 64%)' },
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
  rankdir: 'TB' as const,   // roots at top, evidence flowing down
  nodesep: 45,              // px gap between nodes within a rank
  ranksep: 90,              // px gap between ranks (routing room)
  edgesep: 28,              // px gap between edges (routing room)
  ranker: 'network-simplex' as const,
  // Port mode: spacing between adjacent nubs along a claim's border, and how far
  // an undercut nub hangs off the port it contests. When a claim has more ports
  // than fit within its default width, it is widened to hold them (+ portMargin
  // of clearance on each side).
  portGap: 26,
  portMargin: 8,
  undercutOffset: 30,
  // Initial zoom-to-fit leaves this much of the viewport as margin.
  fitPadding: 0.92,
} as const

// ── Viewport / rendering ──────────────────────────────────────────────────────
export const VIEW = {
  zoomMin: 0.08,
  zoomMax: 5,
  arrowSourcePad: 2,
  arrowTargetPad: 9,
} as const

// ── Edge rendering ────────────────────────────────────────────────────────────
export const EDGE = {
  strokeWidthDefault: 1.6,
  strokeWidthWarrants: 1.4,
  opacity: 0.72,
  // SVG stroke-dasharray: 'dash-length, gap-length' (px at scale 1)
  dashWarrants: '5,3',
} as const
