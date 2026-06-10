---
goat-flow-reference-version: "1.11.0"
---
# Skill Quality Testing

Short index for full-depth skill-authoring work. Load only the topical file(s)
needed for the current phase; do not pre-load the whole pack unless the task
genuinely spans TDD iteration, review-class hardening, and deployment.

## Availability Check

Non-runnable authoring methodology - no CLI check applies. Load when creating or hardening a goat-flow skill, then open the topical file named in the table below.

## Which file to load

| File | Content | Load when |
|------|---------|-----------|
| `tdd-iteration.md` | Iron law, RED/GREEN/REFACTOR loop, pressure scenarios, rationalisations, bulletproofing | Creating or hardening any skill. Load first. |
| `adversarial-framing.md` | Cynical-reviewer role, zero-findings HALT, parallel reviewer pattern, finding schema | Authoring or hardening review-class skills. |
| `deployment.md` | Deployment checklist, verification claim evidence, consumer/API skill guardrails, STOP rule | Finalising before merge. |

## The iron law (always-loaded anchor)

> **No skill without a failing test first.**

This applies to NEW skills AND to EDITS of existing skills. See
`tdd-iteration.md` for the full methodology.

## Cross-references

- `.goat-flow/skill-docs/skill-preamble.md` - Proof Gate and evidence standard
- `.goat-flow/skill-docs/skill-conventions.md` - conventions and task tracking
