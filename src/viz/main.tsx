import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { COLORS } from '../config'

const style = document.createElement('style')
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: ${COLORS.background};
    color: ${COLORS.text};
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif;
    overflow: hidden;
  }
`
document.head.appendChild(style)

const root = document.getElementById('root')!
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
