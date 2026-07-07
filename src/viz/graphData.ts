import type { SimulationNodeDatum, SimulationLinkDatum } from 'd3'
import type { DiscourseSpace, Claim, Inference, Cluster } from '../types'
import { COLORS, NODE } from '../config'

// ── Node types ────────────────────────────────────────────────────────────────
//
// The graph is bipartite: content-bearing Claim nodes and content-free
// Inference junction nodes. Every edge runs claim↔inference.

export type ClaimNode = Claim & {
  _kind: 'claim'
  _isRoot: boolean
  _depth: number
}
export type InfNode = Inference & {
  _kind: 'inference'
  _depth: number
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

  return { nodes, links: cleanLinks, nodeById, incoming, outgoing, maxDepth }
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

function push(m: Map<string, string[]>, k: string, v: string) {
  m.set(k, [...(m.get(k) ?? []), v])
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

export function isRootClaim(n: GraphNode): boolean {
  return n._kind === 'claim' && (n as ClaimNode)._isRoot
}

export function nodeHW(n: GraphNode): number {
  if (n._kind === 'inference') return NODE.infRadius
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
