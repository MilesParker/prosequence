import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { DiscourseSpace } from '../../types'
import { COLORS, EDGE, NODE, DISCLOSURE, TITLE_BAR_HEIGHT, VIEW } from '../../config'
import { fitTransform, type LayoutBounds } from '../layout'
import {
  edgeColor, edgeMarkerId,
  nodeFill, nodeStroke,
  nodeHW, nodeHH, isRootClaim, isWarrantClaim,
  rectEdgePt, fitTag,
  type GraphNode, type GraphData, type GraphLink, type ClaimNode, type EdgeRole,
} from '../graphData'

interface Props {
  data: DiscourseSpace
  graphData: GraphData
  bounds: LayoutBounds
  highlight: Set<string>
  onHover: (node: GraphNode | null, x?: number, y?: number) => void
  onSelect: (node: GraphNode | null) => void
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
export function Graph({ data, graphData, bounds, highlight, onHover, onSelect }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)
  const onHoverRef = useRef(onHover)
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onHoverRef.current = onHover }, [onHover])
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
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

    const linkSel = g.append('g').attr('class', 'links')
      .selectAll<SVGPathElement, GraphLink>('path').data(links).join('path')
      .attr('fill', 'none')
      .attr('stroke', d => edgeColor(d.role))
      .attr('stroke-width', d => d.role === 'Warrants' ? EDGE.strokeWidthWarrants : EDGE.strokeWidthDefault)
      .attr('stroke-dasharray', d => d.role === 'Warrants' ? EDGE.dashWarrants : null)
      .attr('stroke-opacity', d => d.uncertain ? EDGE.opacity * 0.6 : EDGE.opacity)
      .attr('marker-end', d => `url(#${edgeMarkerId(d.role)})`)
      .attr('d', d => linkPath(d))

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
      sel.append('rect')
        .attr('x', -hw).attr('y', -hh).attr('width', hw * 2).attr('height', hh * 2).attr('rx', NODE.rx)
        .attr('fill', nodeFill(c)).attr('stroke', nodeStroke(c))
        .attr('stroke-width', isRootClaim(c) ? NODE.rootStrokeWidth : NODE.strokeWidth)
        .attr('stroke-dasharray', isWarrantClaim(c) ? EDGE.dashWarrants : null)
      const lines = fitTag(c.tag || (c.id as unknown as string), hw, hh, isRootClaim(c) ? 10 : 9.5)
      const totalH = (lines.length - 1) * NODE.lineHeight
      sel.append('text')
        .attr('text-anchor', 'middle').attr('fill', '#e8e8e8')
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
      }))

    const fit = fitTransform(bounds, W, H - TITLE_BAR_HEIGHT, VIEW.zoomMin, VIEW.zoomMax)
    svg.call(zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k))

    return () => { svg.on('.zoom', null) }
  }, [data, graphData, bounds])

  // Update the search-highlight rings without rebuilding the scene.
  useEffect(() => {
    nodesRef.current?.each(function (d) {
      if (d._kind !== 'claim') return
      d3.select(this).select('.hl').attr('opacity', highlight.has(d.id as unknown as string) ? 1 : 0)
    })
  }, [highlight])

  return <svg ref={svgRef} style={{ display: 'block' }} />
}
