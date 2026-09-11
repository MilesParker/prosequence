// Workspace.tsx — the single page. Two columns: the map, and the READER beside it
// (the article or the focus view, one at a time — see App). They coexist, so a
// selection made in either is immediately visible in the other.
//
// Each pane minimizes to a rail on its own side and restores from it — the rail and
// the pane's own minimize button are the only show/hide controls, so there is
// nothing to duplicate them in the title bar. A minimized pane is UNMOUNTED, not
// hidden: the graph builds its scene once against a measured container and
// `loadViewport` restores the reader's location on mount, so a remount lands where
// they left off, where a hidden pane would have had to build against a zero-size
// box and re-fit on reveal.
//
// Widths are dragged at the splitter. Each pane carries its own hard floor
// (`PaneSpec.minWidth` — App picks it, since the reader's depends on which surface
// is showing) and the row scrolls horizontally rather than crushing them.

import { useCallback, useRef, type ReactNode } from 'react'
import { COLORS, WORKSPACE, TITLE_BAR_HEIGHT } from '../../config'
import type { PaneId } from '../persist'

export const PANE_ORDER: readonly PaneId[] = ['graph', 'reader'] as const

export interface PaneSpec {
  id: PaneId
  /** Plain name — the rail, the tooltips, the header when there is no `titleNode`. */
  title: string
  /** Header-left, in place of the plain name (the reader's surface switch). */
  titleNode?: ReactNode
  /** Floor for this pane's width. The reader's depends on the surface it shows. */
  minWidth: number
  /** Pane-header controls, right-aligned before the minimize button. */
  controls?: ReactNode
  /** Body. Only called while the pane is open — a minimized pane is unmounted. */
  render: () => ReactNode
}

interface Props {
  panes: PaneSpec[]
  open: Record<PaneId, boolean>
  sizes: Record<PaneId, number>
  onToggle: (id: PaneId) => void
  onResize: (sizes: Record<PaneId, number>) => void
}

const label = {
  fontSize: 11,
  fontWeight: 600,
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  color: COLORS.textFaint,
}

function MinimizeIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden>
      <path d="M5 12h14" />
    </svg>
  )
}

function ExpandIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** A minimized pane: a vertical rail carrying its name. The whole rail restores it. */
function Rail({ spec, onToggle }: { spec: PaneSpec; onToggle: (id: PaneId) => void }) {
  return (
    <button
      type="button"
      className="pz-rail"
      title={`Show ${spec.title}`}
      aria-label={`Show ${spec.title}`}
      onClick={() => onToggle(spec.id)}
      style={{
        width: WORKSPACE.railWidth,
        flex: `0 0 ${WORKSPACE.railWidth}px`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10,
        padding: '9px 0',
        border: 'none',
        borderLeft: `1px solid ${COLORS.borderFaint}`, borderRight: `1px solid ${COLORS.borderFaint}`,
        background: COLORS.surfaceBlur, cursor: 'pointer', font: 'inherit',
      }}
    >
      <ExpandIcon />
      <span style={{ ...label, writingMode: 'vertical-rl', whiteSpace: 'nowrap' }}>{spec.title}</span>
    </button>
  )
}

/** The draggable boundary between two open panes. */
function Splitter({ onDrag }: { onDrag: (clientX: number, phase: 'start' | 'move') => void }) {
  const down = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    onDrag(e.clientX, 'start')
    const move = (ev: PointerEvent) => onDrag(ev.clientX, 'move')
    const up = () => {
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
  }, [onDrag])
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      className="pz-splitter"
      onPointerDown={down}
      style={{
        flex: `0 0 ${WORKSPACE.splitter}px`,
        cursor: 'col-resize',
        background: COLORS.background,
        borderLeft: `1px solid ${COLORS.borderFaint}`,
        borderRight: `1px solid ${COLORS.borderFaint}`,
        touchAction: 'none',
      }}
    />
  )
}

const workspaceCss = `
  .pz-splitter { transition: background .12s ease; }
  .pz-splitter:hover, .pz-splitter:active { background: ${COLORS.border}; }
  .pz-rail { transition: background .12s ease, color .12s ease; color: ${COLORS.textDim}; }
  .pz-rail:hover { background: ${COLORS.surface}; color: ${COLORS.text}; }
  .pz-panebtn { display: inline-flex; align-items: center; justify-content: center; width: 22px; height: 22px; padding: 0; border-radius: 5px; border: 1px solid transparent; background: none; cursor: pointer; color: ${COLORS.textDim}; transition: color .12s ease, background .12s ease, border-color .12s ease; }
  .pz-panebtn:hover { color: ${COLORS.text}; background: hsla(220, 24%, 20%, 0.05); border-color: ${COLORS.border}; }
`

export function Workspace({ panes, open, sizes, onToggle, onResize }: Props) {
  const bodyRefs = useRef<Partial<Record<PaneId, HTMLElement | null>>>({})
  // Drag origin: the pointer x and the two panes' pixel widths when the splitter
  // was grabbed. Widths are measured, not derived from the fractions, so the drag
  // is exact even when a floor is binding somewhere else in the row.
  const drag = useRef<{ x: number; left: PaneId; right: PaneId; lw: number; rw: number } | null>(null)

  const minWidthOf = useCallback(
    (id: PaneId) => panes.find(p => p.id === id)?.minWidth ?? 0, [panes])

  const onSplit = useCallback((left: PaneId, right: PaneId) => (clientX: number, phase: 'start' | 'move') => {
    if (phase === 'start') {
      const lw = bodyRefs.current[left]?.getBoundingClientRect().width ?? 0
      const rw = bodyRefs.current[right]?.getBoundingClientRect().width ?? 0
      drag.current = { x: clientX, left, right, lw, rw }
      return
    }
    const d = drag.current
    if (!d) return
    const span = d.lw + d.rw
    const minL = minWidthOf(left)
    const minR = minWidthOf(right)
    if (span < minL + minR) return   // no room to trade — both are already at their floor
    const lw = Math.max(minL, Math.min(span - minR, d.lw + (clientX - d.x)))
    // Convert back to fractions: the pair's share of the row is fixed, only its
    // internal division moves, so the third pane's size is untouched.
    const pair = sizes[left] + sizes[right]
    onResize({ ...sizes, [left]: pair * (lw / span), [right]: pair * ((span - lw) / span) })
  }, [sizes, onResize, minWidthOf])

  const specs = PANE_ORDER.map(id => panes.find(p => p.id === id)).filter((p): p is PaneSpec => !!p)

  // Walk the row in order. A splitter goes before every open pane that has an open
  // pane to its left — so with a rail between two open panes the splitter lands
  // just after the rail, still dividing the two panes it actually resizes.
  const row: ReactNode[] = []
  let prevOpen: PaneId | null = null
  for (const spec of specs) {
    if (!open[spec.id]) {
      row.push(<Rail key={`rail:${spec.id}`} spec={spec} onToggle={onToggle} />)
      continue
    }
    if (prevOpen) row.push(<Splitter key={`split:${spec.id}`} onDrag={onSplit(prevOpen, spec.id)} />)
    prevOpen = spec.id
    row.push(
      <section
        key={spec.id}
        ref={el => { bodyRefs.current[spec.id] = el }}
        style={{
          flex: `${sizes[spec.id]} 1 0`,
          minWidth: spec.minWidth,
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
      >
        <header style={{
          height: WORKSPACE.headerHeight, flex: `0 0 ${WORKSPACE.headerHeight}px`,
          display: 'flex', alignItems: 'center', gap: 10, padding: '0 8px 0 12px',
          borderBottom: `1px solid ${COLORS.borderFaint}`, background: COLORS.surfaceBlur,
        }}>
          {spec.titleNode ?? <span style={{ ...label, flexShrink: 0 }}>{spec.title}</span>}
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            {spec.controls}
            <button
              type="button" className="pz-panebtn"
              title={`Minimize ${spec.title}`} aria-label={`Minimize ${spec.title}`}
              onClick={() => onToggle(spec.id)}
            >
              <MinimizeIcon />
            </button>
          </div>
        </header>
        {/* The pane's client area: every surface fills this box absolutely. */}
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', minHeight: 0 }}>
          {spec.render()}
        </div>
      </section>,
    )
  }

  return (
    <div style={{
      position: 'fixed', top: TITLE_BAR_HEIGHT, left: 0, right: 0, bottom: 0,
      display: 'flex', alignItems: 'stretch',
      overflowX: 'auto', overflowY: 'hidden',
      background: COLORS.background,
    }}>
      <style>{workspaceCss}</style>
      {row}
    </div>
  )
}
