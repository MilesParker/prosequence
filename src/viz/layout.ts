import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { LAYOUT, NODE } from '../config'
import { nodeHW, nodeHH, type GraphData, type GraphNode, type EdgeRole } from './graphData'

export interface LayoutBounds {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
}

/** A packed subtree box, plus the thesis-edge bundles leaving it. */
export interface GroupBox {
  id: string
  x: number       // top-left
  y: number
  width: number
  height: number
  /** Thesis-directed edges bundled per (thesis, role): one drawn trunk each, fanning
   *  back out to the member nodes inside the group. */
  bundles: Array<{ thesisId: string; role: EdgeRole; count: number; members: string[] }>
}

export interface LayoutResult {
  bounds: LayoutBounds
  groups: GroupBox[]
}

const elk = new ELK()

/**
 * Grouped layout. The corpora share a shape: remove the thesis claim and the
 * graph falls apart into fully disjoint subtrees (verified: zero cross-group
 * edges). So:
 *
 *   1. **Partition** nodes into those components (union–find, theses excluded).
 *   2. **Lay out each group independently** with ELK layered — crossing-minimised,
 *      orthogonally routed edges *within* the group, where all the structure is.
 *   3. **Rect-pack the group boxes** toward a target aspect ratio. Layers exist
 *      only within a group, so one subtree may sit entirely below another —
 *      this is what collapses the width (≈4–5:1 flat → ≈1.3:1 packed).
 *   4. **Thesis on top, bundled edges.** Each group's thesis-directed edges collapse
 *      into one drawn bundle per role (Concludes/Contests) from the group's
 *      border to the thesis; individual inference→thesis edges are not drawn.
 *
 * Writes node centres to `x`/`y` and routed waypoints to `link.points`
 * (thesis-touching links get none — they're represented by bundles).
 */
export async function layoutGraph(gd: GraphData): Promise<LayoutResult> {
  const wOf = (n: GraphNode) => (n._kind === 'claim' ? nodeHW(n) : NODE.infRadius) * 2
  const hOf = (n: GraphNode) => (n._kind === 'claim' ? nodeHH(n) : NODE.infRadius) * 2
  const idOf = (n: GraphNode) => n.id as unknown as string

  const thesisIds = gd.nodes.filter(n => n._kind === 'claim' && (n as { _isThesis?: boolean })._isThesis).map(idOf)
  const theses = new Set(thesisIds)

  // ── 1. Partition into components, theses excluded ────────────────────────────
  const parent = new Map<string, string>()
  const find = (x: string): string => {
    let r = x
    while (parent.get(r) !== r) r = parent.get(r)!
    let c = x
    while (parent.get(c) !== c) { const n = parent.get(c)!; parent.set(c, r); c = n }
    return r
  }
  const union = (a: string, b: string) => { const ra = find(a), rb = find(b); if (ra !== rb) parent.set(ra, rb) }
  for (const n of gd.nodes) { const id = idOf(n); if (!theses.has(id)) parent.set(id, id) }
  for (const l of gd.links) {
    const s = l.source as unknown as string, t = l.target as unknown as string
    if (theses.has(s) || theses.has(t)) continue
    union(s, t)
  }
  const groups = new Map<string, string[]>()
  for (const n of gd.nodes) {
    const id = idOf(n)
    if (theses.has(id)) continue
    const g = find(id)
    ;(groups.get(g) ?? groups.set(g, []).get(g)!).push(id)
  }

  // ── 2. Lay out each group independently ─────────────────────────────────────
  const groupLayouts = await Promise.all([...groups.entries()].map(async ([g, ids]) => {
    const inGroup = new Set(ids)
    const edges = gd.links
      .filter(l => inGroup.has(l.source as unknown as string) && inGroup.has(l.target as unknown as string))
      .map(l => ({ id: l.id, sources: [l.source as unknown as string], targets: [l.target as unknown as string] }))
    const graph: ElkNode = {
      id: g,
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'UP',
        'elk.edgeRouting': 'ORTHOGONAL',
        'elk.spacing.nodeNode': String(LAYOUT.nodeSpacing),
        'elk.layered.spacing.nodeNodeBetweenLayers': String(LAYOUT.layerSpacing),
        'elk.spacing.edgeNode': '16',
      },
      children: ids.map(id => ({ id, width: wOf(gd.nodeById.get(id)!), height: hOf(gd.nodeById.get(id)!) })),
      edges,
    }
    const res = await elk.layout(graph)
    return { g, res }
  }))

  // ── 3. Pack the group boxes toward the target aspect ratio ─────────────────
  const packGraph: ElkNode = {
    id: 'top',
    layoutOptions: {
      'elk.algorithm': 'rectpacking',
      'elk.aspectRatio': String(LAYOUT.aspectRatio),
      'elk.spacing.nodeNode': String(LAYOUT.groupGap),
    },
    children: groupLayouts.map(({ g, res }) => ({ id: g, width: res.width ?? 0, height: res.height ?? 0 })),
  }
  const packed = await elk.layout(packGraph)
  const packPos = new Map((packed.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]))

  // Apply per-group offsets to node centres and edge waypoints.
  const edgePoints = new Map<string, Array<{ x: number; y: number }>>()
  for (const { g, res } of groupLayouts) {
    const off = packPos.get(g) ?? { x: 0, y: 0 }
    for (const c of res.children ?? []) {
      const n = gd.nodeById.get(c.id)!
      n.x = off.x + (c.x ?? 0) + (c.width ?? 0) / 2
      n.y = off.y + (c.y ?? 0) + (c.height ?? 0) / 2
    }
    for (const e of res.edges ?? []) {
      const sec = e.sections?.[0]
      if (sec) edgePoints.set(e.id, [sec.startPoint, ...(sec.bendPoints ?? []), sec.endPoint]
        .map(p => ({ x: p.x + off.x, y: p.y + off.y })))
    }
  }
  for (const l of gd.links) l.points = edgePoints.get(l.id)

  // ── 4. Thesis(s) centred above; bundle thesis-directed edges per (group, role) ──
  const packW = packed.width ?? 0
  const thesisY = -LAYOUT.thesisGap
  thesisIds.forEach((rid, i) => {
    const rn = gd.nodeById.get(rid)!
    rn.x = packW / 2 + (i - (thesisIds.length - 1) / 2) * (nodeHW(rn) * 2 + 60)
    rn.y = thesisY - nodeHH(rn)
  })

  const groupOf = (id: string) => (theses.has(id) ? null : find(id))
  const bundleMembers = new Map<string, string[]>()   // "group|thesis|role" → member node ids
  for (const l of gd.links) {
    const s = l.source as unknown as string, t = l.target as unknown as string
    const thesisEnd = theses.has(t) ? t : theses.has(s) ? s : null
    if (!thesisEnd) continue
    const member = theses.has(t) ? s : t
    const g = groupOf(member)
    if (!g) continue
    const k = `${g}|${thesisEnd}|${l.role}`
    ;(bundleMembers.get(k) ?? bundleMembers.set(k, []).get(k)!).push(member)
  }

  const groupBoxes: GroupBox[] = groupLayouts.map(({ g, res }) => {
    const off = packPos.get(g)!
    const bundles: GroupBox['bundles'] = []
    for (const [k, members] of bundleMembers) {
      const [gg, thesisId, role] = k.split('|')
      if (gg === g) bundles.push({ thesisId, role: role as EdgeRole, count: members.length, members })
    }
    return { id: g, x: off.x, y: off.y, width: res.width ?? 0, height: res.height ?? 0, bundles }
  })

  // ── Bounds over nodes and group boxes ────────────────────────────────────────
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const ext = (x0: number, y0: number, x1: number, y1: number) => {
    if (x0 < minX) minX = x0
    if (y0 < minY) minY = y0
    if (x1 > maxX) maxX = x1
    if (y1 > maxY) maxY = y1
  }
  for (const n of gd.nodes) {
    if (n.x == null || n.y == null) continue
    ext(n.x - wOf(n) / 2, n.y - hOf(n) / 2, n.x + wOf(n) / 2, n.y + hOf(n) / 2)
  }
  for (const b of groupBoxes) ext(b.x, b.y, b.x + b.width, b.y + b.height)
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0 }

  return {
    bounds: { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY },
    groups: groupBoxes,
  }
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
