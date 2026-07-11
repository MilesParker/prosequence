import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { LAYOUT, NODE } from '../config'
import { nodeHW, nodeHH, type GraphData, type GraphNode } from './graphData'

export interface LayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

const elk = new ELK()

/**
 * Layered layout via ELK (Eclipse Layout Kernel). ELK's layered algorithm both
 * minimises edge crossings and *routes* edges orthogonally around nodes — which
 * is what makes edges legible (a force/stress layout cannot). The cost is a wide
 * aspect ratio: fan-out puts many nodes in one layer, and no static layout avoids
 * that while keeping edges routed — so this is a wide, pannable map.
 *
 * Runs async (ELK returns a promise). Writes node centres to `x`/`y` and routed
 * waypoints to each `link.points`, and returns the graph bounds.
 */
export async function layoutGraph(gd: GraphData): Promise<LayoutBounds> {
  const wOf = (n: GraphNode) => (n._kind === 'claim' ? nodeHW(n) : NODE.infRadius) * 2
  const hOf = (n: GraphNode) => (n._kind === 'claim' ? nodeHH(n) : NODE.infRadius) * 2

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'UP',                       // edge targets above sources → conclusions/roots on top
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.spacing.nodeNode': String(LAYOUT.nodeSpacing),
      'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT.layerSpacing),
      'elk.spacing.edgeNode': '16',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '10',
    },
    children: gd.nodes.map(n => ({ id: String(n.id), width: wOf(n), height: hOf(n) })),
    edges: gd.links.map(l => ({
      id: l.id,
      sources: [l.source as unknown as string],
      targets: [l.target as unknown as string],
    })),
  }

  const res = await elk.layout(graph)

  const byId = new Map((res.children ?? []).map(c => [c.id, c]))
  for (const n of gd.nodes) {
    const c = byId.get(String(n.id))
    if (c) { n.x = (c.x ?? 0) + (c.width ?? 0) / 2; n.y = (c.y ?? 0) + (c.height ?? 0) / 2 }
  }

  const edgeById = new Map((res.edges ?? []).map(e => [e.id, e]))
  for (const l of gd.links) {
    const sec = edgeById.get(l.id)?.sections?.[0]
    l.points = sec
      ? [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint].map(p => ({ x: p.x, y: p.y }))
      : undefined
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const n of gd.nodes) {
    if (n.x == null || n.y == null) continue
    const hw = wOf(n) / 2, hh = hOf(n) / 2
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
