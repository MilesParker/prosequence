import { useState, useCallback, useMemo, useEffect, useRef } from 'react'
import { COLORS } from '../config'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { Legend } from './components/Legend'
import { FocusView } from './focus/FocusView'
import { useDiscourseData } from './hooks/useDiscourseData'
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

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [search, setSearch] = useState('')
  const [view, setView] = useState<View>('graph')
  // The one shared selection (§9a): always a ClaimId, owned by neither view. It
  // drives the graph's selection ring and the focus view's centre alike.
  const [focusId, setFocusId] = useState<string | null>(null)
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

  // Single click selects a claim (rings it, arms the focus centre). Background
  // click deselects. Inference nodes are not selectable — they are junctions.
  const handleSelect = useCallback((node: GraphNode | null) => {
    if (node) setHovered(null)
    setFocusId(node && node._kind === 'claim' ? String(node.id) : null)
  }, [])

  // Double-click a claim dives straight into the focus view for it. No "came
  // from" claim exists on a fresh entry from the graph, so clear the trace.
  const handleActivate = useCallback((node: GraphNode) => {
    if (node._kind !== 'claim') return
    const id = String(node.id)
    setFromId(null)
    setFocusId(id)
    setView('focus')
    window.history.pushState({ pzFocus: id }, '')
  }, [])

  // Refocus inside the stack (§7). The claim we leave becomes the "came from"
  // trace. Push a history entry so browser-back walks it.
  const navigate = useCallback((id: string) => {
    setFromId(focusIdRef.current)
    setFocusId(id)
    window.history.pushState({ pzFocus: id }, '')
  }, [])

  // Focus-band return icon: drop back to the graph zoomed onto this claim's
  // immediate neighbourhood, rather than the generic back button's reveal.
  const handleLocate = useCallback((id: string) => {
    setFocusId(id)
    setGraphEntryMode('neighborhood')
    setView('graph')
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSearch(''); setFocusId(null) }
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
            selectedId={focusId}
            onHover={handleHover}
            onSelect={handleSelect}
            onActivate={handleActivate}
          />
          {hovered && <Tooltip node={hovered.node} x={hovered.x} y={hovered.y} nodeById={gd.nodeById} />}
          <Legend />
        </>
      ) : (
        fid && <FocusView gd={gd} focusId={fid} fromId={fromId} onFocus={navigate} onLocate={handleLocate} />
      )}
    </>
  )
}
