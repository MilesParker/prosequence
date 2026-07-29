import { DiscourseSpace, ClaimId, Claim } from './types'

export function printDiscourseSpace(ds: DiscourseSpace): void {
  console.log(`=== ${ds.title} [${ds.id}] ===\n`)

  const claimById = new Map<string, Claim>(ds.claims.map(c => [c.id, c]))
  const tagOf = (id: string) => claimById.get(id)?.tag ?? id

  console.log(`ROOTS (${ds.roots.length})`)
  for (const r of ds.roots) {
    console.log(`  [${tagOf(r)}] ${claimById.get(r)?.text ?? r}`)
  }
  console.log()

  console.log(`DEFINITIONS (${ds.definitions.length})`)
  for (const def of ds.definitions) {
    const src = def.importedFrom ? ` (from ${def.importedFrom})` : ''
    console.log(`  ${def.term}${src}: ${def.text}`)
  }
  console.log()

  console.log(`CLAIMS (${ds.claims.length})`)
  for (const c of ds.claims) {
    const flags = [
      c.terminal ? 'terminal' : null,
      c.attribution ? 'attributive' : null,
      c.uncertain ? 'uncertain' : null
    ].filter(Boolean).join(', ')
    console.log(`  [${c.tag}]${flags ? ` (${flags})` : ''}`)
    console.log(`    ${c.text}`)
    if (c.attribution) {
      console.log(`    source: ${sourceLabel(c.attribution.source)}`)
    }
  }
  console.log()

  console.log(`INFERENCES (${ds.inferences.length})`)
  for (const inf of ds.inferences) {
    const output = `${inf.relation} → ${tagOf(inf.target)}`
    const grounds = inf.grounds.map(g => tagOf(g)).join(', ')
    const warrants = inf.warrants.length ? inf.warrants.map(w => tagOf(w)).join(', ') : '(implicit)'
    const scheme = inf.scheme ? ` [${inf.scheme}]` : ''
    console.log(`  ${inf.id}${scheme}`)
    console.log(`    grounds:  ${grounds}`)
    console.log(`    warrants: ${warrants}`)
    console.log(`    ${output}`)
  }
}

function sourceLabel(src: { type: string; reference?: string }): string {
  if (src.reference) return `${src.type} — ${src.reference}`
  return src.type
}

// Helper kept for potential external use; resolves a claim id to its tag.
export function tagForClaim(ds: DiscourseSpace, id: ClaimId): string {
  return ds.claims.find(c => c.id === id)?.tag ?? id
}
