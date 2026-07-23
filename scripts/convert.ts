/*
 * convert.ts — migrate an old-model corpus (Argument / Proposition /
 * TerminalValueNode / Support|Attack|Warrants edges) into the v2 claim /
 * inference model. Mechanical mapping, per the design session of 2026-07-02.
 *
 *   Usage: node --loader ts-node/esm scripts/convert.ts <old.yaml> <out.yaml>
 *
 * Mapping:
 *   Argument A            -> claim c-A (A.claim) + attributive claim g-A
 *                           (A.grounds, iff grounds are meaningful) +
 *                           internal inference i-A { grounds:[g-A],
 *                           concludes: c-A, scheme: A.scheme }.
 *   Proposition           -> ordinary claim, listed in `roots`.
 *   TerminalValueNode t   -> claim { terminal: true }.
 *   Support edge S->T     -> inference { grounds:[c-S], concludes: c-T }.
 *   Attack  edge S->T     -> inference { grounds:[c-S], contests:  c-T }.
 *   Warrants edge W->A    -> c-W added to the warrants[] of A's inference:
 *                            * argument warrant  -> A's internal inference
 *                              (bridges grounds to claim); if A has no
 *                              internal inference, propagate to A's linking
 *                              inference(s), flattening warrant-of-warrant
 *                              chains into conjoint (AND) warrants.
 *                            * terminal warrant  -> the support/contest
 *                              inference(s) linking A onward (the terminal
 *                              warrants the *connection*, not A's internal
 *                              step); falls back to propagation otherwise.
 *   edge.hint             -> hint on the corresponding linking inference.
 *
 * Corpus-specific overrides (design-session decisions) live in OVERRIDES.
 */

import * as fs from 'fs'
import * as yaml from 'js-yaml'

// ---------- old-model shapes ----------

interface OldSource { type: string; reference?: string | null }
interface OldGrounds { text?: string; quote?: string | null; source?: OldSource }
interface OldArgument {
  id: string; tag: string; claim: string; grounds?: OldGrounds
  scheme?: string; uncertain?: boolean; submissionStatus?: string
}
interface OldTerminal { id: string; tag: string; text: string }
interface OldProposition { id: string; tag: string; text: string }
interface OldEdge {
  id: string; source: string; target: string
  relationship: 'Support' | 'Attack' | 'Warrants'
  hint?: string | null; uncertain?: boolean
}
interface OldSpace {
  id: string; title: string; definitions?: unknown[]
  proposition: OldProposition
  arguments?: OldArgument[]
  terminalValueNodes?: OldTerminal[]
  edges?: OldEdge[]
}

// ---------- corpus-specific overrides ----------

interface Overrides {
  // Support/Attack edge id -> inference id its inference should contest
  // (turns a rebut into an undercut targeting an inference).
  contestInferenceForEdge?: Record<string, string>
  // Warrants edge id -> inference id its warrant claim attaches to
  // (redirects a representativeness warrant onto a generalisation link).
  warrantEdgePlacement?: Record<string, string>
}

const OVERRIDES: Record<string, Overrides> = {
  // free-transit: GAP 1 resolution — the user-pays-inconsistency argument
  // undercuts the inference linking user-pays-as-policy to the root (it
  // contests that the user-pays *path* holds, not the policy claim itself).
  'free-transit': {
    contestInferenceForEdge: {
      'e-inconsistency-attacks-user-pays-policy': 'i-e-user-pays-attacks-root',
    },
    // Example chains (Boston, Kansas City, Luxembourg -> generalisation):
    // the representativeness warrant licenses the *generalisation step*, so
    // it attaches to the support inference concluding the generalisation.
    warrantEdgePlacement: {
      'e-w-luxembourg-warrants-luxembourg': 'i-e-luxembourg-supports-many-examples',
      'e-w-kansas-city-warrants-kansas-city': 'i-e-kansas-city-supports-many-examples',
      'e-w-boston-warrants-boston': 'i-e-boston-supports-many-examples',
    },
  },
  // gaza: the confinement claim undercuts the inference from the Mosul-analogy
  // claim to the Hamas-tactics claim (the analogy holds only if the population
  // can flee), rather than rebutting the Mosul-analogy claim directly.
  'gaza-genocide': {
    contestInferenceForEdge: {
      'e-confinement-attacks-mosul': 'i-e-mosul-attacks-hamas-tactics',
    },
  },
}

// ---------- new-model output shapes (plain objects for YAML) ----------

interface NewClaim {
  id: string; tag: string; text: string; terminal: boolean
  attribution?: { source: OldSource; quote: string | null }
  uncertain: boolean; submissionStatus: string
}
interface NewInference {
  id: string; scheme: string | null; uncertain: boolean; submissionStatus: string
  grounds: string[]; warrants: string[]; hint: string | null
  concludes?: string; contests?: string
}

// ---------- helpers ----------

function groundsMeaningful(g?: OldGrounds): boolean {
  const t = (g?.text ?? '').trim()
  return t !== '' && t.toUpperCase() !== 'N/A'
}

function normalizeSource(s?: OldSource): OldSource {
  if (!s) return { type: 'None' }
  if (s.type === 'Citation') return { type: 'Citation', reference: s.reference ?? '' }
  return { type: s.type }
}

// ---------- conversion ----------

function convert(old: OldSpace): { id: string; title: string; definitions: unknown[]; roots: string[]; claims: NewClaim[]; inferences: NewInference[] } {
  const ov = OVERRIDES[old.id] ?? {}
  const args = old.arguments ?? []
  const terminals = old.terminalValueNodes ?? []
  const edges = old.edges ?? []

  const argById = new Map(args.map(a => [a.id, a]))
  const termIds = new Set(terminals.map(t => t.id))
  const propId = old.proposition.id

  const isArg = (id: string) => argById.has(id)
  const isTerminal = (id: string) => termIds.has(id)

  // The claim id that a node id maps to.
  const claimIdOf = (nodeId: string): string => {
    if (nodeId === propId) return propId
    if (isTerminal(nodeId)) return nodeId
    if (isArg(nodeId)) return `c-${nodeId}`
    throw new Error(`unknown node referenced: ${nodeId}`)
  }

  const hasInternalInf = (argId: string): boolean => {
    const a = argById.get(argId)
    return !!a && groundsMeaningful(a.grounds)
  }
  const internalInfId = (argId: string) => `i-${argId}`
  const linkInfId = (edgeId: string) => `i-${edgeId}`

  // ----- claims -----
  const claims: NewClaim[] = []

  // root proposition
  claims.push({
    id: propId, tag: old.proposition.tag, text: old.proposition.text,
    terminal: false, uncertain: false, submissionStatus: 'Accepted',
  })

  // terminals
  for (const t of terminals) {
    claims.push({
      id: t.id, tag: t.tag, text: (t.text ?? '').trim(),
      terminal: true, uncertain: false, submissionStatus: 'Accepted',
    })
  }

  // argument claims + attributive grounds claims
  for (const a of args) {
    claims.push({
      id: `c-${a.id}`, tag: a.tag, text: (a.claim ?? '').trim(),
      terminal: false,
      uncertain: a.uncertain ?? false, submissionStatus: a.submissionStatus ?? 'Accepted',
    })
    if (groundsMeaningful(a.grounds)) {
      claims.push({
        id: `g-${a.id}`, tag: `${a.tag} — grounds`, text: (a.grounds!.text ?? '').trim(),
        terminal: false,
        attribution: { source: normalizeSource(a.grounds!.source), quote: a.grounds!.quote ?? null },
        uncertain: false, submissionStatus: 'Accepted',
      })
    }
  }

  // ----- inferences -----
  const inferences: NewInference[] = []
  const infById = new Map<string, NewInference>()
  const addInf = (inf: NewInference) => { inferences.push(inf); infById.set(inf.id, inf) }

  // (a) internal inferences (grounds -> claim)
  for (const a of args) {
    if (!groundsMeaningful(a.grounds)) continue
    addInf({
      id: internalInfId(a.id), scheme: a.scheme ?? null,
      uncertain: a.uncertain ?? false, submissionStatus: a.submissionStatus ?? 'Accepted',
      grounds: [`g-${a.id}`], warrants: [], hint: null, concludes: `c-${a.id}`,
    })
  }

  // (b) linking inferences (Support/Attack)
  for (const e of edges) {
    if (e.relationship === 'Warrants') continue
    const inf: NewInference = {
      id: linkInfId(e.id), scheme: null,
      uncertain: e.uncertain ?? false, submissionStatus: 'Accepted',
      grounds: [claimIdOf(e.source)], warrants: [], hint: e.hint ?? null,
    }
    const contestOverride = ov.contestInferenceForEdge?.[e.id]
    if (e.relationship === 'Support') {
      inf.concludes = claimIdOf(e.target)
    } else {
      // Attack -> contests. An override may retarget it onto an inference
      // (undercut) instead of the target claim (rebut).
      inf.contests = contestOverride ?? claimIdOf(e.target)
    }
    addInf(inf)
  }

  // linking inferences that leave a given node (as Support/Attack source)
  const linkingInfsFrom = (nodeId: string): NewInference[] =>
    edges
      .filter(e => e.relationship !== 'Warrants' && e.source === nodeId)
      .map(e => infById.get(linkInfId(e.id)))
      .filter((x): x is NewInference => !!x)

  // outgoing Warrants edges from a node
  const warrantEdgesFrom = (nodeId: string): OldEdge[] =>
    edges.filter(e => e.relationship === 'Warrants' && e.source === nodeId)

  // Resolve the inference(s) a warrant pointing at `targetId` should attach
  // to. `terminalSource` selects the terminal placement rule. `seen` guards
  // against warrant-only cycles.
  const resolveTargets = (targetId: string, terminalSource: boolean, seen: Set<string>): NewInference[] => {
    if (seen.has(targetId)) return []
    seen.add(targetId)

    if (terminalSource) {
      const links = linkingInfsFrom(targetId)
      if (links.length) return links
      // fall through to propagation below (target is a warrant-only node)
    } else if (isArg(targetId) && hasInternalInf(targetId)) {
      const inf = infById.get(internalInfId(targetId))
      return inf ? [inf] : []
    }

    // Propagation: target has no internal inference. Prefer its linking
    // inferences; otherwise flatten through its outgoing warrant edges.
    const links = linkingInfsFrom(targetId)
    if (links.length) return links

    const out: NewInference[] = []
    for (const we of warrantEdgesFrom(targetId)) {
      for (const inf of resolveTargets(we.target, false, seen)) out.push(inf)
    }
    return out
  }

  const addWarrant = (inf: NewInference, claimId: string) => {
    if (!inf.warrants.includes(claimId)) inf.warrants.push(claimId)
  }

  // (c) distribute warrant claims onto inferences
  for (const e of edges) {
    if (e.relationship !== 'Warrants') continue
    const warrantClaim = claimIdOf(e.source)

    const placement = ov.warrantEdgePlacement?.[e.id]
    if (placement) {
      const inf = infById.get(placement)
      if (!inf) throw new Error(`override placement inference not found: ${placement}`)
      addWarrant(inf, warrantClaim)
      continue
    }

    const targets = resolveTargets(e.target, isTerminal(e.source), new Set())
    if (targets.length === 0) {
      console.warn(`  (warn) warrant edge ${e.id} (${e.source} -> ${e.target}) had no inference to attach to; dropped`)
    }
    for (const inf of targets) addWarrant(inf, warrantClaim)
  }

  return {
    id: old.id, title: old.title, definitions: old.definitions ?? [],
    roots: [propId], claims, inferences,
  }
}

// ---------- serialization ----------

function dump(space: unknown): string {
  return yaml.dump(space, { lineWidth: 100, noRefs: true, quotingType: '"' })
}

function main(): void {
  const [inPath, outPath] = process.argv.slice(2)
  if (!inPath || !outPath) {
    console.error('Usage: node --loader ts-node/esm scripts/convert.ts <old.yaml> <out.yaml>')
    process.exit(1)
  }
  const old = yaml.load(fs.readFileSync(inPath, 'utf8')) as OldSpace
  console.log(`Converting ${inPath} (${old.id}) ...`)
  const converted = convert(old)
  const header =
    `# Converted to the claim/inference model (v2) by scripts/convert.ts.\n` +
    `# Source: ${inPath}. Do not hand-edit claim texts; this migration is structural.\n`
  fs.writeFileSync(outPath, header + dump(converted), 'utf8')
  console.log(`  wrote ${outPath}: ${converted.claims.length} claims, ${converted.inferences.length} inferences`)
}

main()
