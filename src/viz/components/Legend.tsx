import { COLORS } from '../../config'

function NodeSwatch({ fill, stroke }: { fill: string; stroke: string }) {
  return <div style={{ width: 22, height: 12, flexShrink: 0, background: fill, border: `1.5px solid ${stroke}`, borderRadius: 3 }} />
}

function InfSwatch() {
  return (
    <div style={{ width: 12, height: 12, flexShrink: 0, background: COLORS.inference.fill, border: `1.25px solid ${COLORS.inference.stroke}`, transform: 'rotate(45deg)' }} />
  )
}

function EdgeSwatch({ color, dashed = false }: { color: string; dashed?: boolean }) {
  return <div style={{ width: 26, height: 0, flexShrink: 0, borderTop: `2.5px ${dashed ? 'dashed' : 'solid'} ${color}` }} />
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '4px 0', color: '#888' }}>{children}</div>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#444', marginBottom: 7 }}>{children}</div>
}

function Divider() {
  return <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }} />
}

export function Legend() {
  const n = COLORS.node
  return (
    <div style={{ position: 'fixed', bottom: 20, left: 20, background: 'rgba(10, 12, 20, 0.95)', border: `1px solid ${COLORS.border}`, borderRadius: 8, padding: '12px 16px', fontSize: 11, zIndex: 50, userSelect: 'none' }}>
      <SectionTitle>Claims</SectionTitle>
      <Row><NodeSwatch fill={n.root.fill} stroke={n.root.stroke} /> Root (contested question)</Row>
      <Row><NodeSwatch fill={n.pro.fill} stroke={n.pro.stroke} /> Pro</Row>
      <Row><NodeSwatch fill={n.anti.fill} stroke={n.anti.stroke} /> Anti</Row>
      <Row><NodeSwatch fill={n.empirical.fill} stroke={n.empirical.stroke} /> Empirical</Row>
      <Row><NodeSwatch fill={n.analogy.fill} stroke={n.analogy.stroke} /> Analogy</Row>
      <Row><NodeSwatch fill={n.attributive.fill} stroke={n.attributive.stroke} /> Attributive (grounds)</Row>
      <Row><NodeSwatch fill={n.terminal.fill} stroke={n.terminal.stroke} /> Terminal value</Row>

      <Divider />
      <SectionTitle>Inference</SectionTitle>
      <Row><InfSwatch /> Inference junction</Row>

      <Divider />
      <SectionTitle>Edges</SectionTitle>
      <Row><EdgeSwatch color={COLORS.edge.grounds} /> Grounds</Row>
      <Row><EdgeSwatch color={COLORS.edge.warrants} dashed /> Warrants</Row>
      <Row><EdgeSwatch color={COLORS.edge.concludes} /> Concludes</Row>
      <Row><EdgeSwatch color={COLORS.edge.contests} /> Contests</Row>
    </div>
  )
}
