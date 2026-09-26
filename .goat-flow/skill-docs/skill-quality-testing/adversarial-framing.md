---
goat-flow-reference-version: "1.17.0"
---
# Adversarial Framing (review-class skills)

Patterns specific to authoring or hardening review-class skills - goat-review, goat-critique, goat-qa. Covers a neutral-skeptical role prompt, the zero-finding coverage rule, parallel reviewer information asymmetry, and an optional structured finding schema for explicit machine-readable consumers.

Companion files in this pack:
- `tdd-iteration.md` - core TDD methodology (load first when authoring any skill)
- `deployment.md` - skip-testing rationalisations, deployment checklist, STOP rule

Load this file when authoring or hardening a review-class skill, or any skill whose job is to find problems in other artefacts.

> **Illustrative examples - input/output shape only; never evidence.** Replace roles, coverage examples, and schema values with current task facts.

## Review-class control handling

Start with the generic fixture and scoring rules in `tdd-iteration.md`. Add at least one compliant review control whose expected no-op is no finding or recommendation. Use this file's adversarial roles only when the risk warrants combined pressures; review-class suspicion does not justify blanket reporting.

## Setting the reviewer role

For skills that critique or review artefacts, set the role directly:

> You are a skeptical, neutral reviewer. Do not assume defects or cleanliness. Test each claim against the applicable authority, look for missing coverage as well as incorrect content, and report only evidence-supported findings. Use a precise, professional tone.

The role directs attention to falsification without seeding a finding quota or a conclusion. Skepticism applies equally to suspected defects and suspected correctness.

## Zero-finding coverage rule

Zero findings are valid when a coverage ledger names the inspected surfaces, checks performed, controls sampled, and unresolved gaps. Do not re-run analysis merely to produce a finding. If the ledger is incomplete, finish the missing coverage or ask for the evidence needed; never fabricate a defect to satisfy a quota.

This guard prevents both silent rubber-stamping and motivated fault-finding: the conclusion follows the recorded coverage.

## Semantic assessment anti-bias

Score against explicit criteria, avoid halo effects, and read the whole assessed scope before scoring. Do not inflate or deflate a score to match a desired conclusion. Record uncertainty and unassessed surfaces; every deduction still needs file + semantic-anchor evidence.

## Parallel reviewer pattern (for high-stakes artefacts)

Deliberate information asymmetry catches more than redundant full-context reviews. Three reviewers, three context levels:

| Reviewer | Context given | Method | Catches |
|----------|---------------|--------|---------|
| **Blind Reviewer** | diff only - no spec, no project access | Neutral-skeptical review | Contract mismatches, naming smells, surface bugs, missing-context questions |
| **Edge Case Hunter** | diff + project read access | Mechanical path enumeration - walk every branch | Unhandled boundaries, null paths, integer overflow, race windows, timeout gaps |
| **Acceptance Auditor** | diff + spec + context docs | Spec-vs-diff correspondence check | AC violations, spec-intent deviations, missing behaviour, contradictions |

**Critical rule:** the three must **not** share context. Asymmetry is the design principle - if all three see the same material, their outputs collapse to the same finding set.

Subagent failure handling: if any reviewer fails / times out / returns empty, append the layer name to a `failed_layers` list and proceed with the remaining layers. Partial coverage is surfaced in the Review Integrity section.

goat-critique's Agent C (Fresh Eyes, artefact + rubric only) implements the Blind Reviewer role.

## Structured finding schema

Use this optional schema only when a real downstream consumer requires machine-readable findings (for example, an audit pipeline or PR bot):

```json
{
  "location": "file + semantic anchor",
  "trigger_condition": "one-line description (max 15 words)",
  "guard_snippet": "minimal code sketch that closes the gap (single-line, escaped)",
  "potential_consequence": "what could actually go wrong (max 15 words)"
}
```

Rules:
- Return ONLY a valid JSON array. No prose, no markdown wrapping.
- Empty array `[]` is valid when no unhandled paths are found.
- Each object must contain exactly these four fields and nothing else.

## Cross-references

| Where | What |
|-------|------|
| `/goat-review` skill | Coverage and explicit-justification guard in the review workflow |
| `/goat-critique` skill | Agent C fresh-eyes - parallel reviewer info asymmetry in the wild |
| `/goat-qa` skill | Human-readable gap tables; not an implementation of the optional JSON schema |
