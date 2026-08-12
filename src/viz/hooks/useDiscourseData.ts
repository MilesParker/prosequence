import { useState, useEffect } from 'react'
import * as jsyaml from 'js-yaml'
import { DATA_FILE } from '../../config'
import type { DiscourseSpace } from '../../types'
import { buildGraphData, type GraphData } from '../graphData'
import { layoutGraph, type LayoutBounds, type GroupBox } from '../layout'

interface Result {
  data: DiscourseSpace | null
  graphData: GraphData | null
  bounds: LayoutBounds | null
  groups: GroupBox[] | null
  loading: boolean
  error: string | null
}

/**
 * The one place the parsed YAML is reconciled with the schema. `roots` is the
 * pre-rename spelling of `theses`, read but never written: the dev server
 * serves the newest commit touching a corpus, which may be an ingest branch
 * that predates the rename, so the viewer has to accept both. Normalizing here
 * rather than at each reader keeps `DiscourseSpace.theses` the only spelling
 * anything downstream knows about.
 */
function normalize(parsed: DiscourseSpace): DiscourseSpace {
  const legacy = (parsed as { roots?: unknown }).roots
  if (parsed.theses || !Array.isArray(legacy)) return parsed
  return { ...parsed, theses: legacy as DiscourseSpace['theses'] }
}

export function useDiscourseData(): Result {
  const [data, setData]           = useState<DiscourseSpace | null>(null)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [bounds, setBounds]       = useState<LayoutBounds | null>(null)
  const [groups, setGroups]       = useState<GroupBox[] | null>(null)
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const resp = await fetch(DATA_FILE)
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`)
        const raw = await resp.text()
        const parsed = normalize(jsyaml.load(raw) as DiscourseSpace)
        const gd = buildGraphData(parsed)
        const r = await layoutGraph(gd)   // ELK is async; positions land on gd's nodes/links
        if (!cancelled) {
          setData(parsed)
          setGraphData(gd)
          setBounds(r.bounds)
          setGroups(r.groups)
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

  return { data, graphData, bounds, groups, loading, error }
}
