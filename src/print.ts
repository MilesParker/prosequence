import { DiscourseSpace, NodeId } from './types'

export function printDiscourseSpace(ds: DiscourseSpace): void {
  console.log(`=== ${ds.title} [${ds.id}] ===\n`)

  console.log(`PROPOSITION`)
  console.log(`  [${ds.proposition.tag}] ${ds.proposition.text}\n`)

  console.log(`DEFINITIONS (${ds.definitions.length})`)
  for (const def of ds.definitions) {
    const src = def.importedFrom ? ` (from ${def.importedFrom})` : ''
    console.log(`  ${def.term}${src}: ${def.text}`)
  }
  console.log()

  const tagByNodeId = buildTagIndex(ds)

  console.log(`ARGUMENTS (${ds.arguments.length})`)
  for (const arg of ds.arguments) {
    console.log(`  [${arg.tag}]`)
    console.log(`    claim:    ${arg.claim}`)
    console.log(`    scheme:   ${arg.scheme}`)
    console.log(`    cluster:  ${arg.cluster}`)
    console.log(`    depth:    ${arg.depth}`)
    console.log(`    mediating: ${arg.isMediating}`)
  }
  console.log()

  console.log(`TERMINAL VALUE NODES (${ds.terminalValueNodes.length})`)
  for (const tvn of ds.terminalValueNodes) {
    console.log(`  [${tvn.tag}] ${tvn.text}`)
  }
  console.log()

  console.log(`EDGES (${ds.edges.length})`)
  for (const edge of ds.edges) {
    const srcTag = tagByNodeId.get(edge.source) ?? edge.source
    const tgtTag = tagByNodeId.get(edge.target) ?? edge.target
    const uncertain = edge.uncertain ? ' [uncertain]' : ''
    const hint = edge.hint ? ` (${edge.hint})` : ''
    console.log(`  ${srcTag} → ${tgtTag} [${edge.relationship}]${hint}${uncertain}`)
  }
}

function buildTagIndex(ds: DiscourseSpace): Map<NodeId, string> {
  const map = new Map<NodeId, string>()
  map.set(ds.proposition.id, ds.proposition.tag)
  for (const arg of ds.arguments) map.set(arg.id, arg.tag)
  for (const tvn of ds.terminalValueNodes) map.set(tvn.id, tvn.tag)
  return map
}
