# Prosequence

DAG-based argument mapping. Two node types (Claim, Inference), four
edge roles (Grounds, Warrants, Concludes, Contests).

## Scope

Your scope is the visualization app, the build, validate.py, and
Design.md.

The model is not yours to change. src/types.ts and
discourse-spaces/*.v2.yaml are edited only on explicit instruction —
never as a side effect of another task, never to make something
build or pass. If a task appears to require a model change, stop and
report what change is needed and why.

validate.py is yours to maintain. When the model changes on
instruction, update the invariants to match in the same task.
Invariants are errors unless explicitly marked warnings.

## Build and check

npm run build                   # vite
tsc -p tsconfig.json            # app: src/viz, src/config.ts, src/types.ts
tsc -p tsconfig.node.json       # CLI: src/index.ts, src/loader.ts, src/print.ts
python3 -m prosequence.core.validate  # all three corpora, invariants I1-I8
python3 -m prosequence.tests          # all suites (1d store/session, 1e guard, role protocol)

## Layout

documents/          design docs and other non-executable artifacts. Ignore archive directory entirely!
src/viz/            graph view, focus view, shared indices
src/types.ts        canonical schema (change only on instruction)
discourse-spaces/   <slug>.v2.yaml corpora (change only on instruction)
prosequence/           all Python: core/ (model, session, store, validate, guard), roles/ (role protocol), scripts/
prosequence/core/validate.py   invariants
logs/               runtime token log (gitignored, auto-created)

## Documentation

SESSION_FEED.md is the canonical record of settled design decisions.
Never edit it. If implementation requires changing a decision it
states, stop and report.

Read before implementing:
Always            Entity Model, Enums
Viz work          also Views
Validator work    also Key Settled Decisions

Design.md describes what the code does — modules, data flow, where
things live. Keep it accurate. It holds no rationale and no
decisions, and has no authority over SESSION_FEED. Never resolve a
disagreement between them by editing either file. Report it.

When a decision gets made during implementation that SESSION_FEED
does not cover, report it explicitly at the end of the task. Do not
file it in Design.md and consider it recorded.

Code is authoritative for facts — counts, types, invariants. Never
transcribe those into SESSION_FEED.

Directives (FOCUS_VIEW_SPEC.md, DirectiveV2.md, and similar) are
one-way. Execute, then delete. Never update one to match what was
built.