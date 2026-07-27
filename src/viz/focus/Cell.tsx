// Cell.tsx — the inference box: exactly one inference, rendered as a container.
//
// The box means "this is one inference," NOT "everything here is required."
// Three marks carry three distinctions:
//   · the stroke        — the inference boundary (a stance-hue left spine + a
//                          hairline closing the other sides, light stance wash);
//   · the `assumes` divider — splits grounds from warrants (warrants indented);
//   · the full-width rule   — splits output from inputs (above region only).
//
// Contents follow the view's altitude grammar — conclusion above premises. When
// the box carries its output (the consumers region), top to bottom: the output/
// destination tile, a full-width rule, then grounds tiles, `assumes` divider,
// indented warrant tiles. Below (`supports`/`attacks`) there is no output tile:
// the output is C, which lives in the focus band above the box.
//
// Colour follows STANCE, not position: spine + wash take the stance of the claim
// the inference bears on (its output). For/Against is carried by left/right.
// The tiles inside keep their own per-claim stance fill; never interactive.
//
// C (the centre) is dropped from the inputs via `omit` — it is assumed, and never
// renders as a tile in any region.

import { COLORS, FOCUS, STANCE_CONTAINER_FILL_OPACITY } from '../../config'
import type { GraphData } from '../graphData'
import type { Inference } from '../../types'
import { ClaimTile, useStance, stanceStyle } from './primitives'
import { outputOf } from './focusData'

// Tiles inside a box stack full-width — each fills the enclosing inference — rather
// than flowing content-width. (The bare destination tile outside a box, rendered
// directly, keeps its content width.)
function Bag({ gd, ids, onFocus, indent }: { gd: GraphData; ids: string[]; onFocus: (id: string) => void; indent?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: FOCUS.tileGap, marginLeft: indent ? FOCUS.warrantIndent : 0 }}>
      {ids.map(id => <ClaimTile key={id} gd={gd} id={id} onFocus={onFocus} />)}
    </div>
  )
}

export function InferenceBox({
  gd, inf, onFocus, omit, output,
}: { gd: GraphData; inf: Inference; onFocus: (id: string) => void; omit?: string; output?: string }) {
  const grounds = (inf.grounds ?? []).map(String).filter(g => g !== omit)
  const warrants = (inf.warrants ?? []).map(String).filter(w => w !== omit)
  // Spine + wash by the stance of the claim this inference bears on (its output),
  // washed lighter than a claim so the tiles read on top. Neutral / no root falls
  // back to a plain card (grey spine, surface fill) so the box still has an edge.
  const stance = stanceStyle(useStance(outputOf(inf).id), {
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
        gap: FOCUS.tileGap,
      }}
    >
      {output && (
        <>
          <Bag gd={gd} ids={[output]} onFocus={onFocus} />
          {/* Full-width rule to the stroke, splitting the output above from the inputs below. */}
          <div style={{ height: 0, borderTop: `${FOCUS.ruleWeight}px solid ${COLORS.border}`, marginLeft: -FOCUS.boxPad, marginRight: -FOCUS.boxPad }} />
        </>
      )}
      {grounds.length > 0 && <Bag gd={gd} ids={grounds} onFocus={onFocus} />}
      {warrants.length > 0 && (
        <>
          <div style={{ fontSize: FOCUS.labelFont, color: COLORS.textDim, fontStyle: 'italic', letterSpacing: '0.03em' }}>
            {warrants.length > 1 ? 'assumes, together' : 'assumes'}
          </div>
          <Bag gd={gd} ids={warrants} onFocus={onFocus} indent />
        </>
      )}
    </div>
  )
}
