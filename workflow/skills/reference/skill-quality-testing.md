---
goat-flow-reference-version: "1.3.1"
---
# Skill Quality Testing

Read on full-depth skill-authoring work. Covers how to write, test, and harden a goat-flow skill so it holds up under pressure.

Companion to `skill-preamble.md` (what every skill loads on every invocation) and `skill-conventions.md` (entry formats, task tracking, recovery - loaded on full-depth work).

The authoring methodology is split across three topical files in the sibling `skill-quality-testing/` directory per ADR-023. Load only the file(s) relevant to the skill type you are authoring - agents should not read all three unless the task genuinely spans review-class work, deployment finalisation, and TDD iteration.

## Which file to load

| File | Content | Load when |
|------|---------|-----------|
| `skill-quality-testing/tdd-iteration.md` | The iron law, TDD loop (RED/GREEN/REFACTOR), pressure types, scenario design, rationalisation table, bulletproofing techniques, persuasion principles, meta-testing, dispatch protocol, iteration log, worked example, empirical grounding | Creating or hardening any skill. Load first. |
| `skill-quality-testing/adversarial-framing.md` | Cynical-reviewer role prompt, zero-findings HALT rule, parallel reviewer pattern, structured finding schema | Authoring or hardening a review-class skill (goat-review, goat-critique, goat-qa) |
| `skill-quality-testing/deployment.md` | Skip-testing rationalisations, deployment checklist (RED/GREEN/REFACTOR phases + quality checks + deployment gates), STOP-before-next-skill rule | Finalising any skill before merge |

## The iron law (always-loaded anchor)

> **No skill without a failing test first.**

This applies to NEW skills AND to EDITS of existing skills. Writing a skill before watching an agent fail produces documentation of what you think needs preventing, not what actually needs preventing. See `skill-quality-testing/tdd-iteration.md` for the full methodology.

## Cross-references

- `.goat-flow/decisions/ADR-023-reference-pack-budget-tiers.md` - why this file was split from a 3893-word monolith into an index plus three topical files
- `.goat-flow/skill-reference/skill-preamble.md` - Proof Gate, evidence standard, ceremony level (always-loaded layer)
- `.goat-flow/skill-reference/skill-conventions.md` - Rationalisation table definition, task tracking, recovery protocols
