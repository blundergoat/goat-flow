---
goat-flow-reference-version: "1.16.0"
---
# Skill Docs

This directory holds shared meta-references and reserved guidance placeholders. The active meta-references describe contracts inherited by `/goat-*` skills; placeholders are not loaded until an explicit route is added.

For tool/capability playbooks, see `playbooks/`. For skill-authoring methodology, see `skill-quality-testing/`.

## What lives here

| File | Role | When loaded |
|---|---|---|
| [`agent-document-authoring.md`](./agent-document-authoring.md) | Reserved placeholder for future agent-document authoring guidance. | Not routed or loaded. |
| [`skill-preamble.md`](./skill-preamble.md) | Universal goat-flow contract: Proof Gate, OBSERVED/INFERRED tagging, evidence discipline, retry budget. | Composed into every `/goat-*` skill at scoring time and at runtime; agents inherit its gate vocabulary. |
| [`skill-conventions.md`](./skill-conventions.md) | Authoring conventions: footgun/lesson entry shapes, frontmatter contracts, status / created / evidence blocks. | Composed into a skill when its body references `skill-conventions`. |

The active meta-references describe the *shape* of skills, not how to use a specific tool. A file is inherited only when the composition configuration or a skill explicitly loads it.

## Why a separate directory (and not duplicated into each skill)

Putting these inside every `.claude/skills/<name>/references/` would mean 8-fold duplication and 8-fold drift risk on every preamble change. The shared dir says "every skill inherits this" by construction. Skill-specific references still live in each skill's own `references/` subdir.

## How goat-flow uses these files

The skill-quality composition step:
1. Always pulls in `skill-preamble.md` if `quality.composition.skillPreamblePath` resolves.
2. Pulls in `skill-conventions.md` only when the skill body mentions `skill-conventions`.
3. Concatenates with the SKILL.md to form the *composed surface* that scorers see - so gate vocabulary inherited from the preamble counts.

Override these paths in `.goat-flow/config.yaml` `quality.composition` if a consumer project ships its own preamble.
