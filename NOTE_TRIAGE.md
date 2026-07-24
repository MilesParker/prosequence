# Note triage

Read-only dump for `note`-field triage. Nothing in the corpora, schema, or code
was changed to produce this. Sources:
`discourse-spaces/freedman.v2.yaml`, `discourse-spaces/gaza.v2.yaml`,
`discourse-spaces/free-transit.v2.yaml`.

---

## Part 1 — Five inferences, in full

For each: the inference node **verbatim** (exact source lines), then the `text`
of every `grounds` claim, every `warrants` claim, and the `concludes`/`contests`
target.

### 1. `i-obama-attacks-deal` — freedman.v2.yaml (lines 762–772)

```yaml
  - id: i-obama-attacks-deal
    scheme: null
    uncertain: false
    submissionStatus: Accepted
    grounds:
      - c-obama-double-standard
    warrants: []
    note: >-
      The double-standard attack undermines the pro warrant by showing the evaluation is not
      principled.
    contests: c-deal-ended-economic-harm
```

- **grounds** — `c-obama-double-standard`:
  "The deal's terms are worse than what the same actors condemned as unacceptable under Obama, so partisan praise carries no evidentiary weight."
- **warrants** — *(none; `warrants: []`)*
- **contests target** — `c-deal-ended-economic-harm`:
  "The deal serves US interests by ending a war that was driving inflation and energy price increases."

### 2. `i-few-statements-attacks-statements-evidence` — gaza.v2.yaml (lines 1426–1436)

```yaml
  - id: i-few-statements-attacks-statements-evidence
    scheme: null
    uncertain: false
    submissionStatus: Accepted
    grounds:
      - c-few-statements-vs-systematic-policy
    warrants: []
    note: >-
      Stephens concedes the statements were made; what he contests is the warrant that rhetorical
      statements in the heat of conflict constitute evidence of state policy intent.
    contests: c-statements-evidence-intent
```

- **grounds** — `c-few-statements-vs-systematic-policy`:
  "Inflammatory statements by individual officials do not constitute evidence of a systematic state policy of genocide; the relevant question is official policy, not rhetorical excess in the heat of conflict."
- **warrants** — *(none; `warrants: []`)*
- **contests target** — `c-statements-evidence-intent`:
  "When senior political and military leaders publicly articulate objectives that match the legal definition of genocidal intent, those statements constitute evidence of specific intent, not mere rhetorical excess."

### 3. `i-death-toll-attacks-pattern` — gaza.v2.yaml (lines 1476–1486)

```yaml
  - id: i-death-toll-attacks-pattern
    scheme: null
    uncertain: false
    submissionStatus: Accepted
    grounds:
      - c-death-toll-inconsistent-genocide
    warrants: []
    note: >-
      Both arguments read intent from scale; Stephens's counter is that the relevant scale is
      killing rate (too low for genocide), not infrastructure destruction rate.
    contests: c-pattern-of-ops-genocidal
```

- **grounds** — `c-death-toll-inconsistent-genocide`:
  "The scale of Palestinian deaths is far below what a state with Israel's military capacity would produce if its intent were genuinely genocidal."
- **warrants** — *(none; `warrants: []`)*
- **contests target** — `c-pattern-of-ops-genocidal`:
  "The pattern of IDF operations — systematic destruction of housing, infrastructure, and civilian institutions across the entire Strip — is consistent with intent to make Palestinian life in Gaza non-reconstitutable."

### 4. `i-label-harmful-to-prop` — gaza.v2.yaml (lines 1414–1425)

```yaml
  - id: i-label-harmful-to-prop
    scheme: null
    uncertain: true
    submissionStatus: Accepted
    grounds:
      - c-promiscuous-genocide-label-harmful
    warrants:
      - c-legal-precision-matters
    note: >-
      Attacks the proposition by arguing the designation should not be applied here regardless of
      facts, because its promiscuous application is harmful.
    contests: c-gaza-campaign-is-genocide
```

- **grounds** — `c-promiscuous-genocide-label-harmful`:
  "Applying the genocide label outside its strict legal meaning dilutes its force and ultimately blinds the world to real genocides when they occur."
- **warrants** — `c-legal-precision-matters`:
  "Legal terms that carry grave moral weight must be applied with strict precision; promiscuous application destroys the protective function the term was designed to serve."
- **contests target** — `c-gaza-campaign-is-genocide`:
  "Israel's military campaign in Gaza constitutes genocide."

### 5. `i-sycophancy-supports-electoral` — freedman.v2.yaml (lines 753–761)

```yaml
  - id: i-sycophancy-supports-electoral
    scheme: null
    uncertain: false
    submissionStatus: Accepted
    grounds:
      - c-sycophancy-caused-miscalculation
    warrants: []
    note: Sycophancy explains structurally how electoral interests came to dominate strategic ones.
    concludes: c-electoral-not-strategic
```

- **grounds** — `c-sycophancy-caused-miscalculation`:
  "Trump and Netanyahu's purge of internal dissent caused the strategic miscalculation about Iran's likely response."
- **warrants** — *(none; `warrants: []`)*
- **concludes target** — `c-electoral-not-strategic`:
  "The deal was shaped by Trump's electoral interests, not US strategic interests."

---

## Part 2 — All 34 noted free-transit inferences

`inference id` · `note` (verbatim text) · `tag` of the `concludes`/`contests` target.
For notes stored as folded/wrapped YAML scalars, the text below is the parsed
(single-string) value.

| Inference id | Note (verbatim) | Target tag |
| --- | --- | --- |
| i-low-income-supports-root | Improving low-income mobility is an intrinsic reason to remove fares | Fares should be removed |
| i-emissions-supports-root | Emissions reduction is an intrinsic environmental reason to remove fares | Fares should be removed |
| i-congestion-supports-root | Congestion reduction benefits all road users and is an intrinsic reason to remove fares | Fares should be removed |
| i-labour-supports-root | Labour market access is an intrinsic economic reason to remove fares | Fares should be removed |
| i-boarding-supports-root | Faster boarding is a direct operational benefit of fare removal | Fares should be removed |
| i-collection-cost-supports-root | Unjustified collection costs are an economic reason to remove fares | Fares should be removed |
| i-collective-benefit-supports-root | Collective benefit justifies collective funding as an intrinsic reason | Fares should be removed |
| i-access-supports-root | Access as right is an intrinsic normative reason to remove fares | Fares should be removed |
| i-just-supports-root | Justice is an intrinsic normative reason to remove fares | Fares should be removed |
| i-service-degradation-attacks-root | Service degradation from revenue loss is a direct reason not to remove fares | Fares should be removed |
| i-user-pays-attacks-root | User pays as policy is a direct normative reason not to remove fares | Fares should be removed |
| i-targeted-subsidies-attacks-root | Better alternatives exist — targeted subsidies are more effective than universal removal | Fares should be removed |
| i-racial-justice-supports-low-income | Racial justice elaborates why low-income mobility gains matter | Low income mobility gains |
| i-racial-justice-supports-just | Racial justice provides a redistributive grounding for the justice claim | Fare-free transit is just |
| i-utility-analogy-supports-collective | The utility analogy provides analogical support for collective funding | Collective benefit justifies collective funding |
| i-driving-supports-inconsistency | Road cost socialisation is the concrete evidence for selective application | User pays applied inconsistently |
| i-service-quality-supports-wont-reach | Survey evidence that service quality matters more than fare supports the won't reach claim | Fare removal won't reach those who need it |
| i-rct-defence-supports-null-employment | RCT methodology superiority supports treating the null finding as the best evidence | Null employment effect |
| i-regressivity-attacks-just | Regressivity directly contests the justice claim | Fare-free transit is just |
| i-antisocial-local-supports-generalised | Local reports provide the evidential basis for the generalisation | Antisocial behaviour (generalised) |
| i-user-composition-supports-generalised | User composition shift provides a mechanistic explanation for the antisocial pattern | Antisocial behaviour (generalised) |
| i-high-farebox-attacks-collection-cost | Counterexample showing high recovery is possible undermines the collection cost argument | Collection cost not justified |
| i-plateau-attacks-ridership | Ridership gains are unsustained without service improvements, qualifying the ridership increase claim | Ridership increase |
| i-luxembourg-supports-many-examples | Luxembourg is one of the many successful implementations | Many examples of successful implementation |
| i-kansas-city-supports-many-examples | Kansas City is one of the many successful implementations | Many examples of successful implementation |
| i-boston-supports-many-examples | Boston is one of the many successful implementations | Many examples of successful implementation |
| i-many-examples-supports-ridership | Many successful examples provide empirical support for the ridership increase claim | Ridership increase |
| i-utility-fails-attacks-analogy | Private substitutes disanalogy directly undermines the utility comparison | Transit as public utility analogy |
| i-user-pays-policy-supports-targeted | User pays as policy provides normative grounding for preferring targeted over universal provision | Targeted subsidies more effective |
| i-user-pays-policy-supports-regressive | User pays as policy provides the distributional framework for the regressivity argument | Universal free transit is regressive |
| i-antisocial-generalised-attacks-root | Reliable antisocial behaviour increase is a direct reason not to remove fares | Fares should be removed |
| i-wont-reach-attacks-root | If fare removal doesn't reach those who need it, the primary equity justification fails | Fares should be removed |
| i-null-employment-attacks-root | Null employment effect undermines the labour market access and equity case for fare removal | Fares should be removed |
| i-ridership-grounds-service-degradation | Independent route to service degradation: the ridership gain is itself the cost driver. Distinct from the TransitCenter revenue-dependency evidence, and it concedes the Pro side's ridership claim rather than contesting it. | Service degradation from revenue loss |

*(34 rows.)*

---

## Part 3 — Final value

`i-iranian-politics-supports-deal` (freedman.v2.yaml, line 775): **`uncertain: true`**.
