# Argument Framework: Core Design Principles

## 1. The goal is completeness, not adjudication

The framework does not determine whether arguments are correct or which side wins. It ensures that all reasonable arguments have been made, all implicit assumptions have been surfaced, and all warranted challenges have been lodged. The graph is successful when it is dialectically saturated — every argument that could reasonably be made has been made, and every warrant that could reasonably be challenged has been challenged.

## 2. The atomic unit is the argument

An argument consists of: a claim (the assertable conclusion) and grounds (the attributed factual basis). The bridging assumptions that make the grounds count as evidence for the claim — warrants — are themselves argument nodes connected via Warrants edges. All elements must be explicit before an argument enters the graph.

When making an argument, a participant must state: (a) what they believe — the claim; (b) why they believe it — the grounds; and (c) the assumptions that make b imply a — warrant argument nodes. Warrants are not sub-fields of an argument; they are first-class argument nodes in the graph, distinguishable from support and attack relationships by the Warrants edge type.

## 3. Warrants are the primary site of logical vulnerability

All meaningful logical challenge ultimately targets a warrant — either an explicit one or an implied one that must be made explicit before it can be attacked. Grounds are factual claims attributed to a source. Claims are conclusions that follow or don't follow from their grounds via their warrants.

Warrant argument nodes are connected to the arguments they bridge via Warrants edges. This is a distinct edge type from Support and Attack — it expresses that the warrant is constitutive of the inference, not merely additional evidence for it. Without the warrant the inference collapses; without a support edge the claim is merely less well supported.

What appears to be a grounds attack is always an attack on an implied warrant — either a source-credibility warrant ("this source is reliable") or an attribution-accuracy warrant ("this source actually reported this"). These implied warrants must be surfaced as explicit argument nodes before they can be attacked.

## 4. Grounds must be attributive

Grounds are always attributed to a source. They take the form "source X reports/shows/found Y" rather than asserting facts directly. The source type determines the form of the implicit source-credibility warrant:

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

Every inferential chain eventually bottoms out in a terminal value node — a bedrock commitment that cannot be further justified empirically within this discourse space. Terminal nodes are stated as plain value assertions (e.g. "highest utility is highest justice") without reference to named philosophical frameworks, preserving cultural neutrality.

Terminal nodes cannot be supported by further argument within the discourse space. They can be made explicit, compared, and acknowledged as the source of genuine value disagreement. Two participants who follow their inferential chains all the way down and find incompatible terminal nodes have located the actual source of their disagreement.

## 10. The framework represents both inferential and dialectical structure in a unified graph

The inferential structure captures how individual arguments are constructed — how grounds connect to claims via warrant argument nodes (Warrants edges). The dialectical structure captures how arguments relate to each other — Attack and Support edges. These are logically distinct concerns but are represented in a unified graph rather than separate layers, using three edge types: Warrants, Support, and Attack.

Dialectical attacks are arguments in their own right — they have claims, grounds, and their own warrant nodes. The framework does not assume or require synthesis. Genuine value disagreements are represented as incompatible terminal nodes, not as problems to be resolved. Most real arguments do not produce synthesis — they clarify where disagreement actually lives.

## 11. Depth is inferential distance, not importance

A node's depth in the graph measures how many inferential steps it is from the root proposition. This is not a measure of argumentative salience, rhetorical power, or relevance to the debate. Commonly cited arguments may sit deep in the graph because they are evidential rather than directly normative. The graph reveals that what people lead with in natural argument is usually evidence — which is structurally downstream, not upstream, of the claims that evidence supports.

---

## Summary: What the framework is and is not

**It is:** A tool for mapping the complete logical structure of a debate, making implicit assumptions explicit, and revealing where genuine disagreement lives.

**It is not:** A debate judge, a fact-checker, a political position, or a guarantee of resolution.

**The core question it asks of every participant:** What would you have to believe in order to believe this? Following that question all the way down is the work the framework is designed to support.