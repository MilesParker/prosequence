import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { COLORS, WORKSPACE } from '../config'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { Legend } from './components/Legend'
import { FocusView } from './focus/FocusView'
import { ArticleView } from './article/ArticleView'
import { Workspace, type PaneSpec } from './workspace/Workspace'
import { useDiscourseData } from './hooks/useDiscourseData'
import { loadSettings, saveSettings, type PaneId, type ReaderView } from './persist'
import type { GraphNode, GraphData } from './graphData'

const READER_TITLE: Record<ReaderView, string> = { article: 'Article', focus: 'Focus' }

const DEFAULT_OPEN: Record<PaneId, boolean> = { graph: true, reader: true }

// The persisted layout is keyed by `PaneId`, and `PaneId` has changed shape once
// already (three panes became two when the article and the focus view became
// alternatives). A stored object from the older shape has no `reader` key, which
// would silently start the reader pane minimized and hand the row a NaN flex-grow.
// So the layout is only restored when it is actually the current shape; anything
// else falls back to the defaults, which is the right answer for a layout — it is a
// convenience, not content, and losing one is cheaper than restoring a broken one.
const isLayout = <T,>(o: unknown, ok: (v: unknown) => boolean): o is Record<PaneId, T> => {
  const r = o as Record<string, unknown> | null
  return !!r && typeof r === 'object' && ok(r.graph) && ok(r.reader)
}
const isBool = (v: unknown) => typeof v === 'boolean'
const isSize = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v > 0

/** Which surface the reader pane is showing. Not a show/hide control — the two are
 *  alternatives, so this is a choice of register, and it lives on the pane it
 *  governs rather than in the title bar. */
function ReaderSwitch({ view, onPick }: { view: ReaderView; onPick: (v: ReaderView) => void }) {
  const order: ReaderView[] = ['article', 'focus']
  return (
    <div style={{ display: 'flex', border: `1px solid ${COLORS.border}`, borderRadius: 5, overflow: 'hidden', flexShrink: 0 }}>
      {order.map((v, i) => (
        <button
          key={v}
          type="button"
          onClick={() => onPick(v)}
          aria-pressed={view === v}
          title={`Read this claim as ${v === 'article' ? 'an article' : 'a focus stack'}`}
          style={{
            padding: '3px 11px', fontSize: 11, fontWeight: 600, cursor: 'pointer', font: 'inherit',
            textTransform: 'uppercase', letterSpacing: '0.07em',
            border: 'none', borderLeft: i === 0 ? 'none' : `1px solid ${COLORS.border}`,
            background: view === v ? COLORS.surface : 'transparent',
            color: view === v ? COLORS.text : COLORS.textDimmer,
          }}
        >
          {READER_TITLE[v]}
        </button>
      ))}
    </div>
  )
}

function ThesisIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 10.5 12 3l9 7.5" />
      <path d="M5.5 9.5V20h13V9.5" />
    </svg>
  )
}

/** Recentre the whole page on the corpus's thesis — the one claim that is always
 *  there to come back to. It moves the selection only: the reference thesis is a
 *  separate, deliberate act and this must not quietly re-anchor it. */
function ThesisButton({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      title="Recentre on the thesis"
      style={{
        display: 'flex', alignItems: 'center', gap: 6,
        padding: '4px 11px', fontSize: 12, font: 'inherit', borderRadius: 6,
        cursor: disabled ? 'default' : 'pointer',
        border: `1px solid ${COLORS.border}`, background: COLORS.surface,
        color: disabled ? COLORS.textDimmer : COLORS.textMuted,
      }}
    >
      <ThesisIcon /> Thesis
    </button>
  )
}

/** Search highlights claims on the map. It sits in the title bar because it is a
 *  question about the corpus rather than about the pane you are in — and because
 *  it works whether or not the map is the surface you are looking at. */
function Search({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder="Search claims…  (Esc to reset)"
      spellCheck={false}
      style={{
        width: 260, height: 26, padding: '0 10px', fontSize: 12,
        color: COLORS.text, background: COLORS.surface,
        border: `1px solid ${COLORS.border}`, borderRadius: 6, outline: 'none',
      }}
    />
  )
}

/** What a browser history entry carries: where the reader is in the argument. */
interface NavState { focusId: string | null; refThesisId: string | null }

export function App() {
  const { data, graphData, bounds, groups, error, loading } = useDiscourseData()

  // Restore the reader's centred claim, reference thesis and page layout (per
  // corpus). Read once at mount; ids are validated against the loaded data below.
  const persisted = useMemo(loadSettings, [])

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')

  // ── Workspace layout ────────────────────────────────────────────────────────
  // Two panes, and which surface the reader is showing. Remembered across reloads,
  // deliberately NOT pushed to history — see the nav effect below.
  const [open, setOpen] = useState<Record<PaneId, boolean>>(
    isLayout<boolean>(persisted.open, isBool) ? persisted.open : DEFAULT_OPEN)
  const [sizes, setSizes] = useState<Record<PaneId, number>>(
    isLayout<number>(persisted.sizes, isSize) ? persisted.sizes : WORKSPACE.sizes)
  // The article is the default register: it is the one that reads as an answer to
  // "what is being claimed and why", where the focus stack reads as its structure.
  const [reader, setReader] = useState<ReaderView>(
    persisted.reader === 'focus' || persisted.reader === 'article' ? persisted.reader : 'article')
  const togglePane = useCallback((id: PaneId) => setOpen(o => ({ ...o, [id]: !o[id] })), [])
  const showPane = useCallback((id: PaneId) => setOpen(o => (o[id] ? o : { ...o, [id]: true })), [])

  // The one shared selection: always a ClaimId, owned by no pane. Both open surfaces
  // centre on it, so a click in either moves the other.
  const [focusId, setFocusId] = useState<string | null>(persisted.focusId ?? null)
  // The reference thesis — the origin all stance is measured from. A movable viewing
  // choice, not a property of the claim, and deliberately DECOUPLED from selection:
  // it defaults to the structural thesis and moves ONLY via the graph key's explicit
  // "set reference thesis" mode, never as a side effect of selecting or centring a
  // claim. That keeps "what's ultimately at stake" from drifting to wherever you
  // last clicked. States: undefined = pre-init (→ structural thesis); string = anchor;
  // null = unpainted (all neutral) — reachable only via an explicit clear, not by
  // deselecting.
  // Presence of the persisted key distinguishes a stored anchor/clear (string|null)
  // from a first visit (undefined → structural-thesis default effect below).
  const [refThesisId, setRefThesisId] = useState<string | null | undefined>(
    'refThesisId' in persisted ? persisted.refThesisId : undefined,
  )
  // "Set reference thesis" mode, toggled from the key: while on, the next graph click
  // nominates that claim as the origin instead of selecting it. Keeps re-anchoring a
  // deliberate act without hanging a control off every node (which the zoom layer
  // would shrink to nothing on the overview map anyway).
  const [nominating, setNominating] = useState(false)
  // The claim we last navigated away from — powers the focus view's "came from"
  // trace. Set only by a refocus inside the reader pane; a graph selection is a
  // fresh entry from the map and clears it, as does walking history.
  const [fromId, setFromId] = useState<string | null>(null)
  // A pending explicit "show on the map". The graph consumes it and hands it back,
  // so a later pane restore does not replay it.
  const [locate, setLocate] = useState<{ id: string } | null>(null)
  // Read the live focus inside stable callbacks without re-creating them.
  const focusIdRef = useRef(focusId)
  useEffect(() => { focusIdRef.current = focusId }, [focusId])

  const thesisId = data?.theses?.[0] != null ? String(data.theses[0]) : null

  // One reference thesis is selected by default on load (the structural thesis) so the
  // graph isn't blank — but it's only a default; the user can move it to any claim.
  useEffect(() => {
    if (refThesisId === undefined && thesisId) setRefThesisId(thesisId)
  }, [refThesisId, thesisId])

  // Persist the reader's place: the centred claim, the reference thesis, and the
  // page layout. Viewport ("location") is persisted separately by the graph.
  useEffect(() => {
    saveSettings({ focusId, refThesisId, open, sizes, reader })
  }, [focusId, refThesisId, open, sizes, reader])

  // Drop restored ids that no longer exist in this corpus (e.g. the YAML changed
  // since the last visit) so a stale focus/thesis can't point at nothing. Clearing
  // refThesisId to undefined re-triggers the structural-thesis default above.
  useEffect(() => {
    if (!data) return
    const ids = new Set((data.claims ?? []).map(c => String(c.id)))
    setFocusId(f => (f && !ids.has(f) ? null : f))
    setRefThesisId(r => (typeof r === 'string' && !ids.has(r) ? undefined : r))
  }, [data])

  // ── History ─────────────────────────────────────────────────────────────────
  // One entry per navigation, pushed from here rather than from each call site, so
  // back and forward walk the reader's moves whichever pane made them. The entry
  // carries the two shared, surface-independent facts — the centred claim and the
  // reference thesis. Moving the thesis recolours every surface and used to be
  // unrecoverable by back; it is a navigation now.
  //
  // Nothing about the page's arrangement is in here: not pane open/closed, not the
  // split, not which surface the reader is showing. Back undoes where you are in the
  // argument, not how you have arranged the page to look at it.
  const lastNav = useRef<NavState | null>(null)
  const fromPop = useRef(false)
  useEffect(() => {
    if (refThesisId === undefined) return   // pre-init; the default effect hasn't run
    const nav: NavState = { focusId, refThesisId }
    const prev = lastNav.current
    lastNav.current = nav
    if (prev == null) { window.history.replaceState({ pzNav: nav }, ''); return }
    if (prev.focusId === nav.focusId && prev.refThesisId === nav.refThesisId) return
    if (fromPop.current) { fromPop.current = false; return }   // the pop IS the move
    window.history.pushState({ pzNav: nav }, '')
  }, [focusId, refThesisId])

  // Search highlights matching claims on the map (no expansion — it's a static map).
  const highlight = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !data) return new Set<string>()
    return new Set((data.claims ?? [])
      .filter(c => (c.tag ?? '').toLowerCase().includes(q) || (c.text ?? '').toLowerCase().includes(q))
      .map(c => String(c.id)))
  }, [search, data])

  const handleHover = useCallback((node: GraphNode | null, x?: number, y?: number) => {
    setHovered(node && x !== undefined && y !== undefined ? { node, x, y } : null)
  }, [])

  // Single click selects/centres a claim — nothing more; it never re-anchors the
  // reference thesis (that's the key's explicit mode). A normal background click only
  // deselects; the thesis is cleared ONLY from within "set reference thesis" mode, so a
  // stray click in normal use never drops it. Inference nodes aren't selectable.
  // A map selection is a fresh entry, so it clears the "came from" trace rather than
  // leaving a stale one for the focus view to draw.
  const handleSelect = useCallback((node: GraphNode | null) => {
    if (node) setHovered(null)
    // In "set reference thesis" mode: a claim anchors the thesis there, empty space (or a
    // junction) CLEARS it — either way the one-shot mode ends.
    if (nominating) {
      setNominating(false)
      setRefThesisId(node?._kind === 'claim' ? String(node.id) : null)
      return
    }
    setFromId(null)
    if (!node) { setFocusId(null); return }   // normal background → deselect only; thesis stays
    if (node._kind === 'claim') setFocusId(String(node.id))
  }, [nominating])

  // Double-click a claim: centre on it and make sure the reader pane is up. In the
  // swap world this was "dive into the focus view"; with the surfaces coexisting the
  // dive is just "open what you dived into", in whichever register the reader is
  // already set to. The reference thesis stays where it is — you are centring on the
  // claim, not re-anchoring the space.
  const handleActivate = useCallback((node: GraphNode) => {
    if (node._kind !== 'claim') return
    setFromId(null)
    setFocusId(String(node.id))
    showPane('reader')
  }, [showPane])

  // The one deliberate way to move the origin all stance is measured from — armed
  // from the key, then the next graph click nominates. Selecting stays cheap and
  // frequent; re-anchoring stays rare and intentional, and the reader pane can
  // centre on any claim but never moves the thesis.
  const toggleNominate = useCallback(() => setNominating(v => !v), [])

  // Refocus from inside the reader pane. The claim we leave becomes the "came from"
  // trace; the history entry is pushed by the nav effect above.
  const navigate = useCallback((id: string) => {
    setFromId(focusIdRef.current)
    setFocusId(id)
  }, [])

  // "Show on the map" (focus band icon, article footer, tile locate). Raises the map
  // pane if it is minimized and asks it for a tight neighbourhood zoom — an explicit
  // re-frame, distinct from the passive follow a plain selection gets. Selection and
  // reference thesis are untouched.
  const handleLocate = useCallback((id: string) => {
    setFocusId(id)
    showPane('graph')
    setLocate({ id })
  }, [showPane])
  const clearLocate = useCallback(() => setLocate(null), [])

  // Back to the top of the corpus. The STRUCTURAL thesis (`theses[0]`), not the
  // reference thesis: the reference thesis moves, and this is the one claim that is
  // always where you left it. Where they differ, the focus view's pinned thesis line
  // is the one-click way back to the reference thesis.
  const goToThesis = useCallback(() => {
    if (!thesisId) return
    setFromId(null)
    setFocusId(thesisId)
    showPane('reader')
  }, [thesisId, showPane])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearch(''); setFocusId(null); setNominating(false) }
    }
    const onPop = (e: PopStateEvent) => {
      const nav = e.state && (e.state as { pzNav?: NavState }).pzNav
      if (!nav) return
      fromPop.current = true
      setFromId(null)
      setFocusId(nav.focusId)
      setRefThesisId(nav.refThesisId)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  if (loading) return <Loading />
  if (error)   return <Loading message={`Failed to load YAML: ${error}`} error />
  if (!data || !graphData || !bounds || !groups) return null

  const gd = graphData as GraphData
  // Nothing selected still reads as the thesis in the reader (there is no blank
  // state for "one claim, read out"), while the map shows no selection at all.
  const fid = focusId ?? thesisId

  const panes: PaneSpec[] = [
    {
      id: 'graph',
      title: 'Map',
      minWidth: WORKSPACE.minWidth.graph,
      render: () => (
        <>
          <Graph
            data={data}
            graphData={gd}
            bounds={bounds}
            groups={groups}
            highlight={highlight}
            centerOn={focusId}
            locate={locate}
            onLocated={clearLocate}
            referenceThesisId={refThesisId ?? null}
            onHover={handleHover}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
          <Legend nominating={nominating} onToggleNominate={toggleNominate} />
        </>
      ),
    },
    {
      id: 'reader',
      // The rail and the tooltips name the surface currently loaded, so a minimized
      // reader still says which register it will come back in.
      title: READER_TITLE[reader],
      titleNode: <ReaderSwitch view={reader} onPick={setReader} />,
      minWidth: WORKSPACE.minWidth[reader],
      // Both surfaces pin the same reference thesis the graph measures from. When the
      // thesis has been cleared to null, fall back to the structural thesis so "what's
      // ultimately at stake" — the always-available top — is never blank; the graph
      // stays unpainted in that state regardless.
      render: () => {
        if (!fid) return null
        return reader === 'article'
          ? <ArticleView gd={gd} focusId={fid} referenceThesisId={refThesisId ?? thesisId} onFocus={navigate} onLocate={handleLocate} />
          : <FocusView gd={gd} focusId={fid} fromId={fromId} referenceThesisId={refThesisId ?? thesisId} onFocus={navigate} onLocate={handleLocate} />
      },
    },
  ]

  return (
    <>
      <TitleBar
        title={data.title || 'Argument Graph'}
        subtitle={data.id}
        actions={
          <>
            <ThesisButton onClick={goToThesis} disabled={!thesisId || fid === thesisId} />
            <Search value={search} onChange={setSearch} />
          </>
        }
      />
      <Workspace panes={panes} open={open} sizes={sizes} onToggle={togglePane} onResize={setSizes} />
      {/* The map's tooltip is viewport-positioned, so it rides above the whole
          workspace rather than inside the pane that raised it. */}
      {hovered && open.graph && <Tooltip node={hovered.node} x={hovered.x} y={hovered.y} nodeById={gd.nodeById} />}
    </>
  )
}
