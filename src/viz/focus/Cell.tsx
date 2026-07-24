// Cell.tsx — exactly one inference. Never two; never stacked OR-siblings.
//
// Anatomy (§3, hint row intentionally dropped):
//   grounds rows → conjunction label → warrant rows inside a neutral bracket.
//
// Column tint is chrome only: the column heading and the conjunction label carry
// the For/Against hue, but the tile surface and the warrant bracket — both
// claim-bearing — stay neutral so no claim reads as intrinsically for/against.
//
// The tile fills its reserved column area so For and Against are always the
// same height regardless of content; rows sit at the top and scroll *within*
// the tile on the rare cell that exceeds the reserved height.

import { COLORS, FOCUS } from '../../config'
import type { GraphData } from '../graphData'
import type { Inference } from '../../types'
import { ClaimRow } from './primitives'

type Column = 'for' | 'against'

export function Cell({
  gd, inf, column, onFocus,
}: { gd: GraphData; inf: Inference; column: Column; onFocus: (id: string) => void }) {
  const tint = column === 'for' ? COLORS.column.for : COLORS.column.against
  const grounds = inf.grounds ?? []
  const warrants = inf.warrants ?? []

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        border: `1px solid ${COLORS.border}`,
        borderRadius: FOCUS.cellRadius,
        background: COLORS.surface,
        overflow: 'hidden',
      }}
    >
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '8px 10px 10px' }}>
        {grounds.map(g => (
          <ClaimRow key={String(g)} gd={gd} id={String(g)} onFocus={onFocus} />
        ))}

        {warrants.length > 0 && (
          <>
            <div
              style={{
                fontSize: FOCUS.labelFont,
                color: tint.label,
                fontStyle: 'italic',
                letterSpacing: '0.03em',
                margin: '7px 0 3px 8px',
              }}
            >
              {warrants.length > 1 ? 'assumes, together' : 'assumes'}
            </div>
            <div style={{ borderLeft: `${FOCUS.bracketWidth}px solid ${COLORS.border}`, paddingLeft: 8, marginLeft: 8 }}>
              {warrants.map(w => (
                <ClaimRow key={String(w)} gd={gd} id={String(w)} onFocus={onFocus} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
