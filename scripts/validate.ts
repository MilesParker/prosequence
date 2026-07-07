/*
 * validate.ts — standalone validator for the claim/inference model (v2).
 *
 * Loads a corpus YAML and enforces the six structural invariants documented
 * at the bottom of src/types.ts. No runtime-validation dependency (no Zod):
 * this is a plain script over the parsed YAML.
 *
 *   Usage: node --loader ts-node/esm scripts/validate.ts <corpus.yaml> [more.yaml ...]
 *          npm run validate -- discourse-spaces/free-transit.yaml
 *
 * Invariants (errors unless marked soft):
 *   1. Each inference has exactly one of {concludes, contests}.
 *   2. No inference concludes a claim with terminal: true.
 *   3. All ClaimId/InferenceId references resolve within the space.
 *   4. `grounds` is non-empty on every inference.
 *   5. (soft — warn) Attributive claims are not concluded by any inference.
 *   6. The Concludes graph is acyclic (edges: each grounds/warrant claim →
 *      concluded claim). Also warns on non-terminal, non-attributive claims
 *      that are concluded by nothing and are not roots (GAP-6 gaps).
 */

import * as fs from 'fs'
import * as yaml from 'js-yaml'

interface RawClaim {
  id: string
  tag?: string
  text?: string
  terminal?: boolean
  attribution?: { source?: unknown; quote?: unknown } | null
  cluster?: string
}

interface RawInference {
  id: string
  grounds?: string[]
  warrants?: string[]
  concludes?: string
  contests?: string
}

interface RawSpace {
  id?: string
  title?: string
  roots?: string[]
  claims?: RawClaim[]
  inferences?: RawInference[]
}

interface Report {
  errors: string[]
  warnings: string[]
}

export function validateSpace(space: RawSpace): Report {
  const errors: string[] = []
  const warnings: string[] = []

  const claims = space.claims ?? []
  const inferences = space.inferences ?? []
  const roots = space.roots ?? []

  const claimIds = new Set(claims.map(c => c.id))
  const inferenceIds = new Set(inferences.map(i => i.id))
  const attributive = new Set(claims.filter(c => !!c.attribution).map(c => c.id))
  const terminal = new Set(claims.filter(c => c.terminal === true).map(c => c.id))

  // --- 3 (roots resolve) ---
  for (const r of roots) {
    if (!claimIds.has(r)) errors.push(`[3] root "${r}" does not resolve to a claim`)
  }

  // Track which claims are concluded by some inference.
  const concludedBy = new Map<string, string[]>()

  for (const inf of inferences) {
    const grounds = inf.grounds ?? []
    const warrants = inf.warrants ?? []
    const hasConcludes = inf.concludes !== undefined && inf.concludes !== null
    const hasContests = inf.contests !== undefined && inf.contests !== null

    // --- 1 (exactly one output) ---
    if (hasConcludes === hasContests) {
      errors.push(`[1] inference "${inf.id}" must have exactly one of {concludes, contests} (has ${hasConcludes && hasContests ? 'both' : 'neither'})`)
    }

    // --- 4 (grounds non-empty) ---
    if (grounds.length === 0) {
      errors.push(`[4] inference "${inf.id}" has empty grounds`)
    }

    // --- 3 (references resolve) ---
    for (const g of grounds) {
      if (!claimIds.has(g)) errors.push(`[3] inference "${inf.id}" grounds references unknown claim "${g}"`)
    }
    for (const w of warrants) {
      if (!claimIds.has(w)) errors.push(`[3] inference "${inf.id}" warrants references unknown claim "${w}"`)
    }
    if (hasConcludes) {
      const target = inf.concludes as string
      if (!claimIds.has(target)) {
        errors.push(`[3] inference "${inf.id}" concludes unknown claim "${target}"`)
      } else {
        // --- 2 (no concluding a terminal) ---
        if (terminal.has(target)) {
          errors.push(`[2] inference "${inf.id}" concludes terminal claim "${target}"`)
        }
        concludedBy.set(target, [...(concludedBy.get(target) ?? []), inf.id])
      }
    }
    if (hasContests) {
      const target = inf.contests as string
      if (!claimIds.has(target) && !inferenceIds.has(target)) {
        errors.push(`[3] inference "${inf.id}" contests unknown target "${target}" (neither claim nor inference)`)
      }
    }
  }

  // --- 5 (soft): attributive claims should not be concluded ---
  for (const [claimId, infs] of concludedBy) {
    if (attributive.has(claimId)) {
      warnings.push(`[5] attributive claim "${claimId}" is concluded by ${infs.join(', ')} — attributive claims are checkable leaves`)
    }
  }

  // --- 6 (acyclic Concludes graph) ---
  // Edge set: for every inference concluding C, each grounds/warrant claim → C.
  const adj = new Map<string, Set<string>>()
  for (const inf of inferences) {
    if (inf.concludes === undefined || inf.concludes === null) continue
    const target = inf.concludes
    for (const src of [...(inf.grounds ?? []), ...(inf.warrants ?? [])]) {
      if (!claimIds.has(src) || !claimIds.has(target)) continue
      if (!adj.has(src)) adj.set(src, new Set())
      adj.get(src)!.add(target)
    }
  }
  const cycle = findCycle(adj)
  if (cycle) {
    errors.push(`[6] Concludes graph has a cycle: ${cycle.join(' → ')}`)
  }

  // --- 6 (warn): unsupported non-terminal, non-attributive, non-root claims ---
  for (const c of claims) {
    if (c.terminal) continue
    if (attributive.has(c.id)) continue
    if (roots.includes(c.id)) continue
    if (!concludedBy.has(c.id)) {
      warnings.push(`[6] claim "${c.id}" is non-terminal, non-attributive, not a root, and concluded by nothing (GAP-6 gap, or it should be a root)`)
    }
  }

  return { errors, warnings }
}

/** Returns a node list describing a cycle, or null if the graph is acyclic. */
function findCycle(adj: Map<string, Set<string>>): string[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<string, number>()
  const stack: string[] = []

  const nodes = new Set<string>()
  for (const [src, dsts] of adj) {
    nodes.add(src)
    for (const d of dsts) nodes.add(d)
  }

  function dfs(u: string): string[] | null {
    color.set(u, GRAY)
    stack.push(u)
    for (const v of adj.get(u) ?? []) {
      const cv = color.get(v) ?? WHITE
      if (cv === GRAY) {
        const idx = stack.indexOf(v)
        return [...stack.slice(idx), v]
      }
      if (cv === WHITE) {
        const res = dfs(v)
        if (res) return res
      }
    }
    stack.pop()
    color.set(u, BLACK)
    return null
  }

  for (const n of nodes) {
    if ((color.get(n) ?? WHITE) === WHITE) {
      const res = dfs(n)
      if (res) return res
    }
  }
  return null
}

function main(): void {
  const paths = process.argv.slice(2)
  if (paths.length === 0) {
    console.error('Usage: node --loader ts-node/esm scripts/validate.ts <corpus.yaml> [more.yaml ...]')
    process.exit(1)
  }

  let anyErrors = false
  for (const path of paths) {
    const raw = fs.readFileSync(path, 'utf8')
    const space = yaml.load(raw) as RawSpace
    const { errors, warnings } = validateSpace(space)

    console.log(`\n=== ${path} ===`)
    console.log(`  claims: ${(space.claims ?? []).length}, inferences: ${(space.inferences ?? []).length}, roots: ${(space.roots ?? []).length}`)

    if (errors.length === 0) {
      console.log(`  ✓ PASS — no invariant violations (1–4, 6)`)
    } else {
      anyErrors = true
      console.log(`  ✗ FAIL — ${errors.length} error(s):`)
      for (const e of errors) console.log(`      ERROR ${e}`)
    }
    if (warnings.length > 0) {
      console.log(`  ${warnings.length} warning(s):`)
      for (const w of warnings) console.log(`      warn  ${w}`)
    }
  }

  process.exit(anyErrors ? 1 : 0)
}

// Run as a script (skip when imported).
const invokedDirectly =
  process.argv[1] !== undefined && /validate\.ts$/.test(process.argv[1])
if (invokedDirectly) main()
