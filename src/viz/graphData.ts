import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3'
import type { DiscourseSpace, Claim, Inference, Cluster } from '../types'
import { COLORS, NODE, EDGE } from '../config'

// ── Node types ────────────────────────────────────────────────────────────────
//
// The graph is bipartite: content-bearing Claim nodes and content-free
// Inference junction nodes. Every edge runs claim↔inference.

export type ClaimNode = Claim & {
  _kind: 'claim'
  _isRoot: boolean
  _depth: number
  /**
   * Half-width override (set by `layoutPorts`) when a claim carries more ports
   * than its default width can hold, so its nubs never spill past its border.
   */
  _halfWidth?: number
}
export type InfNode = Inference & {
  _kind: 'inference'
  _depth: number
  /**
   * Node this inference's port/nub is anchored to (set by `layoutPorts`): the
   * host claim for a port, or the contested port for an undercut nub. Dragging
   * the host carries its attached nubs along so they never orphan.
   */
  _hostId?: string
}
export type GraphNode = (ClaimNode | InfNode) & SimulationNodeDatum

export type EdgeRole = 'Grounds' | 'Warrants' | 'Concludes' | 'Contests'

export interface GraphLink extends SimulationLinkDatum<GraphNode> {
  id: string
  role: EdgeRole
  /** True when the target is an Inference (an undercut Contests edge). */
  toInference: boolean
  uncertain: boolean
  /** Routing waypoints (source→target order) assigned by the layout engine. */
  points?: Array<{ x: number; y: number }>
}

export interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
  nodeById: Map<string, GraphNode>
  /** Links whose target is this node. */
  incoming: Map<string, GraphLink[]>
  /** Links whose source is this node. */
  outgoing: Map<string, GraphLink[]>
  maxDepth: number
  /** Inferences that conclude a claim (its supports). Keyed by ClaimId. */
  supports: Map<string, Inference[]>
  /** Inferences that contest a claim (its attacks). Keyed by ClaimId. */
  attacks: Map<string, Inference[]>
  /** Inferences that consume a claim as grounds or warrant. Keyed by ClaimId. */
  consumers: Map<string, Inference[]>
}

// ── Build ─────────────────────────────────────────────────────────────────────

export function buildGraphData(ds: DiscourseSpace): GraphData {
  const claims = ds.claims ?? []
  const inferences = ds.inferences ?? []
  const roots = new Set<string>((ds.roots ?? []).map(String))

  const claimIds = new Set(claims.map(c => c.id as unknown as string))
  const infIds = new Set(inferences.map(i => i.id as unknown as string))

  // ── Links ──────────────────────────────────────────────────────────────────
  const links: GraphLink[] = []
  for (const inf of inferences) {
    const infId = inf.id as unknown as string
    for (const g of inf.grounds ?? []) {
      links.push({ id: `${infId}:g:${g}`, source: g as unknown as GraphNode, target: infId as unknown as GraphNode, role: 'Grounds', toInference: true, uncertain: inf.uncertain })
    }
    for (const w of inf.warrants ?? []) {
      links.push({ id: `${infId}:w:${w}`, source: w as unknown as GraphNode, target: infId as unknown as GraphNode, role: 'Warrants', toInference: true, uncertain: inf.uncertain })
    }
    if (inf.concludes) {
      links.push({ id: `${infId}:concludes`, source: infId as unknown as GraphNode, target: inf.concludes as unknown as GraphNode, role: 'Concludes', toInference: false, uncertain: inf.uncertain })
    }
    if (inf.contests) {
      const target = inf.contests as unknown as string
      links.push({ id: `${infId}:contests`, source: infId as unknown as GraphNode, target: target as unknown as GraphNode, role: 'Contests', toInference: infIds.has(target), uncertain: inf.uncertain })
    }
  }

  // ── Depth (BFS from roots, alternating claim/inference layers) ──────────────
  const depth = computeDepth(claims, inferences, roots)
  const computedMax = Math.max(0, ...Array.from(depth.values()))

  // Terminal claims sink to the bottom regardless of computed depth.
  const terminalDepth = computedMax + 1
  const maxDepth = terminalDepth

  // ── Nodes ────────────────────────────────────────────────────────────────────
  const claimNodes: GraphNode[] = claims.map(c => {
    const id = c.id as unknown as string
    const d = c.terminal ? terminalDepth : (depth.get(id) ?? computedMax)
    return { ...c, _kind: 'claim' as const, _isRoot: roots.has(id), _depth: d } as ClaimNode & SimulationNodeDatum
  })
  const infNodes: GraphNode[] = inferences.map(i => {
    const id = i.id as unknown as string
    return { ...i, _kind: 'inference' as const, _depth: depth.get(id) ?? computedMax } as InfNode & SimulationNodeDatum
  })
  const nodes = [...claimNodes, ...infNodes]

  // Drop links that reference nodes outside the space (defensive).
  const known = (id: string) => claimIds.has(id) || infIds.has(id)
  const cleanLinks = links.filter(l => known(l.source as unknown as string) && known(l.target as unknown as string))

  const nodeById = new Map(nodes.map(n => [n.id as unknown as string, n]))
  const incoming = new Map<string, GraphLink[]>(nodes.map(n => [n.id as unknown as string, []]))
  const outgoing = new Map<string, GraphLink[]>(nodes.map(n => [n.id as unknown as string, []]))
  for (const l of cleanLinks) {
    outgoing.get(l.source as unknown as string)?.push(l)
    incoming.get(l.target as unknown as string)?.push(l)
  }

  // ── Focus-view indices (computed once; both views read these, never recompute)
  const supports = new Map<string, Inference[]>()
  const attacks = new Map<string, Inference[]>()
  const consumers = new Map<string, Inference[]>()
  const consumerSeen = new Map<string, Set<string>>()
  for (const inf of inferences) {
    const iid = inf.id as unknown as string
    if (inf.concludes) push(supports, String(inf.concludes), inf)
    // A contest always targets a claim (I8); guard defensively all the same.
    if (inf.contests && claimIds.has(String(inf.contests))) push(attacks, String(inf.contests), inf)
    // Grounds ∪ warrants — dedupe if a claim is both on the same inference.
    for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])].map(String)) {
      let seen = consumerSeen.get(c)
      if (!seen) { seen = new Set(); consumerSeen.set(c, seen) }
      if (seen.has(iid)) continue
      seen.add(iid)
      push(consumers, c, inf)
    }
  }

  return { nodes, links: cleanLinks, nodeById, incoming, outgoing, maxDepth, supports, attacks, consumers }
}

/** BFS depth: roots at 0, then alternating inference/claim layers. */
function computeDepth(claims: Claim[], inferences: Inference[], roots: Set<string>): Map<string, number> {
  // Which inferences output to a given claim (concludes or rebut-contests it).
  const outputsToClaim = new Map<string, string[]>()
  // Which inferences undercut a given inference (contests it).
  const contestersOf = new Map<string, string[]>()
  const inputsOf = new Map<string, string[]>()

  for (const inf of inferences) {
    const infId = inf.id as unknown as string
    inputsOf.set(infId, [...(inf.grounds ?? []), ...(inf.warrants ?? [])].map(String))
    if (inf.concludes) push(outputsToClaim, String(inf.concludes), infId)
    if (inf.contests) {
      const t = String(inf.contests)
      if (inferences.some(i => (i.id as unknown as string) === t)) push(contestersOf, t, infId)
      else push(outputsToClaim, t, infId)
    }
  }

  const depth = new Map<string, number>()
  const queue: string[] = []
  for (const r of roots) { depth.set(r, 0); queue.push(r) }

  const isInf = new Set(inferences.map(i => i.id as unknown as string))

  while (queue.length) {
    const n = queue.shift()!
    const d = depth.get(n)!
    if (isInf.has(n)) {
      for (const c of inputsOf.get(n) ?? []) visit(c, d + 1)
      for (const j of contestersOf.get(n) ?? []) visit(j, d + 1)
    } else {
      for (const inf of outputsToClaim.get(n) ?? []) visit(inf, d + 1)
    }
  }

  // Anything not reached from a root: place just below the deepest reached.
  const fallback = (Math.max(0, ...Array.from(depth.values()))) + 1
  for (const c of claims) { const id = c.id as unknown as string; if (!depth.has(id)) depth.set(id, fallback) }
  for (const i of inferences) { const id = i.id as unknown as string; if (!depth.has(id)) depth.set(id, fallback) }

  return depth

  function visit(id: string, d: number) {
    if (!depth.has(id) || d < depth.get(id)!) { depth.set(id, d); queue.push(id) }
  }
}

function push<T>(m: Map<string, T[]>, k: string, v: T) {
  m.set(k, [...(m.get(k) ?? []), v])
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function isRootClaim(n: GraphNode): boolean {
  return n._kind === 'claim' && (n as ClaimNode)._isRoot
}


export function nodeHW(n: GraphNode): number {
  if (n._kind === 'inference') return NODE.infRadius
  const override = (n as ClaimNode)._halfWidth
  if (override != null) return override
  return isRootClaim(n) ? NODE.rootHalfWidth : NODE.halfWidth
}

export function nodeHH(n: GraphNode): number {
  if (n._kind === 'inference') return NODE.infRadius
  return isRootClaim(n) ? NODE.rootHalfHeight : NODE.halfHeight
}

export function rectEdgePt(
  nx: number, ny: number, tx: number, ty: number,
  n: GraphNode, pad: number
): { x: number; y: number } {
  const hw = nodeHW(n) + pad
  const hh = nodeHH(n) + pad
  const dx = tx - nx, dy = ty - ny
  if (dx === 0 && dy === 0) return { x: nx, y: ny }
  const adx = Math.abs(dx), ady = Math.abs(dy)
  const scale = adx * hh > ady * hw ? hw / adx : hh / ady
  return { x: nx + dx * scale, y: ny + dy * scale }
}

export function wrapTag(tag: string): string[] {
  const words = (tag || '').split(/\s+/).filter(Boolean)
  const lines: string[] = []
  for (let i = 0; i < words.length; i += NODE.wordsPerLine) {
    lines.push(words.slice(i, i + NODE.wordsPerLine).join(' '))
  }
  return lines.length ? lines : ['']
}

/**
 * Wrap `tag` to fit a `hw × hh` (half-width/height) box at `fontSize`, greedily
 * by estimated character width. If it doesn't fit in the available lines, the
 * last line is trimmed at a word boundary and given a trailing ellipsis.
 */
export function fitTag(tag: string, hw: number, hh: number, fontSize: number): string[] {
  const words = (tag || '').split(/\s+/).filter(Boolean)
  if (!words.length) return ['']
  const maxChars = Math.max(3, Math.floor((hw * 2 - 8) / (fontSize * 0.58)))
  const maxLines = Math.max(1, Math.floor((hh * 2 - 6) / NODE.lineHeight))

  const lines: string[] = []
  let cur = ''
  for (const raw of words) {
    const w = raw.length > maxChars ? raw.slice(0, maxChars - 1) + '…' : raw
    if (!cur) cur = w
    else if ((cur + ' ' + w).length <= maxChars) cur += ' ' + w
    else { lines.push(cur); cur = w }
  }
  if (cur) lines.push(cur)
  if (lines.length <= maxLines) return lines

  const kept = lines.slice(0, maxLines)
  let last = kept[maxLines - 1]
  while (last.length + 1 > maxChars && last.includes(' ')) last = last.replace(/\s+\S*$/, '')
  kept[maxLines - 1] = last.replace(/[…\s]*$/, '') + '…'
  return kept
}

// ── Colour helpers ─────────────────────────────────────────────────────────────

export function claimColorKey(n: ClaimNode): keyof typeof COLORS.node {
  if (n._isRoot) return 'root'
  if (n.terminal) return 'terminal'
  if (n.attribution) return 'attributive'
  const c: Cluster = n.cluster
  if (c === 'Pro') return 'pro'
  if (c === 'Anti') return 'anti'
  if (c === 'Analogy') return 'analogy'
  return 'empirical'
}

export function nodeFill(n: GraphNode): string {
  if (n._kind === 'inference') return COLORS.inference.fill
  return COLORS.node[claimColorKey(n as ClaimNode)].fill
}

export function nodeStroke(n: GraphNode): string {
  if (n._kind === 'inference') return COLORS.inference.stroke
  // The outline reflects the claim's own identity (cluster / root / terminal).
  // Its role as grounds vs warrant in a given inference is carried by the edge
  // (solid vs dashed), not painted onto the node — a claim can be a warrant in
  // one inference and grounds in another, so a global override would be lossy.
  return COLORS.node[claimColorKey(n as ClaimNode)].stroke
}

export function edgeColor(role: EdgeRole): string {
  if (role === 'Grounds')  return COLORS.edge.grounds
  if (role === 'Warrants') return COLORS.edge.warrants
  if (role === 'Concludes') return COLORS.edge.concludes
  return COLORS.edge.contests
}

export function edgeMarkerId(role: EdgeRole): string {
  return `arr-${role.toLowerCase()}`
}

// ── Contest tick — the "contesting" relation mark ───────────────────────────────
// A concluding edge is just a plain line; a contesting edge adds a short double
// tick crossing the line near its target end (geometry in EDGE.contestTick). The
// mark is independent of the edge's colour — the two strokes read as "contest"
// whatever hue the line is, and stay legible when the line is thin or zoomed out
// (unlike a filled-vs-hollow arrowhead). These builders return plain line
// segments, so any renderer — the d3 graph, React SVG, or a static sample —
// draws the identical mark from one source of truth. Nothing calls them yet.

export interface TickSeg { x1: number; y1: number; x2: number; y2: number }

/**
 * The double tick as `count` cross-strokes, centred at (cx,cy) and crossing a
 * line whose direction is `angle` (radians). Renderer-agnostic — the caller
 * decides colour and stroke width. This is the primitive; wrappers below place
 * it relative to a concrete edge.
 */
export function contestTickSegments(cx: number, cy: number, angle: number): TickSeg[] {
  const { count, length, gap } = EDGE.contestTick
  const tx = Math.cos(angle), ty = Math.sin(angle)     // unit vector along the edge
  const nx = -Math.sin(angle), ny = Math.cos(angle)    // unit vector across the edge
  const half = length / 2
  const segs: TickSeg[] = []
  for (let k = 0; k < count; k++) {
    const d = (k - (count - 1) / 2) * gap              // stroke offset along the edge
    const ox = cx + tx * d, oy = cy + ty * d
    segs.push({ x1: ox - nx * half, y1: oy - ny * half, x2: ox + nx * half, y2: oy + ny * half })
  }
  return segs
}

/**
 * Place the double tick near the target end of a source→target polyline (the
 * shape the graph's routed edges use). Walks `EDGE.contestTick.offset` back from
 * the final point along the last segment and orients the tick to that segment.
 */
export function contestTickForPolyline(pts: Array<{ x: number; y: number }>): TickSeg[] {
  if (pts.length < 2) return []
  const end = pts[pts.length - 1]
  const prev = pts[pts.length - 2]
  const dx = end.x - prev.x, dy = end.y - prev.y
  const len = Math.hypot(dx, dy) || 1
  const off = Math.min(EDGE.contestTick.offset, len)   // never overshoot a short final segment
  const cx = end.x - (dx / len) * off
  const cy = end.y - (dy / len) * off
  return contestTickSegments(cx, cy, Math.atan2(dy, dx))
}

export type ChipKind = keyof typeof COLORS.chip

export function claimChipKind(n: ClaimNode): ChipKind {
  return claimColorKey(n) as ChipKind
}

export function sourceLabel(src: { type: string; reference?: string } | undefined): string {
  if (!src) return 'unknown'
  if (src.reference) return `${src.type} — ${src.reference}`
  return src.type
}

export function nodeMainText(n: GraphNode): string {
  if (n._kind === 'inference') {
    const inf = n as InfNode
    return inf.concludes ? 'inference → concludes' : 'inference → contests'
  }
  return (n as ClaimNode).text ?? ''
}
