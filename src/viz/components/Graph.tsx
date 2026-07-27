import { useEffect, useRef } from 'react'
import * as d3 from 'd3'
import type { DiscourseSpace } from '../../types'
import {
  COLORS, EDGE, NODE, DISCLOSURE, TITLE_BAR_HEIGHT, VIEW, STANCE_FILL_OPACITY,
  STANCE_SELECTED_FILL_OPACITY, STANCE_SELECTED_STROKE_BUMP, REF_ROOT,
} from '../../config'
import { fitTransform, type LayoutBounds, type GroupBox } from '../layout'
import { loadViewport, saveViewport } from '../persist'
import {
  nodeHW, nodeHH, isRootClaim,
  rectEdgePt, fitTag,
  computeStance, stanceColor, edgeStance,
  contestTickForPolyline, contestTickSegments,
  type GraphNode, type GraphData, type GraphLink, type ClaimNode, type EdgeRole, type TickSeg,
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
  /** The claim everything is coloured relative to (the movable reference root).
   *  null ⇒ no origin set, so the whole graph is unpainted (all neutral). Updates
   *  recolour the scene in place — they never rebuild it. */
  referenceRootId?: string | null
  onHover: (node: GraphNode | null, x?: number, y?: number) => void
  onSelect: (node: GraphNode | null) => void
  /** Double-click a claim to open it in the focus view. */
  onActivate?: (node: GraphNode) => void
}

/** Clip an edge endpoint to a node's outline: diamond for inferences, rect for claims. */
function clipToNode(node: GraphNode, fx: number, fy: number, tx: number, ty: number, pad: number) {
  if (node._kind === 'inference') {
    const dx = tx - fx, dy = ty - fy
    const len = Math.hypot(dx, dy) || 1
    const ux = dx / len, uy = dy / len
    // Distance from centre to a diamond (|x|+|y| = r) outline along (ux,uy), plus pad.
    const dist = NODE.infRadius / (Math.abs(ux) + Math.abs(uy)) + pad
    return { x: fx + ux * dist, y: fy + uy * dist }
  }
  return rectEdgePt(fx, fy, tx, ty, node, pad)
}

type NodeSel = d3.Selection<SVGGElement, GraphNode, SVGGElement, unknown>

/**
 * Static argument map: every claim is a box, every inference a junction circle,
 * every edge drawn. Positions come from `masterLayout` and are frozen. The only
 * interactions are pan/zoom, hover, click-to-select, drag-to-nudge, and search
 * highlight — no disclosure.
 *
 * Colour is a *stance wash* relative to the reference root (see `computeStance`):
 * aligned / opposed / divided / neutral. Moving the reference root recolours the
 * whole scene in place via `applyStance`, without a rebuild.
 */
export function Graph({ data, graphData, bounds, groups, highlight, centerOn, centerMode, referenceRootId, onHover, onSelect, onActivate }: Props) {
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
  const referenceRootIdRef = useRef(referenceRootId)
  useEffect(() => { referenceRootIdRef.current = referenceRootId }, [referenceRootId])
  // The selected/centred claim (same id the viewport frames), used to emphasise it.
  // A change repaints in place but must NOT re-frame the viewport, so it's separate
  // from the mount-only centring read.
  const selectedIdRef = useRef(centerOn)
  const nodesRef = useRef<NodeSel | null>(null)
  // Repaints the whole scene by stance for a given reference root. Rebuilt on each
  // scene mount (closes over that mount's selections); called by the recolour effect.
  const recolorRef = useRef<((refId: string | null) => void) | null>(null)

  useEffect(() => {
    const el = svgRef.current
    if (!el) return
    const W = window.innerWidth
    const H = window.innerHeight
    const gd = graphData
    const { nodes, links } = gd

    const svg = d3.select(el).attr('width', W).attr('height', H)
    svg.selectAll('*').remove()

    // One arrowhead for every edge: `context-stroke` makes it inherit the path's
    // own stroke, so it tracks the stance colour with no per-edge marker swap.
    const defs = svg.append('defs')
    defs.append('marker').attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10').attr('refX', 8).attr('refY', 0)
      .attr('markerWidth', 6).attr('markerHeight', 6).attr('orient', 'auto')
      .append('path').attr('d', 'M0,-5L10,0L0,5').attr('fill', 'context-stroke').attr('opacity', 0.9)

    const g = svg.append('g')
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([VIEW.zoomMin, VIEW.zoomMax])
      .on('zoom', e => g.attr('transform',
        `translate(${e.transform.x},${e.transform.y + TITLE_BAR_HEIGHT}) scale(${e.transform.k})`))
      // Persist the reader's "location" after each pan/zoom gesture settles so a
      // reload (or a return from the focus view) restores it exactly.
      .on('end', e => saveViewport({ k: e.transform.k, x: e.transform.x, y: e.transform.y }))
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
    // The drawn (endpoint-clipped) polyline for a link — shared by the path and its
    // contest tick so the tick always sits on the visible line.
    const clippedPoints = (l: GraphLink): Array<{ x: number; y: number }> | null => {
      const sN = gd.nodeById.get(l.source as unknown as string)
      const tN = gd.nodeById.get(l.target as unknown as string)
      if (!sN || !tN || sN.x == null || sN.y == null || tN.x == null || tN.y == null) return null
      const pts = (l.points && l.points.length >= 2)
        ? l.points.map(p => ({ x: p.x, y: p.y }))
        : [{ x: sN.x, y: sN.y }, { x: tN.x, y: tN.y }]
      const a = pts[1]; pts[0] = clipToNode(sN, sN.x, sN.y, a.x, a.y, VIEW.arrowSourcePad)
      const b = pts[pts.length - 2]; pts[pts.length - 1] = clipToNode(tN, tN.x, tN.y, b.x, b.y, VIEW.arrowTargetPad)
      return pts
    }
    const linkPath = (l: GraphLink): string | null => {
      const pts = clippedPoints(l)
      return pts ? lineGen(pts) : null
    }

    // Root-directed edges are not drawn individually — each group's are bundled
    // into one line per role (drawn below).
    const isRoot = (id: string) => {
      const n = gd.nodeById.get(id)
      return !!n && n._kind === 'claim' && (n as ClaimNode)._isRoot
    }
    const innerLinks = links.filter(l =>
      !isRoot(l.source as unknown as string) && !isRoot(l.target as unknown as string))

    // Stroke colour comes from applyStance(); geometry channels (warrant dash,
    // contest tick) are set here and are independent of that colour.
    const linkSel = g.append('g').attr('class', 'links')
      .selectAll<SVGPathElement, GraphLink>('path').data(innerLinks).join('path')
      .attr('fill', 'none')
      .attr('stroke-width', d => d.role === 'Warrants' ? EDGE.strokeWidthWarrants : EDGE.strokeWidthDefault)
      .attr('stroke-dasharray', d => d.role === 'Warrants' ? EDGE.dashWarrants : null)
      .attr('stroke-opacity', d => d.uncertain ? EDGE.opacity * 0.6 : EDGE.opacity)
      .attr('marker-end', 'url(#arrow)')
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
      .attr('stroke-width', EDGE.strokeWidthDefault)
      .attr('stroke-opacity', EDGE.opacity * 0.8)
      .attr('d', br => branchPath(br))
    const bundleSel = g.append('g').attr('class', 'bundles')
      .selectAll<SVGPathElement, Bundle>('path').data(bundles).join('path')
      .attr('fill', 'none')
      .attr('stroke-width', b => Math.min(6, 1.4 + b.count * 0.6))
      .attr('stroke-opacity', EDGE.opacity)
      .attr('marker-end', 'url(#arrow)')
      .attr('d', b => trunkPath(b))

    // ── Contest ticks — the "contesting" relation mark ──────────────────────────
    // Wired in-situ for BOTH edge shapes: routed polylines AND bundled trunks (in
    // this corpus ~half the contests target the root and render as bundles, so
    // ticking only polylines would look half-done). Colour is applied later by
    // applyStance so it matches the edge; here we only place the geometry.
    const bundleTickSegs = (b: Bundle): TickSeg[] => {
      const root = gd.nodeById.get(b.rootId)
      const rx = root?.x ?? 0
      const ry = (root?.y ?? 0) + (root ? nodeHH(root) : 0) + VIEW.arrowTargetPad
      const { y: by } = exitPt(b)
      const my = Math.min(by, ry) - 40
      const dy = ry - my                 // the trunk arrives vertically at the root
      const dir = dy >= 0 ? 1 : -1
      const off = Math.min(EDGE.contestTick.offset, Math.abs(dy) || EDGE.contestTick.offset)
      return contestTickSegments(rx, ry - dir * off, Math.atan2(dy, 0))
    }
    interface EdgeTick { kind: 'link' | 'bundle'; link?: GraphLink; bundle?: Bundle }
    const tickData: EdgeTick[] = [
      ...innerLinks.filter(l => l.role === 'Contests').map(l => ({ kind: 'link' as const, link: l })),
      ...bundles.filter(b => b.role === 'Contests').map(b => ({ kind: 'bundle' as const, bundle: b })),
    ]
    const tickSegsFor = (t: EdgeTick): TickSeg[] => {
      if (t.kind === 'bundle') return bundleTickSegs(t.bundle!)
      const pts = clippedPoints(t.link!)
      return pts ? contestTickForPolyline(pts) : []
    }
    const drawTick = (el: SVGGElement, segs: TickSeg[]) => {
      d3.select(el).selectAll<SVGLineElement, TickSeg>('line').data(segs).join('line')
        .attr('x1', s => s.x1).attr('y1', s => s.y1).attr('x2', s => s.x2).attr('y2', s => s.y2)
        .attr('stroke-width', EDGE.contestTick.strokeWidth).attr('stroke-linecap', 'round')
    }
    const tickSel = g.append('g').attr('class', 'ticks')
      .selectAll<SVGGElement, EdgeTick>('g').data(tickData).join('g').attr('class', 'tick')
    tickSel.each(function (t) { drawTick(this, tickSegsFor(t)) })

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
        // A small diamond junction (matches the legend swatch). fill/stroke by applyStance().
        const r = NODE.infRadius
        sel.append('path').attr('class', 'shape').attr('d', `M0 ${-r}L${r} 0L0 ${r}L${-r} 0Z`).attr('stroke-width', 1.25)
        return
      }
      const c = d as ClaimNode
      const hw = nodeHW(c), hh = nodeHH(c)
      sel.append('rect').attr('class', 'hl')          // search-highlight ring (hidden by default)
        .attr('x', -hw - 3).attr('y', -hh - 3).attr('width', hw * 2 + 6).attr('height', hh * 2 + 6)
        .attr('rx', NODE.rx + 2).attr('fill', 'none').attr('pointer-events', 'none')
        .attr('stroke', DISCLOSURE.highlightStroke).attr('stroke-width', DISCLOSURE.highlightWidth)
        .attr('opacity', highlight.has(d.id as unknown as string) ? 1 : 0)
      sel.append('rect').attr('class', 'shape')       // the claim box — coloured by applyStance()
        .attr('x', -hw).attr('y', -hh).attr('width', hw * 2).attr('height', hh * 2).attr('rx', NODE.rx)
        .attr('stroke-width', isRootClaim(c) ? NODE.rootStrokeWidth : NODE.strokeWidth)
        .attr('pointer-events', 'all')   // stay clickable when unpainted (fill:none)
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
      // Reference-root marker: a single bold ink ring around the box (hidden by
      // default; shown on the reference root by applyStance). One rounded rect offset
      // by ringGap — surrounds the node so it reads even at overview zoom.
      const target = sel.append('g').attr('class', 'target').attr('opacity', 0).attr('pointer-events', 'none')
      target.append('rect')
        .attr('x', -hw - REF_ROOT.ringGap).attr('y', -hh - REF_ROOT.ringGap)
        .attr('width', hw * 2 + REF_ROOT.ringGap * 2).attr('height', hh * 2 + REF_ROOT.ringGap * 2)
        .attr('rx', NODE.rx + REF_ROOT.ringGap).attr('fill', 'none')
        .attr('stroke', REF_ROOT.ringColor).attr('stroke-width', REF_ROOT.ringWidth)
    })

    // ── Stance wash — recolour the whole scene relative to a reference root ──────
    const applyStance = (refId: string | null) => {
      const sm = computeStance(gd, refId)
      // Nodes
      nodeSel.each(function (d) {
        const id = d.id as unknown as string
        const sel = d3.select(this)
        const shape = sel.select('.shape')
        if (d._kind === 'inference') {
          const st = sm.node.get(id)
          if (!st || st === 'neutral') shape.attr('fill', COLORS.inference.fill).attr('fill-opacity', 1).attr('stroke', COLORS.inference.stroke)
          else { const col = stanceColor(st); shape.attr('fill', col).attr('fill-opacity', STANCE_FILL_OPACITY).attr('stroke', col) }
          return
        }
        const isRef = refId != null && id === refId
        const isSel = id === selectedIdRef.current
        // The reference root is always its aligned valence (it's on its own side by
        // definition); every other claim takes its stance relative to the root.
        // Neutral = outline only.
        let col: string | null
        if (isRef) {
          col = stanceColor('aligned')
        } else {
          const st = sm.node.get(id)
          col = !st || st === 'neutral' ? null : stanceColor(st)
        }
        if (col) shape.attr('fill', col).attr('fill-opacity', isSel ? STANCE_SELECTED_FILL_OPACITY : STANCE_FILL_OPACITY).attr('stroke', col)
        else shape.attr('fill', 'none').attr('fill-opacity', 1).attr('stroke', COLORS.border)
        // Selected/centred node: same hue, heavier border (denser fill applied above).
        const baseW = isRootClaim(d) ? NODE.rootStrokeWidth : NODE.strokeWidth
        shape.attr('stroke-width', isSel ? baseW + STANCE_SELECTED_STROKE_BUMP : baseW)
        // The reference-root ring takes the node's own colour, not ink.
        const targetSel = sel.select('.target')
        targetSel.attr('opacity', isRef ? 1 : 0)
        if (isRef) targetSel.select('rect').attr('stroke', col ?? stanceColor('aligned'))
      })
      // Edges — coloured by the stance region they lead into. Record each edge's
      // colour so its contest tick (a separate channel) can match it.
      const linkColor = new Map<string, string>()
      linkSel.attr('stroke', d => {
        const col = stanceColor(edgeStance(sm, d.source as unknown as string, d.target as unknown as string))
        linkColor.set(d.id, col); return col
      })
      branchSel.attr('stroke', br => stanceColor(sm.node.get(br.member)))
      const bundleColor = new Map<Bundle, string>()
      bundleSel.attr('stroke', b => {
        const col = stanceColor(sm.node.get(b.members[0]))
        bundleColor.set(b, col); return col
      })
      tickSel.each(function (t) {
        const col = t.kind === 'link'
          ? (linkColor.get(t.link!.id) ?? COLORS.border)
          : (bundleColor.get(t.bundle!) ?? COLORS.border)
        d3.select(this).selectAll('line').attr('stroke', col)
      })
    }
    recolorRef.current = applyStance
    applyStance(referenceRootIdRef.current ?? null)

    // ── Interaction ────────────────────────────────────────────────────────────
    nodeSel
      .on('mouseover', (e: MouseEvent, d) => onHoverRef.current(d, e.clientX, e.clientY))
      .on('mousemove', (e: MouseEvent, d) => onHoverRef.current(d, e.clientX, e.clientY))
      .on('mouseout', () => onHoverRef.current(null))
      .on('click', (e: MouseEvent, d) => { e.stopPropagation(); onSelectRef.current(d) })
      .on('dblclick', (e: MouseEvent, d) => { e.stopPropagation(); if (d._kind === 'claim') onActivateRef.current?.(d) })
    svg.on('click', () => onSelectRef.current(null))

    // Drag to nudge a node; re-clip only its incident edges (and re-place their ticks).
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
        tickSel.each(function (t) {
          const touches = t.kind === 'link'
            ? ((t.link!.source as unknown as string) === id || (t.link!.target as unknown as string) === id)
            : isRoot(id)
          if (touches) drawTick(this, tickSegsFor(t))
        })
      }))

    // Frame the scene on mount. Priority:
    //   1. neighborhood — an explicit "locate" return wants a fixed tight zoom on
    //      the claim, so it overrides any stored viewport.
    //   2. stored viewport — restore the reader's last "location" exactly (reload,
    //      or a generic return from the focus view).
    //   3. centerOn reveal — first-ever visit swapping in a selection: reveal it.
    //   4. fit — nothing to restore or reveal, so fit the whole map.
    const fit = fitTransform(bounds, W, H - TITLE_BAR_HEIGHT, VIEW.zoomMin, VIEW.zoomMax)
    const stored = loadViewport()
    const target = centerOnRef.current ? gd.nodeById.get(centerOnRef.current) : null
    const centerAt = (k: number) => {
      const tx = W / 2 - k * target!.x!
      const ty = (H - TITLE_BAR_HEIGHT) / 2 - k * target!.y!
      svg.call(zoom.transform, d3.zoomIdentity.translate(tx, ty).scale(k))
    }
    if (centerModeRef.current === 'neighborhood' && target && target.x != null && target.y != null) {
      // Centre the claim at a fixed tight zoom so only its one or two immediate
      // neighbours frame it.
      centerAt(Math.min(VIEW.zoomMax, Math.max(VIEW.zoomMin, VIEW.neighborhoodZoom)))
    } else if (stored) {
      svg.call(zoom.transform, d3.zoomIdentity.translate(stored.x, stored.y).scale(stored.k))
    } else if (target && target.x != null && target.y != null) {
      centerAt(Math.max(fit.k, Math.min(VIEW.zoomMax, 0.55)))
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

  // Move the reference root: recolour the whole scene in place (no rebuild, so the
  // viewport and any nudged positions are preserved).
  useEffect(() => {
    recolorRef.current?.(referenceRootId ?? null)
  }, [referenceRootId])

  // Move the selection emphasis when the centred claim changes — repaint in place,
  // never reframe (viewport framing stays mount-only).
  useEffect(() => {
    selectedIdRef.current = centerOn
    recolorRef.current?.(referenceRootIdRef.current ?? null)
  }, [centerOn])

  return <svg ref={svgRef} style={{ display: 'block' }} />
}
