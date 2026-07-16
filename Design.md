# Argument Framework: Core Design Principles

> **Schema v2 (2026-07-02).** The framework was migrated from the
> Argument/Proposition/TerminalValueNode model to a **claim / inference**
> model. The principles below are unchanged in spirit; the structural
> vocabulary has changed. Read "The v2 data model" first — it is the
> canonical mapping between the principles and what is actually stored.
> The canonical TypeScript schema lives in [`src/types.ts`](src/types.ts).

## 0. The v2 data model (claim / inference)

**Two node types.**

- **Claim** — the only content-bearing node (`id`, `tag`, `text`,
  `terminal`, optional `attribution`, `cluster`, `uncertain`,
  `submissionStatus`). One node per distinct claim; several people asserting
  it on different evidence share the node and contribute separate inferences.
- **Inference** — content-free. It binds specific grounds-claims and
  warrant-claims to exactly one output. Rendered as a small junction, not a
  peer node.

**Four edge roles** (positions, not stored edge records — they fall out of an
inference's fields):

- **Grounds** (claim → inference): the evidence an inference runs on.
- **Warrants** (claim → inference): the bridging assumptions. Multiple
  warrants on one inference are **conjoint (AND)**. Alternative
  justifications are **separate inferences (OR)**. `warrants: []` means
  "implicit, not yet surfaced" — a legal state.
- **Concludes** (inference → claim): the inference derives the claim. *A
  support is an inference that concludes.*
- **Contests** (inference → claim): the inference attacks the target claim.
  *An attack is an inference that contests.* Attacks may **only** target
  claims; an attack on an inferential step is not representable and is
  surfaced as a warrant claim instead (see GAP 1).
  - contest a non-attributive **claim** = **rebut**;
  - contest an **attributive** claim = **undermine**.

  No separate attack taxonomy is stored — rebut vs. undermine is read off
  whether the target claim is attributive.

**Enums.** `ArgumentScheme` (FromExample, FromGeneralization, FromAnalogy,
FromAuthority, FromConsequence, FromSign, FromCause, FromDefinition),
`Cluster` (Pro, Anti, Empirical, Analogy, Terminal), `SubmissionStatus`
(Pending, Interrogating, Rejected, Accepted), `GroundsSource` (Citation,
SelfEvident, CommonKnowledge, LogicalNecessity, None).

**Positions, not types.** "Proposition", "terminal", "warrant", "grounds",
"attack" are no longer node/edge types — they are positions a claim or
inference occupies, with two exceptions encoded as data:

- `Claim.terminal: boolean` marks a bedrock commitment (may never be
  concluded), distinct from "not yet supported" (a GAP-6 gap).
- `DiscourseSpace.roots: ClaimId[]` designates the claims currently treated
  as contested questions.

**Retired constructs.** `Argument` (with embedded grounds), `Proposition` and
`TerminalValueNode` as node types, `Support`/`Attack`/`Warrants` as edge
types, `Grounds` as a struct, and the `depth`/`isMediating` fields are all
gone. Depth is computed from topology; a mediating claim is one with no
inference from it concluding a root. `cluster` survives on `Claim` as viz
metadata; the inference's `note` field (formerly `hint`) is a non-semantic
authoring margin note — never rendered as argument content and never attackable.

## 1. The goal is completeness, not adjudication

The framework does not determine whether arguments are correct or which side wins. It ensures that all reasonable arguments have been made, all implicit assumptions have been surfaced, and all warranted challenges have been lodged. The graph is successful when it is dialectically saturated — every argument that could reasonably be made has been made, and every warrant that could reasonably be challenged has been challenged.

## 2. The atomic unit is the claim, joined by inferences

An assertion decomposes into: a **claim** (the assertable conclusion), its **grounds** (the attributed factual basis, itself a claim carrying `attribution`), and an **inference** that binds the grounds to the claim (`concludes`). The bridging assumptions that make the grounds count as evidence — **warrants** — are themselves claim nodes, listed in the inference's `warrants`. All elements must be explicit before the inference enters the graph.

When making an argument, a participant must state: (a) what they believe — the claim; (b) why they believe it — the grounds-claim; and (c) the assumptions that make b imply a — warrant claims on the inference. Warrants are not sub-fields; they are first-class claims, bound to a specific inference via its `warrants` list. A support and an attack are not different kinds of thing from an inference — a support *is* an inference that `concludes`, an attack *is* an inference that `contests`.

## 3. Warrants are the primary site of logical vulnerability

All meaningful logical challenge ultimately targets a warrant — either an explicit one or an implied one that must be made explicit before it can be attacked. Grounds are factual claims attributed to a source. Claims are conclusions that follow or don't follow from their grounds via their warrants.

Warrant claims are attached to the inference they bridge via its `warrants` list. This is a distinct position from grounds — a warrant is constitutive of the inference, not merely additional evidence for it. Without the warrant the inference collapses; without an additional concluding inference the claim is merely less well supported. To challenge whether a warrant licenses the step, you surface the implicit warrant as an explicit claim on that inference and **rebut that claim** — attacks target claims, never inferences. If the warrant is already explicit, contest it directly; if it is still implicit (`warrants: []`), the gatekeeper surfaces it first (see GAP 1).

What appears to be a grounds attack is always an attack on an implied warrant — either a source-credibility warrant ("this source is reliable") or an attribution-accuracy warrant ("this source actually reported this"). These implied warrants must be surfaced as explicit argument nodes before they can be attacked.

## 4. Grounds must be attributive

Grounds are attributive **claims**: a claim carrying an `attribution: { source, quote }`, its text of the form "source X reports/shows/found Y" rather than asserting facts directly. Attributive claims are the empirical leaves of the graph — they bottom out by checkability against the cited source, not by a `terminal` flag, and should not be concluded by any inference (soft invariant 5). The source type determines the form of the implicit source-credibility warrant:

- **Citation** — a specific paper, report, study, or document
- **Self-evident** — true by inspection of the world; no citation needed but the self-evidence claim is itself attackable
- **Common knowledge** — so widely established that citation is unnecessary; also attackable
- **Logical necessity** — follows from definitions or conceptual structure
- **None** — for terminal value nodes and definition-based arguments that have no empirical basis

## 5. Warrants are independent and multiple

An argument may have multiple warrant argument nodes connected via Warrants edges. Each must independently bridge the grounds to the claim without relying on any other warrant. If one warrant depends on another, that dependency is a separate argument that must be entered into the graph in its own right.

## 6. Defeat conditions are not encoded

The framework does not determine when an argument is defeated. That judgment is left to participants. The framework only makes visible which warrants have been attacked, which have been defended, and which challenges remain unanswered. There is no assumption that defeating all warrants constitutes defeat of an argument — participants may apply different standards.

## 7. The LLM is a Socratic gatekeeper, not a judge

Before an argument enters the graph, the LLM interrogates it to surface implicit warrants, check atomicity, enforce grounds attribution, and ensure well-formedness. The LLM reflects back what the argument actually says when fully unpacked and asks the submitter to confirm or revise. Arguments that cannot be made well-formed do not enter the graph. The LLM never rules on whether an argument is correct — only whether it is properly formed.

Entry to the discourse space is a privilege contingent on minimum argumentative hygiene, not a right. This is a feature, not a limitation — the framework's value depends on the quality of what it contains.

## 8. The discourse space is constituted by its definition layer

Key terms are stipulated at the discourse space level via imported definitions. These are scoping decisions, not truth claims — "for the purposes of this discussion, by X we mean Y." Arguments within the space must use terms consistently with those definitions.

Challenging a definition is a meta-move that redirects to a different discourse space where that term is the primary subject. Contested terms point to other discourse spaces via an import mechanism, analogous to how legal documents reference statutory definitions or academic papers cite prior work for definitions rather than re-arguing them.

## 9. Terminal value nodes are bedrock

Every inferential chain eventually bottoms out in a terminal claim — a `Claim` with `terminal: true` (`cluster: Terminal`) — a bedrock commitment that cannot be further justified empirically within this discourse space. Terminal claims are stated as plain value assertions (e.g. "highest utility is highest justice") without reference to named philosophical frameworks, preserving cultural neutrality.

Terminal claims cannot be concluded by any inference within the discourse space (invariant 2); the gatekeeper rejects any inference that concludes one. They can be made explicit, compared, and acknowledged as the source of genuine value disagreement. Two participants who follow their inferential chains all the way down and find incompatible terminal nodes have located the actual source of their disagreement.

## 10. The framework represents both inferential and dialectical structure in a unified graph

The inferential structure captures how individual arguments are constructed — how grounds connect to claims via warrant claims on an inference. The dialectical structure captures how arguments relate — inferences that `conclude` (support) or `contest` (attack) other claims and inferences. These are logically distinct concerns but are represented in a unified graph rather than separate layers, using the four edge roles (Grounds, Warrants, Concludes, Contests) that fall out of inference structure.

Dialectical attacks are inferences in their own right — they run on grounds-claims and carry their own warrant claims. Because an attack is a node (an inference) rather than a bare edge, its grounds and warrants are themselves claims that can be rebutted — an attack is answered by contesting the claims it stands on, not by contesting the inference. The framework does not assume or require synthesis. Genuine value disagreements are represented as incompatible terminal claims, not as problems to be resolved. Most real arguments do not produce synthesis — they clarify where disagreement actually lives.

## 11. Depth is inferential distance, not importance

A node's depth in the graph measures how many inferential steps it is from the root proposition. This is not a measure of argumentative salience, rhetorical power, or relevance to the debate. Commonly cited arguments may sit deep in the graph because they are evidential rather than directly normative. The graph reveals that what people lead with in natural argument is usually evidence — which is structurally downstream, not upstream, of the claims that evidence supports.

---

## Summary: What the framework is and is not

**It is:** A tool for mapping the complete logical structure of a debate, making implicit assumptions explicit, and revealing where genuine disagreement lives.

**It is not:** A debate judge, a fact-checker, a political position, or a guarantee of resolution.

**The core question it asks of every participant:** What would you have to believe in order to believe this? Following that question all the way down is the work the framework is designed to support.

---

## YAML generation rules (v2)

A discourse-space corpus is a single YAML document with `id`, `title`,
`definitions`, `roots`, `claims`, and `inferences`. The discipline rules are
unchanged in spirit; only the shapes changed.

- **Claims list.** Every assertion — conclusions, grounds, warrants,
  terminals, and the contested questions themselves — is a `Claim`. Keep
  claims **atomic**: one proposition per claim.
- **Roots.** List the contested question(s) in `roots`. They are ordinary
  claims; nothing "owns" them.
- **Attribution on claims.** A claim that reports what a source says carries
  `attribution: { source: <GroundsSource>, quote: <verbatim | null> }`. Its
  text is attributive ("Source X reports Y"). These are the checkable leaves;
  do not conclude them with an inference.
- **Warrant claims as bridging assumptions.** Surface the assumption that
  licenses each step as its own claim and list it in the inference's
  `warrants`. Conjoint warrants (all required for one step) go on **one**
  inference; genuinely **alternative** justifications are **separate**
  inferences concluding the same claim.
- **Contests for attacks.** An attack is an inference with `contests`, and it
  may only target a **claim**. Contest a non-attributive claim to **rebut** it;
  contest an attributive claim to **undermine** it. There is no inference-
  targeting attack: an applicability challenge ("that warrant does not license
  this step") is handled by surfacing the implicit warrant as its own claim on
  the target inference and then contesting *that* claim.
- **Examples through generalisations.** An example claim feeds a
  generalisation via an inference that `concludes` the generalisation; the
  representativeness warrant attaches to *that* inference (the generalising
  step), not to the example's internal attribution inference.
- **Terminals as plain-language value assertions.** `terminal: true`,
  `cluster: Terminal`, no attribution, never concluded.

Validate every corpus with `python validate.py <corpus.v2.yaml> ...`, which
enforces invariants I1–I8. I1–I4 and I6–I8 are hard errors (non-zero exit);
I5 (attributive claims should not be concluded) is a soft warning. I7 keeps
terminal claims in `warrants` only — never in grounds, never as a `contests`
target — and I8 forbids an attack from targeting an inference.

## Corpus extraction (Step 4 shape change)

The extraction procedure is unchanged for Steps 1–3 and 5 (identify the
contested question, harvest positions, attribute grounds, interrogate for
implicit warrants). **Step 4 — emit YAML — changes shape only:** instead of
`arguments` (claim + embedded grounds), `terminalValueNodes`, and typed
`edges`, emit a flat `claims` list (with `attribution` on the attributive
ones and `terminal` on the bedrock ones), a `roots` list, and an
`inferences` list whose `grounds`/`warrants`/`concludes`/`contests` fields
encode all the connective tissue. `scripts/convert.ts` performs exactly this
mechanical remapping from an old-model corpus.

## GAP 1 — resolved (enthymemification: surfaced warrant, contested as a rebut)

GAP 1 was: a warrant-applicability attack (e.g. free-transit's *user-pays
applied inconsistently*) had no clean representation, because it appears to
attack *the applicability of a warranted connection* rather than a claim, and
terminal nodes could not be targeted. In v2 this is resolved by
**enthymemification**, not by inference-targeting. Attacks may only target
claims; undercuts have left the model entirely. An attack on an inferential
step is surfaced: the gatekeeper makes the suppressed warrant the step depends
on explicit, adds it to the target inference's `warrants`, and the attack
becomes an ordinary **rebut** of that warrant claim. The
user-pays-inconsistency argument now contests an explicit applicability /
consistency claim standing beside the user-pays warrant, leaving the policy
claim and the terminal untouched. Likewise, in the Gaza corpus the
*confinement* argument rebuts the surfaced warrant bridging the *Mosul-analogy*
claim to the *Hamas-tactics* claim, rather than undercutting the inference.