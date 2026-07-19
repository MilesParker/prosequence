import type { ReactNode } from 'react'
import { COLORS, TITLE_BAR_HEIGHT } from '../../config'

interface Props {
  title: string
  subtitle?: string
  search?: string
  onSearch?: (value: string) => void
  /** Right-aligned control (the graph⇄focus view toggle). */
  viewToggle?: ReactNode
}

export function TitleBar({ title, subtitle, search, onSearch, viewToggle }: Props) {
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
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
        {viewToggle}
        {onSearch && (
          <input
            value={search ?? ''}
            onChange={e => onSearch(e.target.value)}
            placeholder="Search claims…  (Esc to reset)"
            spellCheck={false}
            style={{
              width: 260,
              height: 26,
              padding: '0 10px',
              fontSize: 12,
              color: COLORS.text,
              background: COLORS.surface,
              border: `1px solid ${COLORS.border}`,
              borderRadius: 6,
              outline: 'none',
            }}
          />
        )}
      </div>
    </div>
  )
}
