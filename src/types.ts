// types.ts — canonical schema, claim/inference model (v2)
//
// Two node types: Claim, Inference.
// Four edge roles: Grounds, Warrants, Concludes, Contests.
// Composition rule: AND within an inference (all grounds and warrants
// jointly required), OR across inferences (any inference concluding a
// claim independently supports it).
//
// Roles are positional. "Proposition", "terminal", "warrant", "grounds",
// "attack" are not node types — they are positions a claim or inference
// occupies in the graph, with two exceptions encoded as data:
//   - Claim.terminal: a commitment that the claim is bedrock (may never
//     be concluded), as opposed to merely not-yet-supported.
//   - DiscourseSpace.roots: claims currently designated as contested
//     questions (views are rooted here; their grounds are bracketed).

// ---------- Branded IDs ----------

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ClaimId = Brand<string, "ClaimId">;
export type InferenceId = Brand<string, "InferenceId">;
export type DiscourseSpaceId = Brand<string, "DiscourseSpaceId">;

// ---------- Enums ----------

export type ArgumentScheme =
    | "FromExample"
    | "FromGeneralization"
    | "FromAnalogy"
    | "FromAuthority"
    | "FromConsequence"
    | "FromSign"
    | "FromCause"
    | "FromDefinition";

export type SubmissionStatus =
    | "Pending"
    | "Interrogating"
    | "Rejected"
    | "Accepted";

// ---------- Attribution (for claims that report what a source says) ----------

export type GroundsSource =
    | { type: "Citation"; reference: string }
    | { type: "SelfEvident" }
    | { type: "CommonKnowledge" }
    | { type: "LogicalNecessity" }
    | { type: "None" };

/**
 * Present on claims whose text is attributive ("Source X reports Y").
 * Such claims are the empirical leaves of the graph: they bottom out by
 * checkability against the cited source, not by a terminal flag.
 * `quote` is verbatim provenance, captured at extraction time.
 */
export interface Attribution {
    source: GroundsSource;
    quote: string | null;
}

// ---------- Nodes ----------

/**
 * The only content-bearing node. One node per distinct claim; multiple
 * people asserting the same claim on different evidence share this node
 * and contribute separate inferences concluding it.
 */
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

/**
 * A single inferential act. Carries no content — it binds specific
 * grounds-claims and warrant-claims to exactly one output.
 *
 * Output is exactly one of:
 *   - concludes: this inference derives the target claim
 *   - contests: this inference attacks the target claim
 *       attributive target = undermine; any other target = rebut
 *
 * Attacks always target a claim. An attack on an inferential step
 * ("that doesn't follow") is not representable, and is not meant to be:
 * the gatekeeper enthymemifies it — surfaces the suppressed warrant the
 * attack denies, adds that warrant to the target inference's `warrants`,
 * and the attack becomes an ordinary rebut of that claim. This is how
 * applicability attacks against terminal warrants are handled (former
 * GAP 1): the terminal stays bedrock, and the surfaced applicability or
 * consistency claim beside it is what gets contested.
 *
 * Multiple warrants on one inference are conjoint (all required).
 * Alternative warrants are alternative inferences.
 */
interface InferenceBase {
    id: InferenceId;
    scheme: ArgumentScheme | null;
    uncertain: boolean;
    submissionStatus: SubmissionStatus;

    grounds: ClaimId[];   // 1..*
    warrants: ClaimId[];  // 0..* — empty means implicit, not yet surfaced

    /**
     * Free-text authoring note. Not semantic, not attackable, not rendered
     * as argument content. If it states an assumption the inference needs
     * in order to hold, it belongs in `warrants` instead.
     */
    note: string | null;
}

/** Output arity (exactly one of concludes/contests) is type-enforced. */
export type Inference = InferenceBase &
    (
        | { concludes: ClaimId; contests?: never }
        | { contests: ClaimId; concludes?: never }
        );

// ---------- Discourse space ----------

export interface Definition {
    term: string;
    text: string;
    importedFrom: DiscourseSpaceId | null;
}

/**
 * Constituted by its definition layer. Propositions are not owned
 * structure — `roots` designates which claims are currently treated as
 * contested questions (entry points for views and traversal).
 */
export interface DiscourseSpace {
    id: DiscourseSpaceId;
    title: string;
    definitions: Definition[];
    roots: ClaimId[];
    claims: Claim[];
    inferences: Inference[];
}

// ---------- Structural invariants ----------
//
// I1. Inference has exactly one of {concludes, contests}.  [type-enforced]
// I2. No inference concludes a claim with terminal: true.
// I3. All ClaimId / InferenceId references resolve within the space.
// I4. grounds is non-empty.
// I5. Attributive claims (attribution present) should not be concluded by
//     any inference — they are checkable leaves. (Soft invariant; a claim
//     can migrate from contested to attributive as a debate settles.)
// I6. The graph of Concludes edges is acyclic.
// I7. Terminal claims appear only in `warrants` — never in `grounds`,
//     never as a `contests` target.
// I8. No `contests` target is an InferenceId.  [type-enforced]
//
// I1 and I8 are compile errors in TypeScript. They still require runtime
// assertions in validate.py, which reads YAML and has no compiler.