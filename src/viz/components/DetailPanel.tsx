import { COLORS, PANEL_WIDTH, PANEL_FONT } from '../../config'
import type { GraphNode, ClaimNode, InfNode, GraphData, GraphLink, EdgeRole } from '../graphData'
import { claimChipKind, sourceLabel } from '../graphData'

interface Props {
  node: GraphNode
  graphData: GraphData
  onClose: () => void
}

function RelBadge({ role }: { role: EdgeRole }) {
  const s = COLORS.rel[role.toLowerCase() as keyof typeof COLORS.rel]
  return (
    <span style={{ fontSize: PANEL_FONT.badge, fontWeight: 700, padding: '2px 6px', borderRadius: 3, flexShrink: 0, background: s.bg, color: s.color }}>
      {role}
    </span>
  )
}

function LinkList({ links, endpoint, nodeById }: { links: GraphLink[]; endpoint: 'source' | 'target'; nodeById: Map<string, GraphNode> }) {
  if (links.length === 0) {
    return <li style={{ color: '#333', fontStyle: 'italic', fontSize: PANEL_FONT.meta, padding: '4px 0' }}>none</li>
  }
  return (
    <>
      {links.map(l => {
        const id = String(l[endpoint])
        const n = nodeById.get(id)
        const label = n && n._kind === 'claim' ? (n.tag || id) : (n ? 'inference' : id)
        return (
          <li key={l.id} style={{ padding: '6px 0', borderBottom: `1px solid ${COLORS.borderFaint}`, fontSize: PANEL_FONT.meta, color: '#999', display: 'flex', gap: 8, alignItems: 'baseline' }}>
            <RelBadge role={l.role} />
            <span>{label}</span>
          </li>
        )
      })}
    </>
  )
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginTop: 18 }}>
      <div style={{ fontSize: PANEL_FONT.label, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.08em', color: COLORS.textDim, marginBottom: 6 }}>{label}</div>
      {children}
    </div>
  )
}

function Chip({ children, color }: { children: React.ReactNode; color?: string }) {
  return (
    <span style={{ fontSize: PANEL_FONT.chip, padding: '3px 9px', borderRadius: 10, background: '#1a1c28', color: color ?? '#777' }}>{children}</span>
  )
}

export function DetailPanel({ node, graphData, onClose }: Props) {
  const { nodeById, incoming, outgoing } = graphData
  const id = node.id as unknown as string
  const inc = incoming.get(id) ?? []
  const out = outgoing.get(id) ?? []

  const isClaim = node._kind === 'claim'
  const claim = isClaim ? (node as ClaimNode) : null
  const inf = !isClaim ? (node as InfNode) : null

  const tagOf = (cid: string) => { const n = nodeById.get(cid); return n && n._kind === 'claim' ? (n.tag || cid) : cid }

  return (
    <div style={{ position: 'fixed', top: 0, right: 0, width: PANEL_WIDTH, height: '100vh', background: COLORS.surface, borderLeft: `1px solid ${COLORS.border}`, overflowY: 'auto', zIndex: 200, fontSize: PANEL_FONT.base }}>
      <div style={{ position: 'sticky', top: 0, background: COLORS.surface, borderBottom: `1px solid ${COLORS.border}`, padding: '16px 20px 14px', display: 'flex', alignItems: 'flex-start', gap: 10, zIndex: 1 }}>
        <h2 style={{ flex: 1, fontSize: PANEL_FONT.title, fontWeight: 600, color: COLORS.text, lineHeight: 1.4, margin: 0 }}>
          {isClaim ? (node.tag || id) : 'Inference'}
        </h2>
        <button onClick={onClose} style={{ flexShrink: 0, background: 'none', border: 'none', color: COLORS.textDim, fontSize: PANEL_FONT.close, cursor: 'pointer', lineHeight: 1, padding: '0 2px' }}>×</button>
      </div>

      <div style={{ padding: '16px 20px 24px' }}>
        <Section label="ID">
          <div style={{ fontFamily: 'monospace', fontSize: PANEL_FONT.meta, color: COLORS.textCode }}>{id}</div>
        </Section>

        {claim && (
          <>
            <Section label="Statement">
              <div style={{ color: COLORS.textMuted, lineHeight: 1.6, fontSize: PANEL_FONT.body }}>{claim.text}</div>
            </Section>
            {claim.attribution && (
              <>
                {claim.attribution.quote && (
                  <Section label="Quote">
                    <div style={{ borderLeft: `2px solid ${COLORS.border}`, paddingLeft: 10, color: '#999', fontSize: PANEL_FONT.meta, fontStyle: 'italic' }}>“{claim.attribution.quote}”</div>
                  </Section>
                )}
                <Section label="Source">
                  <div style={{ color: COLORS.textMuted }}>{sourceLabel(claim.attribution.source as { type: string; reference?: string })}</div>
                </Section>
              </>
            )}
            <Section label="Properties">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                {claim._isRoot && <Chip color="#90caf9">root</Chip>}
                {claim.terminal && <Chip color="#ffcc02">terminal</Chip>}
                {claim.attribution && <Chip>attributive</Chip>}
                <Chip>{claim.cluster}</Chip>
                <Chip>depth {node._depth}</Chip>
                {claim.uncertain && <Chip color="#ff8a65">uncertain</Chip>}
                {claim.submissionStatus && <Chip>{claim.submissionStatus}</Chip>}
              </div>
            </Section>
          </>
        )}

        {inf && (
          <>
            <Section label="Output">
              <div style={{ color: COLORS.textMuted }}>
                {inf.concludes ? <>concludes → <strong>{tagOf(String(inf.concludes))}</strong></>
                  : inf.contests ? <>contests → <strong>{tagOf(String(inf.contests))}</strong></>
                  : '—'}
              </div>
            </Section>
            {inf.note && (
              <Section label="Note">
                <div style={{ color: '#999', fontSize: PANEL_FONT.meta, lineHeight: 1.5 }}>{inf.note}</div>
              </Section>
            )}
            <Section label={`Grounds (${(inf.grounds ?? []).length})`}>
              <div style={{ color: COLORS.textMuted, fontSize: PANEL_FONT.meta }}>{(inf.grounds ?? []).map(g => tagOf(String(g))).join('; ') || '—'}</div>
            </Section>
            <Section label={`Warrants (${(inf.warrants ?? []).length})`}>
              <div style={{ color: COLORS.textMuted, fontSize: PANEL_FONT.meta }}>{(inf.warrants ?? []).length ? (inf.warrants).map(w => tagOf(String(w))).join('; ') : 'implicit (not yet surfaced)'}</div>
            </Section>
            <Section label="Properties">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 2 }}>
                <Chip>{inf.scheme || 'no scheme'}</Chip>
                <Chip>depth {node._depth}</Chip>
                {inf.uncertain && <Chip color="#ff8a65">uncertain</Chip>}
              </div>
            </Section>
          </>
        )}

        <Section label={`Incoming (${inc.length})`}>
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
            <LinkList links={inc} endpoint="source" nodeById={nodeById} />
          </ul>
        </Section>

        <Section label={`Outgoing (${out.length})`}>
          <ul style={{ listStyle: 'none', margin: '4px 0 0', padding: 0 }}>
            <LinkList links={out} endpoint="target" nodeById={nodeById} />
          </ul>
        </Section>
      </div>
    </div>
  )
}
