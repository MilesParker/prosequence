// Cell.tsx — the inference box: exactly one inference, rendered as a container.
//
// Containment is the AND: everything inside holds together, and a separate box
// is a separate argument. The grouping is carried by a thick stance-hue SPINE
// down the left edge — the single most legible "these belong together" mark —
// with a hairline neutral border closing the other three sides and a light
// stance wash filling the interior. Full column width and stacked, so every box
// in a half reads as the same kind of thing; never interactive; inferences are
// never selectable.
//
// Colour follows STANCE, not position: the spine and wash take the stance of the
// claim the inference bears on (its output — the centred claim). For/Against is
// carried by left/right position alone. The tiles inside keep their own per-claim
// stance fill and, being heavier (0.18 vs the box's 0.08), read as sitting on top.
//
// Anatomy (positional role): grounds tiles, then the `assumes` / `assumes,
// together` divider, then warrant tiles. The box's output is the centred claim
// and lives in the focus band — it is never a tile inside the box.

import { COLORS, FOCUS, STANCE_CONTAINER_FILL_OPACITY } from '../../config'
import type { GraphData } from '../graphData'
import type { Inference } from '../../types'
import { ClaimTile, useStance, stanceStyle } from './primitives'
import { outputOf } from './focusData'

function Bag({ gd, ids, onFocus }: { gd: GraphData; ids: string[]; onFocus: (id: string) => void }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: FOCUS.tileGap }}>
      {ids.map(id => <ClaimTile key={id} gd={gd} id={id} onFocus={onFocus} />)}
    </div>
  )
}

export function InferenceBox({
  gd, inf, onFocus, omit,
}: { gd: GraphData; inf: Inference; onFocus: (id: string) => void; omit?: string }) {
  // `omit` drops the centred claim from a consuming inference above: C is the
  // centre and assumed, never a tile in any region, so its box shows only the
  // co-inputs. Below (omit undefined) shows every ground and warrant.
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
      {grounds.length > 0 && <Bag gd={gd} ids={grounds} onFocus={onFocus} />}
      {warrants.length > 0 && (
        <>
          <div style={{ fontSize: FOCUS.labelFont, color: COLORS.textDim, fontStyle: 'italic', letterSpacing: '0.03em' }}>
            {warrants.length > 1 ? 'assumes, together' : 'assumes'}
          </div>
          <Bag gd={gd} ids={warrants} onFocus={onFocus} />
        </>
      )}
    </div>
  )
}
