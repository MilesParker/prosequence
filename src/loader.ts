import * as fs from 'fs'
import * as yaml from 'js-yaml'
import {
  DiscourseSpace,
  DiscourseSpaceId,
  NodeId,
  EdgeId,
  Argument,
  TerminalValueNode,
  Edge,
  Grounds,
  Definition,
  Proposition
} from './types'

function castGrounds(g: any): Grounds {
  return {
    text: g.text,
    source: g.source
  }
}

function castArgument(a: any): Argument {
  return {
    id: a.id as NodeId,
    tag: a.tag,
    claim: a.claim,
    grounds: castGrounds(a.grounds),
    scheme: a.scheme,
    cluster: a.cluster,
    depth: a.depth,
    isMediating: a.isMediating,
    uncertain: a.uncertain,
    submissionStatus: a.submissionStatus
  }
}

function castTerminalValueNode(n: any): TerminalValueNode {
  return {
    id: n.id as NodeId,
    tag: n.tag,
    text: n.text
  }
}

function castEdge(e: any): Edge {
  return {
    id: e.id as EdgeId,
    source: e.source as NodeId,
    target: e.target as NodeId,
    relationship: e.relationship,
    hint: e.hint ?? null,
    uncertain: e.uncertain
  }
}

function castProposition(p: any): Proposition {
  return {
    id: p.id as NodeId,
    tag: p.tag,
    text: p.text
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
    proposition: castProposition(data.proposition),
    arguments: (data.arguments ?? []).map(castArgument),
    terminalValueNodes: (data.terminalValueNodes ?? []).map(castTerminalValueNode),
    edges: (data.edges ?? []).map(castEdge)
  }
}
