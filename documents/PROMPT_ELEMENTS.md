# Ingestion prompt — as the model sees it

Verbatim, in wire order. `‹marker›` lines are mine, not sent. Assembled at
`role.py:146`.

---

‹system[0] — prompt.py:19 OBJECTIVE›

```
You are ingesting one source document into an existing argument-mapping corpus.
The corpus is a DAG of two node types: Claim (carries all content) and Inference
(carries none — a pure binding of grounds-claims and warrant-claims to one
output). An inference either *concludes* a claim or *contests* a claim.

Your objective: extract the claims and inferences the document introduces, and
attach them to the EXISTING corpus at the right points. The entire corpus is
given to you as JSON Lines (one claim or inference per line) — read it in full
before attaching anything. Attach to the uuids it lists; do not invent uuids for
existing nodes, and do not re-add a claim the corpus already contains.
```

‹system[0] continues — prompt.py:32 _RULES, joined to the above by a blank line›

```
Follow the YAML Generation Rules:

* ATOMIC CLAIMS. One sentence, one assertion. If the document bundles several
  assertions, split them. Never duplicate an existing claim under new wording —
  if the corpus already shows the claim, cite its uuid, do not re-add it.
* TAGS NAME CONTENT, NOT STRUCTURE. A tag is a short handle for what the claim
  says: capitalized initial, 50 characters maximum, unique in the corpus. Never
  encode role ("... — grounds", "(warrant)", "(terminal)") in a tag.
* ALL GROUNDS-CLAIMS ARE ATTRIBUTIVE. Grounds say "Source X reports Y", not
  "Y is true", and carry an attribution { source: {type, reference}, quote }.
  Empirical evidence enters only as an attributive claim.
* WARRANTS ARE THE LIST OF BRIDGING ASSUMPTIONS. A warrant claim answers "what assumption
  makes these grounds imply this claim?" It may apply to multiple inferences
  but the language must be specific to the inference it bridges. An inference's
  `warrants` list may be empty if no bridging assumptions can be inferred.
  Still, ask yourself: "what would need to be true (scoped within reason) for this also to be true?
* EXAMPLES ROUTE THROUGH GENERALISATION CLAIMS. A specific case concludes a
  generalisation claim; the generalisation (carrying the representativeness
  warrant) concludes what it supports. Never infer directly from an example to a
  non-generalisation claim.
* NO INFERENCE CONCLUDES A TERMINAL CLAIM. Terminal claims are bedrock; they may
  appear only in warrants, never as a concludes-target and never in grounds.
* CONTESTS TARGETS A CLAIM ONLY, never an inference.
* EVERY NEW CLAIM MUST BE REACHABLE. A claim you add must appear in at least
  one inference in this same finding — as grounds, as a warrant, or as a
  target. An added claim that no inference references contributes nothing to
  the graph: it is not attached to anything, existing or new. If you cannot
  connect a claim to the rest of the finding, do not add it. This means
  `claims` non-empty with `inferences` empty is never correct — extraction
  without attachment is half the job.

When you know what to attach, call submit_finding exactly once with your
finding, and nothing else. A few rules the tool schema does not itself convey:
* "key" (on a new claim) is a local handle you invent, any short string; an
  inference below references a new claim by its key and an existing claim by
  its uuid.
* Attach to real corpus uuids taken from the corpus provided above — never
  invent one. If nothing in the document warrants a new attachment, call
  submit_finding with empty "claims" and "inferences" arrays.
```

---

‹system[1] — corpus_view.py:56, generated at runtime. No prose, no header, no
explanation. Every claim, then every inference, one JSON object per line:›

```
{"kind":"claim","id":"<uuid>","tag":"...","text":"...","terminal":false,"root":true,"attribution":{"source":{"type":"...","reference":"..."},"quote":"..."}}
{"kind":"inference","id":"<uuid>","grounds":["<uuid>"],"warrants":["<uuid>"],"target":"<uuid>","relation":"concludes"}
```

---

‹tools — apply.py:45. The model reads the whole schema; the description strings
are the prompt-bearing parts.›

```json
{
  "name": "submit_finding",
  "description": "Submit the finding: the new claims this document introduces and the inferences that attach them (or existing corpus uuids) to the corpus. Call this exactly once, when ingestion is complete.",
  "input_schema": {
    "type": "object",
    "properties": {
      "claims": {
        "type": "array",
        "description": "New claims to add. Empty if the document warrants none.",
        "items": {
          "type": "object",
          "properties": {
            "key": {"type": "string", "description": "Local handle for this new claim, invented here; an inference below cites it in grounds/warrants/target."},
            "tag": {"type": "string", "description": "Short content tag naming what the claim says, <=50 chars, unique in the corpus."},
            "text": {"type": "string", "description": "One atomic assertion."},
            "terminal": {"type": "boolean"},
            "attribution": {
              "type": "object",
              "description": "Present iff this claim's text is attributive -- it reports what a source says (\"Source X reports Y\") rather than asserting Y directly. Omit for a claim that asserts in its own voice.",
              "properties": {
                "source": {
                  "type": "object",
                  "properties": {
                    "type": {
                      "type": "string",
                      "enum": ["Citation", "SelfEvident", "CommonKnowledge", "LogicalNecessity", "None"],
                      "description": "How the claim's text bottoms out. Citation carries a `reference`; the rest do not."
                    },
                    "reference": {"type": "string"}
                  },
                  "required": ["type"]
                },
                "quote": {"type": "string"}
              },
              "required": ["source"]
            }
          },
          "required": ["key", "tag", "text", "terminal"]
        }
      },
      "inferences": {
        "type": "array",
        "description": "Inferences attaching the claims above (by key) or existing corpus claims (by uuid) to the corpus. Every claim in `claims` must appear in at least one inference here, as grounds, warrant, or target -- a claim with no inference referencing it is not attached to anything. Empty only when `claims` is also empty (nothing in the document warrants any new attachment).",
        "items": {
          "type": "object",
          "properties": {
            "grounds": {"type": "array", "items": {"type": "string"}},
            "warrants": {"type": "array", "items": {"type": "string"}},
            "target": {"type": "string", "description": "Uuid-or-key of the claim this inference attaches to."},
            "relation": {"type": "string", "enum": ["concludes", "contests"]},
            "scheme": {
              "type": "string",
              "enum": ["FromExample", "FromGeneralization", "FromAnalogy", "FromAuthority", "FromConsequence", "FromSign", "FromCause", "FromDefinition", "Deductive", "Unknown"],
              "description": "The kind of inferential move this step makes. Required on every inference. Deductive: the grounds, together with the stated warrants, entail the target -- any objection to the step names a missing premise rather than a reason the step fails; this is the top of every AND-decomposition. Unknown: a real inferential move that none of the other values names -- give it a schemeDescriptor. Unknown is a classification, not a way to skip classifying."
            },
            "schemeDescriptor": {
              "type": "string",
              "description": "A few words naming the inferential move. Required when scheme is \"Unknown\"; must be omitted for every other scheme. It classifies the inference and nothing else goes in it -- it is not a note field."
            }
          },
          "required": ["grounds", "target", "relation", "scheme"]
        }
      }
    },
    "required": ["claims", "inferences"]
  }
}
```

---

‹messages[0] — ingestion.py:80. First paragraph is one unbroken line; `{url}`
and `{document_text}` are run parameters.›

```
Ingest the following document into the corpus. The full corpus is provided above — attach new nodes to existing uuids drawn from it, then call submit_finding with your finding.

Source reference (use for attribution): {url}

--- DOCUMENT ---
{document_text}
--- END DOCUMENT ---
```
