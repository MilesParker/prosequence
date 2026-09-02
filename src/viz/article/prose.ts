// prose.ts — the article view's wording. Pure functions from model facts to
// the words the page prints; no React, no layout. Everything the article says
// that is not a claim's own text comes from here, so the vocabulary is in one
// place and can be tuned without touching the composition.

import type { GroundsSource, Relation } from '../../types'
import type { Stance } from '../graphData'

/**
 * A claim's text as a complete sentence: trimmed, with a full stop added when
 * it ends in nothing that closes a sentence. Claim texts are already sentences
 * in every corpus; this only guards the odd one that trails off, so that two
 * grounds run together in one paragraph still read as two sentences.
 */
export function sentence(text: string): string {
  const t = text.trim()
  if (!t) return t
  return /[.!?…]["”’')\]]*$/.test(t) ? t : `${t}.`
}

const NUMBER_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve']

/** Small counts as words, larger ones as digits — prose, not figures. */
export function numberWord(n: number): string {
  return n >= 0 && n < NUMBER_WORDS.length ? NUMBER_WORDS[n] : String(n)
}

/** "one step away" / "three steps away" — the hop count in prose. */
export function stepsAway(hops: number): string {
  return `${numberWord(hops)} step${hops === 1 ? '' : 's'} away`
}

/**
 * Which side of the reference thesis the centred claim stands on, in words.
 * The article carries no stance hue, so this phrase is the only place stance
 * appears. Neutral / unknown ⇒ null (the kicker says nothing about it).
 */
export function stancePhrase(st: Stance | undefined): string | null {
  switch (st) {
    case 'aligned': return 'standing with it'
    case 'opposed': return 'standing against it'
    case 'divided': return 'cutting both ways'
    default: return null
  }
}

/** The source line under an attributive claim's quote — a byline, not a type. */
export function sourcePhrase(src: GroundsSource): string {
  switch (src.type) {
    case 'Citation': return src.reference
    case 'SelfEvident': return 'held to be self-evident'
    case 'CommonKnowledge': return 'common knowledge'
    case 'LogicalNecessity': return 'a logical necessity'
    case 'None': return 'no source given'
  }
}

/**
 * How the centred claim enters a consuming inference, as the lead-in to that
 * inference's target — "grounds for <target>", "assumed in arguing against
 * <target>". Role (grounds / warrant) and relation (concludes / contests) are the
 * two facts the phrase has to carry.
 */
export function rolePhrase(asWarrant: boolean, relation: Relation): string {
  if (asWarrant) return relation === 'concludes' ? 'assumed in arguing for' : 'assumed in arguing against'
  return relation === 'concludes' ? 'grounds for' : 'grounds against'
}

/**
 * The label on a warrant line. Every warrant carries its own — an inference's
 * warrants all conjoin, but that AND is shown by their sitting together under
 * one argument, not by a word that runs them into a single assumption. Grounds
 * carry no label at all: they are the argument's prose, not an aside to it.
 */
export const ASSUMES = 'assumes'


/**
 * An argument's sub-headline. `Inference` carries no tag of its own — it has a
 * scheme, its inputs and a target — so the handle for an argument is its
 * grounds' tags, which are also what the graph and the focus view label those
 * claims with. Joined with "+" because an inference's grounds conjoin.
 */
export function argumentHeadline(tags: string[]): string {
  return tags.filter(Boolean).join(' + ')
}

/** "in two ways" — how many distinct inferences carry C to the same target. */
export function waysPhrase(n: number): string | null {
  return n > 1 ? `in ${numberWord(n)} ways` : null
}

/** "one of three routes" — said only when the trail is not the only way up. */
export function routesPhrase(n: number): string | null {
  return n > 1 ? `one of ${numberWord(n)} routes` : null
}
