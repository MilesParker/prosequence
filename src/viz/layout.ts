import dagre from '@dagrejs/dagre'
import { LAYOUT } from '../config'
import { nodeHW, nodeHH, type GraphData, type GraphNode } from './graphData'

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
