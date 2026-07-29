import * as fs from 'fs'
import * as yaml from 'js-yaml'
import {
  DiscourseSpace,
  DiscourseSpaceId,
  ClaimId,
  InferenceId,
  Claim,
  Inference,
  Relation,
  Attribution,
  Definition
} from './types'

function castAttribution(a: any): Attribution | undefined {
  if (!a) return undefined
  return {
    source: a.source,
    quote: a.quote ?? null
  }
}

function castClaim(c: any): Claim {
  return {
    id: c.id as ClaimId,
    tag: c.tag,
    text: c.text,
    terminal: c.terminal ?? false,
    attribution: castAttribution(c.attribution),
    uncertain: c.uncertain ?? false,
    submissionStatus: c.submissionStatus ?? 'Accepted'
  }
}

function castInference(i: any): Inference {
  return {
    id: i.id as InferenceId,
    scheme: i.scheme ?? null,
    uncertain: i.uncertain ?? false,
    submissionStatus: i.submissionStatus ?? 'Accepted',
    grounds: (i.grounds ?? []) as ClaimId[],
    warrants: (i.warrants ?? []) as ClaimId[],
    target: i.target as ClaimId,
    relation: i.relation as Relation
  }
}

function castDefinition(d: any): Definition {
  return {
    term: d.term,
    text: d.text,
    importedFrom: d.importedFrom ? (d.importedFrom as DiscourseSpaceId) : null
  }
}

export function loadDiscourseSpace(path: string): DiscourseSpace {
  const raw = fs.readFileSync(path, 'utf8')
  const data = yaml.load(raw) as any
  return {
    id: data.id as DiscourseSpaceId,
    title: data.title,
    definitions: (data.definitions ?? []).map(castDefinition),
    roots: (data.roots ?? []) as ClaimId[],
    claims: (data.claims ?? []).map(castClaim),
    inferences: (data.inferences ?? []).map(castInference)
  }
}
