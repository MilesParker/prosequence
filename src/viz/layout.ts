import dagre from '@dagrejs/dagre'
import { LAYOUT, NODE } from '../config'
import { nodeHW, nodeHH, type GraphData, type GraphNode } from './graphData'
import type { InfNode, ClaimNode } from './graphData'

export interface LayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/**
 * Layered layout via dagre, prioritising legibility of relationships. Both
 * claims and inference junctions are ranked, so every edge spans adjacent ranks
 * and stays short. Assigns `x`/`y` (node centres) to every node in place and,
 * critically, stores each edge's routed waypoints on `link.points` so the
 * renderer can steer edges *around* nodes instead of drawing straight lines
 * through them.
 *
 * Edge direction is reversed relative to the data model: grounds run
 * claim→inference→claim (evidence up to a conclusion), so feeding them raw would
 * rank evidence above conclusions. Reversing makes dagre rank a concluded claim
 * above its inference above its grounds — roots on top, evidence sinking down.
 * The captured waypoints are reversed back to data (source→target) order.
 */
export function layoutSugiyama(gd: GraphData): LayoutBounds {
  const idOf = (n: GraphNode) => n.id as unknown as string

  const g = new dagre.graphlib.Graph({ multigraph: true, directed: true })
  g.setGraph({
    rankdir: LAYOUT.rankdir,
    nodesep: LAYOUT.nodesep,
    ranksep: LAYOUT.ranksep,
    edgesep: LAYOUT.edgesep,
    ranker: LAYOUT.ranker,
  })
  g.setDefaultEdgeLabel(() => ({}))

  for (const n of gd.nodes) {
    g.setNode(idOf(n), { width: nodeHW(n) * 2, height: nodeHH(n) * 2 })
  }

  for (const l of gd.links) {
    const src = l.source as unknown as string
    const tgt = l.target as unknown as string
    // Reversed: data target becomes the (higher) dagre source.
    g.setEdge(tgt, src, {}, l.id)
  }

  dagre.layout(g)

  for (const n of gd.nodes) {
    const p = g.node(idOf(n))
    if (p) { n.x = p.x; n.y = p.y }
  }

  // Capture routed waypoints. dagre returns them in dagre-source→dagre-target
  // order (reversed vs. the data edge), so flip back to source→target.
  for (const l of gd.links) {
    const src = l.source as unknown as string
    const tgt = l.target as unknown as string
    const e = g.edge(tgt, src, l.id)
    l.points = e?.points ? e.points.map(p => ({ x: p.x, y: p.y })).reverse() : undefined
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of gd.nodes) {
    if (n.x == null || n.y == null) continue
    const hw = nodeHW(n), hh = nodeHH(n)
    if (n.x - hw < minX) minX = n.x - hw
    if (n.x + hw > maxX) maxX = n.x + hw
    if (n.y - hh < minY) minY = n.y - hh
    if (n.y + hh > maxY) maxY = n.y + hh
  }
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0 }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * Port-mode layout. Inferences are not ranked; the graph is laid out over
 * claims only (which also halves depth vs. the diamond model). Each inference
 * then collapses onto a port on its single target claim's bottom border, and
 * grounds/warrants route up to that port. Undercuts (contests an inference) hang
 * a nub just below the port they attack.
 *
 * Assigns `x`/`y` to claims (dagre) and to inference nubs (port slots), stores
 * routed waypoints on grounds/warrant links, and returns the bounding box.
 */
export function layoutPorts(gd: GraphData): LayoutBounds {
  const idOf = (n: GraphNode) => n.id as unknown as string
  const claims = gd.nodes.filter(n => n._kind === 'claim')
  const claimIds = new Set(claims.map(idOf))

  // Claim an inference ultimately outputs to, following undercuts to bedrock.
  const outputClaim = (infId: string, seen = new Set<string>()): string | null => {
    if (seen.has(infId)) return null
    seen.add(infId)
    const inf = gd.nodeById.get(infId) as InfNode | undefined
    if (!inf || inf._kind !== 'inference') return null
    if (inf.concludes != null) return String(inf.concludes)
    if (inf.contests != null) {
      const t = String(inf.contests)
      return claimIds.has(t) ? t : outputClaim(t, seen)
    }
    return null
  }

  // Widen any claim that hosts more ports than its default width can hold, so
  // its nubs stay flush along the border instead of spilling past it. Done
  // before dagre so the layout reserves the extra width.
  const portCount = new Map<string, number>()
  for (const n of gd.nodes) {
    if (n._kind !== 'inference') continue
    const inf = n as InfNode
    let host: string | null = null
    if (inf.concludes != null && claimIds.has(String(inf.concludes))) host = String(inf.concludes)
    else if (inf.contests != null && claimIds.has(String(inf.contests))) host = String(inf.contests)
    if (host) portCount.set(host, (portCount.get(host) ?? 0) + 1)
  }
  for (const c of claims) {
    const k = portCount.get(idOf(c)) ?? 0
    if (k <= 1) continue
    const need = (k - 1) / 2 * LAYOUT.portGap + NODE.portHalfWidth + LAYOUT.portMargin
    if (need > nodeHW(c)) (c as ClaimNode)._halfWidth = need
  }

  const g = new dagre.graphlib.Graph({ multigraph: true, directed: true })
  g.setGraph({
    rankdir: LAYOUT.rankdir,
    nodesep: LAYOUT.nodesep,
    ranksep: LAYOUT.ranksep,
    edgesep: LAYOUT.edgesep,
    ranker: LAYOUT.ranker,
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of claims) g.setNode(idOf(n), { width: nodeHW(n) * 2, height: nodeHH(n) * 2 })

  // Contract each grounds/warrant link to a claim→claim edge (ground → the
  // inference's output claim), reversed so the conclusion ranks above.
  for (const l of gd.links) {
    if (l.role !== 'Grounds' && l.role !== 'Warrants') continue
    const gClaim = l.source as unknown as string
    const out = outputClaim(l.target as unknown as string)
    if (out == null || !claimIds.has(out) || !claimIds.has(gClaim) || gClaim === out) continue
    g.setEdge(out, gClaim, {}, l.id)
  }

  dagre.layout(g)
  for (const n of claims) { const p = g.node(idOf(n)); if (p) { n.x = p.x; n.y = p.y } }

  // Routed waypoints for grounds/warrant links (ground → out-claim), flipped to
  // source→target order. Endpoints get re-aimed at the port when rendering.
  for (const l of gd.links) {
    if (l.role !== 'Grounds' && l.role !== 'Warrants') continue
    const gClaim = l.source as unknown as string
    const out = outputClaim(l.target as unknown as string)
    if (out == null) { l.points = undefined; continue }
    const e = g.edge(out, gClaim, l.id)
    l.points = e?.points ? e.points.map(p => ({ x: p.x, y: p.y })).reverse() : undefined
  }

  // ── Port slots ───────────────────────────────────────────────────────────────
  const meanGroundX = (node: GraphNode): number => {
    const inf = node as InfNode
    const gs = [...(inf.grounds ?? []), ...(inf.warrants ?? [])]
      .map(id => gd.nodeById.get(String(id)))
      .filter((m): m is GraphNode => !!m && m.x != null)
    return gs.length ? gs.reduce((s, m) => s + (m.x ?? 0), 0) / gs.length : (node.x ?? 0)
  }

  const portsByClaim = new Map<string, string[]>()
  const undercuts: GraphNode[] = []
  for (const n of gd.nodes) {
    if (n._kind !== 'inference') continue
    const inf = n as InfNode
    let host: string | null = null
    if (inf.concludes != null && claimIds.has(String(inf.concludes))) host = String(inf.concludes)
    else if (inf.contests != null && claimIds.has(String(inf.contests))) host = String(inf.contests)
    if (host) (portsByClaim.get(host) ?? portsByClaim.set(host, []).get(host)!).push(idOf(n))
    else undercuts.push(n)
  }

  for (const [claimId, infIds] of portsByClaim) {
    const c = gd.nodeById.get(claimId)!
    infIds.sort((a, b) =>
      (meanGroundX(gd.nodeById.get(a)!) - meanGroundX(gd.nodeById.get(b)!))
      || (a < b ? -1 : 1))
    const n = infIds.length
    const y = (c.y ?? 0) + nodeHH(c)
    infIds.forEach((id, i) => {
      const inf = gd.nodeById.get(id)! as InfNode
      inf.x = (c.x ?? 0) + (i - (n - 1) / 2) * LAYOUT.portGap
      inf.y = y
      inf._hostId = claimId
    })
  }

  // Undercut nubs hang just below the port they contest.
  for (const node of undercuts) {
    const inf = node as InfNode
    const tgt = inf.contests != null ? gd.nodeById.get(String(inf.contests)) : undefined
    if (tgt && tgt.x != null && tgt.y != null) {
      node.x = tgt.x
      node.y = tgt.y + LAYOUT.undercutOffset
      inf._hostId = String(inf.contests)
    } else {
      node.x = meanGroundX(node)
      node.y = 0
    }
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of gd.nodes) {
    if (n.x == null || n.y == null) continue
    const hw = n._kind === 'inference' ? NODE.portRadius : nodeHW(n)
    const hh = n._kind === 'inference' ? NODE.portRadius : nodeHH(n)
    if (n.x - hw < minX) minX = n.x - hw
    if (n.x + hw > maxX) maxX = n.x + hw
    if (n.y - hh < minY) minY = n.y - hh
    if (n.y + hh > maxY) maxY = n.y + hh
  }
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0 }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

/**
 * Zoom transform that fits the laid-out graph into a `vw × vh` viewport,
 * respecting the configured min/max zoom.
 */
export function fitTransform(
  b: LayoutBounds, vw: number, vh: number, zoomMin: number, zoomMax: number,
): { x: number; y: number; k: number } {
  const gw = b.width || 1
  const gh = b.height || 1
  const k = Math.max(zoomMin, Math.min(zoomMax, LAYOUT.fitPadding * Math.min(vw / gw, vh / gh)))
  const cx = (b.minX + b.maxX) / 2
  const cy = (b.minY + b.maxY) / 2
  return { x: vw / 2 - k * cx, y: vh / 2 - k * cy, k }
}
