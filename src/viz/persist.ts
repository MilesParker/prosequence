// ── Local persistence ─────────────────────────────────────────────────────────
// Remember where the reader left off — the graph viewport ("location") and the
// view settings (which surface, the centred claim, the reference thesis) — across
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
// Presence of `refThesisId` is meaningful: absent = pre-init (App defaults it to the
// structural thesis), while an explicit null = deliberately unpainted. So callers
// read the raw object and test `'refThesisId' in settings` rather than coalescing.
//
// `open` / `sizes` / `reader` are the workspace layout: which of the two panes are
// up, how they divide the width, and which surface the reader pane is showing.
// Layout is remembered but is NOT part of history — see the nav effect in App: back
// walks where you are in the argument, not how you have arranged the page. A
// settings object written before the workspace existed simply lacks these keys and
// falls through to the defaults.
export type PaneId = 'graph' | 'reader'
export type ReaderView = 'article' | 'focus'

export interface Settings {
  focusId?: string | null
  refThesisId?: string | null
  open?: Record<PaneId, boolean>
  sizes?: Record<PaneId, number>
  reader?: ReaderView
}
export const loadSettings = (): Settings => load<Settings>('settings', {})
export const saveSettings = (s: Settings): void => save('settings', s)

// ── Map key ────────────────────────────────────────────────────────────────────
// Whether the graph's key is expanded. Its own entry rather than a field on
// Settings: the key writes it from inside the map pane, and a second writer on the
// settings object would race App's own saves. Default OPEN — a key nobody notices
// is not a key, and the collapsed pill was too quiet to find.
export const loadKeyOpen = (): boolean => load<boolean>('keyOpen', true)
export const saveKeyOpen = (v: boolean): void => save('keyOpen', v)
