# CODE_FACTS

Verbatim extraction. No analysis, comparison, or recommendation.

---

## 1. `src/types.ts` — interfaces, types, enums, unions (in full)

### Branded IDs

`src/types.ts:19`
```ts
type Brand<T, B extends string> = T & { readonly __brand: B };
```

`src/types.ts:21-23`
```ts
export type ClaimId = Brand<string, "ClaimId">;
export type InferenceId = Brand<string, "InferenceId">;
export type DiscourseSpaceId = Brand<string, "DiscourseSpaceId">;
```

### Enums / unions

`src/types.ts:27-35`
```ts
export type ArgumentScheme =
    | "FromExample"
    | "FromGeneralization"
    | "FromAnalogy"
    | "FromAuthority"
    | "FromConsequence"
    | "FromSign"
    | "FromCause"
    | "FromDefinition";
```

`src/types.ts:37-41`
```ts
export type SubmissionStatus =
    | "Pending"
    | "Interrogating"
    | "Rejected"
    | "Accepted";
```

`src/types.ts:45-50`
```ts
export type GroundsSource =
    | { type: "Citation"; reference: string }
    | { type: "SelfEvident" }
    | { type: "CommonKnowledge" }
    | { type: "LogicalNecessity" }
    | { type: "None" };
```

### `Attribution` (interface — carried by `Claim`)

`src/types.ts:58-61`
```ts
export interface Attribution {
    source: GroundsSource;
    quote: string | null;
}
```

### `Claim` (interface)

`src/types.ts:70-87`
```ts
export interface Claim {
    id: ClaimId;
    tag: string;
    text: string;

    /**
     * True: bedrock value commitment. The gatekeeper must reject any
     * inference concluding a terminal claim. Distinguishes "cannot be
     * supported within this space" from "not yet supported" (GAP 6).
     */
    terminal: boolean;

    /** Present iff the claim is attributive. */
    attribution?: Attribution;

    uncertain: boolean;
    submissionStatus: SubmissionStatus;
}
```

### `Inference` (`InferenceBase` interface + `Inference` union type)

`src/types.ts:110-118`
```ts
interface InferenceBase {
    id: InferenceId;
    scheme: ArgumentScheme | null;
    uncertain: boolean;
    submissionStatus: SubmissionStatus;

    grounds: ClaimId[];   // 1..*
    warrants: ClaimId[];  // 0..* — empty means implicit, not yet surfaced
}
```

`src/types.ts:121-125`
```ts
export type Inference = InferenceBase &
    (
        | { concludes: ClaimId; contests?: never }
        | { contests: ClaimId; concludes?: never }
        );
```

### `Definition` (interface)

`src/types.ts:129-133`
```ts
export interface Definition {
    term: string;
    text: string;
    importedFrom: DiscourseSpaceId | null;
}
```

### `DiscourseSpace` (interface)

`src/types.ts:140-147`
```ts
export interface DiscourseSpace {
    id: DiscourseSpaceId;
    title: string;
    definitions: Definition[];
    roots: ClaimId[];
    claims: Claim[];
    inferences: Inference[];
}
```

---

## 2. `validate.py` — invariants (one line each)

- `I1` — `validate.py:46-49`: inference has exactly one output — flags when `(concludes?1:0)+(contests?1:0) != 1`.
- `I2` — `validate.py:63-65`: no inference concludes a claim whose `terminal` is true.
- `I3` — `validate.py:52-61,89-92`: every referenced id resolves — grounds→claim, warrant→claim, concludes→claim, contests→claim-or-inference, and each root→claim.
- `I4` — `validate.py:67-69`: `grounds` is non-empty (zero grounds fails).
- `I5` — `validate.py:71-73` (soft; warning only, does not affect exit): a concluded claim should not be attributive (`attribution` is not None).
- `I6` — `validate.py:94-124`: the Concludes graph (grounds/warrants→inference→concludes; contests edges excluded) is acyclic, via DFS grey back-edge detection.
- `I7` — `validate.py:77-81`: terminal claims appear only in warrants — not used as grounds, not used as a `contests` target.
- `I8` — `validate.py:86-87`: a `contests` target is not an inference (attacks may only target claims).

Docstring `validate.py:4-11`: enforces I1–I8; I5 is soft (reported, does not affect exit status); non-zero exit if any hard invariant is violated.

---

## 3. Per corpus file

Counts from parsing each YAML (`claims` / `inferences` arrays; terminal = claims with `terminal: true`; note = inference key `note` that is non-null and non-empty).

| File | Claims | Inferences | Terminals | Inferences w/ non-null non-empty note |
|------|-------:|-----------:|----------:|--------------------------------------:|
| `discourse-spaces/free-transit.v2.yaml` | 102 | 68 | 2 | 0 |
| `discourse-spaces/freedman.v2.yaml` | 49 | 31 | 4 | 0 |
| `discourse-spaces/gaza.v2.yaml` | 81 | 59 | 4 | 0 |

Note field: no `note` (or `jnote`) key is present on any inference in any of the three corpora (`grep -c "note:"` / `"jnote"` = 0 in each; parse finds no note-like key on any inference object). Note count is therefore 0 for every file.

---

## 4. Repo state

### Graph view — EXISTS, builds
- Files: `src/viz/components/Graph.tsx`, `src/viz/graphData.ts` (with `src/viz/App.tsx`, `src/viz/layout.ts`).
- Build: `tsc -p tsconfig.json` (includes `src/viz`) → exit 0. `vite build` → success (610 modules transformed, built in ~4s).

### Focus view — EXISTS, builds
- Files: `src/viz/focus/FocusView.tsx`, `src/viz/focus/Cell.tsx`, `src/viz/focus/focusData.ts`, `src/viz/focus/primitives.tsx`.
- Build: covered by the same `tsc -p tsconfig.json` (exit 0) and `vite build` (success).

### Validator — EXISTS, builds/runs
- `validate.py` (Python): runs. `python3 validate.py` → all three corpora `PASS I1 I2 I3 I4 I6 I7 I8` (I5 soft).
- `scripts/validate.ts` (TypeScript, run via ts-node — `npm run validate`): runs. With explicit file-path args, all three corpora report `✓ PASS — no invariant violations (1–4, 6)` plus GAP-6 warnings (free-transit 34, freedman 4, gaza 5). Requires explicit paths; does not glob-expand.

### Navigation module — NO standalone module file
- No dedicated navigation module exists in `src/` (no file named nav/navigation; `src/viz/hooks/` contains only `useDiscourseData.ts`).
- Navigation is implemented inline: `navigate` useCallback at `src/viz/App.tsx:119`, threaded to `FocusView` at `src/viz/App.tsx:195`; referenced in `src/viz/focus/FocusView.tsx` and `src/viz/focus/primitives.tsx`. Builds as part of the app (`tsc -p tsconfig.json` exit 0; `vite build` success).

### Doc files in repo
- `Design.md`
- `DirectiveV2.md`
- `FOCUS_VIEW_AUDIT.md`
- `FOCUS_VIEW_SPEC.md`
- `NOTE_TRIAGE.md`
- (No README.)

### Build/run commands and outcomes
- `npm run build` (`vite build`) → success.
- `tsc -p tsconfig.json` (app: `src/viz`, `src/config.ts`, `src/types.ts`, `vite.config.ts`) → exit 0.
- `tsc -p tsconfig.node.json` (CLI: `src/index.ts`, `src/loader.ts`, `src/print.ts`, `src/types.ts`) → exit 0.
- `python3 validate.py` → runs, PASS on all corpora.
- `npm run validate` (`scripts/validate.ts` via ts-node) → runs, PASS (1–4, 6) on all corpora.
- Node v24.15.0; `node_modules` present.
