// FocusView.tsx — the band-stack surface. Centres one claim; derives the rest.
//
// Vertical zones (§2): parent band → focus band → For/Against columns.
// Two gestures only (§7): refocus (click a claim / parent entry) and page
// (chevrons, For/Against columns only). No expand/collapse; everything visible
// at rest. Page state resets on refocus via a `key` keyed to the focus id.

import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode, type RefObject } from 'react'
import { COLORS, FOCUS, SHOW_FOCUS_TEXT, TITLE_BAR_HEIGHT, DETAIL_TEXT } from '../../config'
import type { GraphData, StanceMap } from '../graphData'
import type { Inference, Attribution as AttributionT } from '../../types'
import { sourceLabel, computeStance } from '../graphData'
import {
  getClaim, supportsOf, attacksOf, consumersOf, outputOf, renderedClaimIds,
} from './focusData'
import { BedrockBadge, EmptyCell, FromHighlight, GraphIcon, LocateContext, HoverContext, TargetIcon, FrontierContext, StanceContext, useStance, stanceStyle, TagHeader, TAG_STYLE } from './primitives'
import { InferenceBox } from './Cell'
import { Tooltip } from '../components/Tooltip'

// Hover affordances live in CSS so tiles/rows need no per-node state.
const focusCss = `
  .pz-row { transition: background .12s ease; }
  .pz-row:hover { background: hsla(220, 24%, 20%, 0.05); }
  .pz-tile { transition: filter .12s ease, box-shadow .12s ease; }
  .pz-tile:hover { filter: brightness(0.985); box-shadow: 0 1px 3px hsla(220, 24%, 20%, 0.14); }
  .pz-tile .pz-graphbtn { opacity: 0; transition: opacity .12s ease, color .12s ease, background .12s ease; }
  .pz-tile:hover .pz-graphbtn, .pz-tile:focus-within .pz-graphbtn { opacity: 1; }
  .pz-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid transparent; background: none; cursor: pointer; color: ${COLORS.textDim}; transition: color .12s ease, background .12s ease, border-color .12s ease; }
  .pz-iconbtn:hover { color: ${COLORS.text}; background: hsla(220, 24%, 20%, 0.05); border-color: ${COLORS.border}; }
  .pz-graphbtn { display: inline-flex; align-items: center; justify-content: center; padding: 2px; border: none; background: none; cursor: pointer; color: ${COLORS.textDimmer}; border-radius: 4px; transition: color .12s ease, background .12s ease; }
  .pz-graphbtn:hover { color: ${COLORS.text}; background: hsla(220, 24%, 20%, 0.06); }
`

// A fixed-height frame whose content scrolls, with a scroll-edge fade top and
// bottom (the mask stands in for the retired pager — "everything visible at
// rest" means no disclosure control, and scrolling inside a fixed frame is not
// disclosure). A box clipped by the frame's edge visibly runs off it.
function ScrollFrame({ height, children }: { height: number; children: ReactNode }) {
  const f = FOCUS.scrollFade
  const mask = `linear-gradient(to bottom, transparent 0, #000 ${f}px, #000 calc(100% - ${f}px), transparent 100%)`
  // The content is inset by the fade depth so the first/last item sits at the fade
  // boundary fully opaque — otherwise the top box's chamfer is eaten by the fade.
  return (
    <div style={{ height, overflowY: 'auto', maskImage: mask, WebkitMaskImage: mask }}>
      <div style={{ padding: `${f}px 0` }}>{children}</div>
    </div>
  )
}

// A region heading carrying its count — the fan-out the retired pager's `n` used
// to show. No `i of n`: position in a bag asserts nothing, so there is no rank to
// index into.
function RegionHeading({ text, count, color }: { text: string; count: number; color: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', justifyContent: 'center', gap: 6, fontSize: FOCUS.labelFont, textTransform: 'uppercase', letterSpacing: '0.08em', color }}>
      <span>{text}</span>
      <span style={{ fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{count}</span>
    </div>
  )
}

function Connector() {
  return <div style={{ width: 1, height: FOCUS.connector, background: COLORS.border, alignSelf: 'center' }} />
}

// ── Reference-root line & tear (Stage 4) ──────────────────────────────────────
//
// The reference root — the origin all stance is measured from, the same claim the
// graph pins with a target — rides at the very top as "what is this ultimately
// for", which the one-hop parent band otherwise loses. Below it an inert torn
// sheet stands in for the chain of hops we are NOT showing (that structure lives
// in the graph, or one refocus away), captioned with how far the centred claim
// really sits from the root. Neither is drawn when the centred claim IS the root
// — that band carries the target itself — so the same claim never appears twice
// with a 0-gap between (see the frame's suppression logic).

// The pinned root: an ink target icon over the ALIGNED wash. The root is aligned by
// construction (it is on its own side), so its painted surface doubles as the legend
// for that pole and the caption for every other fill in the frame — the honesty
// constraint made visible. Truncated to a single banner line; clicking it recentres
// the stack on the root — the always-available "take me back to the top".
function RootLine({ gd, rootId, onFocus }: { gd: GraphData; rootId: string; onFocus: (id: string, source?: DOMRect) => void }) {
  const claim = getClaim(gd, rootId)
  const stance = stanceStyle(useStance(rootId), { neutralBg: COLORS.surface, neutralBorder: COLORS.border })
  return (
    <div
      className="pz-row"
      onClick={e => onFocus(rootId, e.currentTarget.getBoundingClientRect())}
      title={claim?.text ?? rootId}
      style={{
        display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer',
        padding: '8px 12px', borderRadius: 8,
        border: `1px solid ${COLORS.border}`,
        ...stance,   // aligned wash + border (root is aligned); ink target icon stays
      }}
    >
      <TargetIcon />
      <span style={{ flex: 1, minWidth: 0 }}>
        <TagHeader gd={gd} id={rootId} />
        {SHOW_FOCUS_TEXT && (
          <span style={{ display: 'block', ...DETAIL_TEXT, fontSize: FOCUS.detailFont, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {claim?.text ?? rootId}
          </span>
        )}
      </span>
      <span style={{ flexShrink: 0, fontSize: FOCUS.labelFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim }}>
        reference root
      </span>
    </div>
  )
}

// The torn edge: a repeating zigzag "perforation" the full width of the stack.
// Pure decoration — the enclosing tear sets pointer-events: none, so nothing here
// is a target and it never expands.
function TornEdge() {
  const { tearHeight: h, tearToothW: w } = FOCUS
  return (
    <svg width="100%" height={h} style={{ display: 'block' }} aria-hidden>
      <defs>
        <pattern id="pz-tear" width={w} height={h} patternUnits="userSpaceOnUse">
          <path d={`M0 ${h - 3} L${w / 2} 3 L${w} ${h - 3}`} fill="none" stroke={COLORS.border} strokeWidth="1.5" />
        </pattern>
      </defs>
      <rect width="100%" height={h} fill="url(#pz-tear)" />
    </svg>
  )
}

// Torn edge + the hop count beside it. Inert: the tear only says "there's more
// between here and the root, and it's this many inference hops away".
function TearLine({ hops }: { hops: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, pointerEvents: 'none', margin: `${FOCUS.rootLineGap}px 0` }}>
      <div style={{ flex: 1, minWidth: 0 }}><TornEdge /></div>
      <span style={{ flexShrink: 0, fontSize: FOCUS.labelFont, color: COLORS.textDim, whiteSpace: 'nowrap' }}>
        <span style={{ fontWeight: 700, color: COLORS.textMuted }}>{hops}</span> hop{hops === 1 ? '' : 's'} to root
      </span>
    </div>
  )
}

// ── Above region — consumers as inference boxes carrying their output ─────────
//
// Where the centred claim C goes: one inference box per consuming inference, the
// same template as below, holding its output/destination tile with the inference's
// inputs bracketed beneath it. C is one of those inputs, and renders in its own
// grounds/warrant position marked as the centred claim — never omitted. Role is
// carried by the stub style (solid grounds / dashed warrant), not by a label. The
// output tile is the only upward navigation in the frame and recentres like any
// tile. Two inferences into one destination are two boxes — no dedupe, no
// multiplicity badge. The heading carries the fan-out count.

// One consuming inference: its box, with the destination as the output tile and C
// among the bracketed inputs.
function AboveEntry({ gd, inf, focusId, onFocus }: { gd: GraphData; inf: Inference; focusId: string; onFocus: (id: string) => void }) {
  return <InferenceBox gd={gd} inf={inf} onFocus={onFocus} output={outputOf(inf).id} centredId={focusId} />
}

// One polarity half of the Above region: its consuming inferences, stacked
// full-width like the Below boxes. An empty half is its heading and nothing else.
function AboveColumn({ gd, focusId, inferences, onFocus }: { gd: GraphData; focusId: string; inferences: Inference[]; onFocus: (id: string) => void }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: FOCUS.boxGap }}>
      {inferences.map(inf => <AboveEntry key={inf.id} gd={gd} inf={inf} focusId={focusId} onFocus={onFocus} />)}
    </div>
  )
}

function AboveRegion({ gd, focusId, onFocus }: { gd: GraphData; focusId: string; onFocus: (id: string) => void }) {
  const cons = consumersOf(gd, focusId)
  const supports = cons.filter(inf => outputOf(inf).kind === 'concludes')
  const contests = cons.filter(inf => outputOf(inf).kind === 'contests')
  return (
    <div>
      <div style={{ display: 'flex', gap: FOCUS.parentColGap, marginBottom: 6 }}>
        <RegionHeading text="Supports" count={supports.length} color={COLORS.column.for.label} />
        <RegionHeading text="Contests" count={contests.length} color={COLORS.column.against.label} />
      </div>
      <ScrollFrame height={FOCUS.aboveHeight}>
        <div style={{ display: 'flex', gap: FOCUS.parentColGap, alignItems: 'flex-start' }}>
          <AboveColumn gd={gd} focusId={focusId} inferences={supports} onFocus={onFocus} />
          <AboveColumn gd={gd} focusId={focusId} inferences={contests} onFocus={onFocus} />
        </div>
      </ScrollFrame>
    </div>
  )
}

// ── Focus band (§2, §3a) — the centred claim, larger and bordered ─────────────

function Attribution({ attribution }: { attribution: AttributionT }) {
  return (
    <div style={{ marginTop: 12 }}>
      {attribution.quote && (
        <div style={{ borderLeft: `2px solid ${COLORS.border}`, paddingLeft: 10, marginBottom: 6, color: COLORS.textMuted, fontStyle: 'italic', fontSize: FOCUS.rowFont, lineHeight: 1.5 }}>
          “{attribution.quote}”
        </div>
      )}
      <div style={{ fontSize: FOCUS.labelFont, color: COLORS.textDim }}>
        {sourceLabel(attribution.source as { type: string; reference?: string })}
      </div>
    </div>
  )
}

// ── Focus-band affordances ────────────────────────────────────────────────────

function IconBtn({ title, onClick, onMouseEnter, onMouseLeave, onFocus, onBlur, children }: {
  title: string
  onClick?: () => void
  onMouseEnter?: () => void
  onMouseLeave?: () => void
  onFocus?: () => void
  onBlur?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button" className="pz-iconbtn" title={title} aria-label={title}
      onClick={onClick} onMouseEnter={onMouseEnter} onMouseLeave={onMouseLeave} onFocus={onFocus} onBlur={onBlur}
    >
      {children}
    </button>
  )
}

// A back/undo arrow: the claim you navigated from. Hover to trace it, click to
// return to it.
function CameFromIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M1 4v6h6" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  )
}

function FocusBand({ gd, focusId, fromId, showFromIcon, isReferenceRoot, onFromHover, onFocus, onLocate, bandRef }: {
  gd: GraphData
  focusId: string
  fromId: string | null
  showFromIcon: boolean
  isReferenceRoot: boolean
  onFromHover: (on: boolean) => void
  onFocus: (id: string) => void
  onLocate: (id: string) => void
  bandRef: RefObject<HTMLDivElement>
}) {
  const claim = getClaim(gd, focusId)
  // The centred claim is the "you are here" surface — painted by its own stance at
  // the denser selected opacity, mirroring the graph's selected node. At the root it
  // reads aligned (root is aligned by construction), matching the pinned root line.
  const stance = stanceStyle(useStance(focusId), { selected: true, neutralBg: COLORS.surface, neutralBorder: COLORS.border })
  return (
    <div
      ref={bandRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: FOCUS.focusMinHeight,
        border: `2px solid ${COLORS.border}`,
        borderRadius: 10,
        padding: '16px 18px',
        ...stance,
      }}
    >
      {/* At the root, the band carries the target itself (no separate root line). */}
      {isReferenceRoot && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <TargetIcon size={15} />
          <span style={{ fontSize: FOCUS.labelFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim }}>
            reference root
          </span>
        </div>
      )}
      <div style={{ position: 'absolute', top: 10, right: 12, display: 'flex', gap: 4 }}>
        {showFromIcon && (
          <IconBtn
            title="Highlight where you came from — click to return"
            onMouseEnter={() => onFromHover(true)}
            onMouseLeave={() => onFromHover(false)}
            onFocus={() => onFromHover(true)}
            onBlur={() => onFromHover(false)}
            onClick={() => { if (fromId) onFocus(fromId) }}
          >
            <CameFromIcon />
          </IconBtn>
        )}
        <IconBtn title="Show in graph, zoomed to this claim" onClick={() => onLocate(focusId)}>
          <GraphIcon />
        </IconBtn>
      </div>
      <div style={{ paddingRight: showFromIcon ? 64 : 34 }}>
        <TagHeader gd={gd} id={focusId} />
        {SHOW_FOCUS_TEXT && (
          <div style={{ ...DETAIL_TEXT, fontSize: FOCUS.detailFont, lineHeight: 1.5 }}>
            {claim?.text ?? focusId}
          </div>
        )}
      </div>
      {claim?.terminal && <div style={{ marginTop: 12 }}><BedrockBadge /></div>}
      {claim?.attribution && <Attribution attribution={claim.attribution} />}
    </div>
  )
}

// ── Below region — supports / attacks, inference boxes ────────────────────────
//
// One inference box per inference, full column width and stacked within its
// polarity half (For left / Against right) — every box the same width, so they
// read as the same kind of thing; membership is the only assertion. Both halves
// share one fixed-height scroll frame, so a tall box runs off the scroll edge
// with its closed stroke intact. The heading carries the count; corpus order kept.
//
// C (the centred claim) is the output tile of every box here — the inference
// concludes or contests it — marked as the centred claim; the inference's grounds
// and warrants bracket beneath it.

function BelowColumn({
  gd, focusId, inferences, onFocus, emptyLabel,
}: { gd: GraphData; focusId: string; inferences: Inference[]; onFocus: (id: string) => void; emptyLabel: string }) {
  return (
    <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: FOCUS.boxGap }}>
      {inferences.length === 0
        ? <EmptyCell label={emptyLabel} />
        : inferences.map(inf => <InferenceBox key={inf.id} gd={gd} inf={inf} onFocus={onFocus} output={focusId} centredId={focusId} />)}
    </div>
  )
}

function BelowRegion({ gd, focusId, onFocus }: { gd: GraphData; focusId: string; onFocus: (id: string) => void }) {
  const supports = supportsOf(gd, focusId)
  const attacks = attacksOf(gd, focusId)
  return (
    <div>
      <div style={{ display: 'flex', gap: FOCUS.parentColGap, marginBottom: 6 }}>
        <RegionHeading text="For" count={supports.length} color={COLORS.column.for.label} />
        <RegionHeading text="Against" count={attacks.length} color={COLORS.column.against.label} />
      </div>
      <ScrollFrame height={FOCUS.columnHeight}>
        <div style={{ display: 'flex', gap: FOCUS.parentColGap, alignItems: 'flex-start' }}>
          <BelowColumn gd={gd} focusId={focusId} inferences={supports} onFocus={onFocus} emptyLabel="no argument yet" />
          <BelowColumn gd={gd} focusId={focusId} inferences={attacks} onFocus={onFocus} emptyLabel="no challenge yet" />
        </div>
      </ScrollFrame>
    </div>
  )
}

// ── Refocus flight ────────────────────────────────────────────────────────────
//
// The "your click is on its way to the centre" hint. On a tile click the whole
// surface crossfades to the newly centred claim; over that crossfade a single
// ghost of the clicked box flies from where it sat to where the new focus band
// lands. Three legs (§ config FOCUS.flight): fade the old surface out, fly the
// ghost source → measured band, fade the new surface in as the ghost fades out.
// The crossfade is what lets the ghost be an approximation — it never morphs
// shape, it just travels. Skipped entirely under prefers-reduced-motion.

type FlightPhase = 'out' | 'move' | 'in'
type Flight = { id: string; source: DOMRect; target: DOMRect | null; phase: FlightPhase }

// The flying box. A band-styled rectangle carrying the target claim's tag, pinned
// with position:fixed in viewport coords (matching the rects we measure). It sits
// on `source` until a `target` arrives, then the CSS transition carries it across;
// in the final leg it fades so the redrawn band shows through beneath it.
function Ghost({ gd, flight, sm }: { gd: GraphData; flight: Flight; sm: StanceMap | null }) {
  const FL = FOCUS.flight
  const st = sm ? (flight.id === sm.refRootId ? 'aligned' : sm.node.get(flight.id)) : undefined
  const stance = stanceStyle(st, { selected: true, neutralBg: COLORS.surface, neutralBorder: COLORS.border })
  const box = flight.target ?? flight.source
  const tag = getClaim(gd, flight.id)?.tag ?? flight.id
  return (
    <div
      aria-hidden
      style={{
        position: 'fixed',
        left: box.left, top: box.top, width: box.width, height: box.height,
        boxSizing: 'border-box',
        display: 'flex', alignItems: 'center',
        padding: '3px 4px 3px 9px',
        borderRadius: FOCUS.tileRadius,
        borderStyle: 'solid', borderWidth: 2,
        ...stance,
        opacity: flight.phase === 'in' ? 0 : 1,
        pointerEvents: 'none',
        zIndex: 40,
        willChange: 'left, top, width, height, opacity',
        transition:
          `left ${FL.move}ms ${FL.ease}, top ${FL.move}ms ${FL.ease}, ` +
          `width ${FL.move}ms ${FL.ease}, height ${FL.move}ms ${FL.ease}, ` +
          `opacity ${FL.fadeIn}ms ${FL.ease}`,
      }}
    >
      <span style={{ ...TAG_STYLE, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
        {tag}
      </span>
    </div>
  )
}

// ── Frame ─────────────────────────────────────────────────────────────────────

export function FocusView({
  gd, focusId, fromId = null, referenceRootId = null, onFocus, onLocate,
}: { gd: GraphData; focusId: string; fromId?: string | null; referenceRootId?: string | null; onFocus: (id: string) => void; onLocate: (id: string) => void }) {
  const claim = getClaim(gd, focusId)
  const hasParents = consumersOf(gd, focusId).length > 0
  const terminal = !!claim?.terminal

  // Stance relative to the reference root (the graph's Stage 3 origin; App has
  // already defaulted a cleared root back to the structural root before it reaches
  // us). Recomputed only when the root moves — navigating the stack keeps it. It
  // feeds both the hop count up to the root and the frontier hints on continuations.
  const sm = useMemo(() => computeStance(gd, referenceRootId), [gd, referenceRootId])
  const rootClaim = referenceRootId ? getClaim(gd, referenceRootId) : null
  const isAtRoot = rootClaim != null && referenceRootId === focusId
  // `dist` counts every claim↔inference edge — two per inference hop.
  const hopDist = rootClaim ? sm.dist.get(focusId) : undefined
  const hops = hopDist != null ? Math.round(hopDist / 2) : null
  // Root line + tear only when the root is real, off-centre, and genuinely above
  // us (a directed path exists). Centred ON the root, the focus band carries the
  // target instead — no line, no tear, no 0-hop restatement of the same claim.
  const showRootLine = rootClaim != null && !isAtRoot && hops != null && hops > 0

  // The claims already on screen — the frame the frontier hints measure *past*.
  const visible = useMemo(() => {
    const s = new Set(renderedClaimIds(gd, focusId))
    s.add(focusId)
    if (referenceRootId) s.add(referenceRootId)
    return s
  }, [gd, focusId, referenceRootId])
  const frontier = useMemo(
    () => (referenceRootId ? { sm, visible } : null),
    [referenceRootId, sm, visible],
  )

  // The claim you came from is only traceable when it's actually on screen — not
  // a co-input hidden behind a grounds-role tile, and not an entry from the graph.
  const fromVisible = useMemo(
    () => fromId != null && renderedClaimIds(gd, focusId).has(fromId),
    [gd, focusId, fromId],
  )
  const [showFrom, setShowFrom] = useState(false)
  // Tile hover raises the same rich tooltip the graph shows on a node. Cleared on
  // every refocus, since the hovered tile is unmounted/replaced without a leave.
  const [hovered, setHovered] = useState<{ id: string; x: number; y: number } | null>(null)
  const hoveredNode = hovered ? gd.nodeById.get(hovered.id) ?? null : null
  useEffect(() => { setShowFrom(false); setHovered(null) }, [focusId])   // reset on every refocus

  // ── Refocus flight ──────────────────────────────────────────────────────────
  // Honour the OS "reduce motion" setting — then a click is an instant swap.
  const reduceMotion = useMemo(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches,
    [],
  )
  const bandRef = useRef<HTMLDivElement>(null)
  const [flight, setFlight] = useState<Flight | null>(null)
  const FL = FOCUS.flight

  // Intercept every refocus: with a source rect (and motion allowed, and not the
  // claim we're already on) start a flight; otherwise swap straight through. A
  // flight already in progress swallows further clicks into a plain swap.
  const handleFocus = useCallback((id: string, source?: DOMRect) => {
    if (!source || reduceMotion || id === focusId || flight) { onFocus(id); return }
    setFlight({ id, source, target: null, phase: 'out' })
  }, [onFocus, focusId, reduceMotion, flight])

  // The flight's clock. `out`: fade the old surface, then swap focusId under the
  // fade and advance. `move`: the new band is now mounted but held invisible —
  // measure it, hand the ghost its target (the CSS transition flies it there),
  // then advance once the travel time is up. `in`: fade the new surface in beneath
  // the fading ghost, then clear. The focusId swap rides inside phase `out` so the
  // redraw happens while the surface is already dark.
  useEffect(() => {
    if (!flight) return
    if (flight.phase === 'out') {
      const t = setTimeout(() => {
        onFocus(flight.id)
        setFlight(f => (f ? { ...f, phase: 'move' } : f))
      }, FL.fadeOut)
      return () => clearTimeout(t)
    }
    if (flight.phase === 'move') {
      if (flight.target == null) {
        const rect = bandRef.current?.getBoundingClientRect()
        // No band to fly to (shouldn't happen post-swap) — skip the travel and just
        // crossfade, rather than re-measuring null forever into a render loop.
        if (!rect) { setFlight(f => (f ? { ...f, phase: 'in' } : f)); return }
        setFlight(f => (f ? { ...f, target: rect } : f))
        return
      }
      const t = setTimeout(() => setFlight(f => (f ? { ...f, phase: 'in' } : f)), FL.move)
      return () => clearTimeout(t)
    }
    const t = setTimeout(() => setFlight(null), FL.fadeIn)   // phase 'in'
    return () => clearTimeout(t)
  }, [flight, onFocus, FL.fadeOut, FL.move, FL.fadeIn])

  // The surface is dark for the whole flight except the final fade-in leg; the old
  // content shows through phase `out` (focusId hasn't swapped yet), the new through
  // `in`. `move` holds it invisible so the freshly mounted band can't pop in early.
  const surfaceOpacity = !flight || flight.phase === 'in' ? 1 : 0
  const surfaceTransition = flight
    ? `opacity ${flight.phase === 'in' ? FL.fadeIn : FL.fadeOut}ms ${FL.ease}`
    : 'none'

  return (
    <div style={{ position: 'fixed', top: TITLE_BAR_HEIGHT, left: 0, right: 0, bottom: 0, overflowY: 'auto', background: COLORS.background }}>
      <style>{focusCss}</style>
      <HoverContext.Provider value={(id, x, y) => setHovered(id != null && x != null && y != null ? { id, x, y } : null)}>
      <FromHighlight.Provider value={{ id: fromVisible ? fromId : null, active: showFrom }}>
       <LocateContext.Provider value={onLocate}>
        <FrontierContext.Provider value={frontier}>
        <StanceContext.Provider value={referenceRootId ? sm : null}>
        <div style={{ maxWidth: FOCUS.columnMaxWidth, margin: '0 auto', padding: '28px 20px 96px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', opacity: surfaceOpacity, transition: surfaceTransition }}>
          {/* What's ultimately at stake, then the inert tear for the hidden hops. */}
          {showRootLine && (
            <>
              <RootLine gd={gd} rootId={referenceRootId as string} onFocus={handleFocus} />
              <TearLine hops={hops as number} />
            </>
          )}

          {hasParents && (
            <>
              <AboveRegion gd={gd} focusId={focusId} onFocus={handleFocus} />
              <Connector />
            </>
          )}

          <FocusBand
            gd={gd} focusId={focusId} fromId={fromId}
            showFromIcon={fromVisible}
            isReferenceRoot={isAtRoot}
            onFromHover={setShowFrom}
            onFocus={handleFocus}
            onLocate={onLocate}
            bandRef={bandRef}
          />

          {/* Terminals cannot be concluded or contested (I7/I8): omit the whole
              children band rather than render empty-pending cells (§8). */}
          {!terminal && (
            <>
              <Connector />
              <BelowRegion gd={gd} focusId={focusId} onFocus={handleFocus} />
            </>
          )}
        </div>
        </StanceContext.Provider>
        </FrontierContext.Provider>
       </LocateContext.Provider>
      </FromHighlight.Provider>
      </HoverContext.Provider>
      {flight && <Ghost gd={gd} flight={flight} sm={referenceRootId ? sm : null} />}
      {hovered && hoveredNode && <Tooltip node={hoveredNode} x={hovered.x} y={hovered.y} nodeById={gd.nodeById} />}
    </div>
  )
}
