import { COLORS } from '../../config'

interface Props {
  message?: string
  error?: boolean
}

export function Loading({ message = 'Loading graph…', error = false }: Props) {
  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: COLORS.background,
      zIndex: 999,
      fontSize: 14,
      color: error ? COLORS.error : COLORS.textDim,
    }}>
      {message}
    </div>
  )
}
