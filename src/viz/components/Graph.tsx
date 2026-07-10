import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { SimulationNodeDatum } from 'd3'
import type { DiscourseSpace } from '../../types'
import { COLORS, EDGE, NODE, DISCLOSURE, TITLE_BAR_HEIGHT, VIEW } from '../../config'
import { masterLayout, fitTransform, type LayoutBounds } from '../layout'
import {
  edgeColor, edgeMarkerId,
  nodeFill, nodeStroke,
  nodeHW, nodeHH, isRootClaim, isWarrantClaim,
  rectEdgePt, fitTag,
  type GraphNode, type GraphData, type GraphLink, type ClaimNode, type InfNode, type EdgeRole,
} from '../graphData'
import type { Projection, Derived, DisState } from '../disclosure'

interface Props {
  data: DiscourseSpace
  graphData: GraphData
  derived: Derived
  projection: Projection
  highlight: Set<string>
  onHover: (node: GraphNode | null, x?: number, y?: number) => void
  onSelect: (node: GraphNode | null) => void
  onPortClick: (infId: string) => void
  onJunctionClick: (infId: string) => void
  onChipClick: (infId: string, claimId: string) => void
  onBadgeClick: (infId: string) => void
  onGroundsClose: (infId: string) => void
  onClaimExpand: (claimId: string) => void
  onClaimCollapse: (claimId: string) => void
}

const ROLES: EdgeRole[] = ['Grounds', 'Warrants', 'Concludes', 'Contests']

// Port nub: a half-disc flush on the claim's bottom border (local y = 0), bulging
// `height` below it — fused to the claim rather than floating beside it.
function portPath(halfWidth: number, height: number): string {
  return `M${-halfWidth},0 A${halfWidth},${height} 0 0 0 ${halfWidth},0 Z`
}

/** Clip an edge endpoint to a node's outline: a circle for inferences (so the
 *  line meets the rim, not the centre), a rectangle for claim boxes. */
function clipToNode(node: GraphNode, fx: number, fy: number, tx: number, ty: number, pad: number) {
  if (node._kind === 'inference') {
    const r = NODE.portRadius * 0.8 + pad
    const dx = tx - fx, dy = ty - fy
    const len = Math.hypot(dx, dy) || 1
    return { x: fx + (dx / len) * r, y: fy + (dy / len) * r }
  }
  return rectEdgePt(fx, fy, tx, ty, node, pad)
}

type CNode = ClaimNode & SimulationNodeDatum
type INode = InfNode & SimulationNodeDatum

type RenderItem =
  | { key: string; id: string; kind: 'claim'; node: CNode }
  | { key: string; id: string; kind: 'inference'; state: DisState; node: INode }

export function Graph(props: Props) {
  const { data, graphData, projection, highlight } = props
  const svgRef = useRef<SVGSVGElement>(null)

  // Latest callbacks + projection, read from inside D3 handlers without re-binding.
  const cbRef = useRef(props)
  cbRef.current = props
  const projRef = useRef(projection)
  projRef.current = projection

  // Set once per corpus (Effect A); consumed by the render effect (Effect B).
  const gdRef = useRef<GraphData | null>(null)
  const nodesLayer = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const linksLayer = useRef<d3.Selection<SVGGElement, unknown, null, undefined> | null>(null)
  const pointsRef = useRef<Map<string, Array<{ x: number; y: number }>>>(new Map())
  const childrenRef = useRef<Map<string, InfNode[]>>(new Map())

  // ── Effect A: scene setup (svg, zoom, defs, master layout) ─────────────────
  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const W = window.innerWidth
    const H = window.innerHeight
    const gd = graphData
    gdRef.current = gd

    masterLayout(gd)

    // Routed waypoints (flat/all-X geometry) keyed for reuse when an inference
    // endpoint is expanded. Endpoints stay strings on the built links.
    const points = new Map<string, Array<{ x: number; y: number }>>()
    for (const l of gd.links as GraphLink[]) {
      if (l.points) points.set(`${l.source}|${l.target}|${l.role}`, l.points)
    }
    pointsRef.current = points

    // host claim → inference nubs anchored to it (for rigid drag).
    const children = new Map<string, InfNode[]>()
    for (const n of gd.nodes) {
      if (n._kind !== 'inference') continue
      const host = (n as InfNode)._hostId
      if (host == null) continue
      ;(children.get(host) ?? children.set(host, []).get(host)!).push(n as InfNode)
    }
    childrenRef.current = children

    const svg = d3.select(el).attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    const defs = svg.append('defs')
    ROLES.forEach(role => {
      defs.append('marker')
        .attr('id', edgeMarkerId(role))
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 6).attr('markerHeight', 6)
        .attr('orient', 'auto')
        .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', edgeColor(role)).attr('opacity', 0.9)
    })

    const g = svg.append('g')
    linksLayer.current = g.append('g').attr('class', 'links') as d3.Selection<SVGGElement, unknown, null, undefined>
    nodesLayer.current = g.append('g').attr('class', 'nodes') as d3.Selection<SVGGElement, unknown, null, undefined>

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([VIEW.zoomMin, VIEW.zoomMax])
      .on('zoom', e => {
        g.attr('transform', `translate(${e.transform.x},${e.transform.y + TITLE_BAR_HEIGHT}) scale(${e.transform.k})`)
      })
    svg.call(zoom)

    // Initial fit to the currently-visible nodes (not the sparse full bounds).
    const bounds = visibleBounds(gd, projRef.current)
    const fit = fitTransform(bounds, W, H - TITLE_BAR_HEIGHT, VIEW.zoomMin, VIEW.zoomMax)
    svg.call(zoom.transform, d3.zoomIdentity.translate(fit.x, fit.y).scale(fit.k))

    return () => { svg.on('.zoom', null) }
  }, [data, graphData])

  // ── Effect B: render the projection (positions frozen; fade enter/exit) ────
  useEffect(() => {
    const gd = gdRef.current
    const layerN = nodesLayer.current
    const layerL = linksLayer.current
    if (!gd || !layerN || !layerL) return
    renderScene(gd, layerN, layerL, projection, highlight, pointsRef.current, childrenRef.current, cbRef)
  }, [projection, highlight])

  return <svg ref={svgRef} style={{ display: 'block' }} />
}

// ── Geometry ────────────────────────────────────────────────────────────────

function renderPos(gd: GraphData, proj: Projection, id: string): { x: number; y: number } {
  const n = gd.nodeById.get(id)
  if (!n) return { x: 0, y: 0 }
  if (n._kind === 'claim') return { x: n.x ?? 0, y: n.y ?? 0 }
  const inf = n as InfNode
  if (proj.inferenceState.get(id) === 'X') return { x: n.x ?? 0, y: n.y ?? 0 }
  return { x: inf._portX ?? n.x ?? 0, y: inf._portY ?? n.y ?? 0 }
}

function visibleBounds(gd: GraphData, proj: Projection): LayoutBounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const ext = (x: number, y: number, hw: number, hh: number) => {
    if (x - hw < minX) minX = x - hw
    if (x + hw > maxX) maxX = x + hw
    if (y - hh < minY) minY = y - hh
    if (y + hh > maxY) maxY = y + hh
  }
  for (const id of proj.visibleClaims) {
    const n = gd.nodeById.get(id); if (!n) continue
    ext(n.x ?? 0, n.y ?? 0, nodeHW(n), nodeHH(n))
  }
  for (const id of proj.inferenceState.keys()) {
    const p = renderPos(gd, proj, id); ext(p.x, p.y, NODE.portRadius, NODE.portRadius)
  }
  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0 }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderScene(
  gd: GraphData,
  layerN: d3.Selection<SVGGElement, unknown, null, undefined>,
  layerL: d3.Selection<SVGGElement, unknown, null, undefined>,
  proj: Projection,
  highlight: Set<string>,
  pointsMap: Map<string, Array<{ x: number; y: number }>>,
  children: Map<string, InfNode[]>,
  cbRef: React.MutableRefObject<Props>,
) {
  const fade = DISCLOSURE.fadeMs

  const items: RenderItem[] = []
  for (const id of proj.visibleClaims) {
    const n = gd.nodeById.get(id)
    if (n && n._kind === 'claim') items.push({ key: id, id, kind: 'claim', node: n as CNode })
  }
  for (const [id, state] of proj.inferenceState) {
    const n = gd.nodeById.get(id)
    if (n && n._kind === 'inference') items.push({ key: id, id, kind: 'inference', state, node: n as INode })
  }

  const baseOpacity = (d: RenderItem) => (d.node.uncertain ? 0.6 : 1)

  // ── Edges ────────────────────────────────────────────────────────────────
  const lineGen = d3.line<{ x: number; y: number }>().x(p => p.x).y(p => p.y).curve(d3.curveLinear)

  const isMaster = (id: string) => {
    const n = gd.nodeById.get(id)
    return !n || n._kind === 'claim' || proj.inferenceState.get(id) === 'X'
  }
  const linkPath = (e: Projection['edges'][number]): string | null => {
    const s = renderPos(gd, proj, e.source)
    const t = renderPos(gd, proj, e.target)
    const routed = pointsMap.get(`${e.source}|${e.target}|${e.role}`)
    const pts = routed && routed.length >= 2 && isMaster(e.source) && isMaster(e.target)
      ? routed.map(p => ({ x: p.x, y: p.y }))
      : [{ x: s.x, y: s.y }, { x: t.x, y: t.y }]
    const sNode = gd.nodeById.get(e.source)
    const tNode = gd.nodeById.get(e.target)
    if (sNode) { const a = pts[1]; pts[0] = clipToNode(sNode, s.x, s.y, a.x, a.y, VIEW.arrowSourcePad) }
    if (tNode) { const b = pts[pts.length - 2]; pts[pts.length - 1] = clipToNode(tNode, t.x, t.y, b.x, b.y, VIEW.arrowTargetPad) }
    return lineGen(pts)
  }

  // An expanded (X) inference draws its own concludes/contests tether (nub →
  // floated circle), so suppress the projection's output edge for it to avoid a
  // double line.
  const drawnEdges = proj.edges.filter(e => !(
    (e.role === 'Concludes' || (e.role === 'Contests' && !e.toInference))
    && proj.inferenceState.get(e.source) === 'X'))
  const lsel = layerL.selectAll<SVGPathElement, Projection['edges'][number]>('path.link')
    .data(drawnEdges, d => d.id)
  lsel.exit().transition().duration(fade).style('opacity', 0).remove()
  const lenter = lsel.enter().append('path').attr('class', 'link').attr('fill', 'none').style('opacity', 0)
  lenter.merge(lsel)
    .attr('stroke', d => edgeColor(d.role))
    .attr('stroke-width', d => d.role === 'Warrants' ? EDGE.strokeWidthWarrants : EDGE.strokeWidthDefault)
    .attr('stroke-dasharray', d => d.role === 'Warrants' ? EDGE.dashWarrants : null)
    .attr('marker-end', d => `url(#${edgeMarkerId(d.role)})`)
    .attr('d', d => linkPath(d))
  lenter.transition().duration(fade).style('opacity', EDGE.opacity)
  lsel.transition().duration(fade).style('opacity', EDGE.opacity)

  // ── Nodes ────────────────────────────────────────────────────────────────
  const sel = layerN.selectAll<SVGGElement, RenderItem>('g.node').data(items, d => d.key)
  sel.exit().transition().duration(fade).style('opacity', 0).remove()
  const enter = sel.enter().append('g').attr('class', 'node').attr('cursor', 'pointer').style('opacity', 0)
  const rerender = () =>
    renderScene(gd, layerN, layerL, proj, highlight, pointsMap, children, cbRef)

  const merged = enter.merge(sel)
  merged
    .attr('transform', d => { const p = renderPos(gd, proj, d.id); return `translate(${p.x},${p.y})` })
    .each(function (d) { drawNode(d3.select(this), d, gd, proj, highlight, children, cbRef, rerender) })
  enter.transition().duration(fade).style('opacity', d => baseOpacity(d))
  sel.transition().duration(fade).style('opacity', d => baseOpacity(d))
}

function drawNode(
  sel: d3.Selection<SVGGElement, RenderItem, null, undefined>,
  d: RenderItem,
  gd: GraphData,
  proj: Projection,
  highlight: Set<string>,
  children: Map<string, InfNode[]>,
  cbRef: React.MutableRefObject<Props>,
  rerender: () => void,
) {
  sel.selectAll('*').remove()
  const cb = () => cbRef.current
  const hover = (event: MouseEvent, node: GraphNode) => cb().onHover(node, event.clientX, event.clientY)

  if (d.kind === 'inference') {
    const inf = d.node
    if (d.state === 'P') {
      const concludes = inf.concludes != null
      const style = concludes ? COLORS.node.pro : COLORS.node.anti
      sel.append('path')
        .attr('d', portPath(NODE.portHalfWidth, NODE.portHeight))
        .attr('fill', style.stroke).attr('stroke', style.stroke).attr('stroke-width', NODE.strokeWidth)  // solid = closed
      sel.on('click', (e: MouseEvent) => { e.stopPropagation(); cb().onPortClick(d.id) })
        .on('mouseover', (e: MouseEvent) => hover(e, inf))
        .on('mousemove', (e: MouseEvent) => hover(e, inf))
        .on('mouseout', () => cb().onHover(null))
      return
    }
    // J or X: the inference as a port-coloured bundler circle. In X it floats
    // off the conclusion's rim — the nub stays behind as a persistent anchor,
    // with a tether between them and the grounds converging on the floated
    // circle. So the static expanded view still reads as "this port, popped out."
    const concludes = inf.concludes != null
    const style = concludes ? COLORS.node.pro : COLORS.node.anti
    const prev = sel.attr('data-state')
    sel.attr('data-state', d.state)
    const r = NODE.portRadius * 0.8

    if (d.state === 'X') {
      const mx = inf.x ?? 0, my = inf.y ?? 0
      const rx = inf._portX ?? mx, ry = inf._portY ?? my
      const ox = rx - mx, oy = ry - my          // rim, relative to the g (at master)
      sel.append('line')                          // tether = concludes/contests attachment
        .attr('x1', ox).attr('y1', oy).attr('x2', 0).attr('y2', 0)
        .attr('stroke', edgeColor(concludes ? 'Concludes' : 'Contests'))
        .attr('stroke-width', EDGE.strokeWidthDefault).attr('stroke-opacity', EDGE.opacity)
      sel.append('path')                          // persistent rim nub (anchor)
        .attr('d', portPath(NODE.portHalfWidth, NODE.portHeight))
        .attr('transform', `translate(${ox},${oy})`)
        .attr('fill', style.fill).attr('stroke', style.stroke).attr('stroke-width', NODE.strokeWidth)
      const bundler = sel.append('g')             // floated bundler (opaque so edges
      bundler.append('circle').attr('r', r).attr('fill', COLORS.background)  // don't show through)
      bundler.append('circle').attr('r', r)
        .attr('fill', style.fill).attr('stroke', style.stroke).attr('stroke-width', NODE.strokeWidth)
      if (prev !== 'X') {                          // slide out from the nub on expand
        bundler.attr('transform', `translate(${ox},${oy})`)
          .transition().duration(320).attr('transform', 'translate(0,0)')
      }
    } else {
      sel.append('circle').attr('r', r).attr('fill', COLORS.background)   // J: opaque backing
      sel.append('circle').attr('r', r)           // bundler resting on the rim
        .attr('fill', style.fill).attr('stroke', style.stroke).attr('stroke-width', NODE.strokeWidth)
    }
    sel.on('click', (e: MouseEvent) => { e.stopPropagation(); cb().onJunctionClick(d.id) })
      .on('mouseover', (e: MouseEvent) => hover(e, inf))
      .on('mousemove', (e: MouseEvent) => hover(e, inf))
      .on('mouseout', () => cb().onHover(null))
    // Drag the junction as an independent node (moves the bundler; edges follow).
    sel.call(d3.drag<SVGGElement, RenderItem>()
      .on('start', () => cb().onHover(null))
      .on('drag', function (event) {
        if (d.state === 'X') { inf.x = event.x; inf.y = event.y }
        else { inf._portX = event.x; inf._portY = event.y }
        rerender()
      }))
    drawFan(sel, d.id, gd, proj, cbRef)
    return
  }

  // Claim — rectangle with wrapped tag label.
  const c = d.node
  const hw = nodeHW(c), hh = nodeHH(c)
  if (highlight.has(d.id)) {
    sel.append('rect')
      .attr('x', -hw - 3).attr('y', -hh - 3).attr('width', hw * 2 + 6).attr('height', hh * 2 + 6)
      .attr('rx', NODE.rx + 2).attr('fill', 'none')
      .attr('stroke', DISCLOSURE.highlightStroke).attr('stroke-width', DISCLOSURE.highlightWidth)
  }
  sel.append('rect')
    .attr('x', -hw).attr('y', -hh).attr('width', hw * 2).attr('height', hh * 2)
    .attr('rx', NODE.rx).attr('fill', nodeFill(c)).attr('stroke', nodeStroke(c))
    .attr('stroke-width', isRootClaim(c) ? NODE.rootStrokeWidth : NODE.strokeWidth)
    .attr('stroke-dasharray', isWarrantClaim(c) ? EDGE.dashWarrants : null)

  const lines = fitTag(c.tag || d.id, hw, hh, isRootClaim(c) ? 10 : 9.5)
  const totalH = (lines.length - 1) * NODE.lineHeight
  sel.append('text')
    .attr('text-anchor', 'middle').attr('fill', '#e8e8e8')
    .attr('font-size', isRootClaim(c) ? '10px' : '9.5px')
    .attr('font-family', 'system-ui, sans-serif').attr('pointer-events', 'none')
    .attr('font-weight', isRootClaim(c) ? '600' : '400')
    .selectAll('tspan').data(lines).join('tspan')
    .attr('x', 0).attr('dy', (_, i) => i === 0 ? `${-totalH / 2}px` : `${NODE.lineHeight}px`)
    .attr('dominant-baseline', 'middle').text(t => t)

  // §6: persistent low-contrast count of hidden material behind this claim.
  const hc = proj.hiddenCount.get(d.id) ?? 0
  if (hc > 0) {
    sel.append('text')
      .attr('x', hw - 4).attr('y', hh - 4).attr('text-anchor', 'end')
      .attr('font-size', `${DISCLOSURE.hiddenFontSize}px`).attr('font-family', 'system-ui, sans-serif')
      .attr('fill', COLORS.textFaint).attr('pointer-events', 'none').text(`+${hc}`)
  }

  sel.on('click', (e: MouseEvent) => {
    e.stopPropagation()
    if (e.altKey) cb().onClaimExpand(d.id)
    else if (e.shiftKey) cb().onClaimCollapse(d.id)
    else cb().onSelect(c)
  })
    .on('mouseover', (e: MouseEvent) => hover(e, c))
    .on('mousemove', (e: MouseEvent) => hover(e, c))
    .on('mouseout', () => cb().onHover(null))

  // Drag: move the claim and its anchored port/undercut nubs rigidly.
  sel.call(d3.drag<SVGGElement, RenderItem>()
    .on('start', () => cb().onHover(null))
    .on('drag', function (event) {
      const dx = event.x - (c.x ?? 0)
      const dy = event.y - (c.y ?? 0)
      c.x = event.x; c.y = event.y
      const nubs = descendantNubs(d.id, children)
      for (const nb of nubs) { nb._portX = (nb._portX ?? 0) + dx; nb._portY = (nb._portY ?? 0) + dy }
      rerender()
    }))
}

/** Folded warrants → chips; folded grounds → one count badge (§3 J/X). */
function drawFan(
  sel: d3.Selection<SVGGElement, RenderItem, null, undefined>,
  infId: string,
  gd: GraphData,
  proj: Projection,
  cbRef: React.MutableRefObject<Props>,
) {
  const f = proj.folded.get(infId)
  if (!f) return
  const cb = () => cbRef.current
  let y = DISCLOSURE.fanGap
  const chipW = 84

  for (const w of f.chips) {
    const node = gd.nodeById.get(w)
    const raw = (node && node._kind === 'claim' ? node.tag : w) || w
    const label = raw.length > DISCLOSURE.chipMaxChars ? raw.slice(0, DISCLOSURE.chipMaxChars - 1) + '…' : raw
    const chip = sel.append('g').attr('cursor', 'pointer')
      .on('click', (e: MouseEvent) => { e.stopPropagation(); cb().onChipClick(infId, w) })
    chip.append('rect')
      .attr('x', -chipW / 2).attr('y', y).attr('width', chipW).attr('height', DISCLOSURE.chipHeight)
      .attr('rx', DISCLOSURE.chipHeight / 2)
      .attr('fill', COLORS.chip.default.bg).attr('stroke', COLORS.border).attr('stroke-width', 1)
    chip.append('text')
      .attr('x', 0).attr('y', y + DISCLOSURE.chipHeight / 2).attr('text-anchor', 'middle')
      .attr('dominant-baseline', 'central').attr('font-size', `${DISCLOSURE.chipFontSize}px`)
      .attr('font-family', 'system-ui, sans-serif').attr('fill', COLORS.chip.default.color)
      .attr('pointer-events', 'none').text(label)
    y += DISCLOSURE.chipHeight + DISCLOSURE.chipGap
  }

  // Grounds control: a port-style circle (matching the junction), not a text
  // ovoid. Solid = closed (grounds folded), light = open (promoted). Clicking
  // toggles — so opening grounds is reversible (symmetric with closing).
  const derived = cb().derived
  const iInf = derived.inf.get(infId)
  const foldGrounds = iInf ? (iInf.grounds ?? []).map(String).filter(g => derived.foldableSet.has(g)) : []
  if (foldGrounds.length > 0) {
    const isOpen = f.groundsIds.length === 0     // nothing left folded → all promoted
    const style = COLORS.node.empirical          // steel, reads as grounds
    const r = NODE.portRadius * 0.7
    const cy = y + r
    const ctrl = sel.append('g').attr('cursor', 'pointer')
      .on('click', (e: MouseEvent) => {
        e.stopPropagation()
        if (isOpen) cb().onGroundsClose(infId); else cb().onBadgeClick(infId)
      })
    ctrl.append('circle').attr('cx', 0).attr('cy', cy).attr('r', r).attr('fill', COLORS.background)  // opaque backing
    ctrl.append('circle').attr('cx', 0).attr('cy', cy).attr('r', r)
      .attr('fill', isOpen ? style.fill : style.stroke).attr('stroke', style.stroke).attr('stroke-width', NODE.strokeWidth)
    if (foldGrounds.length > 1) {
      ctrl.append('text').attr('x', 0).attr('y', cy).attr('text-anchor', 'middle')
        .attr('dominant-baseline', 'central').attr('font-size', '8px').attr('font-family', 'system-ui, sans-serif')
        .attr('fill', isOpen ? style.stroke : COLORS.background).attr('pointer-events', 'none')
        .text(String(foldGrounds.length))
    }
  }
}

function descendantNubs(claimId: string, children: Map<string, InfNode[]>): InfNode[] {
  const out: InfNode[] = []
  const walk = (id: string) => {
    for (const nb of children.get(id) ?? []) { out.push(nb); walk(nb.id as unknown as string) }
  }
  walk(claimId)
  return out
}
