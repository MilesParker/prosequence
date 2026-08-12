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
//   - DiscourseSpace.theses: claims currently designated as contested
//     questions (a view is anchored at one; its grounds are bracketed).
//     Spelled `roots` before the rename — the word collided with its
//     graph-theory sense, which a thesis is not: the graph may grow upward
//     past one, when a later document argues from it to something further.

// ---------- Branded IDs ----------

type Brand<T, B extends string> = T & { readonly __brand: B };

export type ClaimId = Brand<string, "ClaimId">;
export type InferenceId = Brand<string, "InferenceId">;
export type DiscourseSpaceId = Brand<string, "DiscourseSpaceId">;

// ---------- Enums ----------

/**
 * The kind of inferential move an inference makes. Required on every
 * inference — there is no "unclassified" state, only `Unknown`, which is a
 * classification.
 *
 *   - Deductive: the grounds, together with the stated warrants, entail the
 *     target. Any objection to the step names a missing premise rather than a
 *     reason the step fails. This is the top of every AND-decomposition.
 *   - Unknown: a real inferential move that none of the other values names.
 *     `schemeDescriptor` carries a few words naming the move.
 */
export type ArgumentScheme =
    | "FromExample"
    | "FromGeneralization"
    | "FromAnalogy"
    | "FromAuthority"
    | "FromConsequence"
    | "FromSign"
    | "FromCause"
    | "FromDefinition"
    | "Deductive"
    | "Unknown";

export type SubmissionStatus =
    | "Pending"
    | "Interrogating"
    | "Rejected"
    | "Accepted";

/**
 * How an inference relates to its single target claim.
 *   - concludes: the inference derives the target
 *   - contests: the inference attacks the target
 */
export type Relation = "concludes" | "contests";

// ---------- Attribution (for claims that report what a source says) ----------

/** The five discriminants of `GroundsSource`, named so the tool boundary can
 *  constrain `source.type` against the same closed set the union spells. */
export type GroundsSourceType =
    | "Citation"
    | "SelfEvident"
    | "CommonKnowledge"
    | "LogicalNecessity"
    | "None";

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
 * grounds-claims and warrant-claims to exactly one target claim.
 *
 * The target is a single claim; `relation` says how the inference bears
 * on it:
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
export interface Inference {
    id: InferenceId;

    /** Required. Every inference is classified; `Unknown` is a value, not a gap. */
    scheme: ArgumentScheme;

    /**
     * A few words naming the inferential move when `scheme` is `Unknown`.
     * It classifies the inference and nothing else goes in it — it is not a
     * note field. Non-null implies `scheme === "Unknown"` (I9); the converse
     * is not required, because migration produced `Unknown` with no
     * descriptor. New findings must supply one (enforced at the tool
     * boundary, not here).
     */
    schemeDescriptor: string | null;

    uncertain: boolean;
    submissionStatus: SubmissionStatus;

    grounds: ClaimId[];   // 1..*
    warrants: ClaimId[];  // 0..* — empty means implicit, not yet surfaced

    // Exactly one target claim, and how this inference bears on it. One
    // value carrying a role replaces the former concludes/contests pair,
    // which admitted two malformed states (both set, neither set).
    target: ClaimId;
    relation: Relation;
}

// ---------- Discourse space ----------

export interface Definition {
    term: string;
    text: string;
    importedFrom: DiscourseSpaceId | null;
}

/**
 * Constituted by its definition layer. Propositions are not owned
 * structure — `theses` designates which claims are currently treated as
 * contested questions (entry points for views and traversal).
 */
export interface DiscourseSpace {
    id: DiscourseSpaceId;
    title: string;
    definitions: Definition[];
    theses: ClaimId[];
    claims: Claim[];
    inferences: Inference[];
}

// ---------- Structural invariants ----------
//
// I1. Inference has a `target` and a `relation` in {concludes, contests}.
//     [target/relation both required — type-enforced]
// I2. No inference with relation "concludes" targets a terminal claim.
// I3. All ClaimId / InferenceId references resolve within the space.
// I4. grounds is non-empty.
// I5. Attributive claims (attribution present) should not be concluded by
//     any inference — they are checkable leaves. (Soft invariant; a claim
//     can migrate from contested to attributive as a debate settles.)
// I6. The graph of Concludes edges is acyclic.
// I7. Terminal claims appear only in `warrants` — never in `grounds`,
//     never as the target of a contesting inference.
// I8. A contesting inference's target is a ClaimId, never an InferenceId.
//     [type-enforced: target is ClaimId]
// I9. schemeDescriptor non-null implies scheme == "Unknown".
//     One-directional deliberately: `Unknown` with no descriptor is legal,
//     because migration produced exactly that. The reverse implication —
//     `Unknown` requires a descriptor — is enforced at the tool boundary
//     (submit_finding), not over the corpus.
// I10. scheme is present and is a member of ArgumentScheme.
//     [type-enforced: scheme is a required ArgumentScheme]
//
// I1, I8 and I10 are structurally enforced in TypeScript (target is a single
// required ClaimId, relation and scheme required enums). They still require
// runtime assertions in validate.py, which reads YAML and has no compiler.