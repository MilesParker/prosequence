// focusData.ts — thin derivations over the shared GraphData indices.
//
// The focus view centres a single Claim (`focusId: ClaimId`). Everything else
// is read off `supports` / `attacks` / `consumers`, which buildGraphData
// computes once on load — neither view recomputes them.

import type { GraphData, ClaimNode, Stance, StanceMap } from '../graphData'
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

/**
 * The stance of the branch hidden *below* a continuation claim — a claim shown as
 * a tap target (a cell ground/warrant or a parent destination) whose own
 * support/attack is off-frame. Walks down from `id` (its supporting/attacking
 * inferences → their grounds/warrants, recursively) and reports where everything
 * hidden past it leads *relative to the reference root*, reusing the Stage 3 stance
 * map: one-sided ⇒ that stance's colour, two-sided (or any genuinely `divided`
 * node) ⇒ `divided`. Claims already on screen (`visible`) are the frame, not the
 * frontier, so they don't count — we still descend past them to reach what's
 * hidden deeper. Returns null when nothing is hidden past `id` (a bedrock/leaf, or
 * an unpainted graph): a claim you can already read past has no continuation to
 * hint at, and gets no mark (§ "status only on continuations").
 */
export function frontierStance(
  gd: GraphData, sm: StanceMap, id: string, visible: Set<string>,
): Stance | null {
  const seen = new Set<string>([id])
  let aligned = false, opposed = false, divided = false
  const stack = [id]
  while (stack.length) {
    const u = stack.pop() as string
    for (const inf of [...supportsOf(gd, u), ...attacksOf(gd, u)]) {
      for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])]) {
        const cid = String(c)
        if (seen.has(cid)) continue
        seen.add(cid)
        if (!visible.has(cid)) {
          const st = sm.node.get(cid)
          if (st === 'aligned') aligned = true
          else if (st === 'opposed') opposed = true
          else if (st === 'divided') divided = true
        }
        stack.push(cid)   // descend even through visible claims — deeper is still hidden
      }
    }
  }
  if (!aligned && !opposed && !divided) return null
  if (divided || (aligned && opposed)) return 'divided'
  return aligned ? 'aligned' : 'opposed'
}
