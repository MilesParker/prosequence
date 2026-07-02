# CLAUDE_CODE_DIRECTIVE: Migrate Parsanga to the Claim/Inference Schema (v2)

This directive instructs a Claude Code session to migrate the Parsanga codebase from the
Argument/Proposition/TerminalValueNode model to the claim/inference model settled in the
design session of 2026-07-02. Read this whole file before changing anything. The
accompanying `parsanga.ts` is the new canonical schema — do not redesign it; implement it.

## 1. The schema change in brief

Old model: Argument nodes (with embedded grounds), Proposition and TerminalValueNode as
distinct types, edges of type Support / Attack / Warrants, hint on edges.

New model (see parsanga.ts for the canonical definition):
- **Two node types.** `Claim` (all content) and `Inference` (no content; binds grounds-claims
  and warrant-claims to exactly one output).
- **Four edge roles.** Grounds, Warrants (both claim → inference), and exactly one output
  per inference: `concludes: ClaimId` or `contests: ClaimId | InferenceId`.
- **Attack and Support are gone.** A support is an inference that concludes. An attack is an
  inference that contests. Contesting a claim = rebut; contesting an inference = undercut;
  rebutting an attributive claim = undermine. No separate taxonomy is encoded.
- **Proposition is gone as a type.** `DiscourseSpace.roots: ClaimId[]` designates the claims
  currently treated as contested questions.
- **TerminalValueNode is gone as a type.** `Claim.terminal: boolean` marks bedrock claims.
  No inference may conclude a terminal claim.
- **Grounds are gone as a struct.** Attributive content is a `Claim` carrying an optional
  `attribution: { source: GroundsSource; quote: string | null }`.
- **Composition rule.** Within one inference, all grounds and warrants are conjoint (AND).
  Alternative justifications for the same claim are separate inferences (OR).
  `warrants: []` means "implicit, not yet surfaced," which is a legal state.
- **Dropped fields.** `depth` (derivable from topology), `isMediating` (expressible as
  topology: a mediating claim has no inference from it concluding a root). `cluster`
  survives on Claim as viz metadata. `hint` survives on Inference as a margin note.

## 2. Tasks, in order

### Task 1 — Replace the TypeScript interfaces
`parsanga.ts` is provided as a spec document (placed alongside this directive, e.g. in
`/docs` or repo root — not in `src/`). It is not meant to persist as a second schema file.
Locate the repo's existing schema file (likely `types.ts` or similar). Before touching it,
grep the repo for its import path(s) to see what depends on it.
- If nothing else imports from it, or only one or two files do: move parsanga.ts's contents
  into `src/` under whatever name/path suits the repo's conventions and update those imports.
- If many files import the existing file under its current name/path: keep that filename
  and path, replace its contents with parsanga.ts's contents.
  Either way, the file's *contents* become parsanga.ts verbatim (comments included — they are
  the spec for the validator in Task 2), there is exactly one schema file in `src/` when done,
  and the standalone `parsanga.ts` doc is deleted once its contents have been placed. Compiles
  clean under `tsc --strict`; verify after placing it.

### Task 2 — Write the validator
A small script (TypeScript or Python, match whatever the repo uses for tooling) that loads
a corpus YAML and enforces the six invariants listed at the bottom of parsanga.ts:
1. Each inference has exactly one of {concludes, contests}.
2. No inference concludes a claim with terminal: true.
3. All ClaimId/InferenceId references resolve within the space.
4. `grounds` is non-empty on every inference.
5. (Soft — warn, don't fail) Attributive claims are not concluded by any inference.
6. The Concludes graph is acyclic (edges: each grounds/warrant claim → concluded claim).
   Also warn on: non-terminal, non-attributive claims concluded by nothing (these are GAP-6
   gaps or should be in `roots`).

### Task 3 — Convert the corpora
Convert `free_transit.yaml`, the US-Iran ceasefire corpus, and adopt the already-converted
`gaza_genocide_v2_draft.yaml` (provided; regenerate if its source changed). Mechanical
mapping, per the conversion script pattern from the design session:

- Argument A → claim `c-A` (A.claim text) + attributive claim `g-A` (A.grounds.text,
  carrying quote + source as `attribution`) + inference `i-A` { grounds: [g-A],
  warrants: [c-W for each old Warrants edge W→A where W is an argument],
  concludes: c-A, scheme: A.scheme }.
- TerminalValueNode t → claim with terminal: true, cluster: Terminal.
- Proposition → ordinary claim, listed in `roots`.
- Old Support edge S→T → inference { grounds: [c-S], concludes: c-T (or the root claim),
  warrants: [] }.
- Old Attack edge S→T → inference { grounds: [c-S], contests: c-T (or the root claim) }.
- Old Warrants edges FROM terminals: these semantically warranted the connection of an
  argument to the proposition, not the argument's internal inference. Attach the terminal
  claim as a warrant on the support/contest inference that links c-A to the root — NOT on
  i-A. (This was the forced discovery of the design session: it is why attacks are nodes.)
- Old edge `hint` → `hint` on the corresponding inference.

**Corpus-specific judgment calls, decided in the design session:**
- free_transit node-29 (user-pays applied inconsistently) is the GAP 1 case. It must
  convert to an inference CONTESTING the inference that links node-12 to the root via the
  user-pays terminal — an undercut, not a rebut. Verify GAP 1 is representable and then
  mark GAP 1 resolved in the docs.
- free_transit node-13 (regressivity) has conjoint warrants: the general subsidy-direction
  principle AND the implicit non-trivial-tax-incidence claim. Both attach to the SAME
  inference (AND semantics). Surface the implicit one as a claim if it is not already a node.
- Example chains (Boston, Kansas City, Luxembourg → generalisation) convert to inferences
  concluding the generalisation claim; the representativeness warrants attach to those
  inferences.
- gaza corpus: the confinement claim contests the inference from the Mosul-analogy claim
  to the Hamas-tactics claim (undercut) — already encoded in the provided draft.

Run the validator on all three converted corpora. All must pass invariants 1–4 and 6.

### Task 4 — Update viz.html
Rewrite the D3 rendering for the bipartite structure:
- Claims: rectangles (or current node treatment). Inferences: small, visually subordinate
  junction marks (small circles/diamonds) — they are wiring, not peers. A later version may
  collapse simple claim–inference–claim runs into styled direct links; do NOT do that now.
  Correct representation first.
- Edge colors: Grounds, Warrants, Concludes, Contests each distinct; Contests keeps the
  old attack red, Concludes the old support green.
- Depth for the Y-axis layout is now COMPUTED: root claims (DiscourseSpace.roots) at
  depth 0, then alternate claim/inference layers by BFS. Terminal claims render at the
  bottom regardless of computed depth if the current layout did so for terminal nodes.
- Tooltips: claims show text + attribution (source, quote) if present; inferences show
  scheme + hint + their warrant list.
- An undercut (contests targeting an inference) must render legibly — an edge terminating
  on an inference node.

### Task 5 — Update the docs
- SESSION_FEED.md: replace the Entity Model and Enums sections with the v2 model; move
  GAP 1 to resolved (undercut = contests targeting an inference); note that Support/Attack/
  Warrants-as-edge-types, Proposition, TerminalValueNode, Grounds-as-struct are retired.
  Merge in SESSION_FEED_ADDENDUM.md (provided) if not already merged.
- YAML Generation Rules section: rewrite for the new shapes (claims list, inferences list,
  attribution on claims, conjoint-warrant rule, contests for attacks). Preserve the
  discipline rules unchanged in spirit: attributive grounds, atomic claims, warrant claims
  as bridging assumptions, examples through generalisations, terminals as plain-language
  value assertions.
- Corpus extraction instructions doc: same rewrite. Keep Steps 1–3 and 5 logic; Step 4
  (YAML format) changes shape.

### Task 6 — Do not do
- Do not add a Zod or runtime validation dependency (validator is a standalone script).
- Do not collapse inference nodes in the viz (later version).
- Do not encode defeat conditions anywhere.
- Do not rename existing corpus claim texts while converting; this migration is structural.

## 3. Acceptance checklist
- [ ] parsanga.ts in place, `tsc --strict` clean
- [ ] Validator runs; documents its warnings vs. errors
- [ ] Three corpora converted; validator passes; node-29 encoded as an undercut
- [ ] node-13 has conjoint warrants on one inference
- [ ] viz.html renders gaza_genocide_v2 and free_transit_v2 with legible undercuts
- [ ] SESSION_FEED.md reflects v2; GAP 1 marked resolved; extraction instructions updated