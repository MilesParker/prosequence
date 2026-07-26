import { COLORS, STANCE, STANCE_NEUTRAL_STROKE, STANCE_FILL_OPACITY, REF_ROOT } from '../../config'

/** Full-chroma stance colour → the pale fill used on nodes (matches the graph wash).
 *  Poles are `hsl(…)`; return that same hue at opacity `a`. Non-hsl (neutral) ⇒ no fill. */
function tint(color: string, a: number): string {
  const m = color.match(/^hsl\((.*)\)$/)
  if (!m) return 'transparent'
  return `hsla(${m[1]}, ${a})`
}

// A claim-box swatch in a stance colour: pale fill under a saturated border, as on
// the graph. Neutral is outline-only (no fill).
function StanceSwatch({ fill, stroke }: { fill: string; stroke: string }) {
  return (
    <div style={{
      width: 22, height: 13, flexShrink: 0, borderRadius: 3,
      background: fill === 'none' ? 'transparent' : tint(fill, STANCE_FILL_OPACITY),
      border: `1.5px solid ${stroke}`,
    }} />
  )
}

// The reference-root marker: an aligned (blue) claim box wrapped in a single ring of
// its own colour, matching the graph — the root is always painted its aligned valence.
function TargetSwatch() {
  return (
    <svg width={24} height={18} viewBox="-12 -9 24 18" style={{ flexShrink: 0, overflow: 'visible' }}>
      <rect x={-6.5} y={-4} width={13} height={8} rx={2} fill={tint(STANCE.aligned, STANCE_FILL_OPACITY)} stroke={STANCE.aligned} strokeWidth={1.4} />
      <rect x={-9.5} y={-7} width={19} height={14} rx={4} fill="none" stroke={STANCE.aligned} strokeWidth={REF_ROOT.ringWidth} />
    </svg>
  )
}

function InfSwatch() {
  return (
    <div style={{ width: 12, height: 12, flexShrink: 0, background: COLORS.inference.fill, border: `1.25px solid ${COLORS.inference.stroke}`, transform: 'rotate(45deg)' }} />
  )
}

// A neutral edge line, optionally dashed (warrant) and/or with the contest double-tick.
function EdgeSwatch({ dashed = false, tick = false }: { dashed?: boolean; tick?: boolean }) {
  const c = COLORS.textMuted
  return (
    <svg width={26} height={12} viewBox="0 0 26 12" style={{ flexShrink: 0 }}>
      <line x1={0} y1={6} x2={26} y2={6} stroke={c} strokeWidth={2} strokeDasharray={dashed ? '5,3' : undefined} />
      {tick && <>
        <line x1={15} y1={1.5} x2={15} y2={10.5} stroke={c} strokeWidth={1.6} strokeLinecap="round" />
        <line x1={19} y1={1.5} x2={19} y2={10.5} stroke={c} strokeWidth={1.6} strokeLinecap="round" />
      </>}
    </svg>
  )
}

function Row({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '4px 0', color: COLORS.textMuted }}>{children}</div>
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 9.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: COLORS.textFaint, marginBottom: 7 }}>{children}</div>
}

function Divider() {
  return <div style={{ marginTop: 10, borderTop: `1px solid ${COLORS.border}`, paddingTop: 10 }} />
}

export function Legend({ nominating, onToggleNominate }: { nominating: boolean; onToggleNominate: () => void }) {
  return (
    <div style={{ position: 'fixed', bottom: 20, left: 20, background: COLORS.surfaceBlur, backdropFilter: 'blur(4px)', border: `1px solid ${COLORS.border}`, borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.10)', padding: '12px 16px', fontSize: 11, zIndex: 50, userSelect: 'none', maxWidth: 230 }}>
      <SectionTitle>Reference root</SectionTitle>
      {/* Arming this mode makes the next graph click nominate a claim as the origin —
          a deliberate act, kept off the individual nodes so nothing clutters the map. */}
      <button
        type="button"
        onClick={onToggleNominate}
        style={{
          display: 'flex', alignItems: 'center', gap: 9, width: '100%', textAlign: 'left',
          padding: '6px 8px', borderRadius: 6, cursor: 'pointer', font: 'inherit', fontSize: 11,
          border: `1px solid ${nominating ? REF_ROOT.ringColor : COLORS.border}`,
          background: nominating ? 'hsla(220, 24%, 20%, 0.06)' : COLORS.surface,
          color: nominating ? COLORS.text : COLORS.textMuted,
        }}
      >
        <TargetSwatch /> {nominating ? 'Pick a claim to anchor…' : 'Set reference root'}
      </button>
      <div style={{ fontSize: 10.5, color: COLORS.textFaint, marginTop: 6, lineHeight: 1.35 }}>
        {nominating
          ? 'Click a claim to measure stance from it — or click empty space to clear.'
          : <>Everything is coloured by its stance <em>relative to the reference root</em>.</>}
      </div>

      <Divider />
      <SectionTitle>Stance</SectionTitle>
      <Row><StanceSwatch fill={STANCE.aligned} stroke={STANCE.aligned} /> Aligned (same side)</Row>
      <Row><StanceSwatch fill={STANCE.opposed} stroke={STANCE.opposed} /> Opposed (other side)</Row>
      <Row><StanceSwatch fill={STANCE.divided} stroke={STANCE.divided} /> Divided (cuts both ways)</Row>
      <Row><StanceSwatch fill="none" stroke={STANCE_NEUTRAL_STROKE} /> Neutral (unconnected)</Row>

      <Divider />
      <SectionTitle>Edge marks</SectionTitle>
      <Row><EdgeSwatch /> Grounds / concludes</Row>
      <Row><EdgeSwatch dashed /> Warrant (dashed)</Row>
      <Row><EdgeSwatch tick /> Contests (double-tick)</Row>
      <div style={{ fontSize: 10.5, color: COLORS.textFaint, marginTop: 2, lineHeight: 1.35 }}>
        Marks are geometry — edge <em>colour</em> is its stance, above.
      </div>

      <Divider />
      <SectionTitle>Inference</SectionTitle>
      <Row><InfSwatch /> Junction</Row>
    </div>
  )
}
