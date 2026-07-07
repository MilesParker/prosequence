import { useState, useCallback } from 'react'
import { Loading } from './components/Loading'
import { TitleBar } from './components/TitleBar'
import { Graph } from './components/Graph'
import { Tooltip } from './components/Tooltip'
import { DetailPanel } from './components/DetailPanel'
import { Legend } from './components/Legend'
import { useDiscourseData } from './hooks/useDiscourseData'
import type { GraphNode } from './graphData'
import type { GraphData } from './graphData'

export function App() {
  const { data, graphData, error, loading } = useDiscourseData()

  const [hovered, setHovered] = useState<{ node: GraphNode; x: number; y: number } | null>(null)
  const [selected, setSelected] = useState<GraphNode | null>(null)

  const handleHover = useCallback((node: GraphNode | null, x?: number, y?: number) => {
    setHovered(node && x !== undefined && y !== undefined ? { node, x, y } : null)
  }, [])

  const handleClick = useCallback((node: GraphNode | null) => {
    setSelected(node)
    if (node) setHovered(null)
  }, [])

  if (loading) return <Loading />
  if (error)   return <Loading message={`Failed to load YAML: ${error}`} error />
  if (!data || !graphData) return null

  return (
    <>
      <TitleBar title={data.title || 'Argument Graph'} subtitle={data.id} />
      <Graph data={data} onHover={handleHover} onClick={handleClick} />
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
