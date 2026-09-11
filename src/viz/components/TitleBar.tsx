import type { ReactNode } from 'react'
import { COLORS, TITLE_BAR_HEIGHT } from '../../config'

interface Props {
  title: string
  subtitle?: string
  /** Right-aligned page-level actions: recentre on the thesis, and search. */
  actions?: ReactNode
}

/**
 * The one piece of chrome above the workspace. It carries what corpus you are
 * reading and the two acts that belong to the page rather than to one surface:
 * recentring on the thesis, and search.
 *
 * It carries no show/hide controls. Each pane has a minimize button and a rail to
 * come back from, which is the whole mechanism; a second set of toggles up here was
 * the same act spelled twice.
 */
export function TitleBar({ title, subtitle, actions }: Props) {
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
        {actions}
      </div>
    </div>
  )
}
