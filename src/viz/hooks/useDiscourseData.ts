import { useState, useEffect } from 'react'
import * as jsyaml from 'js-yaml'
import { DATA_FILE } from '../../config'
import type { DiscourseSpace } from '../../types'
import { buildGraphData, type GraphData } from '../graphData'
import { layoutGraph, type LayoutBounds } from '../layout'

interface Result {
  data: DiscourseSpace | null
  graphData: GraphData | null
  bounds: LayoutBounds | null
  loading: boolean
  error: string | null
}

export function useDiscourseData(): Result {
  const [data, setData]           = useState<DiscourseSpace | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [bounds, setBounds]       = useState<LayoutBounds | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const resp = await fetch(DATA_FILE)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const raw = await resp.text()
        const parsed = jsyaml.load(raw) as DiscourseSpace
        const gd = buildGraphData(parsed)
        const b = await layoutGraph(gd)   // ELK is async; positions land on gd's nodes/links
        if (!cancelled) {
          setData(parsed)
          setGraphData(gd)
          setBounds(b)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [])

  return { data, graphData, bounds, loading, error }
}
