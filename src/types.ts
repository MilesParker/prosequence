export type NodeId = string & { readonly _brand: 'NodeId' }
export type DiscourseSpaceId = string & { readonly _brand: 'DiscourseSpaceId' }
export type EdgeId = string & { readonly _brand: 'EdgeId' }

export enum ArgumentScheme {
  FromExample = 'FromExample',
  FromGeneralization = 'FromGeneralization',
  FromAnalogy = 'FromAnalogy',
  FromAuthority = 'FromAuthority',
  FromConsequence = 'FromConsequence',
  FromSign = 'FromSign',
  FromCause = 'FromCause',
  FromDefinition = 'FromDefinition'
}

export enum EdgeRelationship {
  Support = 'Support',
  Attack = 'Attack',
  Warrants = 'Warrants'
}

export enum GroundsSourceType {
  Citation = 'Citation',
  SelfEvident = 'SelfEvident',
  CommonKnowledge = 'CommonKnowledge',
  LogicalNecessity = 'LogicalNecessity',
  None = 'None'
}

export enum Cluster {
  Proposition = 'Proposition',
  Pro = 'Pro',
  Anti = 'Anti',
  Empirical = 'Empirical',
  Analogy = 'Analogy',
  Terminal = 'Terminal'
}

export enum SubmissionStatus {
  Pending = 'Pending',
  Interrogating = 'Interrogating',
  Rejected = 'Rejected',
  Accepted = 'Accepted'
}

export interface CitationSource {
  type: GroundsSourceType.Citation
  reference: string
}

export interface SelfEvidentSource {
  type: GroundsSourceType.SelfEvident
}

export interface CommonKnowledgeSource {
  type: GroundsSourceType.CommonKnowledge
}

export interface LogicalNecessitySource {
  type: GroundsSourceType.LogicalNecessity
}

export interface NoSource {
  type: GroundsSourceType.None
}

export type GroundsSource =
    | CitationSource
    | SelfEvidentSource
    | CommonKnowledgeSource
    | LogicalNecessitySource
    | NoSource

export interface Grounds {
  text: string
  quote: string | null
  source: GroundsSource
}

export interface Proposition {
  id: NodeId
  tag: string
  text: string
}

export interface Argument {
  id: NodeId
  tag: string
  claim: string
  grounds: Grounds
  scheme: ArgumentScheme
  cluster: Cluster
  depth: number
  isMediating: boolean
  uncertain: boolean
  submissionStatus: SubmissionStatus
}

export interface TerminalValueNode {
  id: NodeId
  tag: string
  text: string
}

export interface Edge {
  id: EdgeId
  source: NodeId
  target: NodeId
  relationship: EdgeRelationship
  hint: string | null
  uncertain: boolean
}

export interface Definition {
  term: string
  text: string
  importedFrom: DiscourseSpaceId | null
}

export interface DiscourseSpace {
  id: DiscourseSpaceId
  title: string
  definitions: Definition[]
  proposition: Proposition
  arguments: Argument[]
  terminalValueNodes: TerminalValueNode[]
  edges: Edge[]
}