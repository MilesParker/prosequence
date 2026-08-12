// Cell.tsx — the inference box: exactly one inference, one template for both
// regions. Every box shows a complete inference — one output, its inputs, and how
// each input enters — so the box teaches the shape of an inference and C's role in
// it is legible from position alone, without a label.
//
// Layout, top to bottom:
//   output tile          — the claim this inference bears on (Above: the
//                          destination; Below: C, the centred claim)
//   │                    — a solid, unbroken spine dropping from just below the
//   ├── grounds tile        output tile to the last input
//   ┊·· warrant tile     — one stub per input reaches from the spine to the tile:
//   ┊·· warrant tile        SOLID into grounds, DASHED into warrants
//
// Three marks, three distinctions:
//   · the box stroke  — the inference boundary (a stance-hue left spine + a
//                       hairline closing the other sides, light stance wash). Its
//                       closure is what makes a box clipped at the scroll edge
//                       self-announce.
//   · the bracket     — connects the inputs to the output (the corner carries the
//                       output/inputs split; there is no full-width rule).
//   · the stub style  — SOLID vs DASHED carries grounds vs warrant (there is no
//                       `assumes` divider and no role subhead).
//
// The centred claim C ALWAYS renders, in its structural position — as the output
// tile (Below) or among the inputs in its grounds/warrant role (Above) — marked as
// the tile you are centred on. It is never omitted and never a placeholder.
//
// Colour follows STANCE, not position: the box's spine + wash take the stance of the
// inference's GROUNDS/WARRANTS — the side it argues from — NOT the output claim's
// stance. Contesting an aligned claim argues from the opposed side, so the box reads
// opposed while the contested claim's own output tile stays aligned. For/Against is
// carried by left/right. The tiles inside keep their own per-claim stance fill.

import { useContext } from 'react'
import { COLORS, EDGE, FOCUS, STANCE_CONTAINER_FILL_OPACITY } from '../../config'
import type { GraphData } from '../graphData'
import type { Inference } from '../../types'
import { contestTickSegments } from '../graphData'
import { ClaimTile, StanceContext, stanceStyle } from './primitives'
import { outputOf, combinedStance } from './focusData'

type Input = { id: string; warrant: boolean }

// The contest mark on the bracket's topmost (output-relation) segment: the graph's
// double tick, from the SAME builder (`contestTickSegments`), so the two views draw
// one mark from one definition. Only the orientation differs — here the spine runs
// vertically, so the tick is oriented up toward the output tile. `color` is the box's
// stance (the inputs' side), matching the graph, which paints a contest edge by the
// side it leads into; `pointer-events: none` and `overflow: visible` let it sit on
// the thin riser without clipping. Centred on the (inset) spine and dropped a little
// so it clears the output tile above it.
function ContestTick({ color }: { color: string }) {
  const { length, gap, count, strokeWidth } = EDGE.contestTick
  const w = length + 2
  const h = (count - 1) * gap + strokeWidth + 2
  const segs = contestTickSegments(w / 2, h / 2, -Math.PI / 2)   // vertical spine, up toward output
  return (
    <svg
      width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden
      style={{
        position: 'absolute', left: FOCUS.bracketInset - w / 2,
        top: (FOCUS.bracketRiser - h) / 2 + FOCUS.bracketTickDrop,
        overflow: 'visible', pointerEvents: 'none',
      }}
    >
      {segs.map((s, i) => (
        <line key={i} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" />
      ))}
    </svg>
  )
}

// One input row: the bracket connector (spine + stub) beside a full-width tile.
// The connector spans the whole row height — including the tile's vertical padding
// — so consecutive rows' spines meet with no gap and the spine reads as unbroken.
// The stub sits at the row's vertical centre, exactly on the tile's centre, since
// the top/bottom padding is symmetric.
function InputRow({
  gd, input, centred, last, onFocus,
}: { gd: GraphData; input: Input; centred: boolean; last: boolean; onFocus: (id: string) => void }) {
  const stubStyle = `${FOCUS.bracketWidth}px ${input.warrant ? 'dashed' : 'solid'} ${COLORS.textDim}`
  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div style={{ position: 'relative', width: FOCUS.bracketIndent, flexShrink: 0 }}>
        {/* Spine: solid, from the row top down to this input's stub on the last row,
            through the row on every other — never dashed, never broken. Inset a little
            from the output tile's left edge (`bracketInset`). */}
        <div
          style={{
            position: 'absolute', left: FOCUS.bracketInset, top: 0, width: FOCUS.bracketWidth,
            height: last ? '50%' : '100%',
            background: COLORS.textDim,
          }}
        />
        {/* Stub: spine → tile, at the row centre. Solid into grounds, dashed into warrants. */}
        <div style={{ position: 'absolute', left: FOCUS.bracketInset, right: 0, top: '50%', borderTop: stubStyle }} />
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', padding: `${FOCUS.tileVPad}px 0` }}>
        <ClaimTile gd={gd} id={input.id} onFocus={onFocus} centred={centred} />
      </div>
    </div>
  )
}

export function InferenceBox({
  gd, inf, onFocus, output, centredId,
}: { gd: GraphData; inf: Inference; onFocus: (id: string) => void; output: string; centredId: string }) {
  // Grounds first, then warrants — conjuncts of one inference; the stub style, not
  // order, carries which is which. C is NOT dropped: it renders in its own role.
  const inputs: Input[] = [
    ...(inf.grounds ?? []).map(g => ({ id: String(g), warrant: false })),
    ...(inf.warrants ?? []).map(w => ({ id: String(w), warrant: true })),
  ]
  // Spine + wash by the stance of the inference's inputs (its grounds/warrants) — the
  // side it argues from — washed lighter than a claim so the tiles read on top. The
  // contest tick takes the same stance. Neutral / no thesis falls back to a plain card
  // (grey spine, surface fill) so the box still has an edge.
  const stance = stanceStyle(combinedStance(useContext(StanceContext), inputs.map(i => i.id)), {
    neutralBg: COLORS.surface, neutralBorder: COLORS.border, fillOpacity: STANCE_CONTAINER_FILL_OPACITY,
  })

  return (
    <div
      style={{
        width: '100%',
        boxSizing: 'border-box',
        border: `1px solid ${COLORS.border}`,
        borderLeft: `${FOCUS.spineWidth}px solid ${stance.borderColor}`,
        borderRadius: `0 ${FOCUS.boxRadius}px ${FOCUS.boxRadius}px 0`,
        background: stance.background,
        padding: FOCUS.boxPad,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Output tile — flush left; the bracket hangs beneath it. */}
      <div style={{ display: 'flex' }}>
        <ClaimTile gd={gd} id={output} onFocus={onFocus} centred={output === centredId} />
      </div>
      {/* Riser: the topmost spine segment, just below the output tile — the only
          part carrying the output relation. It reads as the bracket descending from
          the output (its corner carries the output/inputs split; there is no rule),
          and it hosts the contest mark, once, when the inference contests its output.
          A `concludes` inference leaves it unmarked. */}
      <div style={{ position: 'relative', height: FOCUS.bracketRiser }}>
        <div style={{ position: 'absolute', left: FOCUS.bracketInset, top: 0, bottom: 0, width: FOCUS.bracketWidth, background: COLORS.textDim }} />
        {outputOf(inf).kind === 'contests' && <ContestTick color={stance.borderColor} />}
      </div>
      {inputs.map((input, i) => (
        <InputRow
          key={input.id + ':' + i}
          gd={gd}
          input={input}
          centred={input.id === centredId}
          last={i === inputs.length - 1}
          onFocus={onFocus}
        />
      ))}
    </div>
  )
}
