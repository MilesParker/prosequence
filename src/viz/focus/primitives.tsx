// primitives.tsx — the focus view's small shared parts: pip, bedrock badge,
// dashed empty-state cell, and the clickable claim row that carries them.
//
// These are the §9a "primitive components" for this surface. They read the
// shared pip/colour tokens; they do not reach above the primitive level.

import { createContext, useContext } from 'react'
import { COLORS, FOCUS } from '../../config'
import type { GraphData } from '../graphData'
import { getClaim, isSupported, isContested } from './focusData'

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

/** One §4 pip: 8px circle, one of two solid fills. Presence only. */
export function Pip({ kind }: { kind: 'supported' | 'contested' }) {
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: FOCUS.pipSize,
        height: FOCUS.pipSize,
        borderRadius: '50%',
        flexShrink: 0,
        background: kind === 'supported' ? COLORS.pip.supported : COLORS.pip.contested,
      }}
    />
  )
}

/** Terminal claims wear this instead of pips: outlined, muted, no fill. */
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

/**
 * Status marks for a claim id: a bedrock badge if terminal, otherwise zero,
 * one, or two pips per the §4 predicates. Both pips = live dispute.
 */
export function ClaimStatus({ gd, id }: { gd: GraphData; id: string }) {
  const claim = getClaim(gd, id)
  if (claim?.terminal) return <BedrockBadge />
  const sup = isSupported(gd, id)
  const con = isContested(gd, id)
  if (!sup && !con) return null
  return (
    <span style={{ display: 'inline-flex', gap: FOCUS.pipGap, alignItems: 'center', flexShrink: 0 }}>
      {sup && <Pip kind="supported" />}
      {con && <Pip kind="contested" />}
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
  return (
    <div
      className="pz-row"
      onClick={() => onFocus(id)}
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'baseline',
        padding: '6px 8px',
        borderRadius: 6,
        cursor: 'pointer',
        fontSize: FOCUS.rowFont,
        lineHeight: 1.5,
        color: COLORS.text,
        ...hl,
      }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>{claim?.text ?? id}</span>
      <ClaimStatus gd={gd} id={id} />
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
