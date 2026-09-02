// trail.ts — the routes from the reference thesis down to the centred claim, and
// how far the argument runs on beneath a claim.
//
// The structure is a DAG, so "the" path is not well defined: a claim can reach the
// thesis several ways. Rather than pick one and imply it is the only one, this
// returns up to `MAX_TRAILS` of the shortest routes and the surface shows them
// stacked — they are one compact line each.

import type { GraphData } from '../graphData'
import type { Inference } from '../../types'
import { getClaim, consumersOf, outputOf, supportsOf, attacksOf } from '../focus/focusData'

/** More than a few routes stops being orientation and starts being a list. */
export const MAX_TRAILS = 3

export interface Trails {
  /** Each route thesis-first, ending at the claim BEFORE the centred one. */
  paths: string[][]
  /** Shortest routes beyond the ones returned; 0 when `paths` is all of them. */
  more: number
}

export function trailsFromThesis(gd: GraphData, focusId: string, thesisId: string): Trails | null {
  if (focusId === thesisId) return { paths: [], more: 0 }

  // Breadth-first UP from the claim, keeping every predecessor that lies on a
  // shortest route, so the enumeration below can walk the whole shortest-path DAG
  // rather than a single arbitrary chain.
  const dist = new Map<string, number>([[focusId, 0]])
  const parents = new Map<string, string[]>()
  const queue = [focusId]
  for (let head = 0; head < queue.length; head++) {
    const u = queue[head]
    const du = dist.get(u)!
    for (const inf of consumersOf(gd, u)) {
      const v = outputOf(inf).id
      const dv = dist.get(v)
      if (dv === undefined) {
        dist.set(v, du + 1)
        parents.set(v, [u])
        queue.push(v)
      } else if (dv === du + 1 && !parents.get(v)!.includes(u)) {
        parents.get(v)!.push(u)
      }
    }
  }
  if (!dist.has(thesisId)) return null

  // Walk down from the thesis. `parents` points toward the centred claim, so each
  // route comes out already in reading order.
  const paths: string[][] = []
  let more = 0
  const walk = (at: string, acc: string[]) => {
    if (at === focusId) {
      if (paths.length < MAX_TRAILS) paths.push(acc.slice(0, -1))  // drop the centred claim
      else more += 1
      return
    }
    for (const next of parents.get(at) ?? []) {
      if (acc.includes(next)) continue
      walk(next, [...acc, next])
      if (more > 0 && paths.length >= MAX_TRAILS && more > 20) return   // enough to say "more"
    }
  }
  walk(thesisId, [thesisId])
  return { paths, more }
}

/**
 * Keep a long route from crowding out the claim it leads to: hold the two ends,
 * elide the middle. Returns entries in order; `null` marks the elision.
 */
export function elide(path: string[], max = 5): Array<string | null> {
  if (path.length <= max) return path
  return [path[0], path[1], null, path[path.length - 2], path[path.length - 1]]
}

/**
 * REACH: how many inference hops the argument runs on BENEATH a claim — the
 * article's answer to the focus view's frontier chevron ("there is more this
 * way"), as a number rather than a mark, since prose has no row to hang a chevron
 * off. 0 means nothing argues for or against it: the reading stops here.
 *
 * Deliberately not called depth. Computed depth runs the other way — BFS from the
 * theses, counting hops ABOVE a claim toward what it serves — and the two would
 * have collided under one word. The distinction is load-bearing twice over: depth
 * must never be rendered to a reader, which survives only because what the article
 * renders is reach; and ordering by reach is near-noise if read as depth, since an
 * inference's grounds all sit at roughly the same distance from a thesis.
 */
export function reachBelow(gd: GraphData, id: string, memo = new Map<string, number>(), seen = new Set<string>()): number {
  const hit = memo.get(id)
  if (hit !== undefined) return hit
  if (seen.has(id)) return 0            // cycle guard; the model forbids them, the walk does not assume it
  seen.add(id)
  let best = 0
  for (const inf of [...supportsOf(gd, id), ...attacksOf(gd, id)]) {
    for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])]) {
      best = Math.max(best, 1 + reachBelow(gd, String(c), memo, seen))
    }
  }
  seen.delete(id)
  memo.set(id, best)
  return best
}

/**
 * How far the longest chain under an argument runs — its grounds' reach, not its
 * warrants', since warrants are what an argument assumes rather than what it
 * builds on. Used to order arguments within a section: the most developed line
 * first. This is argumentative development, NOT importance, and the page makes the
 * ordering self-evidencing by printing the same numbers it sorts on.
 */
export function argumentReach(gd: GraphData, grounds: string[], reachOf: (id: string) => number): number {
  let best = 0
  for (const g of grounds) best = Math.max(best, reachOf(g))
  return best
}

/**
 * Whether an argument rests directly on a bedrock commitment — a terminal claim
 * among its grounds or its warrants. These sort FIRST despite having the least
 * beneath them, and the reason stands on its own rather than as a hedge against
 * ranking: a value commitment is undeveloped by definition rather than by neglect,
 * so ordering on development alone buries exactly the claims the space rests on.
 */
export function restsOnBedrock(gd: GraphData, inf: Inference): boolean {
  for (const c of [...(inf.grounds ?? []), ...(inf.warrants ?? [])]) {
    if (getClaim(gd, String(c))?.terminal) return true
  }
  return false
}
