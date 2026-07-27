import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { COLORS } from '../config'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { Legend } from './components/Legend'
import { FocusView } from './focus/FocusView'
import { useDiscourseData } from './hooks/useDiscourseData'
import { loadSettings, saveSettings } from './persist'
import type { GraphNode, GraphData } from './graphData'

type View = 'graph' | 'focus'

// Contextual swap between the two mutually-exclusive surfaces (§9a): an entry
// button on the graph, a return button in the focus view.
function ViewSwitch({ view, onGraph, onFocus }: { view: View; onGraph: () => void; onFocus: () => void }) {
  const style = {
    padding: '5px 12px', fontSize: 12, borderRadius: 6, cursor: 'pointer',
    border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.textMuted,
  }
  return view === 'graph'
    ? <button style={style} onClick={onFocus}>Focus view →</button>
    : <button style={style} onClick={onGraph}>← Back to graph</button>
}

export function App() {
  const { data, graphData, bounds, groups, error, loading } = useDiscourseData()

  // Restore the reader's last surface, centred claim and reference root (per
  // corpus). Read once at mount; validated against the loaded data below.
  const persisted = useMemo(loadSettings, [])

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>(persisted.view ?? 'graph')
  // The one shared selection (§9a): always a ClaimId, owned by neither view. It
  // drives the graph's centre-on-swap and the focus view's centre alike.
  const [focusId, setFocusId] = useState<string | null>(persisted.focusId ?? null)
  // The reference root — the origin all stance is measured from. A movable viewing
  // choice, not a property of the claim, and deliberately DECOUPLED from selection:
  // it defaults to the structural root and moves ONLY via the graph key's explicit
  // "set reference root" mode, never as a side effect of selecting or centring a
  // claim. That keeps "what's ultimately at stake" from drifting to wherever you
  // last clicked. States: undefined = pre-init (→ structural root); string = anchor;
  // null = unpainted (all neutral) — reachable only via an explicit clear, not by
  // deselecting.
  // Presence of the persisted key distinguishes a stored anchor/clear (string|null)
  // from a first visit (undefined → structural-root default effect below).
  const [refRootId, setRefRootId] = useState<string | null | undefined>(
    'refRootId' in persisted ? persisted.refRootId : undefined,
  )
  // "Set reference root" mode, toggled from the key: while on, the next graph click
  // nominates that claim as the origin instead of selecting it. Keeps re-anchoring a
  // deliberate act without hanging a control off every node (which the zoom layer
  // would shrink to nothing on the overview map anyway).
  const [nominating, setNominating] = useState(false)
  // The claim we last navigated away from inside the focus view — powers the
  // "came from" trace. Null when we entered focus fresh from the graph.
  const [fromId, setFromId] = useState<string | null>(null)
  // How the graph frames the shared claim when we return to it: 'reveal' (the
  // generic back button) or 'neighborhood' (the focus-band locate icon).
  const [graphEntryMode, setGraphEntryMode] = useState<'reveal' | 'neighborhood'>('reveal')
  // Read the live focus inside stable callbacks without re-creating them.
  const focusIdRef = useRef(focusId)
  useEffect(() => { focusIdRef.current = focusId }, [focusId])

  const rootId = data?.roots?.[0] != null ? String(data.roots[0]) : null

  // One reference root is selected by default on load (the structural root) so the
  // graph isn't blank — but it's only a default; the user can move it to any claim.
  useEffect(() => {
    if (refRootId === undefined && rootId) setRefRootId(rootId)
  }, [refRootId, rootId])

  // Persist the view settings (surface, centred claim, reference root) so a reload
  // lands where the reader left off. Viewport ("location") is persisted separately
  // by the graph itself.
  useEffect(() => {
    saveSettings({ view, focusId, refRootId })
  }, [view, focusId, refRootId])

  // Drop restored ids that no longer exist in this corpus (e.g. the YAML changed
  // since the last visit) so a stale focus/root can't point at nothing. Clearing
  // refRootId to undefined re-triggers the structural-root default above.
  useEffect(() => {
    if (!data) return
    const ids = new Set((data.claims ?? []).map(c => String(c.id)))
    setFocusId(f => (f && !ids.has(f) ? null : f))
    setRefRootId(r => (typeof r === 'string' && !ids.has(r) ? undefined : r))
  }, [data])

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
  // reference root (that's the key's explicit mode). A normal background click only
  // deselects; the root is cleared ONLY from within "set reference root" mode, so a
  // stray click in normal use never drops it. Inference nodes aren't selectable.
  const handleSelect = useCallback((node: GraphNode | null) => {
    if (node) setHovered(null)
    // In "set reference root" mode: a claim anchors the root there, empty space (or a
    // junction) CLEARS it — either way the one-shot mode ends.
    if (nominating) {
      setNominating(false)
      setRefRootId(node?._kind === 'claim' ? String(node.id) : null)
      return
    }
    if (!node) { setFocusId(null); return }   // normal background → deselect only; root stays
    if (node._kind === 'claim') setFocusId(String(node.id))
  }, [nominating])

  // Double-click a claim dives straight into the focus view for it, keeping the
  // reference root where it is (you're centring on the claim, not re-anchoring the
  // whole space). No "came from" claim on a fresh entry from the graph.
  const handleActivate = useCallback((node: GraphNode) => {
    if (node._kind !== 'claim') return
    const id = String(node.id)
    setFromId(null)
    setFocusId(id)
    setView('focus')
    window.history.pushState({ pzFocus: id }, '')
  }, [])

  // The one deliberate way to move the origin all stance is measured from — wired to
  // the explicit target control on a claim, never to a plain tap. Selecting stays
  // cheap and frequent; re-anchoring stays rare and intentional.
  // Re-anchoring the reference root is a graph-only act: arm "set reference root"
  // mode from the key, then the next graph click nominates. The focus view can
  // centre on any claim (a plain click) but never moves the root.
  const toggleNominate = useCallback(() => setNominating(v => !v), [])

  // Refocus inside the stack (§7). The claim we leave becomes the "came from"
  // trace. Push a history entry so browser-back walks it.
  const navigate = useCallback((id: string) => {
    setFromId(focusIdRef.current)
    setFocusId(id)
    window.history.pushState({ pzFocus: id }, '')
  }, [])

  // Focus-band return icon: drop back to the graph zoomed onto this claim's
  // immediate neighbourhood, rather than the generic back button's reveal. Centres
  // on the claim without disturbing the reference root.
  const handleLocate = useCallback((id: string) => {
    setFocusId(id)
    setGraphEntryMode('neighborhood')
    setView('graph')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearch(''); setFocusId(null); setNominating(false) }
    }
    const onPop = (e: PopStateEvent) => {
      const id = e.state && (e.state as { pzFocus?: string }).pzFocus
      if (id) { setFromId(null); setFocusId(id) }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('popstate', onPop)
    }
  }, [])

  // Null selection defaults to a root when entering the focus view (§9a-2/§10.3).
  useEffect(() => {
    if (view === 'focus' && !focusId && rootId) setFocusId(rootId)
  }, [view, focusId, rootId])

  if (loading) return <Loading />
  if (error)   return <Loading message={`Failed to load YAML: ${error}`} error />
  if (!data || !graphData || !bounds || !groups) return null

  const gd = graphData as GraphData
  const fid = focusId ?? rootId

  return (
    <>
      <TitleBar
        title={data.title || 'Argument Graph'}
        subtitle={data.id}
        search={view === 'graph' ? search : undefined}
        onSearch={view === 'graph' ? setSearch : undefined}
        viewToggle={<ViewSwitch view={view} onGraph={() => { setGraphEntryMode('reveal'); setView('graph') }} onFocus={() => setView('focus')} />}
      />

      {view === 'graph' ? (
        <>
          <Graph
            data={data}
            graphData={gd}
            bounds={bounds}
            groups={groups}
            highlight={highlight}
            centerOn={focusId}
            centerMode={graphEntryMode}
            referenceRootId={refRootId ?? null}
            onHover={handleHover}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
          {hovered && <Tooltip node={hovered.node} x={hovered.x} y={hovered.y} nodeById={gd.nodeById} />}
          <Legend nominating={nominating} onToggleNominate={toggleNominate} />
        </>
      ) : (
        // The focus view pins the same reference root the graph measures from
        // (Stage 3). When the root has been cleared to null, fall back to the
        // structural root so "what's ultimately at stake" — the always-available
        // top — is never blank; the graph stays unpainted in that state regardless.
        fid && <FocusView gd={gd} focusId={fid} fromId={fromId} referenceRootId={refRootId ?? rootId} onFocus={navigate} onLocate={handleLocate} />
      )}
    </>
  )
}
