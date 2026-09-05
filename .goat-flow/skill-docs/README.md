---
goat-flow-reference-version: "1.17.0"
---
# Skill Docs

This directory holds **shared meta-references composed into goat-flow skills**. They describe the universal contract that every `/goat-*` skill inherits - they are not standalone playbooks.

For tool/capability playbooks, see `playbooks/`. For skill-authoring methodology, see `skill-quality-testing/`.

## What lives here

| File | Role | When loaded |
|---|---|---|
| [`skill-preamble.md`](./skill-preamble.md) | Universal goat-flow contract: Proof Gate, evidence classes, durable-text redaction, and Step 0 budget. | Composed into every `/goat-*` skill at scoring time and at runtime; agents inherit its gate vocabulary. |
| [`skill-conventions.md`](./skill-conventions.md) | Full-depth execution contract: Adaptive Step 0, contradiction check and stuck protocol, task tracking, durable-artifact redaction, presenting findings, milestone retrospective, sub-agent Orchestration Admission, recovery, Interrupt Freeze, autonomy awareness, skill authoring, and footgun/lesson/pattern entry formats. | Composed into a skill when its body references `skill-conventions`. |

These are meta because they describe the *shape* of skills, not how to use a specific tool. Adding a new shared meta reference here means committing every existing skill to inherit it - do that intentionally, not by accident.

## Why a separate directory (and not duplicated into each skill)

Putting these inside every `.claude/skills/<name>/references/` would mean 8-fold duplication and 8-fold drift risk on every preamble change. The shared dir says "every skill inherits this" by construction. Skill-specific references still live in each skill's own `references/` subdir.

## How goat-flow uses these files

The skill-quality composition step:
1. Always pulls in `skill-preamble.md` if `quality.composition.skillPreamblePath` resolves.
2. Pulls in `skill-conventions.md` only when the skill body mentions `skill-conventions`.
3. Concatenates with the SKILL.md to form the *composed surface* that scorers see - so gate vocabulary inherited from the preamble counts.

Override these paths in `.goat-flow/config.yaml` `quality.composition` if a consumer project ships its own preamble.
