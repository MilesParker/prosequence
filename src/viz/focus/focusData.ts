// focusData.ts — thin derivations over the shared GraphData indices.
//
// The focus view centres a single Claim (`focusId: ClaimId`). Everything else
// is read off `supports` / `attacks` / `consumers`, which buildGraphData
// computes once on load — neither view recomputes them.

import type { GraphData, ClaimNode } from '../graphData'
import type { Inference } from '../../types'

export function getClaim(gd: GraphData, id: string): ClaimNode | null {
  const n = gd.nodeById.get(id)
  return n && n._kind === 'claim' ? (n as ClaimNode) : null
}

/** Inferences that conclude `id` — the claim's For column. */
export const supportsOf = (gd: GraphData, id: string): Inference[] => gd.supports.get(id) ?? []
/** Inferences that contest `id` — the claim's Against column. */
export const attacksOf = (gd: GraphData, id: string): Inference[] => gd.attacks.get(id) ?? []
/** Inferences that use `id` as grounds or warrant — the parent band. */
export const consumersOf = (gd: GraphData, id: string): Inference[] => gd.consumers.get(id) ?? []

/** §4 pip predicates — presence only, never counts. */
export const isSupported = (gd: GraphData, id: string): boolean => supportsOf(gd, id).length > 0
export const isContested = (gd: GraphData, id: string): boolean => attacksOf(gd, id).length > 0

export type Output = { id: string; kind: 'concludes' | 'contests' }

/** The claim an inference outputs to (its concludes or contests target). */
export function outputOf(inf: Inference): Output {
  return inf.concludes
    ? { id: String(inf.concludes), kind: 'concludes' }
    : { id: String(inf.contests), kind: 'contests' }
}

/** Role a claim plays in an inference: which input list it sits in. */
export function roleOf(inf: Inference, id: string): 'grounds' | 'warrants' | null {
  if ((inf.warrants ?? []).some(w => String(w) === id)) return 'warrants'
  if ((inf.grounds ?? []).some(g => String(g) === id)) return 'grounds'
  return null
}

/**
 * The claim ids actually rendered around `focusId`: parent-band destinations
 * (plus the grounds shown in warrant-role tiles) and every grounds/warrant in
 * the For/Against cells. Used to decide whether the claim you came *from* is on
 * screen to be highlighted — it isn't when it's a co-input hidden behind a
 * grounds-role tile, or when you entered from the graph.
 */
export function renderedClaimIds(gd: GraphData, focusId: string): Set<string> {
  const ids = new Set<string>()
  for (const inf of consumersOf(gd, focusId)) {
    ids.add(outputOf(inf).id)
    if (roleOf(inf, focusId) === 'warrants') for (const g of inf.grounds ?? []) ids.add(String(g))
  }
  for (const inf of [...supportsOf(gd, focusId), ...attacksOf(gd, focusId)]) {
    for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])]) ids.add(String(c))
  }
  return ids
}
