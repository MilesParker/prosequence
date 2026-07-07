import { useState, useEffect } from 'react'
import * as jsyaml from 'js-yaml'
import { DATA_FILE } from '../../config'
import type { DiscourseSpace } from '../../types'
import { buildGraphData, type GraphData } from '../graphData'

interface Result {
  data: DiscourseSpace | null
  graphData: GraphData | null
  loading: boolean
  error: string | null
}

export function useDiscourseData(): Result {
  const [data, setData]           = useState<DiscourseSpace | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
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
        if (!cancelled) {
          setData(parsed)
          setGraphData(buildGraphData(parsed))
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

  return { data, graphData, loading, error }
}
