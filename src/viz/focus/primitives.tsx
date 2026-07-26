// primitives.tsx — the focus view's small shared parts: pip, bedrock badge,
// dashed empty-state cell, and the clickable claim row that carries them.
//
// These are the §9a "primitive components" for this surface. They read the
// shared pip/colour tokens; they do not reach above the primitive level.

import { createContext, useContext } from 'react'
import { COLORS, FOCUS, REF_ROOT, STANCE_FILL_OPACITY, STANCE_SELECTED_FILL_OPACITY } from '../../config'
import type { GraphData, StanceMap, Stance } from '../graphData'
import { stanceColor } from '../graphData'
import { getClaim, frontierStance } from './focusData'

/**
 * The claim you navigated *from*, plus whether the focus band's trace icon is
 * engaged. Consumed by every clickable claim — ClaimRow here and ClaimTap in the
 * parent band — so the matching one rings itself while the icon is held.
 */
export const FromHighlight = createContext<{ id: string | null; active: boolean }>({ id: null, active: false })

/** Ring + wash for the came-from claim, applied only while the trace is active. */
export function useFromHighlight(id: string): { boxShadow: string; background: string } | null {
  const { id: fromId, active } = useContext(FromHighlight)
  return active && fromId === id
    ? { boxShadow: `0 0 0 2px ${FOCUS.fromRing}`, background: FOCUS.fromTint }
    : null
}

/** "Show <claim> in the graph, zoomed to its neighbourhood." Provided by the
 *  focus view so every visible claim can locate itself, not just the centre. */
export const LocateContext = createContext<(id: string) => void>(() => {})

/**
 * The Stage 3 stance map plus the claims currently on screen, provided by the
 * focus view so any claim rendered as a continuation can mark what's hidden past
 * it (see `frontierStance`). Null when there's no reference root to measure from.
 */
export const FrontierContext = createContext<{ sm: StanceMap; visible: Set<string> } | null>(null)

// ── Stance fill ───────────────────────────────────────────────────────────────
//
// Stance is the absolute channel: where a claim sits relative to the reference
// root. It is carried by the FILL on every claim surface (this replaces the old
// frontier-chevron colouring), mirroring the graph's node wash so the two surfaces
// cannot drift. POSITION (For/Against, Supports/Contests) stays a separate channel
// carried by layout + chrome tint; the two are independent and both hues appearing
// in one column is the expected off-root state, not an error.

/** The Stage-3 stance map, provided by the focus view so every claim surface can
 *  paint its own stance. Null when there is no reference root to measure against —
 *  then nothing is painted (the honesty constraint: no fill without a legible root
 *  in the frame, which the pinned root line / focus-band header guarantee). */
export const StanceContext = createContext<StanceMap | null>(null)

/** This claim's stance relative to the reference root. The root is `aligned` by
 *  construction (it is on its own side); `computeStance` leaves it out of the map,
 *  so we special-case it exactly as the graph does. Undefined ⇒ neutral / no root. */
export function useStance(id: string): Stance | undefined {
  const sm = useContext(StanceContext)
  if (!sm) return undefined
  return id === sm.refRootId ? 'aligned' : sm.node.get(id)
}

/** 'hsl(h, s%, l%)' → 'hsla(h, s%, l%, a)'. The pale wash is derived from the one
 *  token definition, so there is never a second colour literal to drift. */
function hslaFrom(hsl: string, alpha: number): string {
  return hsl.replace('hsl(', 'hsla(').replace(/\)\s*$/, `, ${alpha})`)
}

/** The stance wash for a claim surface: a pale fill of the stance hue over a
 *  saturated border of the same hue — the graph's node treatment ported to CSS.
 *  `selected` uses the denser fill the graph gives its centred node. Neutral / no
 *  stance paints nothing this pass (neutral = 0 in every corpus); callers that are
 *  standalone cards pass a `neutral*` fallback so they keep a visible edge. */
export function stanceStyle(
  st: Stance | undefined,
  { selected = false, neutralBg = 'transparent', neutralBorder = 'transparent' } = {},
): { background: string; borderColor: string } {
  if (!st || st === 'neutral') return { background: neutralBg, borderColor: neutralBorder }
  const hue = stanceColor(st)
  return {
    background: hslaFrom(hue, selected ? STANCE_SELECTED_FILL_OPACITY : STANCE_FILL_OPACITY),
    borderColor: hue,
  }
}

/** The reference-root "target": a small bullseye in ink, no stance hue — it marks
 *  the origin all stance is measured from, matching the graph's ringed target. Used
 *  only to *label* the root in the focus view (root line / focus-band header); the
 *  reference root is moved from the graph's key, never from here. */
export function TargetIcon({ size = FOCUS.targetIcon }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={REF_ROOT.ringColor} strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="4.5" />
      <circle cx="12" cy="12" r="1.4" fill={REF_ROOT.ringColor} stroke="none" />
    </svg>
  )
}

/** A small node-and-edge network glyph: the "show in graph" affordance. */
export function GraphIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="6" cy="7" r="2.4" />
      <circle cx="18" cy="6" r="2.4" />
      <circle cx="13" cy="18" r="2.4" />
      <line x1="8.4" y1="6.8" x2="15.6" y2="6.2" />
      <line x1="7.3" y1="9" x2="11.7" y2="16" />
      <line x1="17.1" y1="8.2" x2="13.9" y2="15.8" />
    </svg>
  )
}

/** Terminal claims wear this: outlined, muted, no fill. A bedrock claim is a
 *  dead end — nothing is hidden past it — so it reads as "no continuation here". */
export function BedrockBadge() {
  return (
    <span
      style={{
        fontSize: FOCUS.labelFont,
        textTransform: 'uppercase',
        letterSpacing: '0.08em',
        color: COLORS.textMuted,
        border: `1px solid ${COLORS.textDim}`,
        borderRadius: 4,
        padding: '1px 6px',
        whiteSpace: 'nowrap',
      }}
    >
      bedrock
    </span>
  )
}

/** A small double chevron: "there's more this way." A pure frontier marker — it no
 *  longer carries stance (that moved to the surface fill); it rides only on claims
 *  whose own support/attack is off-frame (see FrontierMark). */
function FrontierGlyph({ color }: { color: string }) {
  return (
    <svg width="13" height="13" viewBox="0 0 12 12" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2.5 2 L6.5 6 L2.5 10" />
      <path d="M6 2 L10 6 L6 10" opacity="0.5" />
    </svg>
  )
}

/**
 * The frontier mark for a claim shown as a continuation: a bedrock badge if it's a
 * dead end, otherwise a de-stanced chevron that just says "there's more past here,
 * open it to follow." Stance itself is now the surface fill, so the chevron only
 * marks *presence* of a hidden branch — `frontierStance` is reused purely as the
 * "is anything hidden past here" oracle (non-null), its hue discarded. Nothing at
 * all when there's no reference root, or when nothing is hidden past this claim.
 * Terminals keep the badge in ADDITION to their fill (the fill comes from the row).
 */
export function FrontierMark({ gd, id }: { gd: GraphData; id: string }) {
  const claim = getClaim(gd, id)
  const ctx = useContext(FrontierContext)
  if (claim?.terminal) return <BedrockBadge />
  if (!ctx) return null
  const hasHidden = frontierStance(gd, ctx.sm, id, ctx.visible) != null
  if (!hasHidden) return null
  return (
    <span title="More past here — open it to follow" style={{ display: 'inline-flex', flexShrink: 0 }}>
      <FrontierGlyph color={COLORS.textDim} />
    </span>
  )
}

/**
 * The right-hand marks on any claim: its frontier hint (stance chevron / bedrock)
 * with a small "show in graph" button stacked just below. The button locates
 * *this* claim on the map; stopPropagation keeps the click off the row's
 * recentre gesture.
 */
export function ClaimMarks({ gd, id }: { gd: GraphData; id: string }) {
  const onLocate = useContext(LocateContext)
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
      <FrontierMark gd={gd} id={id} />
      <button
        type="button" className="pz-graphbtn" title="Show in graph" aria-label="Show in graph"
        onClick={e => { e.stopPropagation(); onLocate(id) }}
      >
        <GraphIcon size={13} />
      </button>
    </span>
  )
}

/**
 * A claim as one clickable row: its text plus status marks. Clicking refocuses
 * the whole stack on that claim — the only navigation gesture in a cell.
 * Attributive claims render text only here; source/quote read in the focus
 * band (§3a).
 */
export function ClaimRow({
  gd, id, onFocus,
}: { gd: GraphData; id: string; onFocus: (id: string) => void }) {
  const claim = getClaim(gd, id)
  const hl = useFromHighlight(id)
  const stance = stanceStyle(useStance(id))
  return (
    <div
      className="pz-row"
      onClick={() => onFocus(id)}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: FOCUS.rowFont,
        lineHeight: 1.5,
        color: COLORS.text,
        boxSizing: 'border-box',
        border: '1px solid transparent',
        marginBottom: 4,
        ...stance,   // stance wash: pale fill + saturated border, by stance
        ...hl,       // came-from trace overrides the wash while engaged
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{claim?.text ?? id}</span>
      <ClaimMarks gd={gd} id={id} />
    </div>
  )
}

/** Dashed placeholder for a For/Against column with no inference yet (§8). */
export function EmptyCell({ label }: { label: string }) {
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `1px dashed ${COLORS.border}`,
        borderRadius: FOCUS.cellRadius,
        padding: '18px 14px',
        color: COLORS.textDim,
        fontStyle: 'italic',
        fontSize: FOCUS.rowFont,
        textAlign: 'center',
      }}
    >
      {label}
    </div>
  )
}
