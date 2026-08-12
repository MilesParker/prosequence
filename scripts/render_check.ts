// Headless render check for Directive 1d: prove the viz's own data pipeline
// consumes a corpus committed through the 1d session. Runs the app loader, the
// graph view's data builder, and the focus view's data builders — the two view
// surfaces both build from these. No DOM: buildGraphData / focusData are pure.
import { loadDiscourseSpace } from '../src/loader'
import { buildGraphData, isThesisClaim } from '../src/viz/graphData'
import {
  renderedClaimIds,
  supportsOf,
  attacksOf,
  consumersOf,
} from '../src/viz/focus/focusData'

const path = process.argv[2]
const ds = loadDiscourseSpace(path)

// Graph view: full graph-data model.
const gd = buildGraphData(ds)
const claimNodes = gd.nodes.filter((n) => n._kind === 'claim').length
const infNodes = gd.nodes.filter((n) => n._kind === 'inference').length

// Focus view: centre on a thesis and build its neighbourhood data.
const thesis = gd.nodes.find((n) => n._kind === 'claim' && isThesisClaim(n))
if (!thesis) throw new Error('no thesis claim to focus')
const rendered = renderedClaimIds(gd, thesis.id)
const supports = supportsOf(gd, thesis.id).length
const attacks = attacksOf(gd, thesis.id).length
const consumers = consumersOf(gd, thesis.id).length

console.log(
  `GRAPH  ${gd.nodes.length} nodes (${claimNodes} claim, ${infNodes} inference), ${gd.links.length} links`
)
console.log(
  `FOCUS  thesis=${thesis.id.slice(0, 12)}  rendered=${rendered.size}  supports=${supports} attacks=${attacks} consumers=${consumers}`
)
console.log('both view pipelines built OK')
