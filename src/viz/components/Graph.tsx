import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { DiscourseSpace } from '../../types'
import { COLORS, EDGE, NODE, DISCLOSURE, TITLE_BAR_HEIGHT, VIEW } from '../../config'
import { fitTransform, type LayoutBounds, type GroupBox } from '../layout'
import {
  edgeColor, edgeMarkerId,
  nodeFill, nodeStroke,
  nodeHW, nodeHH, isRootClaim,
  rectEdgePt, fitTag,
  type GraphNode, type GraphData, type GraphLink, type ClaimNode, type EdgeRole,
} from '../graphData'

interface Props {
  data: DiscourseSpace
  graphData: GraphData
  bounds: LayoutBounds
  groups: GroupBox[]
  highlight: Set<string>
  /** Claim to reveal on mount — the shared selection, centred when swapping in. */
  centerOn?: string | null
  /** How to frame `centerOn` on mount: 'reveal' pans it in at a moderate zoom;
   *  'neighborhood' zooms tight on its immediate surroundings (return icon). */
  centerMode?: 'reveal' | 'neighborhood'
  /** Currently-selected claim id — draws a persistent ring (updates live). */
  selectedId?: string | null
  onHover: (node: GraphNode | null, x?: number, y?: number) => void
  onSelect: (node: GraphNode | null) => void
  /** Double-click a claim to open it in the focus view. */
  onActivate?: (node: GraphNode) => void
}

const ROLES: EdgeRole[] = ['Grounds', 'Warrants', 'Concludes', 'Contests']

/** Clip an edge endpoint to a node's outline: circle for inferences, rect for claims. */
function clipToNode(node: GraphNode, fx: number, fy: number, tx: number, ty: number, pad: number) {
  if (node._kind === 'inference') {
    const r = NODE.infRadius + pad
    const dx = tx - fx, dy = ty - fy
    const len = Math.hypot(dx, dy) || 1
    return { x: fx + (dx / len) * r, y: fy + (dy / len) * r }
  }
  return rectEdgePt(fx, fy, tx, ty, node, pad)
}

type NodeSel = d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>

/**
 * Static argument map: every claim is a box, every inference a junction circle,
 * every edge drawn. Positions come from `masterLayout` and are frozen. The only
 * interactions are pan/zoom, hover, click-to-select, drag-to-nudge, and search
 * highlight — no disclosure.
 */
export function Graph({ data, graphData, bounds, groups, highlight, centerOn, centerMode, selectedId, onHover, onSelect, onActivate }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  const onActivateRef = useRef(onActivate)
  useEffect(() => { onHoverRef.current = onHover }, [onHover])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
  useEffect(() => { onActivateRef.current = onActivate }, [onActivate])
  // Read only at mount (in the scene-build effect); a change mid-view must not
  // yank the viewport / rebuild the scene, so these stay out of that effect's deps.
  const centerOnRef = useRef(centerOn)
  useEffect(() => { centerOnRef.current = centerOn }, [centerOn])
  const centerModeRef = useRef(centerMode)
  useEffect(() => { centerModeRef.current = centerMode }, [centerMode])
  const selectedIdRef = useRef(selectedId)
  useEffect(() => { selectedIdRef.current = selectedId }, [selectedId])
  const nodesRef = useRef<NodeSel | null>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const W = window.innerWidth
    const H = window.innerHeight
    const gd = graphData
    const { nodes, links } = gd

    const svg = d3.select(el).attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    const defs = svg.append('defs')
    ROLES.forEach(role => {
      defs.append('marker').attr('id', edgeMarkerId(role))
        .attr('viewBox', '0 -5 10 10').attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', edgeColor(role)).attr('opacity', 0.9)
    })

    const g = svg.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([VIEW.zoomMin, VIEW.zoomMax])
      .on('zoom', e => g.attr('transform',
        `translate(${e.transform.x},${e.transform.y + TITLE_BAR_HEIGHT}) scale(${e.transform.k})`))
    svg.call(zoom)
    svg.on('dblclick.zoom', null)   // double-click is reserved for open-in-focus

    // ── Group boxes (behind everything) ───────────────────────────────────────
    g.append('g').attr('class', 'groups')
      .selectAll('rect').data(groups).join('rect')
      .attr('x', b => b.x - 12).attr('y', b => b.y - 12)
      .attr('width', b => b.width + 24).attr('height', b => b.height + 24)
      .attr('rx', 10)
      .attr('fill', COLORS.borderFaint).attr('fill-opacity', 0.35)
      .attr('stroke', COLORS.border).attr('stroke-width', 1)

    // ── Edges ────────────────────────────────────────────────────────────────
    const lineGen = d3.line<{ x: number; y: number }>().x(p => p.x).y(p => p.y).curve(d3.curveLinear)
    const linkPath = (l: GraphLink): string | null => {
      const sN = gd.nodeById.get(l.source as unknown as string)
      const tN = gd.nodeById.get(l.target as unknown as string)
      if (!sN || !tN || sN.x == null || sN.y == null || tN.x == null || tN.y == null) return null
      const pts = (l.points && l.points.length >= 2)
        ? l.points.map(p => ({ x: p.x, y: p.y }))
        : [{ x: sN.x, y: sN.y }, { x: tN.x, y: tN.y }]
      const a = pts[1]; pts[0] = clipToNode(sN, sN.x, sN.y, a.x, a.y, VIEW.arrowSourcePad)
      const b = pts[pts.length - 2]; pts[pts.length - 1] = clipToNode(tN, tN.x, tN.y, b.x, b.y, VIEW.arrowTargetPad)
      return lineGen(pts)
    }

    // Root-directed edges are not drawn individually — each group's are bundled
    // into one line per role (drawn below).
    const isRoot = (id: string) => {
      const n = gd.nodeById.get(id)
      return !!n && n._kind === 'claim' && (n as ClaimNode)._isRoot
    }
    const innerLinks = links.filter(l =>
      !isRoot(l.source as unknown as string) && !isRoot(l.target as unknown as string))

    const linkSel = g.append('g').attr('class', 'links')
      .selectAll<SVGPathElement, GraphLink>('path').data(innerLinks).join('path')
      .attr('fill', 'none')
      .attr('stroke', d => edgeColor(d.role))
      .attr('stroke-width', d => d.role === 'Warrants' ? EDGE.strokeWidthWarrants : EDGE.strokeWidthDefault)
      .attr('stroke-dasharray', d => d.role === 'Warrants' ? EDGE.dashWarrants : null)
      .attr('stroke-opacity', d => d.uncertain ? EDGE.opacity * 0.6 : EDGE.opacity)
      .attr('marker-end', d => `url(#${edgeMarkerId(d.role)})`)
      .attr('d', d => linkPath(d))

    // ── Bundled root edges ─────────────────────────────────────────────────────
    // Each group's root-directed edges merge into one trunk per role, but for
    // continuity the trunk fans back out at the group border: a thin branch runs
    // from every member inference up to the bundle's exit point, so each edge is
    // individually traceable end-to-end.
    interface Bundle { box: GroupBox; rootId: string; role: EdgeRole; count: number; members: string[]; idx: number; total: number }
    const bundles: Bundle[] = groups.flatMap(box =>
      box.bundles.map((b, idx) => ({ box, ...b, idx, total: box.bundles.length })))
    const exitPt = (b: Bundle) => ({
      // on the group's top border, fanned when a group has several bundles
      x: b.box.x + b.box.width / 2 + (b.idx - (b.total - 1) / 2) * 26,
      y: b.box.y - 12,
    })
    const trunkPath = (b: Bundle): string => {
      const root = gd.nodeById.get(b.rootId)
      const { x: bx, y: by } = exitPt(b)
      const rx = root?.x ?? 0
      const ry = (root?.y ?? 0) + (root ? nodeHH(root) : 0) + VIEW.arrowTargetPad
      const my = Math.min(by, ry) - 40   // bow upward between the two
      return `M${bx},${by} C${bx},${my} ${rx},${my} ${rx},${ry}`
    }
    interface Branch { bundle: Bundle; member: string }
    const branches: Branch[] = bundles.flatMap(bundle => bundle.members.map(member => ({ bundle, member })))
    const branchPath = (br: Branch): string | null => {
      const n = gd.nodeById.get(br.member)
      if (!n || n.x == null || n.y == null) return null
      const { x: bx, y: by } = exitPt(br.bundle)
      const s = clipToNode(n, n.x, n.y, bx, by, VIEW.arrowSourcePad)
      const dy = Math.max(1, s.y - by)
      return `M${s.x},${s.y} C${s.x},${s.y - dy * 0.6} ${bx},${by + dy * 0.4} ${bx},${by}`
    }
    const branchSel = g.append('g').attr('class', 'bundle-branches')
      .selectAll<SVGPathElement, Branch>('path').data(branches).join('path')
      .attr('fill', 'none')
      .attr('stroke', br => edgeColor(br.bundle.role))
      .attr('stroke-width', EDGE.strokeWidthDefault)
      .attr('stroke-opacity', EDGE.opacity * 0.8)
      .attr('d', br => branchPath(br))
    const bundleSel = g.append('g').attr('class', 'bundles')
      .selectAll<SVGPathElement, Bundle>('path').data(bundles).join('path')
      .attr('fill', 'none')
      .attr('stroke', b => edgeColor(b.role))
      .attr('stroke-width', b => Math.min(6, 1.4 + b.count * 0.6))
      .attr('stroke-opacity', EDGE.opacity)
      .attr('marker-end', b => `url(#${edgeMarkerId(b.role)})`)
      .attr('d', b => trunkPath(b))

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeSel = g.append('g').attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g').data(nodes).join('g')
      .attr('class', 'node').attr('cursor', 'pointer')
      .attr('transform', d => `translate(${d.x ?? 0},${d.y ?? 0})`)
      .attr('opacity', d => d.uncertain ? 0.6 : 1) as NodeSel
    nodesRef.current = nodeSel

    nodeSel.each(function (d) {
      const sel = d3.select(this)
      if (d._kind === 'inference') {
        sel.append('circle').attr('r', NODE.infRadius)
          .attr('fill', nodeFill(d)).attr('stroke', nodeStroke(d)).attr('stroke-width', 1.25)
        return
      }
      const c = d as ClaimNode
      const hw = nodeHW(c), hh = nodeHH(c)
      sel.append('rect').attr('class', 'hl')          // search-highlight ring (hidden by default)
        .attr('x', -hw - 3).attr('y', -hh - 3).attr('width', hw * 2 + 6).attr('height', hh * 2 + 6)
        .attr('rx', NODE.rx + 2).attr('fill', 'none')
        .attr('stroke', DISCLOSURE.highlightStroke).attr('stroke-width', DISCLOSURE.highlightWidth)
        .attr('opacity', highlight.has(d.id as unknown as string) ? 1 : 0)
      sel.append('rect').attr('class', 'sel')         // persistent selection ring (hidden by default)
        .attr('x', -hw - 4).attr('y', -hh - 4).attr('width', hw * 2 + 8).attr('height', hh * 2 + 8)
        .attr('rx', NODE.rx + 3).attr('fill', 'none')
        .attr('stroke', DISCLOSURE.selectionStroke).attr('stroke-width', DISCLOSURE.selectionWidth)
        .attr('opacity', selectedIdRef.current === (d.id as unknown as string) ? 1 : 0)
      sel.append('rect')
        .attr('x', -hw).attr('y', -hh).attr('width', hw * 2).attr('height', hh * 2).attr('rx', NODE.rx)
        .attr('fill', nodeFill(c)).attr('stroke', nodeStroke(c))
        .attr('stroke-width', isRootClaim(c) ? NODE.rootStrokeWidth : NODE.strokeWidth)
      const lines = fitTag(c.tag || (c.id as unknown as string), hw, hh, isRootClaim(c) ? 10 : 9.5)
      const totalH = (lines.length - 1) * NODE.lineHeight
      sel.append('text')
        .attr('text-anchor', 'middle').attr('fill', COLORS.text)
        .attr('font-size', isRootClaim(c) ? '10px' : '9.5px')
        .attr('font-family', 'system-ui, sans-serif').attr('pointer-events', 'none')
        .attr('font-weight', isRootClaim(c) ? '600' : '400')
        .selectAll('tspan').data(lines).join('tspan')
        .attr('x', 0).attr('dy', (_, i) => i === 0 ? `${-totalH / 2}px` : `${NODE.lineHeight}px`)
        .attr('dominant-baseline', 'middle').text(t => t)
    })

    // ── Interaction ────────────────────────────────────────────────────────────
    nodeSel
      .on('mouseover', (e: MouseEvent, d) => onHoverRef.current(d, e.clientX, e.clientY))
      .on('mousemove', (e: MouseEvent, d) => onHoverRef.current(d, e.clientX, e.clientY))
      .on('mouseout', () => onHoverRef.current(null))
      .on('click', (e: MouseEvent, d) => { e.stopPropagation(); onSelectRef.current(d) })
      .on('dblclick', (e: MouseEvent, d) => { e.stopPropagation(); if (d._kind === 'claim') onActivateRef.current?.(d) })
    svg.on('click', () => onSelectRef.current(null))

    // Drag to nudge a node; re-clip only its incident edges.
    nodeSel.call(d3.drag<SVGGElement, GraphNode>()
      .on('start', () => onHoverRef.current(null))
      .on('drag', function (event, d) {
        d.x = event.x; d.y = event.y
        d3.select(this).attr('transform', `translate(${d.x},${d.y})`)
        const id = d.id as unknown as string
        linkSel.each(function (l) {
          if ((l.source as unknown as string) === id || (l.target as unknown as string) === id) {
            l.points = undefined   // drop ELK routing so the edge follows the node
            const p = linkPath(l); if (p) d3.select(this).attr('d', p)
          }
        })
        if (isRoot(id)) bundleSel.attr('d', b => trunkPath(b))
        branchSel.filter(br => br.member === id).attr('d', br => branchPath(br))
      }))

    // On a fresh mount, honour a pending selection: swapping in from the focus
    // view must reveal that claim's position (§9a-1), not just fit the whole map.
    const fit = fitTransform(bounds, W, H - TITLE_BAR_HEIGHT, VIEW.zoomMin, VIEW.zoomMax)
    const target = centerOnRef.current ? gd.nodeById.get(centerOnRef.current) : null
    if (target && target.x != null && target.y != null) {
      let k: number
      if (centerModeRef.current === 'neighborhood') {
        // Return-from-focus: centre the claim at a fixed tight zoom so only its
        // one or two immediate neighbours frame it.
        k = Math.min(VIEW.zoomMax, Math.max(VIEW.zoomMin, VIEW.neighborhoodZoom))
      } else {
        k = Math.max(fit.k, Math.min(VIEW.zoomMax, 0.55))
      }
      const tx = W / 2 - k * target.x
      const ty = (H - TITLE_BAR_HEIGHT) / 2 - k * target.y
      svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k))
    } else {
      svg.call(zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k))
    }

    return () => { svg.on('.zoom', null) }
  }, [data, graphData, bounds])

  // Update the search-highlight rings without rebuilding the scene.
  useEffect(() => {
    nodesRef.current?.each(function (d) {
      if (d._kind !== 'claim') return
      d3.select(this).select('.hl').attr('opacity', highlight.has(d.id as unknown as string) ? 1 : 0)
    })
  }, [highlight])

  // Update the persistent selection ring without rebuilding the scene.
  useEffect(() => {
    nodesRef.current?.each(function (d) {
      if (d._kind !== 'claim') return
      d3.select(this).select('.sel').attr('opacity', selectedId === (d.id as unknown as string) ? 1 : 0)
    })
  }, [selectedId])

  return <svg ref={svgRef} style={{ display: 'block' }} />
}
