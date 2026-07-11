import { useState, useCallback, useMemo, useEffect } from 'react'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { DetailPanel } from './components/DetailPanel'
import { Legend } from './components/Legend'
import { useDiscourseData } from './hooks/useDiscourseData'
import type { GraphNode, GraphData } from './graphData'

export function App() {
  const { data, graphData, bounds, error, loading } = useDiscourseData()

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)
  const [search, setSearch] = useState('')

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
  const handleSelect = useCallback((node: GraphNode | null) => {
    setSelected(node)
    if (node) setHovered(null)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setSelected(null); setSearch('') }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (loading) return <Loading />
  if (error)   return <Loading message={`Failed to load YAML: ${error}`} error />
  if (!data || !graphData || !bounds) return null

  return (
    <>
      <TitleBar title={data.title || 'Argument Graph'} subtitle={data.id} search={search} onSearch={setSearch} />
      <Graph
        data={data}
        graphData={graphData as GraphData}
        bounds={bounds}
        highlight={highlight}
        onHover={handleHover}
        onSelect={handleSelect}
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
