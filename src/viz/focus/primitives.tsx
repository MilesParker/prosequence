// primitives.tsx — the focus view's small shared parts: pip, bedrock badge,
// dashed empty-state cell, and the clickable claim row that carries them.
//
// These are the §9a "primitive components" for this surface. They read the
// shared pip/colour tokens; they do not reach above the primitive level.

import { createContext, useContext } from 'react'
import { COLORS, FOCUS, REF_ROOT, SHOW_FOCUS_TAGS, STANCE_FILL_OPACITY, STANCE_SELECTED_FILL_OPACITY, TAG_TEXT } from '../../config'
import type { GraphData, StanceMap, Stance } from '../graphData'
import { stanceColor } from '../graphData'
import { getClaim, frontierStance } from './focusData'

/**
 * The claim you navigated *from*, plus whether the focus band's trace icon is
 * engaged. Consumed by every clickable claim — the ClaimTile — so the matching
 * one rings itself while the trace icon is held.
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

/** Tile hover, reported to the focus view so it can raise the same rich tooltip
 *  the graph shows on a node (tag, full text, attribution, uncertain). Called with
 *  the claim id and cursor position on move, and `null` on leave. */
export const HoverContext = createContext<(id: string | null, x?: number, y?: number) => void>(() => {})

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
  { selected = false, neutralBg = 'transparent', neutralBorder = 'transparent', fillOpacity }:
    { selected?: boolean; neutralBg?: string; neutralBorder?: string; fillOpacity?: number } = {},
): { background: string; borderColor: string } {
  if (!st || st === 'neutral') return { background: neutralBg, borderColor: neutralBorder }
  const hue = stanceColor(st)
  // Explicit fillOpacity wins (containers wash lighter); otherwise selected vs regular.
  const alpha = fillOpacity ?? (selected ? STANCE_SELECTED_FILL_OPACITY : STANCE_FILL_OPACITY)
  return { background: hslaFrom(hue, alpha), borderColor: hue }
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
 * The marks trailing a claim tile: its frontier hint (stance chevron / bedrock)
 * and a small "show in graph" button, inline so the pill stays one line tall. The
 * button locates *this* claim on the map; stopPropagation keeps the click off the
 * tile's recentre gesture. The chevron is information and always shows; the locate
 * button is chrome and rides in on tile hover (see `.pz-tile` CSS).
 */
function TileMarks({ gd, id }: { gd: GraphData; id: string }) {
  const onLocate = useContext(LocateContext)
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
      <FrontierMark gd={gd} id={id} />
      <button
        type="button" className="pz-graphbtn" title="Show in graph" aria-label="Show in graph"
        onClick={e => { e.stopPropagation(); onLocate(id) }}
      >
        <GraphIcon size={12} />
      </button>
    </span>
  )
}

/**
 * The one tag look, shared by every place a tag appears — standing alone on a tile
 * and heading a claim whose detail is shown — so a tag reads the same either way.
 * The tag is the primary identifier: plain, ink, prominent, the most visible text
 * in its context; the claim's full text sits under it as muted detail. Text
 * formatting only; layout (margins, ellipsis) stays with each caller.
 */
export const TAG_STYLE = { ...TAG_TEXT, fontSize: FOCUS.tagFont } as const

/**
 * A claim's `tag` as a mini header above its text — a short handle for the claim.
 * Gated by SHOW_FOCUS_TAGS so it can be flipped off everywhere at once; renders
 * nothing when the flag is off or the claim carries no tag. Wears the shared tag
 * look (TAG_STYLE), so it matches the tag on a tile.
 */
export function TagHeader({ gd, id }: { gd: GraphData; id: string }) {
  if (!SHOW_FOCUS_TAGS) return null
  const tag = getClaim(gd, id)?.tag
  if (!tag) return null
  return <div style={{ ...TAG_STYLE, marginBottom: 2 }}>{tag}</div>
}

/**
 * A claim as a tile: a full-width rounded rect carrying its tag and nothing else —
 * no structural words, no role name, no full text at rest. Stance owns the fill.
 * Hover reveals the full text (the shared graph tooltip); clicking recentres the
 * stack on the claim. Frontier chevron / bedrock and a hover-in locate button
 * trail the tag as marks, not content.
 *
 * `centred` marks the tile as the claim the stack is currently centred on. It wears
 * the focus band's own treatment — the denser selected stance fill and a heavier
 * stroke — and is left BLANK inside (no tag, no marks): the reader already sees C's
 * full identity in the focus band, so the tile only needs to say "this position is
 * C." It is inert (not clickable) but still raises the tooltip on hover.
 */
export function ClaimTile({
  gd, id, onFocus, centred = false,
}: { gd: GraphData; id: string; onFocus: (id: string) => void; centred?: boolean }) {
  const claim = getClaim(gd, id)
  const hl = useFromHighlight(id)
  const onHover = useContext(HoverContext)
  // Tiles are standalone surfaces, so neutral / no-root paints a plain card edge
  // rather than nothing — stance fill takes over the moment a root is in frame. The
  // centred tile mirrors the focus band: the selected (denser) fill and a 2px stroke.
  const stance = stanceStyle(useStance(id), { selected: centred, neutralBg: COLORS.surface, neutralBorder: COLORS.border })
  return (
    <span
      // No hover-lift affordance on the inert centred tile — only ordinary tiles
      // read as clickable (see `.pz-tile`); the tooltip still fires from the handlers.
      className={centred ? undefined : 'pz-tile'}
      onClick={centred ? undefined : () => onFocus(id)}
      onMouseMove={e => onHover(id, e.clientX, e.clientY)}
      onMouseLeave={() => onHover(null)}
      title={centred ? 'The claim you are centred on' : undefined}
      style={{
        display: 'flex',
        width: '100%',
        alignItems: 'center',
        gap: 6,
        cursor: centred ? 'default' : 'pointer',
        borderRadius: FOCUS.tileRadius,   // rounded rect, like a graph node
        padding: '3px 4px 3px 9px',
        lineHeight: 1.3,
        boxSizing: 'border-box',
        // Longhands, NOT the `border` shorthand: `stanceStyle` supplies `borderColor`
        // separately, and a shorthand + longhand mix makes React's style diff reset
        // borderColor to transparent on some node-reuse updates (border vanishes).
        borderStyle: 'solid',
        borderWidth: centred ? 2 : 1,
        ...stance,   // stance wash: pale fill + saturated border (denser when centred)
        ...(centred ? null : hl),   // came-from trace only on ordinary tiles
      }}
    >
      {centred ? (
        // Blank, but reserving one text line so it stands the same height as a filled tile.
        <span style={{ ...TAG_STYLE, flex: 1 }}>{' '}</span>
      ) : (
        <>
          <span style={{ ...TAG_STYLE, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
            {claim?.tag ?? id}
          </span>
          <TileMarks gd={gd} id={id} />
        </>
      )}
    </span>
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
