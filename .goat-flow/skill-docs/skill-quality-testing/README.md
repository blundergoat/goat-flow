---
goat-flow-reference-version: "1.17.0"
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
| `tdd-iteration.md` | RED/GREEN/REFACTOR loop, pre-registered pressure trials, rationalisations, calibrated evidence | Creating a skill or materially changing its behaviour. Load first. |
| `adversarial-framing.md` | Neutral-skeptical reviewer role, coverage ledger, parallel reviewer pattern, finding schema | Authoring or hardening review-class skills. |
| `deployment.md` | Deployment checklist, verification claim evidence, consumer/API skill guardrails, STOP rule | Finalising before merge. |

## Evaluation contract

Match fixtures and controls to the skill's capability and risk in `tdd-iteration.md`. Every fixture names an already-correct control and scores application, not citation. Load `adversarial-framing.md` only for review-class specialisation; it does not own the universal fixture or scoring rules.

## The iron law (always-loaded anchor)

> **No new skill or material behavioural rule without a failing test first.**

Behaviour-neutral typo, link, and citation corrections use a focused contract
that proves behaviour stayed unchanged. See `tdd-iteration.md` for the full
methodology.

## Cross-references

- `.goat-flow/skill-docs/skill-preamble.md` - Proof Gate and evidence standard
- `.goat-flow/skill-docs/skill-conventions.md` - conventions and task tracking
