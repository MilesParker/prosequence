// ArticleView.tsx — the prose surface. One claim, read as a long-form article.
//
// Same centre as the focus view (a ClaimId), same derived indices, same reference
// thesis; a different composition. It follows the focus view's structure rather
// than inventing one:
//
//   kicker      the reference thesis, how far it is, and which side C stands on
//   title       C's TAG — the short handle, primary, exactly as on a focus tile
//   standfirst  C's own text, the secondary detail beneath the tag
//   deck        C's attribution IN FULL — the verbatim quote and the whole
//               reference, run into the reading as one sentence rather than
//               captioned beneath it — or its bedrock note
//   sections    "Where this leads", then "The case for" / "The case against" —
//               the focus view's vertical order (parent band above, children
//               band below), not an article's conclusion-last convention.
//   arguments   one per inference, headed by its grounds' tags. `Inference` has
//               no tag of its own, so the tags of what it argues FROM are the
//               handle that maps back to a tile on the map. A rail runs down the
//               argument: SOLID beside the grounds prose, DASHED beside the
//               warrant group — the focus view's only grounds/warrant mark
//               (FOCUS.bracket*), carried over intact. One `assumes` heads the
//               group; the warrants conjoin by sitting under it together.
//   sourcing    a claim in the body that is attributive carries its source inline,
//               short-form beside its text (full reference on hover). These are the
//               graph's empirical leaves: nothing argues for them because they are
//               checked, not derived, and without the mark a sourced leaf and an
//               undeveloped claim read identically — both just stop.
//
// Colour: ONE family, STANCE, meaning one thing everywhere on the page — blue
// stands with the reference thesis, orange against it, dusty both ways, uncoloured
// no stance at all. It tints the trail crumbs, the kicker edge and each argument's
// rail (the combined stance of its grounds). For/Against deliberately gets NO
// colour: it is already said in words by the section heads, and a second palette
// running nearly parallel to this one would invite the reader to hunt for a
// distinction that usually is not there. The warrant rail stays neutral.
//
// Register is a web article, not a newspaper: ragged right, no hyphenation, no
// display headline. One affordance — every claim is a link that recentres the
// article on it — plus the "show on the map" line at the foot. Stance is spoken
// in the kicker, never painted.

import { createContext, Fragment, useContext, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { ARTICLE, COLORS, STANCE_INK, articleMeasure } from '../../config'
import type { GraphData } from '../graphData'
import { computeStance } from '../graphData'
import type { Attribution as AttributionT, Inference } from '../../types'
import { getClaim, supportsOf, attacksOf, consumersOf, outputOf, combinedStance } from '../focus/focusData'
import { sentence, sourcePhrase, shortSource, citeTitle, rolePhrase, argumentHeadline, waysPhrase, ASSUMES } from './prose'
import { trailsFromThesis, elide, reachBelow, argumentReach, restsOnBedrock } from './trail'

// All the page's styling. Body is the serif; labels are a quiet sans — the two
// jobs are reading and pointing, and they are not the same job.
//
// Every font-size is a multiple of `--pa-s`, the page's type scale, which the frame
// solves for from the pane's width (see `useTypeScale`). One variable rather than a
// per-size rule because the page is a type SCALE: the ratios between the title, the
// standfirst, the body and the labels are the design, and a body that grew while the
// labels stayed put would just look broken.
const em = (px: number) => `calc(${px}px * var(--pa-s))`
const css = `
  .pa-root { font-family: ${ARTICLE.font}; color: ${COLORS.text}; -webkit-font-smoothing: antialiased; }
  .pa-root a.pa-link { color: inherit; text-decoration: none; cursor: pointer; text-decoration-color: ${COLORS.textDim}; text-decoration-thickness: 1px; text-underline-offset: 0.18em; }
  .pa-root a.pa-link:hover, .pa-root a.pa-link:focus-visible { text-decoration: underline; outline: none; }
  .pa-label { font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.labelSize)}; font-style: normal; font-weight: 500; letter-spacing: 0.02em; color: ${COLORS.textFaint}; }

  /* The kicker is the reference-thesis axis: the trail down from the thesis, how
     far, and which side this claim stands on. Its edge and its stance phrase take
     the STANCE hue (blue aligned / orange opposed / dusty divided; neutral takes
     none) — a different axis from the green/red For-Against of the sections
     below, kept in a different place and a different colour family. Chrome only. */
  .pa-kicker { margin-bottom: 20px; padding-left: 12px; border-left: ${ARTICLE.kickerRail}px solid ${COLORS.border}; }
  .pa-trail { margin-top: 4px; font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.trailFont)}; line-height: 1.5; color: ${COLORS.textMuted}; }
  .pa-trail + .pa-trail { margin-top: 2px; }
  .pa-trail .pa-sep { color: ${COLORS.textDimmer}; margin: 0 0.45em; }
  /* The reach cue rides beside 19px serif prose, so it needs weight to register at
     all — but it is an aside, not a second voice, hence sans, small and unsaturated
     rather than loud. A NUMBER and not repeated marks: reach runs to 9 in gaza, and
     any glyph the reader has to count caps out long before that. */
  .pa-reach { font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.reachFont)}; font-weight: 600; color: ${COLORS.textMuted}; margin-left: 0.45em; white-space: nowrap; vertical-align: 0.09em; letter-spacing: 0.01em; }
  .pa-reach .pa-reach-mark { font-weight: 400; color: ${COLORS.textDim}; margin-right: 0.08em; }
  /* The inline source mark on an attributive claim in the body. Same sans register
     as the reach cue beside it, one step quieter: reach says how much argument is
     still to read, a source says the reading STOPS here and is checked instead. */
  .pa-cite { font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.citeFont)}; color: ${COLORS.textFaint}; margin-left: 0.4em; vertical-align: 0.09em; letter-spacing: 0.01em; }
  .pa-cite .pa-cite-mark { color: ${COLORS.textDimmer}; margin-right: 0.3em; }
  .pa-title { font-size: ${em(ARTICLE.titleFont)}; font-weight: 700; line-height: 1.24; letter-spacing: -0.011em; margin: 0; text-wrap: balance; }
  .pa-standfirst { margin: 12px 0 0; font-size: ${em(ARTICLE.standfirstFont)}; line-height: 1.5; color: ${COLORS.textMuted}; }
  /* The centred claim's provenance, run as a sentence at body size. The quote stays
     italic and quoted — it is someone else's words, not the page's — and the source
     follows it inline, in the sans label register so the eye can tell the words that
     were said from the hand that said them without a caption to separate them. */
  .pa-deck { margin: 18px 0 0; font-size: ${em(ARTICLE.deckFont)}; line-height: 1.55; color: ${COLORS.textMuted}; }
  .pa-deck .pa-quote { font-style: italic; }
  .pa-deck .pa-byline { font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.deckBylineFont)}; color: ${COLORS.textFaint}; }
  .pa-note { margin: 18px 0 0; font-size: ${em(ARTICLE.warrantFont)}; line-height: 1.55; color: ${COLORS.textMuted}; }
  .pa-head { padding-bottom: 26px; border-bottom: 1px solid ${COLORS.border}; }

  .pa-section { font-family: ${ARTICLE.labelFont}; font-size: ${em(ARTICLE.sectionFont)}; font-weight: 600; text-transform: uppercase; letter-spacing: 0.09em; color: ${COLORS.textFaint}; margin: 40px 0 18px; }
  .pa-subhead { font-size: ${em(ARTICLE.subheadFont)}; font-weight: 700; line-height: 1.35; margin: 0 0 7px; color: ${COLORS.text}; }

  /* The rail. Solid alongside grounds, dashed alongside a warrant — the focus
     view's bracket stubs (solid into grounds, dashed into warrants) as a margin
     mark. Same inset for both, so one argument reads as one continuous edge. */
  .pa-arg { margin: 0 0 ${ARTICLE.argGap}px; padding-left: ${ARTICLE.rail}px; border-left: 1px solid ${COLORS.border}; }
  .pa-grounds { margin: 0; font-size: ${em(ARTICLE.bodyFont)}; line-height: ${ARTICLE.lineHeight}; }
  /* The warrant group hangs off the argument on its own dashed rail, headed by a
     single "assumes". Neutral, per the settled rule that the warrant bracket
     carries no column tint. */
  .pa-warrants { margin: ${ARTICLE.warrantGap}px 0 0; padding-left: ${ARTICLE.rail}px; border-left: 1px dashed ${COLORS.border}; }
  .pa-assumes { display: block; margin-bottom: 3px; }
  .pa-warrant { margin: 0; font-size: ${em(ARTICLE.warrantFont)}; line-height: ${ARTICLE.lineHeight}; color: ${COLORS.textMuted}; }
  .pa-warrant + .pa-warrant { margin-top: 5px; }

  .pa-quiet { margin: 0; font-size: ${em(ARTICLE.warrantFont)}; line-height: ${ARTICLE.lineHeight}; color: ${COLORS.textFaint}; }
  .pa-lead { margin: 0 0 12px; font-size: ${em(ARTICLE.leadFont)}; line-height: 1.55; }
  .pa-lead .pa-label { margin-right: 0.4em; }
  .pa-foot { margin-top: 44px; padding-top: 16px; border-top: 1px solid ${COLORS.border}; }
`

// ── Page services ──────────────────────────────────────────────────────────────

/**
 * The two per-claim facts the page's leaves need but should not each recompute:
 * how far the argument runs on beneath a claim, and its stance hue toward the
 * reference thesis. Held in a context so `ClaimLink` can reach them without every
 * component in between carrying them as props.
 */
const PageCtx = createContext<{
  reachOf: (id: string) => number
  hueOf: (id: string) => string | null
  groupHueOf: (ids: string[]) => string | null
}>({ reachOf: () => 0, hueOf: () => null, groupHueOf: () => null })

// ── Primitives ─────────────────────────────────────────────────────────────────

/**
 * A claim as a link. `show` picks which face: 'text' where the claim IS the prose
 * being read (grounds, warrants), 'tag' where it is being pointed at (a trail
 * crumb, a destination) — the focus view's split between primary handle and
 * secondary detail. `tint` colours it by its stance toward the reference thesis;
 * `cue` trails a reach mark saying how much argument lies beneath it, and, on an
 * attributive claim, the source it bottoms out in. No href — nothing to show in a
 * status bar — so keyboard activation is wired by hand.
 */
function ClaimLink({ gd, id, onFocus, show = 'text', tint = false, cue = false }: {
  gd: GraphData; id: string; onFocus: (id: string) => void
  show?: 'text' | 'tag'; tint?: boolean; cue?: boolean
}) {
  const { reachOf, hueOf } = useContext(PageCtx)
  const claim = getClaim(gd, id)
  const label = show === 'tag' ? (claim?.tag ?? claim?.text ?? id) : sentence(claim?.text ?? id)
  const hue = tint ? hueOf(id) : null
  const reach = cue ? reachOf(id) : 0
  const go = () => onFocus(id)
  const onKey = (e: KeyboardEvent<HTMLAnchorElement>) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go() }
  }
  return (
    <>
      <a className="pa-link" role="link" tabIndex={0} onClick={go} onKeyDown={onKey}
         style={hue ? { color: hue, textDecorationColor: hue } : undefined}>{label}</a>
      {cue && claim?.attribution && (
        <span className="pa-cite" title={citeTitle(claim.attribution)}><span className="pa-cite-mark">·</span>{shortSource(claim.attribution.source)}</span>
      )}
      {reach > 0 && (
        <span className="pa-reach" title={`${reach} more ${reach === 1 ? 'step' : 'steps'} of argument beneath this claim`}><span className="pa-reach-mark">›</span>{reach}</span>
      )}
    </>
  )
}

function SectionHead({ children }: { children: ReactNode }) {
  return <h2 className="pa-section">{children}</h2>
}

// ── Head: kicker, title, standfirst, deck ──────────────────────────────────────

// Above the title: where this sits in the whole, as the routes down from the
// reference thesis. Each crumb is coloured by its OWN stance toward that thesis,
// so the line shows both the way down and what it passes through — the words
// "three steps away · standing with it" said the same things less compactly, and
// the trail's own length and colour say them without a sentence.
//
// The structure is a DAG, so several shortest routes can exist; they stack, one
// compact line each, rather than one line implying it is the only way up. At the
// reference thesis itself there is no route to draw — the single word "Thesis".
function Kicker({ gd, thesisId, focusId, hue, onFocus }: {
  gd: GraphData; thesisId: string; focusId: string; hue: string | null; onFocus: (id: string) => void
}) {
  const rail = hue ? { borderLeftColor: hue } : undefined
  if (thesisId === focusId) {
    return <div className="pa-kicker" style={rail}><span className="pa-label">Thesis</span></div>
  }
  const trails = trailsFromThesis(gd, focusId, thesisId)
  if (!trails || trails.paths.length === 0) {
    return (
      <div className="pa-kicker" style={rail}>
        <span className="pa-label">{trails ? 'Directly under the reference thesis' : 'Not connected to the reference thesis'}</span>
      </div>
    )
  }
  return (
    <div className="pa-kicker" style={rail}>
      {trails.paths.map((path, p) => (
        <div className="pa-trail" key={`p${p}`}>
          {elide(path).map((id, i) => (
            <Fragment key={id ?? `gap:${i}`}>
              {i > 0 && <span className="pa-sep">•</span>}
              {id === null ? <span className="pa-sep">…</span> : <ClaimLink gd={gd} id={id} onFocus={onFocus} show="tag" tint />}
            </Fragment>
          ))}
        </div>
      ))}
      {trails.more > 0 && <div className="pa-trail pa-label">and other routes</div>}
    </div>
  )
}

// The centred claim's provenance, run into the reading rather than captioned under
// it. The quote keeps its quotation marks and its italic — they are someone else's
// words and must not read as the page's — but it sits at body size on the same
// line as the source, as one sentence saying what this claim rests on.
//
// It is set in FULL here, both the verbatim quote and the whole reference, and this
// is the only place on the page that is true. A claim inside an argument gets the
// short mark and puts the rest on hover (`shortSource` / `citeTitle`), because four
// full references in a paragraph swamp the prose they annotate. The centred claim
// has no such competition: it is the one thing the page is about, so the reader is
// owed its sourcing without a hover and without an abbreviation.
//
// Attributive claims are the graph's empirical leaves — they bottom out by being
// checkable against a source rather than by a terminal flag — so this line is the
// whole case for the claim, standing where "The case for" stands on any other page.
function Deck({ attribution }: { attribution: AttributionT }) {
  const quote = attribution.quote?.trim()
  return (
    <p className="pa-deck">
      {quote && <><span className="pa-quote">“{quote}”</span>{' '}</>}
      <span className="pa-byline">{quote ? '— ' : ''}{sourcePhrase(attribution.source)}</span>
    </p>
  )
}

// ── Body: one argument per inference ───────────────────────────────────────────

// One inference. Headed by its grounds' tags — the handle that maps this argument
// back to a tile on the map, since an inference carries no tag of its own. Then
// the grounds as running prose against the argument's rail, and the warrants as a
// group on their own dashed rail under one `assumes`. No warrants prints no group
// at all: the absent line IS the unsurfaced warrant, which SESSION_FEED calls the
// normal state rather than a defect.
function Argument({ gd, inf, onFocus }: { gd: GraphData; inf: Inference; onFocus: (id: string) => void }) {
  const { groupHueOf } = useContext(PageCtx)
  const grounds = (inf.grounds ?? []).map(String)
  const warrants = (inf.warrants ?? []).map(String)
  const headline = argumentHeadline(grounds.map(g => getClaim(gd, g)?.tag ?? ''))
  // The rail carries where this whole line of argument stands relative to the
  // reference thesis — the same key as the trail above and the kicker's edge.
  const hue = groupHueOf(grounds)
  return (
    <div className="pa-arg" style={hue ? { borderLeftColor: hue } : undefined}>
      {headline && <h3 className="pa-subhead">{headline}</h3>}
      <p className="pa-grounds">
        {grounds.map((g, i) => (
          <Fragment key={`${g}:${i}`}>{i > 0 && ' '}<ClaimLink gd={gd} id={g} onFocus={onFocus} cue /></Fragment>
        ))}
      </p>
      {warrants.length > 0 && (
        <div className="pa-warrants">
          <span className="pa-label pa-assumes">{ASSUMES}</span>
          {warrants.map((w, i) => (
            <p key={`${w}:${i}`} className="pa-warrant">
              <ClaimLink gd={gd} id={w} onFocus={onFocus} cue />
              {getClaim(gd, w)?.terminal && <span className="pa-label"> · bedrock</span>}
            </p>
          ))}
        </div>
      )}
    </div>
  )
}

// Ordering. A reader who cannot see the whole section at once depends on the order
// to know where to start, so it is computed, not corpus order.
//
// Bedrock first: an argument resting on a terminal claim leads, however little sits
// beneath it. The reason stands on its own — a value commitment is undeveloped by
// definition rather than by neglect, so ordering on development alone buries exactly
// the claims the space rests on. Everything else follows by REACH descending, the
// most developed chain first; that key is printed on the page as the `›N` cues, so
// the ordering explains itself.
function Section({ title, inferences, empty, gd, onFocus }: {
  title: string; inferences: Inference[]; empty: string; gd: GraphData; onFocus: (id: string) => void
}) {
  const { reachOf } = useContext(PageCtx)
  const ordered = useMemo(() => {
    return inferences
      .map((inf, i) => ({
        inf, i,
        rock: restsOnBedrock(gd, inf) ? 1 : 0,
        r: argumentReach(gd, (inf.grounds ?? []).map(String), reachOf),
      }))
      .sort((a, b) =>
        b.rock - a.rock ||
        b.r - a.r ||
        (b.inf.grounds ?? []).length - (a.inf.grounds ?? []).length ||
        a.i - b.i)
      .map(x => x.inf)
  }, [inferences, gd, reachOf])
  return (
    <>
      <SectionHead>{title}</SectionHead>
      {ordered.length === 0
        ? <p className="pa-quiet">{empty}</p>
        : ordered.map(inf => <Argument key={inf.id} gd={gd} inf={inf} onFocus={onFocus} />)}
    </>
  )
}

// Where C goes ("Therefore") — the upper region, mirroring the focus view's parent band, which
// sits ABOVE the focus band. One line per DESTINATION, not per inference: a claim
// can reach the same target through several inferences, and printing the target
// once with "in two ways" says that, where one line each read as a duplicate.
// This is the next step up. The kicker's reference thesis is the horizon. Two
// different distances, deliberately kept apart — see the note in the page below.
function WhereThisLeads({ gd, focusId, consumers, isThesis, onFocus }: {
  gd: GraphData; focusId: string; consumers: Inference[]; isThesis: boolean; onFocus: (id: string) => void
}) {
  if (consumers.length === 0 && isThesis) return null

  // Key on (how C enters, where it goes) so the same target reached two ways in
  // the same role collapses to one line, while grounds-for and assumed-in-arguing-for
  // the same target stay apart — they are different facts about C.
  const routes = new Map<string, { role: string; targetId: string; n: number }>()
  for (const inf of consumers) {
    const out = outputOf(inf)
    const role = rolePhrase((inf.warrants ?? []).map(String).includes(focusId), out.kind)
    const key = `${role}\u0000${out.id}`
    const hit = routes.get(key)
    if (hit) hit.n += 1
    else routes.set(key, { role, targetId: out.id, n: 1 })
  }

  return (
    <>
      <SectionHead>Therefore</SectionHead>
      {routes.size === 0
        ? <p className="pa-quiet">This claim is not yet used anywhere.</p>
        : [...routes.entries()].map(([key, r]) => {
          const ways = waysPhrase(r.n)
          return (
            <p key={key} className="pa-lead">
              <span className="pa-label">{r.role}</span>
              <ClaimLink gd={gd} id={r.targetId} onFocus={onFocus} show="tag" />
              {ways && <span className="pa-label"> {ways}</span>}
            </p>
          )
        })}
    </>
  )
}

// ── The type scale ─────────────────────────────────────────────────────────────

/**
 * Solve for the body size this pane can carry, and the outer width that gives it
 * `ARTICLE.charsPerLine`. The line LENGTH is the invariant; the type size is what
 * moves. A wider pane is spent on larger type at the same measure until the type
 * reaches `bodyFontMax`, after which the surplus becomes margin — reading distance
 * does not grow with the window, so the gain from more width is real but finite.
 *
 * `paneMargin` is held back on each side first, so the article never fills its pane
 * exactly — it stays a sheet on a ground at every width, not only above the cap.
 *
 * Rounded DOWN to a quarter-pixel: down, so the solved size never exceeds what the
 * pane can actually hold and eats into the reserved margin; quarter-pixel, so a
 * splitter drag settles instead of reflowing the page on every pointer sample.
 */
function useTypeScale(ref: RefObject<HTMLElement>): { scale: number; measure: number } {
  const [body, setBody] = useState<number>(ARTICLE.bodyFont)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(entries => {
      const w = entries[0].contentRect.width
      if (w < 1) return
      const usable = w - ARTICLE.paneMargin * 2
      const fits = (usable - ARTICLE.chrome) / (ARTICLE.charsPerLine * ARTICLE.charWidthRatio)
      const clamped = Math.min(ARTICLE.bodyFontMax, Math.max(ARTICLE.bodyFont, fits))
      setBody(Math.floor(clamped * 4) / 4)   // never round UP past what fits
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return { scale: body / ARTICLE.bodyFont, measure: articleMeasure(body) }
}

// ── Page ───────────────────────────────────────────────────────────────────────

export function ArticleView({ gd, focusId, referenceThesisId = null, onFocus, onLocate }: {
  gd: GraphData; focusId: string; referenceThesisId?: string | null; onFocus: (id: string) => void; onLocate: (id: string) => void
}) {
  const claim = getClaim(gd, focusId)
  const title = claim?.tag ?? claim?.text ?? focusId

  // Stance and distance are measured from the same reference thesis the graph and
  // focus view use. `dist` counts claim↔inference edges, two per inference hop.
  const sm = useMemo(() => computeStance(gd, referenceThesisId), [gd, referenceThesisId])
  const thesisId = referenceThesisId && getClaim(gd, referenceThesisId) ? referenceThesisId : null
  // STANCE.neutral is the string 'none' — absence of stance, not a colour.
  // Every crumb takes a colour, the reference thesis included: `combinedStance`
  // already resolves the reference thesis to `aligned` when folding stances, so
  // the trail follows the convention the codebase set rather than inventing one.
  const hueOf = useMemo(() => (id: string) => {
    const st = id === sm.refThesisId ? 'aligned' : sm.node.get(id)
    return st && st !== 'neutral' ? STANCE_INK[st] : null
  }, [sm])
  const groupHueOf = useMemo(() => (ids: string[]) => {
    const st = combinedStance(sm, ids)
    return st && st !== 'neutral' ? STANCE_INK[st] : null
  }, [sm])
  const hue = thesisId && focusId !== thesisId ? hueOf(focusId) : null

  // One memo per render of the page, shared by every claim link on it.
  const reachOf = useMemo(() => {
    const memo = new Map<string, number>()
    return (id: string) => reachBelow(gd, id, memo)
  }, [gd])

  // The pane is measured on the scroller, not the article, so the article's own
  // width can follow it without the two chasing each other.
  const paneRef = useRef<HTMLDivElement>(null)
  const { scale, measure } = useTypeScale(paneRef)

  const supports = supportsOf(gd, focusId)
  const attacks = attacksOf(gd, focusId)
  const consumers = consumersOf(gd, focusId)
  const terminal = !!claim?.terminal
  const attributive = !!claim?.attribution

  // Terminals are neither concluded nor contested (I2/I7): no body at all. An
  // attributive claim with no support is not a gap — its source is its support —
  // so "The case for" appears only when something actually argues for it.
  const showFor = !terminal && (supports.length > 0 || !attributive)
  const showAgainst = !terminal
  const bothEmpty = showFor && showAgainst && supports.length === 0 && attacks.length === 0

  return (
    // Keyed on the centred claim so a refocus remounts the page — scroll returns to
    // the top, as following a link does.
    <PageCtx.Provider value={{ reachOf, hueOf, groupHueOf }}>
    {/* Fills its workspace pane. `--pa-s` scales every size on the page; `measure`
        is the width that scale needs to hold the line length. */}
    <div ref={paneRef} key={focusId} lang="en" className="pa-root"
         style={{ position: 'absolute', inset: 0, overflowY: 'auto', background: COLORS.background, ['--pa-s' as string]: scale }}>
      <style>{css}</style>
      <article style={{ maxWidth: measure, margin: '0 auto', padding: '48px 24px 72px' }}>
        <header className="pa-head">
          {thesisId && <Kicker gd={gd} thesisId={thesisId} focusId={focusId} hue={hue} onFocus={onFocus} />}
          <h1 className="pa-title">{title}</h1>
          {claim?.text && <p className="pa-standfirst">{sentence(claim.text)}</p>}
          {claim?.attribution && <Deck attribution={claim.attribution} />}
          {terminal && (
            <p className="pa-note">Bedrock — a value commitment this space takes as given. Nothing argues for it, and nothing here contests it.</p>
          )}
        </header>

        <WhereThisLeads gd={gd} focusId={focusId} consumers={consumers} isThesis={!!claim?._isThesis} onFocus={onFocus} />

        {bothEmpty ? (
          <>
            <SectionHead>The case</SectionHead>
            <p className="pa-quiet">Nothing yet argues for or against this claim.</p>
          </>
        ) : (
          <>
            {showFor && (
              <Section title="The case for" inferences={supports} empty="Nothing yet argues for this claim." gd={gd} onFocus={onFocus} />
            )}
            {showAgainst && (
              <Section title="The case against" inferences={attacks} empty="No one has yet contested this claim." gd={gd} onFocus={onFocus} />
            )}
          </>
        )}

        <footer className="pa-foot">
          <a className="pa-link pa-label" role="link" tabIndex={0} onClick={() => onLocate(focusId)}
             onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onLocate(focusId) } }}>
            Show on the map
          </a>
        </footer>
      </article>
    </div>
    </PageCtx.Provider>
  )
}
