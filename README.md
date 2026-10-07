# Prosequence

Prosequence maps contested debates as argument graphs. It is built around one question: *what would you have to believe in order to believe this?*

It is a completeness checker, not a truth machine. It does not score, rank, vote, or adjudicate. Success is dialectical saturation: every argument that could reasonably be made has been made, and every assumption that could reasonably be challenged has been challenged. Most real disagreements don't resolve. They get located. Two people who follow their chains down and find incompatible value commitments at the bottom have gotten exactly what the system offers, even if they still disagree.

---

## Why bother

Take "universal free transit is regressive, because low-income non-riders pay taxes too." In conversation it sounds tight and is hard to answer without seeming to defend waste. Split it into claim, grounds, and warrant and it comes apart. The grounds are true. The general principle is sound. But the inference also needs two further assumptions: that the tax burden on low-income non-riders is non-trivial, and that the beneficiaries skew middle-income net of all effects. Neither one holds up. The argument was borrowing the credibility of true grounds to support a claim its warrant couldn't reach, and only the decomposition makes that visible.

People have tried to build structured argument mapping many times: Debategraph, MIT Deliberatorium, TruthMapping, Worldview Manager. They died of the same thing. Formalising an argument is too much work for the people making it. The tools that survived simplified the structure away. Kialo went to pro/con trees; Polis dropped argument structure for opinion clustering. All of them predate capable language models.

The bet here is that an LLM acting as a Socratic gatekeeper removes that burden. The gatekeeper reflects an argument back fully unpacked: *it seems you're arguing X, but your warrant requires Y. Is that what you mean?* It rules on well-formedness, never on correctness. "Is this what you mean?" is much harder to get defensive about than "you're wrong."

---

## The model

There are two node types. The canonical schema is `src/types.ts`; corpora are stored as YAML.

**Claim** carries all the content. A claim is one atomic assertion with a short `tag` (a human-readable handle) and its full `text`.

**Inference** carries no content. It is a pure binding:

- `grounds` are one or more claims, all jointly required.
- `warrants` are zero or more claims: the bridging assumptions, also jointly required.
- `target` is exactly one claim.
- `relation` is either `concludes` (derives the target) or `contests` (attacks it).
- `scheme` records what kind of inferential move this is.

The rest follows from that split.

**Role is positional.** Nothing stored on a claim says whether it is grounds, a warrant, or a conclusion. Its role is determined by which field references it. The same claim can be grounds in one inference and a warrant in another, and in the corpora some are.

**Claims are shared; inferences are individual.** Two people asserting the same claim on different evidence share one claim node and contribute separate inferences. An attack on the claim hits both of them. An attack on one inference hits only that inference.

**AND within an inference, OR across inferences.** Everything an inference rests on is jointly required. Independent justifications for the same claim are separate inferences.

**Attacks are just inferences.** Support and attack are not edge types; they are the two values of `relation`. Contesting an attributive claim is what "undermining the grounds" means, so there is no separate mechanism for it. There is no undercut either. Any attack on whether an inference applies can be recast as a rebuttal of a warrant the inference relies on. If that warrant was never stated, it is an unsurfaced assumption, and surfacing it is the job. This is the enthymeme-completion thesis, and every counterexample tried against it so far has collapsed back into it.

**Grounds attribute.** Evidence enters as "Source X reports Y," not "Y is true." The attribution makes the implicit source-credibility assumption explicit, which makes it attackable. Where there is no citation, the source type is declared (common knowledge, self-evident, logical necessity), and that declaration can be attacked too.

**Missing warrants are normal.** An inference with no stated warrant is an enthymeme, not a defect. Requiring warrants at write time would push contributors to invent them instead of recording their absence.

**Terminal claims are bedrock.** `terminal: true` marks an irreducible value commitment, written in plain language without named philosophical frameworks. Nothing may conclude a terminal claim. Terminals are where the diversity of human value systems enters the graph without being sorted into categories. Named frameworks are not terminals; they live in warrants, where they justify specific inferential bridges.

**Theses are designations, not types.** A thesis is any claim currently marked as a contested question for its discourse space. A space can hold several theses over one shared graph.

**Definitions constitute discourse spaces.** "By justice we mean X" is a stipulation, not a claim, and it can't be attacked. Someone using the term differently isn't wrong. They belong in a different space, and an import pointer gets them there.

**Stance is computed, never stored.** Whether a claim is for or against depends on what you measure it against. Relative to a chosen reference thesis, every node is `aligned`, `opposed`, `divided` (paths of conflicting parity), or `neutral` (no path at all). Divided means "both" and neutral means "neither," and they are kept distinct.

**Deliberately not encoded:** defeat conditions, depth (computed when needed, never displayed), pro/anti labels, mediating-claim flags, and free-text notes on inferences. Each of these was either computable from the topology or turned out to be a hiding place for unsurfaced assumptions.

---

## Storage and the write path

Corpora live in their own git repository, nested inside the code tree and gitignored by it, at `discourse-spaces/<slug>.v2.yaml`. Every commit in that repo is a graph change. Cloning the code repo does not get you the corpora.

- **One corpus per commit.** Per-corpus history, validation scope, and replay all depend on it.
- **Canonical serialization.** The same graph always produces the same bytes, so a diff shows exactly the nodes that changed. The emitter is hand-written; dumping through a YAML library would tie the byte sequence to that library's version. Loading uses a standard parser.
- **Immutable nodes.** Ops are pure transforms, `(corpus, args) -> corpus`. A new version shares every unchanged node.
- **The session is the only write path.** Ops mutate session state, reads see uncommitted writes, and validation runs once at `commit()`. There is no patch object as input; `session.diff()` produces one as output for review.
- **Failure is terminal.** The writer raises `ValidationFailed`, `HeadMoved`, or `WorkingTreeDirty`. There is no retry, backoff, or loop anywhere in the write path. Commit happens once, so there is never partial state to reconcile.
- **Every commit stays readable.** A test walks every commit reachable from `main` and loads every corpus at each one.
- **Ids are opaque.** Ids are UUIDv7 and carry no meaning; `tag` is the human handle in logs, tooling output, and commit messages. Older documents use slug ids, which resolve through `migrations/2026-07-slug-uuid.map`.

---

## Validation

`validate.py` is the only validator. It returns errors and warnings: errors block a commit, and warnings flag things like unsupported non-thesis claims that might be gaps. The invariants are defined in that file. Run it rather than trusting a list in a document.

```
python validate.py discourse-spaces/free-transit.v2.yaml
```

A parallel TypeScript validator existed once. It drifted and was deleted.

---

## Agents

LLM agents do the population work. The model is the untrusted edge and the harness is the trusted spine: the model requests, and the harness decides what lands.

**One role shape.** Every role implements the same protocol and differs only in two things: its capability grant (the set of write ops it may use, enforced by the harness) and its objective (prose in the system prompt). There is no reviewer gate. A role that disagrees with committed work answers it with its own commit. Authorship is git's author field, the reason is the commit message, and the target is the diff.

**Protocol.** A LangGraph `StateGraph` with three nodes (model call, tool dispatch, apply) and a conditional edge on whether the last message carries tool calls. There is deliberately no checkpointer, since durable execution would reintroduce partial state. `commit()` happens outside the graph, in harness code, after the graph ends.

**Guard.** Before every API call, the harness checks a kill file, then a per-run token cap, then a cumulative token cap read from an append-only token log on disk. The client is a constructor parameter so it can be stubbed. The API key comes from the environment only (`ANTHROPIC_API_KEY`). Cost is computed after the fact from model and token counts; no price table lives in the pre-flight path.

**Ingestion** is the first role built:

- Its run parameter is `(url, fetched_text)`. The harness fetches the document before the run; no fetch tool is bound to the model. Provenance has to be copied, not generated, and untrusted document text shouldn't have a path to arbitrary egress.
- The whole corpus goes into the system prefix as JSON Lines, because attachment needs a global view. Later roles that search the graph get read tools instead, so their traversal stays observable.
- The model calls `submit_finding` exactly once with new claims and the inferences that attach them.
- It is additive only. Ingestion can't revise existing claims.
- It ranks omission as the worst failure and duplication as the acceptable one. Coreference is cheap to fix later; an omission leaves no trace.
- On a would-be validation failure it drops the offending inferences and commits the valid remainder. It never drops claims, and every drop is listed in the commit message.
- A response truncated at `max_tokens` fails the run and commits nothing.

Handoff between roles is a read query over git history, not a status field. Each role keeps one sha per corpus, the point it has read to, and works on whatever changed since.

---

## Surfaces

The viz is a Vite + React + TypeScript app in `src/viz/`, using D3. It has three surfaces that swap rather than coexist. All three share one selected claim, one reference thesis, the derived indices, and one `computeStance`.

- **Graph.** A force-directed bipartite DAG. Inference nodes are small junctions, not peers of claims. Stance is shown on nodes and edges; edge geometry shows concludes vs. contests independently of colour.
- **Focus view.** Stacked bands: what the centred claim feeds into above, the claim itself in the middle, and the case for and against below. The unit is the inference, and every box shows one complete inference: output, inputs, and how each input enters (solid stub for grounds, dashed for warrants). There are no expand/collapse controls; everything is visible at rest, with scrolling inside fixed frames.
- **Article.** The centred claim read as prose. The tag is the title and the text is the standfirst. Each argument is headed by its grounds' tags, and warrants are grouped under a single *assumes*. It shows up to three shortest routes from the thesis rather than one fake breadcrumb. Where nothing argues for a claim, the page says so.

None of the surfaces render ids, schemes, submission status, or depth. Depth is inferential distance, not importance; what people lead with in a real argument is usually evidence, which sits far downstream of what it supports.

---

## Building

```
npm install
npm run build                    # viz
tsc -p tsconfig.json             # typecheck
tsc -p tsconfig.node.json        # CLI: src/index.ts, src/loader.ts, src/print.ts
```

`viz.html` and the checked-in `dist/` bundle are stale. Ignore them.

---

## Corpora

- **free-transit**: "Fares should be removed from public transit." The stress-test corpus and the source of most worked examples.
- **freedman**: US–Iran ceasefire, from a single op-ed.
- **gaza**: Bartov vs. Stephens on whether Israel's military campaign in Gaza constitutes genocide. A paired two-source extraction, and the reference case for the schema migration.

---

## Documentation

- `SESSION_FEED.md` holds the schema and every settled decision. Start here.
- `DESIGN_HISTORY.md` and its addenda record why decisions were made, the worked examples, rejected alternatives, and open research directions. Read these before reinventing something that was already tried and discarded.

The docs follow a few rules:

- They record decisions, not facts. Counts, enum members, and invariant lists come from code and corpora, because every transcription is a copy that rots.
- They name tokens, not values: `STANCE_DIVIDED`, not a colour triple.
- Implementation passes don't edit the canonical docs. They emit a supersede block to paste back.
- Audits classify each mismatch between doc and code as doc stale, code drifted, or code deciding something the doc never covered. They report it rather than reconciling it.

---

## State

**Built:** the schema, the validator, the store, writer, and guard, all three surfaces, and the ingestion role.

**Not built yet:**

- the interactive gatekeeper for human contributors
- warrant surfacing, review, and coreference roles
- the local service the viz will become a client of

**Open problems:**

- Showing contested state without implying a verdict.
- Temporal claims.
- Cross-space inference links.
- User identity and commitments. This is the one that matters most. Prasanga traversal, showing someone the consequences of the claims they actually hold, is the point of the system, and it can't run without knowing who holds what.

---

## Prior art

The claim/inference split independently converges on AIF's I-node/S-node architecture, and ASPIC+'s rebut/undermine distinction falls out of what a contesting inference targets. Prosequence doesn't depend on either. What neither covers is the territory this project is about: traversal over agent commitments, terminal values as culturally neutral bedrock, definitions constituting discourse spaces, and an LLM gatekeeper that asks rather than rules.