import { COLORS } from '../../config'
import type { GraphNode, ClaimNode, InfNode, ChipKind } from '../graphData'
import { sourceLabel } from '../graphData'

interface Props {
  node: GraphNode
  x: number
  y: number
  nodeById: Map<string, GraphNode>
}

const TOOLTIP_W = 340
const TOOLTIP_H = 160

function chipStyle(kind: ChipKind) {
  const c = COLORS.chip[kind] ?? COLORS.chip.default
  return { fontSize: 10, padding: '2px 7px', borderRadius: 10, background: c.bg, color: c.color }
}

function tagOf(id: string, nodeById: Map<string, GraphNode>): string {
  const n = nodeById.get(id)
  return n && n._kind === 'claim' ? (n.tag || id) : id
}

export function Tooltip({ node, x, y, nodeById }: Props) {
  const left = x + 16 + TOOLTIP_W > window.innerWidth  ? x - TOOLTIP_W - 10 : x + 16
  const top  = y + 10 + TOOLTIP_H > window.innerHeight ? y - TOOLTIP_H - 10 : y + 10

  const shell = {
    position: 'fixed' as const, left, top,
    background: COLORS.surface,
    border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '12px 16px',
    maxWidth: TOOLTIP_W, fontSize: 12, lineHeight: 1.5,
    pointerEvents: 'none' as const, zIndex: 100, boxShadow: '0 6px 24px rgba(0,0,0,0.12)',
  }
  const tagStyle = { fontSize: 10, fontWeight: 600 as const, textTransform: 'uppercase' as const, letterSpacing: '0.08em', color: COLORS.textFaint, marginBottom: 5 }
  const chips = { display: 'flex', flexWrap: 'wrap' as const, gap: 6, marginTop: 8 }

  if (node._kind === 'inference') {
    const inf = node as InfNode
    const grounds = (inf.grounds ?? []).map(g => tagOf(String(g), nodeById))
    const warrants = (inf.warrants ?? []).map(w => tagOf(String(w), nodeById))
    // §3 P: "Because {grounds[0]}{, +N more}, given {warrants[0]}{, +N more}."
    const more = (n: number) => (n > 1 ? `, +${n - 1} more` : '')
    const because = grounds.length ? `Because ${grounds[0]}${more(grounds.length)}` : 'Because (grounds)'
    const given = warrants.length ? `, given ${warrants[0]}${more(warrants.length)}` : ''
    return (
      <div style={shell}>
        <div style={tagStyle}>Inference</div>
        <div style={{ color: COLORS.text, marginBottom: 8, fontSize: 12.5 }}>
          {because}{given}.
        </div>
        <div style={chips}>
          <span style={chipStyle('inference')}>{inf.scheme || 'no scheme'}</span>
          {warrants.length === 0 && <span style={chipStyle('default')}>implicit warrant</span>}
        </div>
      </div>
    )
  }

  const claim = node as ClaimNode
  return (
    <div style={shell}>
      <div style={tagStyle}>{claim.tag || (claim.id as unknown as string)}</div>
      <div style={{ color: COLORS.text, marginBottom: 8, fontSize: 12.5 }}>{claim.text}</div>
      {claim.attribution && (
        <>
          {claim.attribution.quote && (
            <div style={{ color: COLORS.textMuted, fontSize: 11, marginBottom: 4, borderLeft: `2px solid ${COLORS.border}`, paddingLeft: 8, fontStyle: 'italic' }}>
              “{claim.attribution.quote}”
            </div>
          )}
          <div style={{ color: COLORS.textFaint, fontSize: 11, marginBottom: 4 }}>
            {sourceLabel(claim.attribution.source as { type: string; reference?: string })}
          </div>
        </>
      )}
      {claim.uncertain && (
        <div style={chips}>
          <span style={chipStyle('default')}>uncertain</span>
        </div>
      )}
    </div>
  )
}
