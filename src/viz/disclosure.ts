// disclosure.ts — progressive disclosure engine (pure, framework-free).
//
// Everything here is a pure function of the corpus plus a small override set.
// The renderer consumes `visibleGraph()`; it owns no topology of its own.
// See the Progressive Disclosure spec for the governing rules (§ references
// below point at it).

import type { DiscourseSpace, Claim, Inference } from '../types'
import type { EdgeRole } from './graphData'

export type DisState = 'P' | 'J' | 'X'

const ORDER: Record<DisState, number> = { P: 0, J: 1, X: 2 }
const maxState = (a: DisState, b: DisState): DisState => (ORDER[a] >= ORDER[b] ? a : b)

// ── Derived quantities (§1) ─────────────────────────────────────────────────
// Computed once per corpus and memoized on the DiscourseSpace object. Never
// cached on node objects (§7).

export interface Derived {
  claim: Map<string, Claim>
  inf: Map<string, Inference>
  roots: Set<string>
  /** claimId → # inferences citing it as a ground or warrant. */
  refCount: Map<string, number>
  /** claimId → inferences concluding it. */
  concludedBy: Map<string, string[]>
  /** claimId → inferences rebutting it (contests a claim). */
  contestedBy: Map<string, string[]>
  /** infId → inferences undercutting it (contests an inference). */
  undercutBy: Map<string, string[]>
  /** claimId → inferences whose output is this claim (concludes ∪ rebuts). */
  ports: Map<string, string[]>
  /** claimId → inferences citing it as a ground or warrant (reverse of inputs). */
  usedBy: Map<string, string[]>
  /** infId → its output target, or null. */
  outputOf: Map<string, { kind: 'claim' | 'inference'; id: string } | null>
  /** Claims satisfying foldable() (§2). */
  foldableSet: Set<string>
  foldable: (claimId: string) => boolean
}

const cache = new WeakMap<DiscourseSpace, Derived>()

export function deriveCorpus(ds: DiscourseSpace): Derived {
  const hit = cache.get(ds)
  if (hit) return hit

  const claims = ds.claims ?? []
  const inferences = ds.inferences ?? []
  const claim = new Map(claims.map(c => [String(c.id), c]))
  const inf = new Map(inferences.map(i => [String(i.id), i]))
  const roots = new Set((ds.roots ?? []).map(String))

  const refCount = new Map<string, number>()
  const concludedBy = new Map<string, string[]>()
  const contestedBy = new Map<string, string[]>()
  const undercutBy = new Map<string, string[]>()
  const ports = new Map<string, string[]>()
  const usedBy = new Map<string, string[]>()
  const outputOf = new Map<string, { kind: 'claim' | 'inference'; id: string } | null>()

  const push = (m: Map<string, string[]>, k: string, v: string) =>
    m.set(k, [...(m.get(k) ?? []), v])
  const bump = (k: string) => refCount.set(k, (refCount.get(k) ?? 0) + 1)

  for (const i of inferences) {
    const id = String(i.id)
    for (const g of i.grounds ?? []) { bump(String(g)); push(usedBy, String(g), id) }
    for (const w of i.warrants ?? []) { bump(String(w)); push(usedBy, String(w), id) }

    if (i.concludes != null) {
      const t = String(i.concludes)
      push(concludedBy, t, id)
      push(ports, t, id)
      outputOf.set(id, { kind: 'claim', id: t })
    } else if (i.contests != null) {
      const t = String(i.contests)
      if (inf.has(t)) {
        push(undercutBy, t, id)              // undercut: contests an inference
        outputOf.set(id, { kind: 'inference', id: t })
      } else {
        push(contestedBy, t, id)             // rebut: contests a claim
        push(ports, t, id)
        outputOf.set(id, { kind: 'claim', id: t })
      }
    } else {
      outputOf.set(id, null)
    }
  }

  // A grounds/warrant claim folds into its parent inference iff it has no
  // incoming edges — i.e. it is never itself concluded or contested (a raw
  // leaf). Roots and terminals are kept visible (roots anchor the view;
  // terminals are bedrock value commitments, spec §4.2).
  const foldableSet = new Set<string>()
  for (const c of claims) {
    const id = String(c.id)
    const noIncoming =
      (concludedBy.get(id)?.length ?? 0) === 0 &&
      (contestedBy.get(id)?.length ?? 0) === 0
    if (noIncoming && !roots.has(id) && c.terminal === false) foldableSet.add(id)
  }

  const derived: Derived = {
    claim, inf, roots,
    refCount, concludedBy, contestedBy, undercutBy, ports, usedBy, outputOf,
    foldableSet,
    foldable: (id: string) => foldableSet.has(id),
  }
  cache.set(ds, derived)
  return derived
}

// ── Disclosure state (§5, §7) ───────────────────────────────────────────────
// Overrides on the topology-derived defaults, not the source of truth.

export interface Overrides {
  states: Map<string, DisState>   // infId → forced state
  promoted: Set<string>           // claimIds promoted from chip/badge to node
}

export function emptyOverrides(): Overrides {
  return { states: new Map(), promoted: new Set() }
}

/**
 * Default view: show the argument's structure, but only where there is
 * structure to show. An inference expands (X) iff at least one of its
 * grounds/warrants is non-leaf (has incoming edges of its own). If every input
 * is a folded leaf there is nothing to draw but a "{n} grounds" badge, so the
 * inference collapses onto its conclusion's rim as a port — its leaves stay one
 * hover away. Deeper collapsing (J) is reached by interaction.
 */
function defaultState(infId: string, d: Derived): DisState {
  const i = d.inf.get(infId)
  if (!i) return 'X'
  const inputs = [...(i.grounds ?? []), ...(i.warrants ?? [])].map(String)
  const hasStructuralInput = inputs.some(c => !d.foldableSet.has(c))
  return hasStructuralInput ? 'X' : 'P'
}

/** §4.1 undercut floor: an undercut inference may never be P. */
function floored(infId: string, s: DisState, d: Derived): DisState {
  const hasUndercut = (d.undercutBy.get(infId)?.length ?? 0) > 0
  return hasUndercut ? maxState(s, 'J') : s
}

export function effectiveState(infId: string, ov: Overrides, d: Derived): DisState {
  const raw = ov.states.get(infId) ?? defaultState(infId, d)
  return floored(infId, raw, d)
}

// ── Projection (§3, §5) ─────────────────────────────────────────────────────

export interface FoldedInfo {
  /** Folded warrants → inline chips. */
  chips: string[]
  /** Folded grounds → one count badge; ids kept for the promote-all action. */
  groundsIds: string[]
}

export interface ProjEdge {
  id: string
  source: string
  target: string
  role: EdgeRole
  toInference: boolean
}

export interface Projection {
  visibleClaims: Set<string>
  inferenceState: Map<string, DisState>
  folded: Map<string, FoldedInfo>
  /** claimId → count of hidden things behind it (§6 persistent indicator). */
  hiddenCount: Map<string, number>
  edges: ProjEdge[]
}

/**
 * BFS from the roots, threading disclosure state through the topology. A claim
 * pulls in its incoming inferences; an inference reveals downstream claims only
 * per its state (§3): P reveals nothing, J only promoted folded inputs, X all
 * non-foldable inputs (plus promoted folded ones). Undercutters of any shown
 * inference are shown too, attached to it.
 */
export function visibleGraph(ds: DiscourseSpace, ov: Overrides, d: Derived): Projection {
  const visibleClaims = new Set<string>()
  const inferenceState = new Map<string, DisState>()
  const folded = new Map<string, FoldedInfo>()
  const edges: ProjEdge[] = []

  const claimQueue: string[] = []
  const infQueue: string[] = []

  const seeClaim = (id: string) => {
    if (!d.claim.has(id) || visibleClaims.has(id)) return
    visibleClaims.add(id)
    claimQueue.push(id)
  }
  const seeInf = (id: string) => {
    if (!d.inf.has(id) || inferenceState.has(id)) return
    infQueue.push(id)
  }

  for (const r of d.roots) seeClaim(r)

  const isRevealed = (claimId: string, state: DisState) => {
    // Which grounds/warrants of an X/J inference become nodes.
    const foldableClaim = d.foldable(claimId)
    if (foldableClaim) return ov.promoted.has(claimId)   // promoted chip/badge
    return state === 'X'                                  // non-foldable: only at X
  }

  while (claimQueue.length || infQueue.length) {
    while (claimQueue.length) {
      const c = claimQueue.shift()!
      for (const infId of d.ports.get(c) ?? []) seeInf(infId)
    }
    while (infQueue.length) {
      const infId = infQueue.shift()!
      if (inferenceState.has(infId)) continue
      const i = d.inf.get(infId)!
      const state = effectiveState(infId, ov, d)
      inferenceState.set(infId, state)

      const grounds = (i.grounds ?? []).map(String)
      const warrants = (i.warrants ?? []).map(String)

      // Folded material for chips/badge (shown at J and X).
      const chips = warrants.filter(w => d.foldable(w) && !ov.promoted.has(w))
      const groundsIds = grounds.filter(g => d.foldable(g) && !ov.promoted.has(g))
      folded.set(infId, { chips, groundsIds })

      // Reveal downstream claims per state, and wire their edges.
      if (state !== 'P') {
        for (const g of grounds) if (isRevealed(g, state)) { seeClaim(g); pushEdge(g, infId, 'Grounds', true) }
        for (const w of warrants) if (isRevealed(w, state)) { seeClaim(w); pushEdge(w, infId, 'Warrants', true) }

        // Output edge (junction → target claim).
        const out = d.outputOf.get(infId)
        if (out && out.kind === 'claim') {
          const role: EdgeRole = i.concludes != null ? 'Concludes' : 'Contests'
          pushEdge(infId, out.id, role, false)
        }
      }

      // Undercutters attach to this inference regardless of its state.
      for (const j of d.undercutBy.get(infId) ?? []) {
        seeInf(j)
        pushEdge(j, infId, 'Contests', true)
      }
    }
  }

  // Prune undercut edges whose undercutter ended up not shown (defensive).
  const shownEdges = edges.filter(e =>
    (e.toInference ? inferenceState.has(e.target) : visibleClaims.has(e.target)) &&
    (d.inf.has(e.source) ? inferenceState.has(e.source) : visibleClaims.has(e.source)))

  const hiddenCount = computeHidden(d, inferenceState, folded)

  return { visibleClaims, inferenceState, folded, hiddenCount, edges: shownEdges }

  function pushEdge(source: string, target: string, role: EdgeRole, toInference: boolean) {
    edges.push({ id: `${source}->${target}:${role}`, source, target, role, toInference })
  }
}

/**
 * §6: a claim with folded material behind it shows a persistent count. We count,
 * per incoming inference: a fully-collapsed (P) inference as one hidden path,
 * and a J/X inference's folded chips + badge as the claims they stand in for.
 */
function computeHidden(
  d: Derived,
  inferenceState: Map<string, DisState>,
  folded: Map<string, FoldedInfo>,
): Map<string, number> {
  const hidden = new Map<string, number>()
  for (const [infId, state] of inferenceState) {
    const out = d.outputOf.get(infId)
    if (!out || out.kind !== 'claim') continue
    const f = folded.get(infId)
    const n = state === 'P' ? 1 : ((f?.chips.length ?? 0) + (f?.groundsIds.length ?? 0))
    if (n > 0) hidden.set(out.id, (hidden.get(out.id) ?? 0) + n)
  }
  return hidden
}

// ── Bulk state helpers for the interaction affordances (§6) ─────────────────

/** Recursively set an inference and everything feeding it to a target state. */
export function setSubtree(
  rootInf: string, target: DisState, ov: Overrides, d: Derived,
): Overrides {
  const states = new Map(ov.states)
  const seen = new Set<string>()
  const walk = (infId: string) => {
    if (seen.has(infId)) return
    seen.add(infId)
    states.set(infId, target)
    const i = d.inf.get(infId)
    if (!i) return
    for (const c of [...(i.grounds ?? []), ...(i.warrants ?? [])].map(String)) {
      for (const child of d.ports.get(c) ?? []) walk(child)
    }
    for (const j of d.undercutBy.get(infId) ?? []) walk(j)
  }
  walk(rootInf)
  return { states, promoted: ov.promoted }
}

/** All inferences whose output is this claim (its incoming inferences). */
export function incomingInferences(claimId: string, d: Derived): string[] {
  return d.ports.get(claimId) ?? []
}

/**
 * §4.4: the minimal disclosure needed to surface `claimId` — the chain of
 * inferences from a root down to it (set to X), plus any folded claims along the
 * way (promoted to nodes). Walks upward from the claim through the inferences
 * that consume it until it reaches a root.
 */
export function pathToReveal(claimId: string, d: Derived): { infs: string[]; promote: string[] } {
  const infs = new Set<string>()
  const promote = new Set<string>()
  const seen = new Set<string>()
  let cur = claimId
  while (!d.roots.has(cur) && !seen.has(cur)) {
    seen.add(cur)
    if (d.foldable(cur)) promote.add(cur)
    const users = d.usedBy.get(cur) ?? []
    if (!users.length) break
    const i = users[0]
    infs.add(i)
    const out = d.outputOf.get(i)
    if (!out || out.kind !== 'claim') break
    cur = out.id
  }
  return { infs: [...infs], promote: [...promote] }
}

/** Claims whose tag or text contains `q` (case-insensitive). */
export function searchClaims(ds: DiscourseSpace, q: string): string[] {
  const needle = q.trim().toLowerCase()
  if (!needle) return []
  return (ds.claims ?? [])
    .filter(c => (c.tag ?? '').toLowerCase().includes(needle) || (c.text ?? '').toLowerCase().includes(needle))
    .map(c => String(c.id))
}

/** §8 acceptance signals — logged in dev to catch projection regressions. */
export function corpusCounts(d: Derived): { folded: number; undercutFloor: number; rootFanIn: number } {
  let undercutFloor = 0
  for (const [infId] of d.inf) if ((d.undercutBy.get(infId)?.length ?? 0) > 0) undercutFloor++
  let rootFanIn = 0
  for (const r of d.roots) rootFanIn += (d.ports.get(r)?.length ?? 0)
  return { folded: d.foldableSet.size, undercutFloor, rootFanIn }
}
