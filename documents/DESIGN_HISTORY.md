# Parsanga: Design History

Durable discoveries, worked examples, rejected alternatives, and open research directions. Written in current (v2) terms.

This is not the schema. `SESSION_FEED.md` is the schema and the settled decisions; it is what a new session reads to start work. This document is what you read to find out *why* — and to avoid re-deriving something that was already worked through and discarded.

Supersedes `SESSION_NOTES.md`, `DESIGN_PRINCIPLES.md`, `FOCUS_VIEW_SPEC.md`, `ARCHITECTURE_STAGE1.md`, `ROLES_SESSION_BRIEF.md`, and `CORPUS_EXTRACTION_INSTRUCTIONS.md` — all deleted. The first two described v1; the rest were consumed directives or briefs whose durable residue is recorded here and in the addenda, and whose settled outcomes are in `SESSION_FEED.md`.

Three addenda carry session-specific rationale: `DESIGN_HISTORY_STAGE1_ADDENDUM.md`, `DESIGN_HISTORY_ROLES_ADDENDUM.md`, `DESIGN_HISTORY_ARTICLE_ADDENDUM.md`.

---

## 1. Worked examples

These are the cases that drove decisions. They are worth keeping because each one is a concrete demonstration that generalised badly when abstracted too early.

### Regressivity — decomposition exposes a hollow argument

*free-transit, node-13.* "Universal free transit is regressive, because low-income non-riders pay taxes too." In natural language it sounds tight and is hard to rebut without appearing to defend waste.

Forced through claim / grounds / warrant decomposition it comes apart. The grounds are true — transit commuters do skew middle-income, and some low-income non-riders do pay general taxes. The warrant, that a subsidy moving resources from the general tax base to middle-income commuters moves money in the wrong direction, is sound as a general principle. But the inference needs two further things: that tax incidence on low-income non-riders is non-trivial, and that the beneficiary population skews middle-income net of all effects. Neither survives scrutiny.

The argument was lending the credibility of true grounds to a claim its warrant could not support. This is the single best demonstration of what the framework is for, and the origin of the conjoint-warrants rule — both assumptions are required, neither survives alone, and only decomposition makes that visible.

### Ridership — the mediating claim

*free-transit, node-2.* Ridership increase is not intrinsically a reason to remove fares; you could raise ridership at gunpoint. It is instrumentally valuable because it feeds emissions reduction, congestion reduction, and labour market access.

This produced the test: *would this claim be a reason to adopt or reject the root even if it produced no downstream effects?* If no, no inference should run from it directly to a root. Only intrinsically valuable claims connect directly.

The rule is topological, not a stored flag — which is itself an instance of the general principle in §2.

### Boston — depth is inferential distance, not importance

*free-transit.* "It worked in Boston" is the first thing most people say in this debate. It sits at depth 4: an evidence claim supporting a generalisation, supporting a mediating claim, warranting a claim that connects to the root.

What people lead with in natural argument is usually evidence, which is structurally downstream of what it supports. Two consequences, both still live:

- The interface must decouple salience from depth. A reader must be able to find a familiar argument regardless of its inferential position.
- Depth must never be rendered to a reader. This is why depth survives on the focus view's prohibited list even after `tag` came off it. The article's `›N` is not a breach: it renders reach, which counts hops *beneath* a claim, and the two measures run in opposite directions — see the article addendum.

### Gaza terminal warrants — the case that forced Support/Attack as inference output

*gaza.* Three terminal-value warrants had no valid home under v1: they warranted an Anti argument's *attack* on the proposition, not the argument itself. v1 had no object for them to attach to.

In v2 they attach cleanly to their contesting inferences. This was the concrete case that forced the decision that an attack is an ordinary inference whose output happens to be `contests` rather than `concludes`.

### Two people, incompatible terminals

The visual payoff the graph exists to deliver: two participants who appear to be arguing about transit funding are, at the bottom of the graph, arguing about incompatible terminal claims. The topology makes that visible in a way no amount of exchange does.

---

## 2. Principles that survived

### Role is positional

A claim's argumentative role is determined by which field references it — never by a stored flag, a node type, or an id prefix. The same claim may be grounds in one inference, a warrant in another, and a conclusion in a third. Encoding role anywhere else (`w-` id prefixes, `— grounds` tag suffixes, a `role` field) contradicts this and breaks the moment a claim acquires a second role.

Empirically confirmed: `c-ridership-increase` and `c-confinement-transforms-cleansing` each occupy both grounds and warrant position.

The rule extends to rendering. A role badge beside a claim types the claim — and a claim is never *a* grounds, it *acts as* grounds in one inference. This is why the focus view carries role by position on the bracket and never by a label on a tile.

### Grounds are ordinary claims

An attribution — "Source X reports Y" — is a claim. Its vulnerabilities (misquotation, source credibility) are attacked exactly as any claim is. "Fact" is not a node kind; it is a claim nobody has successfully attacked, usually because it is checkable against a cited source.

Grounds must attribute rather than assert. "Global temperatures have risen 1.2°C" is a claim; "The IPCC Sixth Assessment Report (2021) reports a 1.2°C rise since 1850–1900" is grounds. The attribution makes the implicit source-credibility warrant explicit and therefore attackable.

Where no citation exists, the source type is declared — self-evident, common knowledge, logical necessity — and the implicit warrant takes that form, which is itself attackable. Flat-earthers are arguing that what you call self-evident isn't.

### Inferences bind

The Toulmin triple — grounds, warrant, conclusion — requires an inference node. Bare edges cannot carry the warranting relationship, because a warrant is only meaningful relative to the specific bridge it spans. A warrant attached to a claim in the abstract is meaningless.

### The unit of the focus view is the inference, not the claim

Both regions render inferences incident to the centred claim, differing only in which member is elided. Above, C is an input; Below, C is the output. Every box shows a complete inference — one output, its inputs, and how each input enters — so the view teaches the shape of an inference rather than assuming it.

The design reached this by two reversals in consecutive passes, both on the same object. The first made consumers minimal, rendering destinations alone on the grounds that the region answers "what does accepting this feed into." That could not show that C's contribution was conditional on co-conjuncts the reader never saw — the enthymeme problem in miniature, in the one view built to prevent it. The information was one hop away and correctly homed, but nothing at rest said to take the hop. The second restored boxes.

The centred claim renders in every box, blank. Omitting it hid the shape of an inference — the reader could not see which slot the claim they were on occupied, which is the one thing the view exists to teach. Rendering its tag instead would repeat the focus band once per box; blankness states "this is the claim you are on" using the only channel not already carrying something, since fill is stance and position is role.

Conclusion sits above premises inside a box, the same altitude grammar the stack uses between bands.

### Terminal claims are where value diversity enters

Terminal claims are not merely bedrock empirical stopping points. They are the one place the full diversity of human value frameworks enters the graph without being categorised or labelled. A participant from any tradition states an irreducible commitment in plain language — "highest utility is highest justice", "justice is what preserves harmony in the community", "justice is what the ancestors would have sanctioned" — without being forced into named Western philosophical categories.

Named philosophical frameworks are not definitions and not terminals. They are warrant engines: they live in warrant claims, justifying inferential bridges.

Terminal depth varies by corpus. Terminals appear at the normative-empirical joint, which is not always the deepest point in the graph.

### Definitions are stipulations, not truth claims

"Justice means X" is a scoping decision — for the purposes of this discussion, by justice we mean Y. It is not assertable and not attackable. A participant using the term differently is not wrong; they belong in a different discourse space, or should follow the import pointer to the space where the term is the primary subject.

This is why a discourse space is constituted by its definition layer rather than by its proposition. Two spaces are the same space iff they share compatible definitions for their key terms. The import mechanism therefore solves two problems at once — contested definitions and discourse-space boundaries turned out to be the same problem.

### The LLM is Socratic, not judicial

At entry the model reflects back what the argument says when fully unpacked, and asks the submitter to confirm or revise: *it seems you are arguing X, but your warrant requires Y — is that what you mean?* It never rules on correctness, only well-formedness. Arguments that cannot be made well-formed do not enter.

This is a different experience from moderation or fact-checking. "Is this what you mean?" is much harder to get defensive about than "you are wrong," and it forces genuine engagement rather than adversarial posturing.

Entry is a privilege contingent on argumentative hygiene, not a right.

### The goal is saturation, not adjudication

The framework does not determine which side is right. Success is dialectical saturation — every argument that could reasonably be made has been made, every warrant that could reasonably be challenged has been challenged. "Winning" is not "my argument prevailed" but "the full logical space has been explored."

Most real arguments do not resolve into synthesis; they clarify where the disagreement lives. Two participants who follow their chains down and find incompatible terminals have achieved the goal, even remaining in disagreement. This is not a conflict-resolution tool.

### Defeat conditions stay unencoded

The model makes contested state visible — which inferences exist, which are themselves contested — and leaves evaluation to participants. There is no assumption that defeating all warrants defeats an argument; participants apply different standards.

This is also why the views carry no counts of support or attack. The one count that survives — a region heading's inference count — is structural rather than evaluative, and the distinction has to be held deliberately, because any number beside a claim reads as strength unless it is obviously about something else.

### Validity and agreement must stay separate

A reader must be able to judge an argument well-formed while disagreeing with its conclusion. Every surveyed platform collapses these. The framework's value depends on keeping them apart, and this constrains any future rating or voting affordance.

### Valence is a fact about a path, not about a claim

The graph and focus view spent a long time disagreeing about colour — green/red in one, blue/orange in the other — and the disagreement was a symptom, not the problem. Both were treating valence as something a claim *has*. It isn't. The same claim is aligned toward one root, opposed toward another, and divided when it reaches a root by paths of conflicting parity. Stance is a function of (node, reference root, graph) and cannot be stored.

Once that is explicit, the two views stop contradicting each other, because they were answering "relative to what?" differently and never saying so. The graph's hue is relative to the reference root; the focus view's left/right position is relative to what is centred. Two honestly-labelled reference points, not one truth rendered two ways.

This is Prasanga again: valence is a fact about a path to a commitment, never a fact about the statement.

A fourth state falls out and must not be collapsed into the other three. *Divided* is mixed — real valence on both sides, and a muddy render is the honest one. *Neutral* is absent — no path to the root at all. Rendering absence as mixture would say "both" where the truth is "neither," so neutral is off-axis (unpainted) rather than a point on it. Before a root is chosen, everything is neutral; that is the ground state, not a special case.

Inferences hold stance for the same reason claims do, and it is their own rather than borrowed. An inference has exactly one output, so it pushes exactly one way; contesting an aligned claim flips parity, which is why a contesting box differs in hue from the claim it attacks. Painting a box with its output claim's stance — the placeholder before this was thought through — made the one object that is not a claim wear a claim's colour, and made the box wash redundant with a tile inside it.

### Position and stance are two channels and must not collapse

Every claim surface carries two independent facts. Position is relative to the centred claim — which side of this argument — and is carried by layout. Stance is relative to the reference root and is carried by fill. They coincide on the root by construction and are independent elsewhere: a claim can support the centred claim and sit opposed to the root, so both hues appearing in one region is the expected off-root state rather than an error.

This is what retired column tint from claim-bearing surfaces. Two colour channels competing for the same pixel meant one of them had to be reading as the other, and position had the cheaper alternative — it can be carried by layout alone.

A painted surface asserts a stance, and stance means nothing except against a specific reference root. So wherever claims are painted, the reference root must be legible in the same view. The pinned reference-root line is the caption for every fill in the frame, not decoration.

Whether position survives a layout that dissolves the single centre is still open. It survived the tile rework because For and Against remained distinct regions.

### Prasanga is a traversal concern, not a schema concern

The graph is a universe of latent Prasanga paths. Actualising a specific one — showing a participant the consequences of the claims they actually hold — is a query and UX problem, not a modelling problem. This is why GAP 5 (agent commitments) is architecturally central rather than peripheral: the traversal is the point of the system, and it cannot run without knowing which claims a given agent accepts.

---

## 3. Schema evolution

### v1 → v2: the claim/inference split

v1 embedded grounds inside an Argument node and used three edge types (Support, Attack, Warrants). Its defect: two people asserting the same claim on different evidence were forced into duplicate non-congruent nodes.

v2 separates *what is being claimed* (shared, dialectically active) from *one particular path to believing it* (individual, evidentially active). Claims carry all content; inferences carry none and are pure bindings. Multiple people asserting one claim share the Claim node and contribute separate Inferences. An attack on the claim hits everyone; an attack on one inference hits only its author.

Consequences that fell out rather than being designed:

- Support and Attack stop being edge types. They are the two possible outputs of an inference.
- Proposition stops being a type. It is a claim listed in `DiscourseSpace.roots`.
- Terminal stops being a type. It is a flag — the one flag the schema keeps, because topology alone cannot distinguish "cannot be supported here" from "not yet supported."
- Depth stops being stored. It is computed.
- Mediating stops being a flag. It is a topological fact.

### v2 draft → v2: undercuts collapse into rebuttals

The v2 draft permitted `contests` to target an InferenceId, treating warrant-applicability attacks as undercuts. That is retired.

The enthymeme-completion thesis: any attack on an inference's applicability can be recast as a rebuttal of a warrant that inference relies on. Where no such warrant is stated, the warrant is an unsurfaced enthymeme — and surfacing it is work the gatekeeper should demand regardless. The attack then targets that claim like any other. `contests` targets ClaimIds only.

Every attempted counterexample resolved this way. None survived. All `contests` edges across the three live corpora target claims.

This is the second time GAP 1 was declared resolved, by a different mechanism each time — which is the reason the history is worth keeping rather than only the conclusion.

### v2 → v2.1: cluster and note retired

Both were fields that looked like schema and were really something else.

**Cluster** (`Pro | Anti | Empirical | Analogy | Terminal`) forced one exclusive choice across three orthogonal dimensions, which is why claims marked `Pro` or `Anti` looked as though they had no epistemic classification. They had one; the enum had no room for it. Every value was already representable: `Terminal` duplicated the flag, `Pro`/`Anti` are computed stance, `Analogy` is `Inference.scheme`, `Empirical` is the presence of `attribution`. Deleted with no replacement — `scheme` plus `attribution.source.type` are finer-grained than cluster ever was, and they split correctly, the claim recording who said it and the inference recording what kind of move consumes it.

**Note** was an applicability remark in prose on the inference. The enthymeme-completion thesis had already ruled that applicability attacks target a surfaced warrant claim, which makes an unattackable prose remark about applicability a contradiction of the thesis living inside the schema.

The corpus query settled it. 46 of 158 inferences carried a note; triaged, they fell into three piles:

- **Restatement of the edge** (37) — the note said what the id and the target already said. All of free-transit's 34 were this.
- **Orientation commentary** (4) — "independent route to the same claim" is OR-across-inferences, which the topology states; "uncertain secondary benefit" is the `uncertain` flag, which was already set.
- **Argument content in unattackable prose** (3) — genuine enthymemes. `i-death-toll-attacks-pattern` needed the assumption that killing rate rather than destruction rate measures genocidal intent; `i-sycophancy-supports-electoral` needed the bridge from purged dissent to unchecked electoral incentive. Both were surfaced as warrant claims. `i-obama-attacks-deal` turned out to be mis-targeted against an argument the corpus never contained — see GAP 6 in the session feed.

So the field's real function was the extractor explaining itself, which is a genuine need but not a schema one — and it hid three enthymemes for as long as it existed. That is the argument for deleting it rather than tolerating it: a place to put prose about an inference is a place enthymemes will accumulate.

Order matters on a repair like this. The notes were the only record that those three inferences were broken, so triage had to precede deletion.

### On attributive migration and validator strictness

A claim can migrate from contested to attributive as a debate settles elsewhere. It was once argued that this justifies leaving I5 — no inference concludes an attributive claim — as a warning rather than an error, since a corpus caught mid-migration would fail.

It doesn't. A corpus file is committed state, not a live editing session; mid-migration is a working-tree condition, and validators run on what you commit. And when a claim does go attributive, its concluding inferences aren't temporarily awkward, they're wrong — the claim now bottoms out by checkability against its source. Removing or resiting them *is* the migration, not cleanup after it.

The observation about how corpora evolve is worth keeping. It was not an argument for tolerance.

### The inference/dialectic distinction is notional

It is tempting to treat inferential structure (how one argument is built) and dialectical structure (how arguments relate) as separate layers needing separate representation. They collapse into one graph. Under v1 this was true conceptually; v2 made it true structurally, since support and attack became the same node type with different outputs. The distinction remains useful for talking, and should never drive the data model.

---

## 4. Rejected alternatives

Recorded so they are not silently reinvented.

| Rejected | Why |
|---|---|
| Hyperedges | Did not earn their complexity against AND-within / OR-across |
| CA-nodes (conflict-application nodes) | An attack is already an inference with a `contests` output |
| Additional edge types beyond the four roles | v1's three-edge design collapsed into inference outputs |
| `contests` targeting an InferenceId | Enthymeme-completion thesis; see §3 |
| Encoding role in ids (`w-` prefixes) or tags (`— grounds`) | Contradicts role-from-position |
| Zod | Runtime validation not needed; `tsc --strict` plus `validate.py` suffices |
| Framework-based agent architecture | Raw Python + Anthropic SDK; the harness must stay the trusted spine |
| AIF as a dependency | Convergent architecture, but its ecosystem is one lab's argument-mining tooling with no mainstream adoption, and OWL/RDF is overhead here. AIF export remains cheap and low priority |
| `Claim.cluster` | Conflated three orthogonal dimensions in one exclusive enum; every value already representable elsewhere — see §3 |
| `Inference.note` | Unattackable prose about applicability contradicts the enthymeme-completion thesis; empirically a hiding place for enthymemes — see §3 |
| A second validator (`scripts/validate.ts`) | Reimplemented rather than shared the invariants and drifted; `validate.py` is canonical, GAP 6 detection ported across |
| Teal/violet and teal/magenta stance poles | Collapsed toward green/red at thin-edge rendering sizes; blue/orange survived |
| Red/green as the focus view's polarity channel | Retired with the discordance — position already carries for/against relative to the centred claim, and hue is needed for stance relative to the root |
| Hex colour tokens | Everything is HSL. HSL makes `divided` a legible transform of the poles — same hue family, dropped chroma — rather than a hand-picked colour, and the conversion was done as its own commit with no value changes so the stance pass started from the right format |
| Chevrons as the focus view's stance channel | Too little surface to carry an absolute channel. Stance moved to fill; chevrons retained for frontier only, carrying no stance |
| Chamfered inference box | `clip-path` cannot stroke a shape, so rings rendered unevenly and the interior bled. The chamfer's job — distinguishing the container in kind from pill-shaped tiles — is done by a stance spine instead |
| Grid layout for tiles within a region | A grid implies its columns mean something. If they don't, ranking is reintroduced rotated 90°. Bag layout asserts nothing about position within a region, which is the point — membership is the only claim being made |
| Convergent mini-graph in place of boxes | Lines fanning into a junction would be the strongest cross-view identity available, since the junction *is* the graph's inference node. Rejected: the focus view exists to be an alternative to the graph, and six fans down a scroll region read as one tangle with no boundary to clip against |
| Paging in the focus view | Tag tiles cut an inference from roughly eight lines to one or two, which fits every sibling in a fixed-height scroll frame. Scrolling in a fixed frame was already ruled not to be disclosure, so the licence pre-existed; paging survived only because full-text cells were too tall to stack. Scroll also keeps OR-siblings adjacent and in corpus order instead of splitting them into a visible set and a hidden set |
| Minimal consumers (destination tiles only) | Lived one pass. Could not show that the centred claim's contribution was conditional on co-conjuncts the reader never saw — see §2 |
| Deduped destination tiles and the multiplicity badge | Lived one pass. Two inferences into one destination are two boxes with visibly different inputs, which is what the badge compensated for |
| Bare destination tile for single-input inferences | Retired with the common template. A box with one input is still a complete inference, and the special case made two renderings of one object |
| The `assumes` / `assumes, together` label on every box | Conjointness is a constant of the model, not a per-box fact, and a label repeated once per box is clutter for something learned once. The stub dash carries the grounds/warrant distinction; if conjointness needs surfacing it belongs in hover |
| Box tinted by its output claim's stance | The box is the inference, and an inference holds its own stance — one output, one direction. Borrowing the claim's hue made the wash redundant with a tile inside the box and hid the parity flip that contesting produces |
| Porting the focus band's darkening to the centred claim's tile | The band's treatment is a darker variant of the stance colour. At band width that reads as emphasis; on a small tile beside other stance-tinted tiles it competes with `divided`. Kept anyway on Miles' call, with the divided-adjacency case flagged for checking |
| Full FLIP / shared-element transition for refocus | The crossfade hides the seam, so the flying ghost never has to morph — only the source rect is measured up front, the target is read from the band after the swap, and the ghost is band-styled rather than a clone of the clicked tile. Approximation is invisible under the fade, and it collapsed the work from a shared-element transition to a three-leg state machine |
| Full-text rows in the focus view | Replaced by tag tiles with full text on hover. This took `tag` off the never-render list; `id`, `scheme`, `submissionStatus`, `uncertain` and computed depth stay off, depth on principle |

### Deferred, not rejected

**A third "unsettled deeper" pip.** Designed to mark "this claim is not itself contested, but something it rests on is." Cut before implementation, for reasons recorded so it is not silently reinvented:

- It is the only such mark not verifiable one click away. Supported and contested are facts about edges incident to the claim; this one is a rollup that says *look* without saying where.
- In a mature corpus it lights permanently near the root, making it noise rather than signal.

It is purely derived — a memoized transitive closure over `grounds ∪ warrants` of `supports(claim)` — so it could be added later with no schema or corpus change. A closure of exactly that shape was subsequently built, but as the frontier chevron, reporting *stance of what lies past here* rather than *something below is unsettled*. Different question, same machinery. Revisit the original only if a corpus demonstrates the gap.

**Pager summary — dissolved.** Whether the pager should surface the status of hidden OR-siblings became moot when paging retired. Recorded because the underlying tension is live wherever content is deferred: discoverability against hoisting attacks out of their true home.

**Unverified on screen.** Whether solid and dashed stubs separate at stub length; whether a darkened blank tile stays distinct from a `divided` tile beside it, divided being the low-chroma stance and so the likeliest confusion; whether the box stroke reads as redundant against the bracket, and whether a bracket clipped at the scroll edge still reads as clipped; whether the contest tick reads at spine weight, the spine being thinner than a graph edge. The refocus flight's timing is likewise unconfirmed — built, typechecked, never eyeballed.

**`divided` and `neutral` at tile scale.** `divided` must stay distinct from both poles on a surface smaller than anything the palette was tuned against. `neutral` — no path to the chosen root — is expected to be rare or absent under a single root in a connected corpus, so its rendering is deliberately undecided rather than designed on spec. `divided` and `neutral` must never collapse: "both" and "neither" are opposite facts.

### Platform graveyard

Structured argument-mapping tools have consistently died from the formalisation burden they place on users: Debategraph, MIT Deliberatorium, TruthMapping, Worldview Manager. The survivors simplified the structure away — Kialo reduced to pro/con trees and pivoted to education; Polis abandoned argument structure entirely for opinion clustering.

Every prior attempt predates capable LLMs. The Socratic gatekeeper is the bet that the constraint which killed the category is now removable.

---

## 5. Open research directions

**Argument schemes and dialectical profiles.** Walton's dialectical profiles — the expected question-and-response patterns for each scheme — would specify what the gatekeeper should ask per scheme type. His work on argument from expert opinion bears directly on the source-credibility warrant.

**Bipolar argumentation semantics.** Baroni, Giacomin and others have formal semantics for bipolar frameworks. Relevant not to encode defeat, which stays out of the model, but to inform how the UX presents contested state without implying a verdict (GAP 2).

**Legal reasoning.** The admissibility/weight distinction maps closely onto grounds/warrant. Common-law treatment of expert testimony bears on source credibility; burden-of-proof conventions bear on gatekeeping.

**Cross-cultural argumentation.** Perelman and Olbrechts-Tyteca's *New Rhetoric* on how different traditions construct and evaluate arguments — relevant to the definition layer and to the plain-language terminal decision.

**Ontology alignment.** The discourse-space / definition / import mechanism resembles semantic-web ontology design. Ontology alignment work bears on GAP 4 (cross-space argument connections); SKOS may be a useful reference for the definition layer.

**Deliberative democracy.** Habermas, Fishkin. The framework's goals — surfacing disagreement, enabling introspection, saturation over consensus — align closely, and this literature has empirical findings about what conditions actually enable deliberation.

---

## 6. Method notes

Patterns that have repeatedly produced good decisions on this project.

**Concrete before abstract.** Every design decision that held up was stress-tested against a specific corpus example first. Every one that had to be reversed was abstracted early.

**Empirical corpus queries as arbiter.** Python analysis against live corpora, run before locking a decision rather than after. This confirmed or refuted pip semantics, tile rendering, warrant foldability, consumer counts, and the enthymeme-completion thesis. Where a design intuition and a corpus query disagreed, the query was right.

**Minimal complexity.** A proposal must earn its complexity against the simplest alternative that could work. Most did not.

**One change at a time.** Lock explicitly before implementing. Confirm before proceeding. Mechanical changes ship as their own commit ahead of the semantic change that depends on them — the HSL conversion before the stance pass, so `divided` could be derived rather than invented.

**Terse imperative specs for handoff.** Rationale belongs in design sessions and in this document. Implementation directives are lean and directive.

**Directives are one-way and disposable.** A pre-implementation directive is true until built, after which it becomes a parallel description of code that drifts by construction. Written, executed, residue extracted, deleted — never updated to match what got built. `FOCUS_VIEW_SPEC.md` became a stale parallel spec precisely by being kept.

**A pass never edits canonical.** Implementation reads `SESSION_FEED.md` and emits a supersede block — the exact changeset to paste back — as a required deliverable. This keeps the implementer off the decision record while making sure canonical does not go quietly stale behind a landed change. Representation decisions are worked out in chat and copied back; application design is maintained in the repo.

**Lift decisions, not facts.** Facts — claim counts, enum members, invariant lists, tuning values — are generated from code and corpora and must never be transcribed into a document, because every transcription is a copy that rots. Decisions can only be authored, and they are the only thing that has to travel back from implementation into the design docs. Restricting the discipline to decisions is what makes it small enough to actually keep.

**Docs name tokens, never values.** `STANCE_DIVIDED` and `FOCUS.flight`, not a hex triple or a duration in milliseconds. A value in prose is a copy nothing can check. The rule is about prose docs, not code — code needs the values, and it holds one definition per token that all three surfaces read.

**Audits report, they do not reconcile.** A difference between doc and code has three causes — doc stale, code drifted, or the build decided something the doc never covered — and a reader of code is structurally biased toward the first. Ask for classification into all three, read-only, quoting both sides. The third category is where lost decisions are, and only the question "what does the code decide that the doc does not mention at all" finds it; a plain diff finds contradictions but never omissions.

Related failure, observed: given a comment justifying a rule that had just been retired, the implementer read the comment as an authority over the change rather than as the thing being changed. Same bias. The mitigation is the same — report inconsistencies, do not resolve them.