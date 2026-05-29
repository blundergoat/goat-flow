---
goat-flow-reference-version: "1.9.0"
---
# Skill Reference (Meta References)

This directory holds **shared meta-references composed into goat-flow skills**. They describe the universal contract that every `/goat-*` skill inherits - they are not standalone playbooks.

For tool/capability playbooks (browser-use, page-capture, skill-quality-testing methodology), see the sibling `skill-playbooks/` directory.

## What lives here

| File | Role | When loaded |
|---|---|---|
| [`skill-preamble.md`](./skill-preamble.md) | Universal goat-flow contract: Proof Gate, OBSERVED/INFERRED tagging, evidence discipline, retry budget. | Composed into every `/goat-*` skill at scoring time and at runtime; agents inherit its gate vocabulary. |
| [`skill-conventions.md`](./skill-conventions.md) | Authoring conventions: footgun/lesson entry shapes, frontmatter contracts, status / created / evidence blocks. | Composed into a skill when its body references `skill-conventions`. |

These are meta because they describe the *shape* of skills, not how to use a specific tool. Adding a new shared meta reference here means committing every existing skill to inherit it - do that intentionally, not by accident.

## Why a separate directory (and not duplicated into each skill)

Putting these inside every `.claude/skills/<name>/references/` would mean 7-fold duplication and 7-fold drift risk on every preamble change. The shared dir says "every skill inherits this" by construction. Skill-specific references still live in each skill's own `references/` subdir.

## How the engine uses these files

`src/cli/quality/skill-quality.ts` `composeContent`:
1. Always pulls in `skill-preamble.md` if `quality.composition.skillPreamblePath` resolves.
2. Pulls in `skill-conventions.md` only when the skill body mentions `skill-conventions`.
3. Concatenates with the SKILL.md to form the *composed surface* that scorers see - so gate vocabulary inherited from the preamble counts.

Override these paths in `.goat-flow/config.yaml` `quality.composition` if a consumer project ships its own preamble.
