import { useState, useCallback, useMemo, useEffect } from 'react'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { DetailPanel } from './components/DetailPanel'
import { Legend } from './components/Legend'
import { useDiscourseData } from './hooks/useDiscourseData'
import type { GraphNode, GraphData } from './graphData'
import {
  deriveCorpus, visibleGraph, emptyOverrides,
  setSubtree, incomingInferences, pathToReveal, searchClaims, corpusCounts,
  type Overrides,
} from './disclosure'

export function App() {
  const { data, graphData, error, loading } = useDiscourseData()

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  // Disclosure overrides on the §5 defaults (source of truth stays the topology).
  const [over, setOver] = useState<Overrides>(() => emptyOverrides())
  const [search, setSearch] = useState('')

  const derived = useMemo(() => (data ? deriveCorpus(data) : null), [data])

  // Merge user overrides with search-forced expansion (§4.4) into one override set.
  const { overrides, highlight } = useMemo(() => {
    if (!data || !derived) return { overrides: emptyOverrides(), highlight: new Set<string>() }
    const states = new Map(over.states)
    const promoted = new Set(over.promoted)
    const matches = searchClaims(data, search)
    for (const m of matches) {
      const { infs, promote } = pathToReveal(m, derived)
      for (const i of infs) states.set(i, 'X')
      for (const p of promote) promoted.add(p)
    }
    return { overrides: { states, promoted }, highlight: new Set(matches) }
  }, [data, derived, over, search])

  const projection = useMemo(
    () => (data && derived ? visibleGraph(data, overrides, derived) : null),
    [data, derived, overrides],
  )

  // Dev signal: §8 acceptance counts + no terminal folded.
  useEffect(() => {
    if (!import.meta.env.DEV || !derived || !data) return
    const c = corpusCounts(derived)
    const terminalFolded = (data.claims ?? []).filter(cl => cl.terminal && derived.foldableSet.has(String(cl.id)))
    // eslint-disable-next-line no-console
    console.info(`[disclosure] ${data.id}: folded=${c.folded} undercut-floor=${c.undercutFloor} root-fan-in=${c.rootFanIn}`)
    console.assert(terminalFolded.length === 0, 'terminal claim folded', terminalFolded)
  }, [data, derived])

  // ── Disclosure affordances (§6) ─────────────────────────────────────────────
  // Clicking a port expands it (P→X) AND reveals its leaf grounds/warrants, so a
  // leaf-only argument shows its content in one click instead of two (expand,
  // then open the grounds control).
  const onPortClick = useCallback((inf: string) => {
    const i = derived?.inf.get(inf)
    const leaves = i
      ? [...(i.grounds ?? []), ...(i.warrants ?? [])].map(String).filter(g => derived!.foldableSet.has(g))
      : []
    setOver(o => {
      const promoted = new Set(o.promoted)
      for (const g of leaves) promoted.add(g)
      return { states: new Map(o.states).set(inf, 'X'), promoted }
    })
  }, [derived])
  const onJunctionClick = useCallback((inf: string) => {
    const cur = projection?.inferenceState.get(inf) ?? 'J'
    const next = cur === 'X' ? 'P' : 'X'   // J→X, X→P (floor re-applies in effectiveState)
    setOver(o => ({ states: new Map(o.states).set(inf, next), promoted: o.promoted }))
  }, [projection])
  const onChipClick = useCallback((_inf: string, claimId: string) => {
    setOver(o => ({ states: o.states, promoted: new Set(o.promoted).add(claimId) }))
  }, [])
  const onBadgeClick = useCallback((inf: string) => {
    const ids = projection?.folded.get(inf)?.groundsIds ?? []
    setOver(o => {
      const promoted = new Set(o.promoted)
      for (const id of ids) promoted.add(id)
      return { states: o.states, promoted }
    })
  }, [projection])
  // Re-fold a junction's grounds (symmetric with onBadgeClick opening them).
  const onGroundsClose = useCallback((inf: string) => {
    if (!derived) return
    const i = derived.inf.get(inf)
    if (!i) return
    const gs = (i.grounds ?? []).map(String).filter(g => derived.foldableSet.has(g))
    setOver(o => {
      const promoted = new Set(o.promoted)
      for (const g of gs) promoted.delete(g)
      return { states: o.states, promoted }
    })
  }, [derived])
  const onClaimExpand = useCallback((claimId: string) => {
    if (!derived) return
    setOver(o => {
      let next = o
      for (const i of incomingInferences(claimId, derived)) next = setSubtree(i, 'X', next, derived)
      return next
    })
  }, [derived])
  const onClaimCollapse = useCallback((claimId: string) => {
    if (!derived) return
    setOver(o => {
      let next = o
      for (const i of incomingInferences(claimId, derived)) next = setSubtree(i, 'P', next, derived)
      return next
    })
  }, [derived])

  // Esc → default view (§4.4/§6): drop all overrides and clear search.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOver(emptyOverrides()); setSearch(''); setSelected(null) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const handleHover = useCallback((node: GraphNode | null, x?: number, y?: number) => {
    setHovered(node && x !== undefined && y !== undefined ? { node, x, y } : null)
  }, [])
  const handleSelect = useCallback((node: GraphNode | null) => {
    setSelected(node)
    if (node) setHovered(null)
  }, [])

  if (loading) return <Loading />
  if (error)   return <Loading message={`Failed to load YAML: ${error}`} error />
  if (!data || !graphData || !derived || !projection) return null

  return (
    <>
      <TitleBar title={data.title || 'Argument Graph'} subtitle={data.id} search={search} onSearch={setSearch} />
      <Graph
        data={data}
        graphData={graphData as GraphData}
        derived={derived}
        projection={projection}
        highlight={highlight}
        onHover={handleHover}
        onSelect={handleSelect}
        onPortClick={onPortClick}
        onJunctionClick={onJunctionClick}
        onChipClick={onChipClick}
        onBadgeClick={onBadgeClick}
        onGroundsClose={onGroundsClose}
        onClaimExpand={onClaimExpand}
        onClaimCollapse={onClaimCollapse}
      />
      {hovered && <Tooltip node={hovered.node} x={hovered.x} y={hovered.y} nodeById={(graphData as GraphData).nodeById} />}
      {selected && (
        <DetailPanel
          node={selected}
          graphData={graphData as GraphData}
          onClose={() => setSelected(null)}
        />
      )}
      <Legend />
    </>
  )
}
