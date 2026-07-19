// FocusView.tsx — the band-stack surface. Centres one claim; derives the rest.
//
// Vertical zones (§2): parent band → focus band → For/Against columns.
// Two gestures only (§7): refocus (click a claim / parent entry) and page
// (chevrons, For/Against columns only). No expand/collapse; everything visible
// at rest. Page state resets on refocus via a `key` keyed to the focus id.

import { useState, useEffect, useMemo, Fragment, type ReactNode } from 'react'
import { COLORS, FOCUS, TITLE_BAR_HEIGHT } from '../../config'
import type { GraphData } from '../graphData'
import type { Inference, Attribution as AttributionT } from '../../types'
import { sourceLabel } from '../graphData'
import {
  getClaim, supportsOf, attacksOf, consumersOf, outputOf, roleOf, renderedClaimIds, type Output,
} from './focusData'
import { ClaimStatus, BedrockBadge, EmptyCell, FromHighlight, useFromHighlight } from './primitives'
import { Cell } from './Cell'

// Hover affordances live in CSS so rows/entries need no per-node state.
const focusCss = `
  .pz-row { transition: background .12s ease; }
  .pz-row:hover { background: hsla(220, 24%, 20%, 0.05); }
  .pz-chev { background: none; border: none; cursor: pointer; padding: 0 6px; line-height: 1; font-size: 16px; color: ${COLORS.textDim}; }
  .pz-chev:not(:disabled):hover { color: ${COLORS.text}; }
  .pz-chev:disabled { opacity: 0.3; cursor: default; }
  .pz-iconbtn { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border-radius: 6px; border: 1px solid transparent; background: none; cursor: pointer; color: ${COLORS.textDim}; transition: color .12s ease, background .12s ease, border-color .12s ease; }
  .pz-iconbtn:hover { color: ${COLORS.text}; background: hsla(220, 24%, 20%, 0.05); border-color: ${COLORS.border}; }
`

function Connector() {
  return <div style={{ width: 1, height: FOCUS.connector, background: COLORS.border, alignSelf: 'center' }} />
}

// ── Parent band (§1–§3) — two fixed columns, paged like For/Against ───────────
//
// Supports / Contests are fixed positions assigned by each consumer inference's
// output polarity (concludes / contests). Each column is a fixed-height card
// paged one entry at a time (grounds-role entries before assumption-role); an
// empty column keeps its header and shows nothing under it — no placeholder,
// since a parent entry can't be authored from this frame (§1). A grounds-role
// entry is the destination claim; a warrant-role entry the `{grounds} → {dest}`
// pair (§3). Every claim shown recentres on tap (§7).

type ParentEntry = { inf: Inference; out: Output; role: 'grounds' | 'warrants' }
type Tint = { tint: string; bg: string; border: string; label: string }

// A claim as an inline tap target: text + status marks, recentring on click.
// The tile itself is never a target — only the claims inside it are (§6, §7),
// so tile chrome carries no click affordance and each claim carries its own.
function ClaimTap({ gd, id, onFocus }: { gd: GraphData; id: string; onFocus: (id: string) => void }) {
  const claim = getClaim(gd, id)
  const hl = useFromHighlight(id)
  return (
    <span
      className="pz-row"
      onClick={() => onFocus(id)}
      style={{ display: 'inline-flex', gap: FOCUS.pipGap, alignItems: 'baseline', cursor: 'pointer', borderRadius: 5, padding: '1px 4px', color: COLORS.text, ...hl }}
    >
      <span>{claim?.text ?? id}</span>
      <ClaimStatus gd={gd} id={id} />
    </span>
  )
}

// One paged entry, filling the reserved height as a tinted card that mirrors a
// For/Against cell. A grounds-role entry is the destination claim alone; a
// warrant-role entry the `{grounds} → {destination}` pair (§3) — the destination
// alone can't say which inference C bridges. The role label names how C (not the
// tile's claim) participates; the `→` is decoration, not a tap target (§7).
function ParentEntryCard({ gd, entry, tint, onFocus }: { gd: GraphData; entry: ParentEntry; tint: Tint; onFocus: (id: string) => void }) {
  const { inf, out, role } = entry
  const grounds = (inf.grounds ?? []).map(String)
  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${tint.border}`,
        borderTop: `2px solid ${tint.tint}`,
        borderRadius: FOCUS.cellRadius,
        background: tint.bg,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 10px', fontSize: FOCUS.rowFont, lineHeight: 1.4, color: COLORS.text }}>
        <div style={{ fontSize: FOCUS.labelFont, color: tint.label, fontStyle: 'italic', letterSpacing: '0.03em', marginBottom: 6 }}>
          {role === 'grounds' ? 'as grounds' : 'as an assumption'}
        </div>
        {role === 'grounds' ? (
          <ClaimTap gd={gd} id={out.id} onFocus={onFocus} />
        ) : (
          // The `→` prefixes the destination as one non-breaking unit, so on a long
          // grounds claim the arrow wraps *with* the destination rather than
          // stranding itself on a line pointing at nothing.
          <span style={{ display: 'inline-flex', flexWrap: 'wrap', alignItems: 'baseline', columnGap: 3, rowGap: 3 }}>
            {grounds.map((g, i) => (
              <Fragment key={g}>
                {i > 0 && <span aria-hidden style={{ color: COLORS.textDim }}>+</span>}
                <ClaimTap gd={gd} id={g} onFocus={onFocus} />
              </Fragment>
            ))}
            <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
              <span aria-hidden style={{ color: COLORS.textDim }}>→</span>
              <ClaimTap gd={gd} id={out.id} onFocus={onFocus} />
            </span>
          </span>
        )}
      </div>
    </div>
  )
}

// One fixed-height column, paged like For/Against (§5 reversed on request). Both
// headers always render (§1); an empty column is a header over reserved space —
// polarity is a position, not a presence — with no placeholder card.
function ParentColumn({ gd, column, entries, onFocus }: { gd: GraphData; column: 'supports' | 'contests'; entries: ParentEntry[]; onFocus: (id: string) => void }) {
  const [page, setPage] = useState(0)
  const heading = column === 'supports' ? 'Supports' : 'Contests'
  const tint = column === 'supports' ? COLORS.column.for : COLORS.column.against

  const n = entries.length
  const i = Math.min(page, Math.max(0, n - 1))

  return (
    <div style={{ flex: 1, minWidth: 0, height: FOCUS.columnHeight, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, fontSize: FOCUS.labelFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: tint.label, textAlign: 'center' }}>
        {heading}
      </div>
      <div style={{ flexShrink: 0, height: FOCUS.pagerHeight, display: 'flex', alignItems: 'center' }}>
        {n > 1 && <div style={{ width: '100%' }}><Pager i={i} n={n} onPrev={() => setPage(i - 1)} onNext={() => setPage(i + 1)} /></div>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {n > 0 && <ParentEntryCard gd={gd} entry={entries[i]} tint={tint} onFocus={onFocus} />}
      </div>
    </div>
  )
}

function ParentBand({ gd, focusId, onFocus }: { gd: GraphData; focusId: string; onFocus: (id: string) => void }) {
  // One entry per consumer inference; polarity picks the column, role the order.
  const entries: ParentEntry[] = consumersOf(gd, focusId).map(inf => ({
    inf,
    out: outputOf(inf),
    role: roleOf(inf, focusId) ?? 'grounds',
  }))
  // Grounds-role entries page before assumption-role ones (§2 order preserved).
  const byRole = (a: ParentEntry, b: ParentEntry) => (a.role === b.role ? 0 : a.role === 'grounds' ? -1 : 1)
  const supports = entries.filter(e => e.out.kind === 'concludes').sort(byRole)
  const contests = entries.filter(e => e.out.kind === 'contests').sort(byRole)
  // Keyed to the focus id so paging resets on every refocus (like For/Against).
  return (
    <div style={{ display: 'flex', gap: FOCUS.parentColGap, alignItems: 'flex-start' }}>
      <ParentColumn key={`sup-${focusId}`} gd={gd} column="supports" entries={supports} onFocus={onFocus} />
      <ParentColumn key={`con-${focusId}`} gd={gd} column="contests" entries={contests} onFocus={onFocus} />
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

// A crosshair: locate this claim back on the map, zoomed to its surroundings.
function LocateIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="8.5" />
      <line x1="12" y1="1.5" x2="12" y2="6" />
      <line x1="12" y1="18" x2="12" y2="22.5" />
      <line x1="1.5" y1="12" x2="6" y2="12" />
      <line x1="18" y1="12" x2="22.5" y2="12" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </svg>
  )
}

function FocusBand({ gd, focusId, fromId, showFromIcon, onFromHover, onFocus, onLocate }: {
  gd: GraphData
  focusId: string
  fromId: string | null
  showFromIcon: boolean
  onFromHover: (on: boolean) => void
  onFocus: (id: string) => void
  onLocate: (id: string) => void
}) {
  const claim = getClaim(gd, focusId)
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        minHeight: FOCUS.focusMinHeight,
        border: `2px solid ${COLORS.border}`,
        borderRadius: 10,
        background: COLORS.surface,
        padding: '16px 18px',
      }}
    >
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
          <LocateIcon />
        </IconBtn>
      </div>
      <div style={{ fontSize: FOCUS.focusFont, fontWeight: 600, lineHeight: 1.45, color: COLORS.text, paddingRight: showFromIcon ? 64 : 34 }}>
        {claim?.text ?? focusId}
      </div>
      {claim?.terminal && <div style={{ marginTop: 12 }}><BedrockBadge /></div>}
      {claim?.attribution && <Attribution attribution={claim.attribution} />}
    </div>
  )
}

// ── For / Against column (§6) — pages OR-siblings; never scrolls, never stacks ─

function Pager({ i, n, onPrev, onNext }: { i: number; n: number; onPrev: () => void; onNext: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: COLORS.textMuted, fontSize: FOCUS.labelFont }}>
      <button className="pz-chev" onClick={onPrev} disabled={i === 0} aria-label="previous">‹</button>
      <span>{i + 1} of {n}</span>
      <button className="pz-chev" onClick={onNext} disabled={i === n - 1} aria-label="next">›</button>
    </div>
  )
}

function Column({
  gd, inferences, column, onFocus, emptyLabel,
}: { gd: GraphData; inferences: Inference[]; column: 'for' | 'against'; onFocus: (id: string) => void; emptyLabel: string }) {
  const [page, setPage] = useState(0)
  const label = column === 'for' ? COLORS.column.for.label : COLORS.column.against.label
  const heading = column === 'for' ? 'For' : 'Against'

  const n = inferences.length
  const i = Math.min(page, Math.max(0, n - 1))

  // Fixed height, equal for both columns, so refocusing never resizes the band.
  // Header and a pager slot are always present; only the cell area scrolls, and
  // only on the rare cell that exceeds the reserved height.
  return (
    <div style={{ flex: 1, minWidth: 0, height: FOCUS.columnHeight, display: 'flex', flexDirection: 'column' }}>
      <div style={{ flexShrink: 0, fontSize: FOCUS.labelFont, textTransform: 'uppercase', letterSpacing: '0.08em', color: label, textAlign: 'center' }}>
        {heading}
      </div>
      <div style={{ flexShrink: 0, height: FOCUS.pagerHeight, display: 'flex', alignItems: 'center' }}>
        {n > 1 && <div style={{ width: '100%' }}><Pager i={i} n={n} onPrev={() => setPage(i - 1)} onNext={() => setPage(i + 1)} /></div>}
      </div>
      <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
        {n === 0
          ? <EmptyCell label={emptyLabel} />
          : <Cell gd={gd} inf={inferences[i]} column={column} onFocus={onFocus} />}
      </div>
    </div>
  )
}

// ── Frame ─────────────────────────────────────────────────────────────────────

export function FocusView({
  gd, focusId, fromId = null, onFocus, onLocate,
}: { gd: GraphData; focusId: string; fromId?: string | null; onFocus: (id: string) => void; onLocate: (id: string) => void }) {
  const claim = getClaim(gd, focusId)
  const hasParents = consumersOf(gd, focusId).length > 0
  const terminal = !!claim?.terminal

  // The claim you came from is only traceable when it's actually on screen — not
  // a co-input hidden behind a grounds-role tile, and not an entry from the graph.
  const fromVisible = useMemo(
    () => fromId != null && renderedClaimIds(gd, focusId).has(fromId),
    [gd, focusId, fromId],
  )
  const [showFrom, setShowFrom] = useState(false)
  useEffect(() => setShowFrom(false), [focusId])   // drop the trace on every refocus

  return (
    <div style={{ position: 'fixed', top: TITLE_BAR_HEIGHT, left: 0, right: 0, bottom: 0, overflowY: 'auto', background: COLORS.background }}>
      <style>{focusCss}</style>
      <FromHighlight.Provider value={{ id: fromVisible ? fromId : null, active: showFrom }}>
        <div style={{ maxWidth: FOCUS.columnMaxWidth, margin: '0 auto', padding: '28px 20px 96px', display: 'flex', flexDirection: 'column', alignItems: 'stretch' }}>
          {hasParents && (
            <>
              <ParentBand gd={gd} focusId={focusId} onFocus={onFocus} />
              <Connector />
            </>
          )}

          <FocusBand
            gd={gd} focusId={focusId} fromId={fromId}
            showFromIcon={fromVisible}
            onFromHover={setShowFrom}
            onFocus={onFocus}
            onLocate={onLocate}
          />

          {/* Terminals cannot be concluded or contested (I7/I8): omit the whole
              children band rather than render empty-pending cells (§8). */}
          {!terminal && (
            <>
              <Connector />
              <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
                <Column key={`for-${focusId}`} gd={gd} inferences={supportsOf(gd, focusId)} column="for" onFocus={onFocus} emptyLabel="no argument yet" />
                <Column key={`against-${focusId}`} gd={gd} inferences={attacksOf(gd, focusId)} column="against" onFocus={onFocus} emptyLabel="no challenge yet" />
              </div>
            </>
          )}
        </div>
      </FromHighlight.Provider>
    </div>
  )
}
