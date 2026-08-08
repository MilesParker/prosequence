// ── Local persistence ─────────────────────────────────────────────────────────
// Remember where the reader left off — the graph viewport ("location") and the
// view settings (which surface, the centred claim, the reference root) — across
// reloads. Best-effort: any failure (private mode, quota, disabled storage) is
// swallowed so the app still runs with defaults.
//
// Every key is namespaced by the corpus file (DATA_FILE) so each model remembers
// its own place; switching ?model=<name> never restores another corpus's stale
// ids or viewport.
import { DATA_FILE } from '../config'

const NS = 'prosequence'
const keyFor = (name: string) => `${NS}:${DATA_FILE}:${name}`

function load<T>(name: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(keyFor(name))
    return raw == null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}

function save(name: string, value: unknown): void {
  try {
    localStorage.setItem(keyFor(name), JSON.stringify(value))
  } catch {
    /* private mode / quota / disabled — persistence is best-effort */
  }
}

// ── Graph viewport (the reader's "location" on the map) ─────────────────────────
// The raw d3 zoom transform (pre-title-bar-offset), so it round-trips through
// zoom.transform exactly as fitTransform's output does.
export interface Viewport { k: number; x: number; y: number }
export const loadViewport = (): Viewport | null => load<Viewport | null>('viewport', null)
export const saveViewport = (v: Viewport): void => save('viewport', v)

// ── View settings ──────────────────────────────────────────────────────────────
// Presence of `refRootId` is meaningful: absent = pre-init (App defaults it to the
// structural root), while an explicit null = deliberately unpainted. So callers
// read the raw object and test `'refRootId' in settings` rather than coalescing.
export interface Settings {
  view?: 'graph' | 'focus'
  focusId?: string | null
  refRootId?: string | null
}
export const loadSettings = (): Settings => load<Settings>('settings', {})
export const saveSettings = (s: Settings): void => save('settings', s)
