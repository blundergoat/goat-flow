---
goat-flow-reference-version: "1.7.0"
---
# Skill Quality Testing

Short index for full-depth skill-authoring work. Load only the topical file(s)
needed for the current phase; do not pre-load the whole pack unless the task
genuinely spans TDD iteration, review-class hardening, and deployment.

## Which file to load

| File | Content | Load when |
|------|---------|-----------|
| `skill-quality-testing/tdd-iteration.md` | Iron law, RED/GREEN/REFACTOR loop, pressure scenarios, rationalisations, bulletproofing | Creating or hardening any skill. Load first. |
| `skill-quality-testing/adversarial-framing.md` | Cynical-reviewer role, zero-findings HALT, parallel reviewer pattern, finding schema | Authoring or hardening review-class skills. |
| `skill-quality-testing/deployment.md` | Deployment checklist, verification claim evidence, consumer/API skill guardrails, STOP rule | Finalising before merge. |

## The iron law (always-loaded anchor)

> **No skill without a failing test first.**

This applies to NEW skills AND to EDITS of existing skills. See
`skill-quality-testing/tdd-iteration.md` for the full methodology.

## Cross-references

- `.goat-flow/skill-reference/skill-preamble.md` - Proof Gate and evidence standard
- `.goat-flow/skill-reference/skill-conventions.md` - conventions and task tracking
