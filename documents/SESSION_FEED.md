# Argument Framework: Session Feed

This document is optimized for LLM context injection. It provides the minimum necessary context to continue design and implementation work on the argument framework without relitigating settled decisions.

Design rationale, worked examples, rejected alternatives, and research directions are in DESIGN_HISTORY.md. Schema history: v1 (Argument/Proposition/TerminalValueNode) was superseded 2026-07-02 by the claim/inference model below. The v2 draft permitted `contests` to target an InferenceId; that is retired — see the enthymeme-completion thesis under Key Settled Decisions. The migration is complete; no v1 corpora remain live.

Schema is at v2.3. v2.1 retired `cluster` and `Inference.note`. v2.2 replaced the `concludes` / `contests` field pair with `target` + `relation`, and migrated every id from a readable slug to UUIDv7. v2.3 made `scheme` non-nullable, added `Deductive` and `Unknown` to `ArgumentScheme`, and added `Inference.schemeDescriptor`. Corpora now live under git in their own repository behind a canonical serializer and a typed writer — see Runtime.

---

## What This Is

A DAG-based argument representation framework. Goal: allow people to map, navigate, and evaluate arguments on contested topics by making implicit logical structure explicit. The animating question is "what would you have to believe in order to believe this?" The framework is a completeness checker not a truth machine — success means dialectical saturation, not adjudication.

---

## Core User Model

When making an argument, a participant must state:
- **(a) What they believe** — the claim
- **(b) Why they believe it** — the grounds (an attributive claim)
- **(c) The assumptions that make b imply a** — warrant claims

All three are Claim nodes. What binds them into one inferential act is an Inference node: it points at its grounds-claims and warrant-claims and bears exactly one relation to exactly one target claim — it either concludes that claim or contests it.

The dialectical layer is not a separate mechanism: contesting is just another inference, aimed at a claim (rebut) or an attributive claim (undermine). There is no third target — see the enthymeme-completion thesis below.

---

## Entity Model (Settled — v2.2)

Two node types. Role is positional throughout; nothing about a node's type says whether it is "acting as" grounds, warrant, claim, proposition, or terminal — its edges do.

**Claim** — the only content-bearing node
- id, tag, text, uncertain, submissionStatus
- IDs are branded string types (ClaimId, InferenceId, DiscourseSpaceId) — not interchangeable with plain strings
- terminal: boolean — true means this is a bedrock commitment; no inference may conclude it. False and unconcluded means "not yet supported" (a gap), not "cannot be supported." This is the one place the model distinguishes bedrock from absence.
- attribution?: { source: GroundsSource; quote: string | null } — present iff the claim's text is attributive ("Source X reports Y"). Attributive claims are the empirical leaves: they bottom out by checkability against the source, not by the terminal flag. A claim can migrate from contested to attributive as a debate settles elsewhere (e.g. "smoking causes cancer" moving from a once-contested claim into other corpora's attributions).
- A claim with no incoming Concludes edge and terminal: false is either a currently-designated root (see DiscourseSpace.roots) or a genuine gap (GAP 6).

**Inference** — the only structural node; carries no content
- id, scheme: ArgumentScheme, uncertain, submissionStatus
- scheme is required, not nullable. `Unknown` is the value for an inferential move the taxonomy does not name; it is not a stand-in for "not yet classified."
- schemeDescriptor: string | null — a few words naming the move. Present iff scheme is `Unknown`. Not a note field: it classifies the inference and carries nothing else. The `Inference.note` argument does not apply, because the descriptor is the same kind of fact `scheme` already holds.
- grounds: ClaimId[] — 1 or more; all conjoint (AND). Alternative, independent justifications for the same claim are separate Inference nodes (OR across inferences), not multiple grounds on one.
- warrants: ClaimId[] — 0 or more, also conjoint. Empty means the warrant is implicit and not yet surfaced — a legal state, not an omission.
- target: ClaimId — required, exactly one. Never an InferenceId.
- relation: Relation — required. `CONCLUDES` means this inference derives its target; `CONTESTS` means it attacks its target. Rebutting an attributive claim is what "undermining grounds" means — there is no separate mechanism for it.

Support and contest are the same structural relation with opposite polarity, so polarity is an attribute of the inference rather than a choice between two named fields. A single-valued target admits no ambiguity about which reference the relation applies to. `grounds` and `warrants` stay separate fields because they are many-valued and position is the only thing carrying their role — this is the boundary of "role is positional," not an exception to it.

**Definition** — lives at discourse space level, not in the argument graph
- term, text, importedFrom: DiscourseSpaceId | null
- Definitions are stipulations not truth claims
- Challenging a definition redirects to another discourse space via import pointer
- Philosophical frameworks are not definitions — they live in warrant claims

**DiscourseSpace**
- id, title
- definitions: Definition[]
- roots: ClaimId[] — the claims currently designated as contested questions (entry points for a view). Not an owned type; any claim can be a root, and a discourse space may have more than one live proposition at once (e.g. a factual question and a separate designational/policy question sharing the same claim and inference graph).
- claims: Claim[]
- inferences: Inference[]

---

## Enums (Settled)

```
ArgumentScheme: FromExample | FromGeneralization | FromAnalogy | FromAuthority | FromConsequence | FromSign | FromCause | FromDefinition | Deductive | Unknown

GroundsSourceType: Citation | SelfEvident | CommonKnowledge | LogicalNecessity | None

SubmissionStatus: Pending | Interrogating | Rejected | Accepted

Relation: CONCLUDES | CONTESTS
```

`Relation` is a plain Python `Enum`, never a `str`-subclassed one. A str-enum compares equal to its own wire string, so call sites keep working with bare strings and the type does no work. Wire values are `"concludes"` and `"contests"`; the serializer emits `relation.value` and the loader constructs `Relation(raw)`, raising on anything else.

`GroundsSource` is a discriminated union, not a bare enum: the `Citation` case carries `reference: string`; the other four cases carry no payload.

`EdgeRelationship` (Support | Attack | Warrants) is retired — see Key Settled Decisions.

`Cluster` (Pro | Anti | Empirical | Analogy | Terminal) is retired — see Key Settled Decisions.

`Inference.note` is retired — see Key Settled Decisions.

---

## Key Settled Decisions

**Two node types: Claim and Inference.** Claims carry all content. Inferences carry none — they are pure bindings of grounds-claims and warrant-claims to one output. This is the load-bearing move of v2: it separates "what is being claimed" (shared, dialectically active) from "one particular path to believing it" (individual, evidentially active).

**Congruence.** Multiple people asserting the same claim on different evidence share one Claim node and each contribute a separate Inference concluding it. An attack on the claim's content hits everyone; an attack on one person's inference hits only them. This fixes the v1 defect where grounds-in-node forced non-congruent duplicate nodes for the same claim.

**AND within an inference, OR across inferences.** All of an inference's grounds and warrants are jointly required. Independent alternative justifications are separate inferences concluding the same claim. Genuinely interdependent multi-premise arguments (e.g. "requires both intent and acts") decompose: each premise becomes its own claim, concluded by its own sub-inference, and a further inference takes both as joint grounds. There is no case that needs anything beyond this — every attempted counterexample during design decomposed cleanly.

**Support and Attack are not edge types; they are the two values of an Inference's relation to its target.** A "support" is an inference with `relation: CONCLUDES`. An "attack" is an inference with `relation: CONTESTS`. This unifies the model further than v1's three-edge-type design. An attack that itself needs a warrant (e.g. a terminal value warranting why a rebuttal defeats a claim) is just an ordinary inference with warrants whose relation happens to be `CONTESTS`.

**Undercuts collapse into rebuttals — the enthymeme-completion thesis.** An inference's `target` is a ClaimId and only a ClaimId. Any attack on an inference's applicability can be recast as a rebuttal of a warrant that inference relies on; where no such warrant is stated, the warrant is an unsurfaced enthymeme, and surfacing it is work the gatekeeper should demand anyway. The attack then targets that claim like any other. Every attempted counterexample during design resolved this way; none survived.

This subsumes the v2-draft undercut. `CONTESTS` on an ordinary Claim = rebut; `CONTESTS` on an attributive Claim = undermine. There is no third case, and no taxonomy field is needed.

**Proposition is not a type.** A proposition is a claim currently designated as a contested question — listed in `DiscourseSpace.roots`. Any claim's content is a candidate proposition (the sub-graph of inferences attacking/supporting it is locally shaped like a discourse space rooted there). A discourse space may hold multiple roots simultaneously sharing one graph (e.g. "did X happen" and "should X be designated Y" as two roots over overlapping claims and inferences) — this replaces the v1 idea of enlarging a single proposition's scope to absorb consequentialist arguments that don't belong to the factual question.

**Terminal value nodes are not a type.** `Claim.terminal: boolean` marks bedrock. The gatekeeper must refuse any inference that would conclude a terminal claim. Distinguishes "cannot be supported within this space" (terminal) from "not yet supported" (a GAP 6 gap) — a distinction the topology alone cannot make, which is why this is the one flag the schema keeps.

**Grounds are not a struct; they are ordinary claims.** An attribution ("Source X reports Y") is a claim whose vulnerabilities — misquotation, source credibility — are attacked the same way any claim or its supporting inference is attacked. "Fact" is not a node kind; it is a claim nobody has successfully attacked, typically because it is checkable against a cited source. The attributive discipline (below) is enforced by the gatekeeper, not by a separate type.

**All grounds-claims are attributive.** "Source X reports Y" not "Y is true." `attribution.source` determines the form of the implicit source-credibility warrant. Unchanged from v1 in spirit.

**Discourse spaces are constituted by their definitions, not their proposition(s).** Two spaces are the same space iff they share compatible definitions for their key terms. Propositions (roots) are views into a space, not what defines it. This resolves the old "what defines a discourse space" ambiguity in favor of the definition layer.

**One validator: `validate.py` is canonical.** A parallel TypeScript validator existed with a divergent rule set and was deleted; its GAP 6 detection was ported across as a warning. Invariants are errors unless explicitly marked warnings; the vocabulary is "error" and "warning", not hard/soft.

**Defeat conditions are not encoded.** Unchanged. The model makes contested state visible (which inferences exist, which are themselves contested); evaluation is left to participants.

**Inference and dialectic are not separate layers.** Strengthened from v1: they were already unified conceptually; v2 unifies them structurally too, since Support and Attack are now the same node type with different output edges.

**LLM role is Socratic gatekeeper not judge.** Unchanged. Surfaces implicit warrants, enforces the attributive-claim discipline, checks well-formedness, refuses inferences that would conclude a terminal claim or duplicate an existing claim under different wording. Never rules on correctness.

**Graph depth ≠ argumentative importance.** Unchanged, though depth is now purely computed (BFS from roots alternating claim/inference layers) rather than a stored field.

**Example nodes route through generalisation claims.** A specific case's inference concludes a generalisation claim; the generalisation's own inference (carrying the representativeness warrant) concludes the claim it supports. Never a direct inference from example to non-generalisation claim.

**Mediating claims do not connect directly to a root.** A claim is mediating if no inference exists (or should exist) from it directly concluding/contesting a root claim — it only feeds inferences for other, non-root claims. No longer a stored flag; a topological fact, checked at gatekeeping time with the same test as before: "would this claim be a reason to adopt/reject the root even with no downstream effects?"

**TypeScript interfaces are the canonical schema definition.** See `src/types.ts`. YAML is the human-readable storage format. Git for versioning.

**Cluster is retired.** Every value it carried was already representable elsewhere and better located there: `Terminal` duplicated `Claim.terminal`; `Pro`/`Anti` are root-relative stance, computed from topology, not properties of a claim; `Analogy` is `Inference.scheme = FromAnalogy`; `Empirical` is the presence of `attribution`. Argument type and approach are carried by `Inference.scheme` and `attribution.source.type` together — the claim records who said it, the inference records what kind of move consumes it. One enum forcing an exclusive choice between orthogonal dimensions was the defect, not a gap.

**`Inference.note` is retired.** Applicability remarks in prose were the informal escape hatch the enthymeme-completion thesis already forbids: if a note carries an applicability assumption it is an unsurfaced enthymeme and belongs in `warrants` as an attackable claim; if it is authoring commentary it is not argument content and does not belong in the schema. Empirically, 46 of 158 inferences carried a note and 3 held argument content — see DESIGN_HISTORY.

**Schemes are required and the taxonomy is open at the bottom.** `scheme` is non-nullable. Two values were added to the original eight.

`Deductive` — the grounds, together with the stated warrants, entail the target; any objection names a missing premise rather than a reason the step fails. This is not a misfit category, it is the unmarked case: every AND-decomposition produces one at the top, where the sub-conclusions are bound into the claim they jointly establish. Its absence was a real gap in coverage — the original eight are Walton-style presumptive schemes, all defeasible, and deduction was never one of them. Deductive inferences carry the heaviest warrant-surfacing obligation, since their premises are the only contestable surface. An attack that appears to target a deductive step is naming an unsurfaced premise.

`Unknown` — a real inferential move none of the others names, carrying a short free-text descriptor. Candidate categories were deliberately not pre-nominated: naming bins in advance anchors classification and returns the shape of the guess rather than the shape of the misfits. The descriptors accumulate across ingestion runs and are clustered into enum candidates later. Two known pressure points were left out on purpose — inductive accumulation is a composition question, not a scheme, and unfalsifiability is on the defect list and mostly applies to contests.

**The descriptor lives on the node, not in the commit message.** Routing it to the change record was rejected: the classification is a property of the inference, not of the agent that made it, and log-trawling is not a maintainable retrieval path. It survives the `Inference.note` test because it is neither argument content nor authoring commentary. Drift is fenced by the name, by I9, and by the write-boundary biconditional rather than by convention.

**Stance is computed per reference root, never stored.** A claim's valence is a fact about a path to a commitment, not a property of the statement — the same claim is aligned toward one root and opposed toward another. `computeStance(graph, referenceRootId)` returns `aligned | opposed | divided | neutral` for every node. Divided means paths of conflicting parity; neutral means no path to the root at all, which is absence of stance rather than a point on the axis. The reference root is nominatable and decoupled from selection.

**Ids are opaque and non-semantic — now actually so.** UUIDv7 throughout. The slug ids violated a rule the schema already stated; the migration brought the corpora into conformance rather than revising anything, which is why the filenames did not move to v3. Ids are never parsed, never carry type or role, never appear in a tag. The cost is that reference sites are no longer scannable; readability moved to `tag`.

**Nodes are immutable.** Frozen dataclasses. Ops are pure transforms, `(corpus, args) -> corpus`; nothing edits a node in place, and a new version shares every unchanged node. Reference collections are tuples rather than lists, uuid minting happens at the session boundary rather than inside an op, and the id→node index is a cached non-field.

**Serialization is canonical and the emitter is hand-written.** The same graph always produces the same bytes, so a commit diff shows exactly the nodes that changed. Dumping through a YAML library would make the canonical byte sequence a function of that library's version; loading still uses a standard parser, since parsing is stable and emitting is where the variance lives.

**Every commit failure is terminal.** Commit happens once at the end of a run, so there is no partial state to reconcile and the cheap response to any failure is to stop. There is no retry, backoff, or loop anywhere in the write path.

**Warrants stay 0..\*.** An inference with no warrant is an enthymeme — the normal state, not a defect. Requiring one at write time would push contributors and agents to invent warrants rather than record their absence. A missing warrant is a gap for gap detection, never an invariant violation.

---

## YAML Generation Rules (v2)

These rules apply when generating YAML corpus data from source material such as articles, papers, or debates.

**Claims are atomic and typed by content, not by role.**
One sentence, one assertion. The same claim node may be grounds in one inference, a warrant in another, and a conclusion in a third — never duplicate a claim under different ids because of the role it happens to play locally.

**Tags name content, never structure.**
A tag is a short handle for what the claim says. It never encodes the claim's role, and it is never derived from another claim's tag. Role is positional; `terminal` is already a schema flag. Ids are opaque uuids and carry nothing at all — the rule that once forbade `w-` id prefixes now has nothing left to forbid there, but it still governs tags.
Wrong: `Warrant — fare cost is binding constraint`
Wrong: `Collection cost not justified — grounds` (a relational name — it duplicates whatever it points at, and breaks silently when that tag changes)
Wrong: `User pays as principle (terminal)`
Right: `Fare cost is binding constraint`

**Tag form: capitalized initial, 50 characters maximum, unique within the corpus.**
Prefer a predicate over a noun phrase wherever the claim asserts a direction. A noun phrase names the topic without saying which way the claim cuts.
Wrong: `Marginal mobility improvement`
Right: `Fare removal helps at the margin`

**Citation-attributed claims lead with the source.**
Form `Source: subject`, abbreviating the reference as needed to fit the 50-character budget. This is what makes provenance scannable in the graph view, which does not render `attribution`. Claims attributed to `CommonKnowledge`, `SelfEvident`, or `LogicalNecessity` have no source to name and take the subject alone.
Right: `Streetsblog/PRI: Kansas City farebox recovery`
Right: `Bartov: siege conditions in northern Gaza`
In a single-source corpus the prefix is constant and carries nothing — drop it there rather than spending characters on it.

**Attributive claims must actually attribute.**
Wrong: `text: "Low-income people spend a disproportionate share of income on transit"`
Right: `text: "Sustainable America reports that low-income people spend a disproportionate share of income on transit"`
Mark such claims with `attribution: { source: ..., quote: ... }`.

**Attribution source type must be chosen carefully.**
- `Citation` — a specific author, paper, report, or organisation is named; always include a reference in the source
- `CommonKnowledge` — structural observations anyone can verify
- `SelfEvident` — true by direct inspection of the world
- `LogicalNecessity` — follows from definitions or conceptual structure
- `None` — only for terminal claims and pure definition-based inferences with no empirical basis
- Never use `None` as a shortcut when a source exists or could be inferred

**Every inference binds specific grounds to a specific warrant.**
Do not attach a warrant to a claim in the abstract. A warrant claim is only meaningful in the context of the particular inference it bridges — attach it via `warrants` on that inference, not as some free-floating property of the concluded claim.

**Warrant claims answer "what assumption makes these grounds imply this claim?"**
Not a restatement of the grounds, not a restatement of the claim, not a free-floating general principle.
Wrong: "Low-income people rationing trips means fare removal helps them" (restates grounds + claim)
Right: "Fare cost is the binding constraint on low-income trip rationing, so removing it relieves that constraint"

**Multiple warrants on one inference are conjoint, not alternative.**
If two assumptions are both required for one bridge, they are both `warrants` entries on the same inference. If they are independent, alternative routes to the same conclusion, they belong to separate inference nodes.

**Attacks are inferences with `relation: CONTESTS`, not a separate structure.**
Give a contesting inference its own grounds and, where the attack itself rests on an assumption (e.g. a terminal value warranting why this rebuttal matters), its own warrants — same as any concluding inference.

**Applicability attacks target a surfaced warrant claim, never an inference.**
When an argument accepts a warrant's general validity but disputes that it applies to this specific link, find the warrant claim carrying the applicability assumption and rebut it. If the inference does not state one, add it to `warrants` first — the assumption was always there, unstated. An inference id cannot be a target; since v2.2 the schema cannot express it.

**Example claims route through generalisation claims.**
A specific case (Boston, Kansas City, Luxembourg) is never concluded by an inference that also concludes a root or a non-generalisation claim. Its inference concludes a generalisation claim; the generalisation's inference (carrying the representativeness warrant) concludes the claim it supports.

**Mediating claims must not be concluded/contested-into by an inference targeting a root.**
Test unchanged: "would this claim be a reason to adopt/reject the root even if it produced no downstream effects?" If no, do not add an inference from it to a root claim.

**Only intrinsically valuable claims connect directly to a root.**
Unchanged in spirit.

**Claim and its grounds-claim must be genuinely distinct.**
If an inference's grounds-claim says the same thing as its concluded claim in different words, the inference is malformed.

**Do not encode defeat conditions.**
Unchanged.

**Terminal claims are plain language value assertions.**
No named philosophical frameworks. `terminal: true`. No inference may conclude a terminal claim — this is a hard validator rule, not a style preference.

---

## Views (Settled)

Both views are built. They swap, never coexist, and share one `ClaimId` selection plus one reference root.

**Shared.** Design tokens, the derived indices (`supports`, `attacks`, `consumers`, computed once on load), the selection, the reference root, and `computeStance`. Not shared: layout, composition, and node/cell rendering above the primitive level.

**Stance rendering.** The graph carries stance on nodes and edges; edge geometry (a double-tick slash) carries `CONCLUDES` vs `CONTESTS` independently of hue. The focus view carries stance on frontier chevrons. Palette poles are matched on perceived loudness rather than equal lightness/chroma, since blue is gamut-limited; `divided` is set apart by low chroma and its hue must avoid both pole families.

**Focus view — locked.**
- Stacked bands: parent band, focus band, children band (For left / Against right). Claims-only frames; inferences are never centered and never selectable.
- Cells and parent columns are fixed-height; overflow scrolls within the frame with a scroll-edge fade. "Everything visible at rest" means no disclosure *controls* — no expand/collapse, no "+N more", no click-to-reveal. Scrolling inside a fixed frame is not disclosure.
- The parent band pages, in two polarity columns (Supports / Contests) with role as a group header ("as grounds" / "as an assumption"). Consumers are neither AND nor OR, so paging is legitimate; the pager's `n` preserves the fan-out count that the band exists to show. Warrant-role tiles render the grounds-to-destination pair, since the destination alone cannot say which inference the claim bridges.
- For/Against columns page OR-siblings. Page state resets on refocus. Corpus order preserved.
- Frontier chevrons replaced pips entirely. Chevrons render on every claim row wherever one appears, never on the focus band; terminals render a `bedrock` badge instead. A chevron answers "there is more this way, and here is where it leads" — a different question from the retired supported/contested pip.
- The cell conjunction label is `assumes` / `assumes, together`. "Because" in natural language signals grounds, not warrants.
- Column tint applies to chrome only — headings, pager, labels — never to claim-bearing surfaces. The warrant bracket is neutral.
- A pinned reference-root line sits at the top of the stack with a target icon; a torn-sheet divider shows hop count when the centered claim is off-root.
- Per-claim "show in graph" locate and a "came from" back-trace are kept. Neither changes selection.
- `roots[0]` is the default centre and the default reference root.
- Attribution renders in the focus band only.
- Never rendered anywhere in the focus view: `id`, `scheme`, computed depth, `tag`, `submissionStatus`, `uncertain`. Depth especially — it is inferential distance and explicitly not importance.

---

## Runtime (Settled — Stage 1)

**Store.** Corpora live in their own git repository, nested inside the code tree and gitignored by it. Every commit in it is a graph change; code commits never appear there.

- Object layer only — blob, tree, commit. No index, no checkout, no subprocess.
- `read(name, sha)` resolves to a content-addressed blob: an exact coordinate, not one that depends on a commit message. `log(name)` gives per-corpus history.
- One corpus per commit. Validation scope, per-file history, and replay all rest on this. The writer enforces it; hand-edits do not.
- Working-tree consistency: `commit` writes the blob and the file, same bytes. Before writing it compares the working-tree file against HEAD's blob and raises `WorkingTreeDirty` on a mismatch, so an agent commit cannot silently discard an uncommitted hand-edit.
- Every commit reachable from `main` must load with the current loader. This is a test in the suite, not a convention — genesis was rebuilt once because it predated v2.2 and could no longer be read.
- Independent positioning of a corpus on disk is available through `git worktree`, not through separate repositories.

**Writer.** The session is the only write path. There is no patch object and no `submit`; patches exist as output (`session.diff()`) for review and the change record, never as input.

- The harness binds head; the session holds one reference to the current version and rebinds it per op.
- Reads see uncommitted writes. This is what makes construction work — `add_claim` returns a uuid, `add_inference` consumes it, `neighborhood` shows what was just built.
- Validation runs only at commit. Mid-construction states legitimately violate invariants.
- Write ops: `add_claim`, `add_inference(grounds, warrants, target, relation, scheme, scheme_descriptor)`, `revise_claim`. Queries: `get`, `neighborhood`, `find_by_tag`, `concludes`, `contesting`, `grounds_citing`, `warrants_citing`.
- Failures are `ValidationFailed`, `HeadMoved`, `WorkingTreeDirty` — all terminal, distinguishable so the harness can log them differently, not so an agent can respond to them.
- The commit message carries op lines with tags. It is the change record until Stage 2 has one, and it is where the readability lost to bare uuids comes back.

**Guard.** The client is a constructor parameter, never a module-level singleton — that seam is what will later allow a stub client to exercise commit paths without hitting the API. There is no run wrapper and no dry-run flag; git makes rollback cheap enough that dry-run-as-safety buys nothing.

- Pre-flight before every call, in order: kill file → per-run token cap → cumulative token cap. Projected cost is estimated input plus `max_tokens`.
- The cumulative gate reads the token log from disk. Process memory cannot bound a crash-loop across restarts.
- Token log is append-only JSONL: timestamp, run_id, corpus, model, input_tokens, output_tokens, committed. No cost figure — cost is a reporting concern computed retrospectively from model and token counts, and a price table inside the pre-flight path is a cap that goes silently wrong.
- Config holds five keys and rejects price-like and key-like keys. The API key comes only from the environment; the guard never handles it.

**Direction — viz and agent surface.** Settled in principle, unbuilt. Recorded here because each one closes an option rather than opening one.

- **The viz becomes a client of a local service.** Derivation lives once, in Python, beside the store and validator. This was already forced in miniature: a divergent TypeScript validator reimplemented the invariants, drifted, and was deleted. The same pressure applies to every derived value the two sides share.
- **The fetch boundary is at version change, never at interaction.** One request per (corpus, version) returns a derived bundle — parsed graph, derived indices, stance. Layout, selection, paging, and animation then run from memory. No interaction path touches the network.
- **The bundle carries stance for every candidate root**, so root nomination is a lookup rather than a fetch. Nomination stays a front-end concern without stance being computed twice. Revisit when corpus size shows up in a profile, not before.
- **The service reads the working-tree file by default and takes an optional sha.** Hand-editing keeps edit-and-reload immediacy, and replay becomes a viewing mode rather than a checkout.
- **Agent activity surfaces as an indicator, not a live update.** The reader binds a version as an agent does and rebinds deliberately. A graph re-laying-out under someone reading it is hostile, and arriving nodes collide with the focus view's flight animation.
- **The derived indices have exactly one implementation.** Stance drifting has a visible symptom — the colour discordance was two implementations disagreeing about what stance was relative to. An index drifting has none; it quietly renders the wrong parent band.

**Direction — the agent record.**

- **Proposals go on branches.** A superseded or reverted proposal is a real commit with a real diff, retrievable by an agent deciding what to work on.
- **Agent authorship is git's author field**, not a commit-message convention. `git log --author` filters on it natively; a message convention gets regex-parsed and drifts.
- **Working-tree writes are main-only.** A branch commit writes the blob and not the file, or the on-disk corpus tracks whichever branch committed last.
- **There is no separate refusal object.** Two agents disagreeing produce two commits, and the delta between two valid corpora *is* the disagreement — human-adjudicated. A structured, contestable refusal only exists once a gate does. What remains open is recognition rather than recording: matching a current proposal against one's own prior one is a coreference judgment.
- **Branch selection by agents is a separate question from branches as record.** Selection implies something eventually merges, and merge is out of scope for single residence — several invariants are not merge-closed.

**Vocabulary: bounding and stopping are different concerns.** Bounding is governance and is built — token caps, kill file, terminal failure. Stopping is a per-role feature concern: when has this role done its work. Conflating them puts a design question in the harness config or a config value in a role spec.

**Open, raised but not decided.**

- Per-file conflict detection — comparing the corpus blob at bound head rather than comparing head shas. Read, log, validation scope, and replay are all per-corpus; the conflict check is the one thing still repo-wide, which produces false conflicts across corpora. Harmless while writes are sequential.
- A pre-commit hook rejecting any commit that touches two corpora, to hold the property hand-edits can break.
- Pinning the store to the main worktree path explicitly. Once a second worktree exists, "the on-disk file" in the dirty-tree check is ambiguous if resolved from cwd.
- An audit reconciling stale file paths across the project documents.

---
## Agent Roles (Settled — role system)

**One role shape.** There is no producer/auditor distinction and no gate. Every role implements one protocol and differs only by capability grant and objective. A role that disagrees with what another committed reads committed state, forms its own view, and answers with its own commit.

**There is no gate because there is no patch to intercept.** The write path takes no patch as input — ops mutate session state and `commit()` writes. A reviewer that intercepts needs something to intercept, and nothing exists at that point. Head is valid by construction, so what a reviewer objects to is never validity; it is formulation or licensing, both judgment, both contestable. Enforcing something contestable at a chokepoint makes the harness an adjudicator, which is the stated non-goal.

**Objections are commits.** Author is git's author field, reason is the commit message, target is the diff. There is no refusal object and no meta-argument in the graph. An objection recorded as a claim about a claim was rejected — see DESIGN_HISTORY roles addendum.

**Declarations are legible, not binding.** Two enforcement classes:

- *Harness-enforced* — capability grant, token caps, kill file, one corpus per commit, validity. All the harness can see.
- *Self-enforced* — stopping, retry-only-on-new-grounds. Evaluating these requires modelling the role's purpose, which is the adjudication being avoided.

A declaration's function is that divergence between declared objective and observed delta is detectable from the change record, post hoc, by a human or another agent.

**Roles are types.** Instance cap and rate budget are class attributes. A shared budget spanning two roles lives in the deployment — the object naming which roles run at what multiplicity — because it cannot live on either sharer without one being authoritative over the other. Known-conflicting pairs are not declared: coverage-against-density is readable from two objectives, and a pair list is a cache of a judgment already available. Add it when something consumes it mechanically.

**The role prompt is three modules, assembled in order.** Framework, objective, then harness-generated mechanics. Separate artifacts, not one string literal — a concatenated prompt makes the modularity decorative and the next role copies the whole thing.

- *Framework* — what the graph is, the hard problems that cut across every role, and the model with the discipline for using each construct. Role-invariant, identical for every role, and the stable cache prefix. Written in narrative prose: it is maintained by hand and a prompt that reads well is one whose defects are visible.
- *Objective* — the role's mission, its ranked failure modes, its change posture, and its pre-emit checks. This is the `objective` class attribute.
- *Mechanics* — corpus view, tool schema, run parameters. Generated, never hand-authored per role.

Constraints are stated once, in the framework, embedded with the construct they govern rather than listed separately. Restating a rule at its point of use as a bare check is fine; restating it as a second explanation is the repetition that costs clarity.

The hard problems sit at the front, not the end. Three of the five govern how a source is *read*, so they must be in hand before reading rather than arriving as review criteria; and in a cached prefix followed by a corpus view and a document, nothing in the framework is recent by the time generation starts.

**The declaration is two class attributes.**

- `capability` — set of ops. The only harness-enforced field, and the mechanism by which roles differ.
- `objective` — prose. Goes in the system prompt and is what an observed delta is compared against.

`deference policy` is retired. It was a pre-gate concept; the retry norm replaced it and that norm is uniform across roles, so a per-role field could only declare a weaker norm than the protocol's.

`stopping condition` is not a field. It is the trigger returning nothing — a property of the role's selection query, checked when writing it.

**The protocol is a StateGraph.** Nodes: model call, tool dispatch, apply. Conditional edge on whether the last message carries tool calls — dispatch and loop, or apply and END.

- LangGraph components are used explicitly: typed dataclass state, `Annotated` reducers, `ToolNode`, conditional edges. `create_agent` is not used — it is a compiled graph you did not write, and the write path must be visibly outside the loop.
- **No checkpointer.** Durable execution would reintroduce partial state, and failure-is-terminal depends on there being none. The absence is deliberate.
- **`commit()` is outside the graph**, after END, in harness code. The graph has no path to a store write.
- **Full message history per call**, via `add_messages`. Required by tool_use/tool_result pairing, not a compromise. Cost per iteration grows through a run; prompt caching on the stable prefix mitigates it, the per-run token cap bounds it, and no mid-run summarization or trimming is used — both are lossy steps in the one reasoning trace that must stay readable. The token log must distinguish cached from uncached reads or it overstates spend.
- Per-run state is a typed dataclass holding plan and progress. Dataclasses, never TypedDicts.

**Control splits three ways.** What the run is about — harness, via the run parameter. What the model looks at — model, via read tools. What lands — harness, via ops. The model requests; it never executes a write. Read tools cannot fail in a way worth refusing, so retry-past-error on the read surface is correct.

**The write boundary enforces the scheme biconditional.** `add_inference` takes `scheme` and optional `scheme_descriptor` (the wire field is `schemeDescriptor`), rejects a descriptor on any other scheme, and rejects `Unknown` without one. Enforced at the op rather than only at the tool schema, so hand-driven writes are covered by the same rule. The corpus invariant (I9) stays one-directional; the op is where the stronger rule belongs, because it governs new work rather than existing state.

**Truncation is terminal.** A model response carrying the finding call with `stop_reason == "max_tokens"` fails the run. Nothing is committed. This is failure-is-terminal applied to the output boundary — a partial finding is a silent quality failure that looks like a successful commit, which is the one shape the design has no way to detect afterwards.

**Ingestion is additive: `revise_claim` is withheld from its capability grant.** Existing claim text, tags, and attributions are fixed for this role. Revise flags touching inferences for review, and those inferences were authored against the current wording — ingestion has not read them closely enough to judge the consequences. Wrongly-worded, over-broad, and conflated claims are left standing with the new material alongside; disambiguation is a later role that holds `revise_claim` and has read what depends on the wording.

**Change posture is per-role, not universal.** What is universal is that changes propagate to whatever depends on them, and that the cost of a change scales with what depends on it. How freely a role should change existing structure varies — ingestion barely at all, consolidation as its whole purpose — so the threshold is stated in `objective` rather than in the shared framework prompt. Roles reason from the same fact and act on different thresholds.

**Handoff between roles is a read query over history, never a status field.** Review state belongs to the reviewer, not the reviewed: one flag cannot serve several reviewers, and a set of reviewer ids is GAP 5. The corpus stays canonical and carries no review bookkeeping.

- A role holds one sha per corpus — the point it has read to. Its trigger walks `log(name)` from there to head, collects nodes touched, and seeds on those.
- The mark advances to head only on clean termination. A run ending on the token cap advances nothing and the next cycle redoes the window. Rework is cheap; silently skipping content is undetectable, because agreement leaves no trace.
- The general mechanism is `(from_sha, to_sha) -> nodes touched`. A role supplies its own mark; a human supplies any range. Same query.
- This is the pull form of the notification the architecture refused. It is the only durable per-role state in the design and is not reconstructible — if lost, reset and redo the window.
- Consequence accepted: the corpus cannot distinguish *reviewed and sound* from *never looked at*. Agreement leaves no trace, which is the price of no gate and no status field.

**Read tools are model-called and include their own entry points.** `get_all_tags() -> (uuid, tag) pairs` is the index — the model asks for it rather than receiving the corpus pre-loaded. Whole-corpus-in-prompt was rejected for roles whose work *is* traversal: it makes the traversal unobservable, and traversal is what strategy consists of.

**Ingestion is the exception, and the exception is about payload profile, not policy.** Ingestion receives the whole corpus in the system prefix. Its work is attachment, which needs a global view at once rather than a search path — and iterative interrogation of an accumulating claim set re-crosses the wire on every turn, which is the growth the read-tool design is avoiding in the first place. Roles that search a host-resident graph (consolidation, disambiguation, review) take the read-tool shape and the traversal transparency that comes with it.

**Cohorts.** A *run* is one parameter to one commit. A *cohort* is n runs sharing one plan, authored once by the model from the objective. The cohort is the unit of attribution — it is what makes one strategy comparable to another. Per-run plan authoring was rejected: it confounds strategy with sampling noise.

**Procedural memory stays in the prompt, human-authored.** An agent-written memory file was rejected on the `Inference.note` argument. What accumulates instead is the graph itself — findings persist as validated state that every future instance reads as input, so rediscovery is bounded to strategy, not findings. Variance across runs is load-bearing: identical strategies have identical blind spots, and independent samples are what make the saturation criterion falsifiable.

**Symmetry is not a role concern.** Asymmetry already in a corpus because one side has more sources is a fact about the world; asymmetry introduced by where an agent spent attention is an artifact. No role can distinguish them from inside a run. Struck from role specs and relocated to deployment-level observation over the change record.

**Objectives are not authored as claims yet.** Prose in the class attribute. The rationale space needs GAP 4 and has no mechanical consumer — a human compares objective against delta. Trigger for revisiting: a role must *answer* another role's objection rather than defer to it.

---

## Staging (revised — supersedes the stages in ARCHITECTURE_STAGE1)

Stage 3 as originally written ("same agent, now proposing through review") does not exist — there is no gate.

- **2 — Ingestion, incremental.** Run parameter is `(url, fetched_text)`. Fetch is a pre-run harness step; no fetch tool is bound to the agent, because provenance must be copied rather than generated, and a fetch tool inside the loop gives untrusted document content a path to arbitrary egress. Adds to `free-transit`. Accepts duplicate risk without coreference: duplicates are a quality defect, not a validity one, and attachment into a corpus you know well is checkable by eye in a way a fresh discourse space is not.
- **3 — Warrant surfacing.** First role operating on existing structure. Demonstrates the enthymeme-completion thesis.
- **4 — Ingestion, second document.** Where attachment and duplicate pressure actually land.
- **5 — Reviewer.** First consumer of the sha-range query and the read mark. Reviews what ingestion landed.
- **6 — Coreference as a shared service.** Pulled forward by 4.
- **7 — Cohorts.** First stage whose output is a comparison rather than a graph change.

Extraction is proven — three corpora built this way, all validating clean, and the YAML Generation Rules above are that role's guidance. Attachment is not: deciding where a new claim belongs, whether an inference already covers it, whether the assumption is already surfaced two nodes over.

---

## Open (from the roles session)

- **Scheme enrichment over the existing corpora.** The migration sets every previously-unscored inference to `Unknown` with no descriptor, which is the worklist. Assigning real schemes is judgment, not migration, and is deliberately not bundled with the schema change. Plan: hand-pass `free-transit` first to test whether the ten values cover real cases before automating. If a third come back `Unknown`, the taxonomy needs work before a role is built. If they cover cleanly, scheme enrichment is a good shape for the first non-ingestion role — narrow capability (`set_scheme` only), trivial stopping condition, cheap and visible errors.

- **`submissionStatus` may be retired.** Review state belongs to the reviewer, not the reviewed, which leaves the enum with no consumer. Same shape as `cluster` and `note` — values better located elsewhere. Needs its own decision.
- **The saturation criterion has no N.** "No agent produced a materially new distinction in the last N runs" cannot distinguish saturation from sampling noise without one.
- **Re-selection after reversal — deferred.** See the DESIGN_HISTORY roles addendum for the trigger condition and the mechanism if adopted.
- **An op that sets status**, and a default for it, are unresolved pending the `submissionStatus` decision.

---

## Gaps

Node references in this section use pre-v2.2 slug ids. Resolve them through `migrations/2026-07-slug-uuid.map`.

**GAP 1: Warrant applicability attacks — RESOLVED.** An applicability attack is a rebuttal of the warrant claim that carries the applicability assumption. Where that claim is not stated, it is an unsurfaced enthymeme; surfacing it is a gatekeeping requirement, not a schema problem. The intermediate v2-draft answer — `contests` targeting an Inference — is retired. Since v2.2 an inference has one `target`, typed ClaimId, so the typed layer cannot express it; I8 still checks it at the YAML boundary, where an id is just a string.

**GAP 2: UX representation of argument state without defeat conditions** — unresolved. Model deliberately omits defeat conditions. UX still needs to show contested state (which inferences exist, how many/which are themselves contested) meaningfully without implying a verdict.

**GAP 3: Temporal claims** — unresolved. No temporal dimension. A claim true at t=1 and false at t=2 is not representable differently from simply false. Live instance: `i-plateau-attacks-ridership` in free-transit, whose retired note said it *qualified* the ridership claim rather than contesting it — a temporal scope limit with nowhere to go but prose.

**GAP 4: Cross-discourse-space argument connections** — unresolved. Import mechanism handles definition-level connections between spaces. Inference-level connections — where an inference in one space is directly relevant to a claim in another — are unmodelled. Also the site of the genocide-by-displacement / genocide-by-destruction distinction surfaced in the Gaza corpus session: some claims genuinely belong to an international-criminal-law discourse space this framework only grazes.

**GAP 5: User identity and submission history** — unresolved but now recognized as architecturally central rather than peripheral. Prasanga traversal — showing a participant the consequences of their own committed claims — requires knowing which claims a given agent accepts. This is not just a trust/weighting feature; it's a prerequisite for the framework's core mechanism.

**GAP 6: Representing missing arguments** — unresolved, now partly detectable. `validate.py` warns on candidates (free-transit 34, freedman 4, gaza 5), but a warning cannot distinguish an intentional root from an overlooked gap from an unfinished thought. Live instance: `i-obama-attacks-deal` in freedman attacks `c-deal-ended-economic-harm`, but its grounds bear on deal quality, not on economic harm — and the pro argument it was written against was never extracted. Its retired note referred to "the pro warrant," a thing not in the corpus. Unrepaired.

---

## Prior Art

The claim/inference split with binary edges converges independently on the AIF (Argument Interchange Format) I-node/S-node architecture (Chesñevar et al.) — I-nodes (information) never connect directly to one another; all inferential and conflict relationships route through a scheme-application node, matching Inference here. ASPIC+'s undermine/rebut distinction falls out of what a `CONTESTS` inference targets (attributive Claim vs. ordinary Claim) rather than needing a separate field. ASPIC+'s undercut has no counterpart here: the enthymeme-completion thesis reduces it to a rebuttal of a surfaced warrant.

Decision: do not adopt AIF as a dependency. Its ecosystem (OVA+, AIFdb) is a single academic lab's argument-mining tooling with no mainstream adoption; its OWL/RDF vocabulary is unnecessary overhead for this project's goals. Parsanga's genuinely novel territory — Prasanga traversal over agent commitments, terminal value nodes as culturally-neutral bedrock, definitions constituting discourse spaces, the LLM Socratic gatekeeper — has no equivalent in AIF or in any surveyed deliberation platform (Kialo, Debategraph, MIT Deliberatorium, Polis, Aaronson's Worldview Manager). AIF-export as a future interoperability option is cheap and low priority.

Platform graveyard note (for product/funding context, not schema): structured argument-mapping tools have consistently died from the formalization burden they place on users (Debategraph, Deliberatorium, TruthMapping, Worldview Manager); survivors simplified structure away (Kialo → pro/con trees, pivoted to education; Polis → no argument structure, opinion clustering). Every prior attempt predates capable LLMs; the LLM Socratic gatekeeper may remove the constraint that killed the category. See SESSION_FEED_ADDENDUM.md history for the "Prasangafy this" product direction discussed alongside this schema work.

---

## Working Corpora

**free-transit.v2.yaml** — stress-test corpus. Key reference points (v1 node numbers retained below for continuity with DESIGN_HISTORY.md):
- Root: "Fares should be removed from public transit"
- Terminal pro: "Society is collectively obligated to fund conditions for full civic participation"
- Terminal anti: "Those who benefit from a service should bear its costs in proportion to use"
- node-13 (regressivity): best example of conjoint warrants on one inference — the general subsidy-direction principle and the implicit non-trivial-tax-incidence claim are both required and neither survives alone.
- node-2 (ridership increase): best example of a mediating claim.
- node-29: the GAP 1 case. Contests the surfaced warrant claim asserting that user-pays legitimately applies to transit, rather than the inference or the terminal behind it.
- node-19/20/21 → node-32: example claims routing through a generalisation claim.

**freedman.v2.yaml** — US-Iran ceasefire, built from the Friedman op-ed. Single-source corpus: nearly all citation grounds trace to one op-ed, which is why the tag source-prefix rule is dropped here.

**gaza_genocide** — Bartov (Pro) vs. Stephens (Anti) on "Israel's military campaign in Gaza constitutes genocide." Built directly as a two-source paired extraction, then iteratively refined for cross-source confrontation (shared warrants surfaced, mis-targeted attacks re-pointed to warrants, duplicate nodes merged, one node given dual Warrants/Contests roles). Now gaza.v2.yaml. Was the reference conversion for the schema migration. Notable v2-specific structure: three terminal-value warrants that had no valid home in v1 (they warranted an Anti argument's *attack* on the proposition, not the argument itself) attach cleanly to their contesting inferences in v2 — this was the concrete case that forced the Support/Attack-as-inference-output decision. Also the corpus where five claims warrant two inferences into the same destination, which is why focus-view warrant tiles must render grounds-to-destination pairs.

Corpus files live at `discourse-spaces/<slug>.v2.yaml`, inside their own git repository nested in the code tree.

Node counts, terminal counts, and validation status are code-derived facts and are deliberately not recorded here — they drift on every corpus touch and nothing reads them mechanically. Run the validator.

All ids are UUIDv7 and carry nothing. `tag` is the human handle everywhere: tooling output, logs, and commit messages. Slug references in older documents resolve through `migrations/2026-07-slug-uuid.map`.

Visualization: a Vite/TypeScript React app (`src/viz/`), D3 v7 / js-yaml, force-directed bipartite DAG. There is a build step — `npm run build` (vite) and `tsc -p tsconfig.json` — plus a separate CLI target (`src/index.ts`, `src/loader.ts`, `src/print.ts`) under `tsconfig.node.json`. Inference nodes render as small, visually subordinate junctions, not peers of claims, and are neither selectable nor openable. `viz.html` survives as a standalone prototyping surface and is stale (still references the retired `cluster` field), as is the checked-in `dist/` bundle.

---

## Implementation Status

- Design history: complete (DESIGN_HISTORY.md) — worked examples, surviving principles, schema evolution, rejected alternatives, research directions. Supersedes DESIGN_PRINCIPLES.md and SESSION_NOTES.md, both deleted
- Session feed: this document, v2, current
- TypeScript interfaces: v2 complete (`src/types.ts`) — two node types (Claim, Inference), four edge roles (Grounds, Warrants, Concludes, Contests), branded ids, compiles clean under `tsc --strict`
- Validator: complete (`validate.py`) — invariants I1–I10, all live:
  - I1 an inference has a target and a valid relation · I2 no inference concludes a terminal · I3 every referenced id resolves · I4 grounds non-empty · I5 no inference concludes an attributive claim · I6 the Concludes graph is acyclic (contests edges excluded) · I7 terminals appear only in `warrants`, never as grounds and never as the target of a contesting inference · I8 a contests target is never an inference · I9 `schemeDescriptor` non-null implies `scheme` is `Unknown` · I10 `scheme` is present and names a member of `ArgumentScheme`
  - I9 is one-directional at the corpus level. `Unknown` with no descriptor is legal, because the scheme migration produces exactly that and it is the worklist for scheme enrichment. The reverse implication is enforced at the write boundary instead, not in the corpus invariants
  - I1 restated at v2.2. It was "exactly one output per inference"; it is now "a target is present and `relation` is one of the two wire values." The typed layer makes both unrepresentable, but `check` runs on raw YAML before anything is constructed, so the boundary still needs guarding. It string-compares against the `Relation` values rather than constructing one, so a bad relation reports as I1 instead of raising
  - I3 resolving a contests target to claim-or-inference is deliberate belt-and-braces on the most recently reversed decision: I3 answers "does this id resolve," I8 answers "is it the right kind," and keeping them separate preserves distinct error messages
  - I5 is an error, not a warning. An attributive claim bottoms out by checkability against its source; concluding one is a category error
  - `check(data, path) -> (errs, warns)` is the pure invariant pass; `validate(path)` wraps it for the CLI, with output and exit codes unchanged. The writer calls `check` at commit and raises `ValidationFailed` carrying `errs`
  - I5 is an error, not a warning. An attributive claim bottoms out by checkability against its source; concluding one is a category error. A claim migrating from contested to attributive must have its concluding inferences removed or the claim split — that repair *is* the migration, not cleanup after it
  - GAP 6 detection is a warning, ported from the deleted TypeScript validator
- Navigation: no standalone module in the repo. Navigation is inline (`navigate` in `src/viz/App.tsx`). `corpus_nav.py` / `test_nav.py` are not present — they belong to the agentic toy or are gone
- YAML corpora: all three migrated to v2 and passing — `discourse-spaces/{free-transit,freedman,gaza}.v2.yaml`
- Tags: warrant pass complete (structural prefixes stripped, ceiling 50, casing uniform). Grounds pass complete
- Graph view and focus view: both implemented and building
- Colour discordance: resolved. Both views read stance from one shared `computeStance`; the graph carries it on nodes and edges, the focus view on frontier chevrons. Column tint is chrome only
- Stage 1 runtime: complete. Id migration, v2.2 field change, canonical serializer, git store, genesis rebuild, typed writer, guard. See Runtime
- Agentic Prasanga traversal (interview-prep toy): raw Python + Anthropic SDK, no framework. Model is the untrusted edge, harness is the trusted spine, model requests rather than executes. Steps 0–3 working; Step 4 — wiring navigation into the full loop with stop conditions and web search — outstanding

---

## v1 → v2 Concept Map

Retained for reading v1-era corpora and notes:

| v1 | v2 |
|---|---|
| Argument node (claim + embedded grounds) | Claim node (conclusion) + attributive Claim node (grounds) + Inference node binding them |
| Proposition (distinct type) | A Claim listed in `DiscourseSpace.roots` |
| TerminalValueNode (distinct type) | A Claim with `terminal: true` |
| Warrant argument node | An ordinary Claim referenced in an Inference's `warrants` |
| Support edge | An Inference with `relation: CONCLUDES` |
| Attack edge | An Inference with `relation: CONTESTS` |
| Warrants edge | Membership of a Claim in an Inference's `warrants` array |
| `Grounds` struct on Argument | An attributive Claim, referenced in an Inference's `grounds` |
| Edge `hint` | Retired. Became `Inference.note` in v2, then dropped entirely — see Key Settled Decisions |
| `depth` field | Computed (BFS from roots), not stored |
| `isMediating` flag | Topological fact: no inference from the claim concludes/contests a root |
| GAP 1 (warrant-applicability attacks, unresolved) | Resolved: a rebuttal of the surfaced warrant claim carrying the applicability assumption |