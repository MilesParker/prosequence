import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { DiscourseSpace } from '../../types'
import { COLORS, EDGE, NODE, TITLE_BAR_HEIGHT, VIEW, INFERENCE_RENDER } from '../../config'
import { layoutSugiyama, layoutPorts, fitTransform } from '../layout'
import {
  buildGraphData,
  edgeColor, edgeMarkerId,
  nodeFill, nodeStroke,
  nodeHW, nodeHH, isRootClaim, isWarrantClaim,
  rectEdgePt, wrapTag,
  type GraphNode, type GraphLink, type EdgeRole,
} from '../graphData'

interface Props {
  data: DiscourseSpace
  onHover: (node: GraphNode | null, x?: number, y?: number) => void
  onClick: (node: GraphNode | null) => void
}

const ROLES: EdgeRole[] = ['Grounds', 'Warrants', 'Concludes', 'Contests']

function diamondPath(r: number): string {
  return `M0,${-r}L${r},0L0,${r}L${-r},0Z`
}

// Port nub: a half-disc whose flat diameter sits flush on the claim's bottom
// border (local y = 0) and whose curve bulges `height` below it — fused to the
// claim rather than floating beside it.
function portPath(halfWidth: number, height: number): string {
  return `M${-halfWidth},0 A${halfWidth},${height} 0 0 0 ${halfWidth},0 Z`
}

export function Graph({ data, onHover, onClick }: Props) {
  const svgRef = useRef<SVGSVGElement>(null)

  const onHoverRef = useRef(onHover)
  const onClickRef = useRef(onClick)
  useEffect(() => { onHoverRef.current = onHover }, [onHover])
  useEffect(() => { onClickRef.current = onClick }, [onClick])

  useEffect(() => {
    const el = svgRef.current
    if (!el) return

    const W = window.innerWidth
    const H = window.innerHeight

    const gd = buildGraphData(data)
    const { nodes, links } = gd
    const ports = INFERENCE_RENDER === 'port'

    // ── Layered layout (dagre). Positions are fixed; no force simulation. ─────
    const bounds = ports ? layoutPorts(gd) : layoutSugiyama(gd)

    // Incident-link index, so a drag only re-clips the affected edges.
    // Built from the raw string endpoints before we resolve them below.
    const incident = new Map<string, GraphLink[]>(nodes.map(n => [n.id as unknown as string, []]))
    for (const l of links) {
      incident.get(l.source as unknown as string)?.push(l)
      incident.get(l.target as unknown as string)?.push(l)
    }

    // Host → attached nubs, so a claim drag carries its ports (and their
    // undercut nubs) with it instead of orphaning them. Positions are anchored
    // relative to the host by the layout, so we translate children by the same
    // delta rather than re-deriving offsets.
    const childrenOf = new Map<string, GraphNode[]>()
    for (const n of nodes) {
      const host = n._kind === 'inference' ? n._hostId : undefined
      if (host == null) continue
      ;(childrenOf.get(host) ?? childrenOf.set(host, []).get(host)!).push(n)
    }
    // All nubs anchored to `id`, transitively (port → its undercut nubs).
    const descendants = (id: string, out: GraphNode[] = []): GraphNode[] => {
      for (const c of childrenOf.get(id) ?? []) {
        out.push(c)
        descendants(c.id as unknown as string, out)
      }
      return out
    }

    // Resolve string endpoints → node objects for rendering. (dagre and the
    // incident index above consumed the raw ids first; without a force
    // simulation nothing else does this, so the edges have no coordinates.)
    for (const l of links) {
      l.source = gd.nodeById.get(l.source as unknown as string)!
      l.target = gd.nodeById.get(l.target as unknown as string)!
    }

    const svg = d3.select(el).attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    // ── Defs: one arrowhead marker per edge role ─────────────────────────────
    const defs = svg.append('defs')
    ROLES.forEach(role => {
      defs.append('marker')
        .attr('id', edgeMarkerId(role))
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-5L10,0L0,5')
        .attr('fill', edgeColor(role))
        .attr('opacity', 0.9)
    })

    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([VIEW.zoomMin, VIEW.zoomMax])
      .on('zoom', e => {
        g.attr('transform', `translate(${e.transform.x},${e.transform.y + TITLE_BAR_HEIGHT}) scale(${e.transform.k})`)
      })
    svg.call(zoom)

    // ── Edges ────────────────────────────────────────────────────────────────
    // Rendered as paths through the layout's routed waypoints so they steer
    // around nodes rather than cutting straight through them. In port mode the
    // concludes/contests-a-claim edges collapse into the port itself, so they
    // are not drawn; undercuts (contests an inference) still need a connector.
    const drawnLinks = ports
      ? links.filter(l => l.role !== 'Concludes' && !(l.role === 'Contests' && !l.toInference))
      : links
    const linkSel = g.append('g').attr('class', 'links')
      .selectAll<SVGPathElement, GraphLink>('path')
      .data(drawnLinks)
      .join('path')
      .attr('fill', 'none')
      .attr('stroke', d => edgeColor(d.role))
      .attr('stroke-width', d => d.role === 'Warrants' ? EDGE.strokeWidthWarrants : EDGE.strokeWidthDefault)
      .attr('stroke-dasharray', d => d.role === 'Warrants' ? EDGE.dashWarrants : null)
      .attr('stroke-opacity', d => d.uncertain ? EDGE.opacity * 0.6 : EDGE.opacity)
      .attr('marker-end', d => `url(#${edgeMarkerId(d.role)})`)

    // ── Nodes ────────────────────────────────────────────────────────────────
    const nodeSel = g.append('g').attr('class', 'nodes')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('class', 'node')
      .attr('cursor', 'pointer')
      .attr('opacity', d => d.uncertain ? 0.6 : 1)

    nodeSel.each(function (d) {
      const sel = d3.select(this)
      if (d._kind === 'inference') {
        if (ports) {
          // Port nub on the target claim's border — a half-disc flush against
          // the claim's bottom edge, filled+stroked like a claim node so it
          // reads as part of the node. Green concludes / red contests reuse the
          // pro/anti node palette.
          const concludes = (d as { concludes?: unknown }).concludes != null
          const style = concludes ? COLORS.node.pro : COLORS.node.anti
          sel.append('path')
            .attr('d', portPath(NODE.portHalfWidth, NODE.portHeight))
            .attr('fill', style.fill)
            .attr('stroke', style.stroke)
            .attr('stroke-width', NODE.strokeWidth)
          return
        }
        // Small diamond — a subordinate junction, not a peer node.
        sel.append('path')
          .attr('d', diamondPath(NODE.infRadius))
          .attr('fill', nodeFill(d))
          .attr('stroke', nodeStroke(d))
          .attr('stroke-width', 1.25)
        return
      }
      // Claim — rectangle with wrapped tag label.
      sel.append('rect')
        .attr('x', -nodeHW(d)).attr('y', -nodeHH(d))
        .attr('width', nodeHW(d) * 2).attr('height', nodeHH(d) * 2)
        .attr('rx', NODE.rx)
        .attr('fill', nodeFill(d))
        .attr('stroke', nodeStroke(d))
        .attr('stroke-width', isRootClaim(d) ? NODE.rootStrokeWidth : NODE.strokeWidth)
        .attr('stroke-dasharray', isWarrantClaim(d) ? EDGE.dashWarrants : null)

      const lines = wrapTag(d.tag || (d.id as unknown as string))
      const totalH = (lines.length - 1) * NODE.lineHeight
      sel.append('text')
        .attr('text-anchor', 'middle')
        .attr('fill', '#e8e8e8')
        .attr('font-size', isRootClaim(d) ? '10px' : '9.5px')
        .attr('font-family', 'system-ui, sans-serif')
        .attr('pointer-events', 'none')
        .attr('font-weight', isRootClaim(d) ? '600' : '400')
        .selectAll('tspan')
        .data(lines)
        .join('tspan')
        .attr('x', 0)
        .attr('dy', (_, i) => i === 0 ? `${-totalH / 2}px` : `${NODE.lineHeight}px`)
        .attr('dominant-baseline', 'middle')
        .text(t => t)
    })

    // ── Positioning ──────────────────────────────────────────────────────────
    // Linear (polyline) rendering follows the layout's collision-avoiding
    // waypoints exactly. Smooth curves can overshoot the route and bulge back
    // into nodes, so clarity wins over prettiness here.
    const lineGen = d3.line<{ x: number; y: number }>()
      .x(p => p.x).y(p => p.y)
      .curve(d3.curveLinear)

    function placeNode(this: SVGGElement | null, d: GraphNode) {
      return `translate(${d.x ?? 0},${d.y ?? 0})`
    }
    function linkPath(d: GraphLink): string | null {
      const s = d.source as GraphNode
      const t = d.target as GraphNode
      if (s.x == null || s.y == null || t.x == null || t.y == null) return null
      // Routed waypoints from the layout, else a straight fall-back (e.g. after
      // a drag). Clip the first/last point to the node borders so the arrowhead
      // meets the target cleanly.
      const pts = (d.points && d.points.length >= 2)
        ? d.points.map(p => ({ x: p.x, y: p.y }))
        : [{ x: s.x, y: s.y }, { x: t.x, y: t.y }]
      const a = pts[1]
      pts[0] = rectEdgePt(s.x, s.y, a.x, a.y, s, VIEW.arrowSourcePad)
      const b = pts[pts.length - 2]
      pts[pts.length - 1] = rectEdgePt(t.x, t.y, b.x, b.y, t, VIEW.arrowTargetPad)
      return lineGen(pts)
    }
    function placeLink(this: SVGPathElement, d: GraphLink) {
      const p = linkPath(d)
      if (p) d3.select(this).attr('d', p)
    }
    nodeSel.attr('transform', placeNode)
    linkSel.each(placeLink)

    // ── Interaction ──────────────────────────────────────────────────────────
    nodeSel
      .on('mouseover', (event: MouseEvent, d) => onHoverRef.current(d, event.clientX, event.clientY))
      .on('mousemove', (event: MouseEvent, d) => onHoverRef.current(d, event.clientX, event.clientY))
      .on('mouseout',  () => onHoverRef.current(null))
      .on('click', (event: MouseEvent, d) => { event.stopPropagation(); onClickRef.current(d) })

    svg.on('click', () => onClickRef.current(null))

    // ── Drag: reposition a single node; re-clip only its incident edges ───────
    nodeSel.call(
      d3.drag<SVGGElement, GraphNode>()
        .on('start', () => onHoverRef.current(null))
        .on('drag', function (event, d) {
          const dx = event.x - (d.x ?? 0)
          const dy = event.y - (d.y ?? 0)

          // A port drags its whole node: resolve the cluster root (the host
          // claim when dragging a port, else the node itself), then translate
          // the root and every nub attached to it — ports and their undercut
          // nubs — by the same delta so the cluster moves rigidly.
          const host = d._kind === 'inference' && d._hostId
            ? gd.nodeById.get(d._hostId) : undefined
          const root = host && host._kind === 'claim' ? host : d
          const moved = [root, ...descendants(root.id as unknown as string)]
          for (const n of moved) { n.x = (n.x ?? 0) + dx; n.y = (n.y ?? 0) + dy }
          const movedSet = new Set(moved)
          nodeSel.filter(n => movedSet.has(n)).attr('transform', placeNode)

          // Dragging invalidates the routed waypoints — fall back to a straight
          // line between the (moved) endpoints for every affected edge.
          const affected = new Set<GraphLink>()
          for (const n of moved) {
            for (const l of incident.get(n.id as unknown as string) ?? []) {
              l.points = undefined
              affected.add(l)
            }
          }
          linkSel.filter(l => affected.has(l)).each(placeLink)
        })
    )

    // ── Initial zoom-to-fit ──────────────────────────────────────────────────
    const fit = fitTransform(bounds, W, H - TITLE_BAR_HEIGHT, VIEW.zoomMin, VIEW.zoomMax)
    svg.call(zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k))

    return () => { svg.on('.zoom', null) }
  }, [data])

  return <svg ref={svgRef} style={{ display: 'block' }} />
}
