import { COLORS, TITLE_BAR_HEIGHT } from '../../config'

interface Props {
  title: string
  subtitle?: string
}

export function TitleBar({ title, subtitle }: Props) {
  return (
    <div style={{
      position: 'fixed',
      top: 0, left: 0, right: 0,
      height: TITLE_BAR_HEIGHT,
      background: COLORS.surfaceBlur,
      borderBottom: `1px solid ${COLORS.borderFaint}`,
      display: 'flex',
      alignItems: 'center',
      padding: '0 18px',
      zIndex: 40,
      gap: 14,
      backdropFilter: 'blur(4px)',
    }}>
      <h1 style={{ fontSize: 13, fontWeight: 600, color: COLORS.textMuted, margin: 0 }}>
        {title}
      </h1>
      {subtitle && (
        <span style={{ fontSize: 11, color: COLORS.textDimmer }}>{subtitle}</span>
      )}
    </div>
  )
}
