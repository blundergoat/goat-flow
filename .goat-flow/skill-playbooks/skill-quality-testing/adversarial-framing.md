---
goat-flow-reference-version: "1.9.1"
---
# Adversarial Framing (review-class skills)

Patterns specific to authoring or hardening review-class skills - goat-review, goat-critique, goat-qa. Covers the cynical-reviewer role prompt, the zero-findings HALT rule, the parallel reviewer information-asymmetry pattern, and the structured finding schema that downstream tools consume.

Companion files in this pack:
- `tdd-iteration.md` - core TDD methodology (load first when authoring any skill)
- `deployment.md` - skip-testing rationalisations, deployment checklist, STOP rule

Load this file when authoring or hardening a review-class skill, or any skill whose job is to find problems in other artefacts.

## Setting the reviewer role

For skills that critique or review artefacts, set the role directly:

> You are a cynical reviewer with zero patience for sloppy work. The content was submitted by someone who may have cut corners and you expect to find problems. Be skeptical of everything. Look for what's missing, not just what's wrong. Use a precise, professional tone - no profanity or personal attacks.

The role primes adversarial attention on the artefact without slipping into personal attacks. "Someone who may have cut corners" carries the suspicion; the closing sentence caps the tone.

## Zero-findings HALT rule

**Zero findings without explicit justification is an error condition, not a clean bill of health - HALT and re-analyse or ask for guidance.** If thorough review legitimately surfaces nothing, state the coverage explicitly ("I checked boundary conditions, error paths, and integration points and found nothing") rather than approving silently. Quality beats quota - a fabricated tenth finding is worse than nine honest ones.

goat-review's zero-findings HALT rule comes from this pattern. The rule is deliberate friction against rubber-stamping; the quality-beats-quota clause is the anti-fabrication guardrail that sits next to it.

## Semantic assessment anti-bias

The Skills page **Assess in Runner** prompt now carries an explicit anti-bias preamble before semantic scoring. It tells the reviewer to score against absolute criteria, avoid halo effects, read the whole artifact before scoring, and round down when tempted toward leniency. Keep review-class skills aligned with that posture: semantic judgments are advisory, but each deduction still needs file + semantic-anchor evidence.

## Parallel reviewer pattern (for high-stakes artefacts)

Deliberate information asymmetry catches more than redundant full-context reviews. Three reviewers, three context levels:

| Reviewer | Context given | Method | Catches |
|----------|---------------|--------|---------|
| **Blind Hunter** | diff only - no spec, no project access | Adversarial / cynical reviewer | Contract mismatches, naming smells, surface bugs, cynical "what's missing" gaps |
| **Edge Case Hunter** | diff + project read access | Mechanical path enumeration - walk every branch | Unhandled boundaries, null paths, integer overflow, race windows, timeout gaps |
| **Acceptance Auditor** | diff + spec + context docs | Spec-vs-diff correspondence check | AC violations, spec-intent deviations, missing behaviour, contradictions |

**Critical rule:** the three must **not** share context. Asymmetry is the design principle - if all three see the same material, their outputs collapse to the same finding set.

Subagent failure handling: if any reviewer fails / times out / returns empty, append the layer name to a `failed_layers` list and proceed with the remaining layers. Partial coverage is surfaced in the Review Integrity section.

goat-critique's Agent C (Fresh Eyes, artefact + rubric only) IS the Blind Hunter role.

## Structured finding schema

When findings need downstream machine processing (audit pipelines, PR bots, goat-critique synthesis):

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
| `/goat-review` skill | Zero-findings HALT - adversarial pattern in the wild |
| `/goat-critique` skill | Agent C fresh-eyes - parallel reviewer info asymmetry in the wild |
| `/goat-qa` skill | Structured-finding shape for gap output |
