# Reference - Coding Guidelines

Coding guidelines are no longer part of the base setup flow. Add them later, after the agent has real project context and repeated examples to learn from.

## When to add them

Create local instruction files only when you are seeing real drift:

- repeated style inconsistencies across sessions
- repeated review feedback on the same patterns
- stable domain or stack rules that do not fit in the hot-path instruction file

## Source-of-truth order

When generating local instructions, prefer this order:

1. Existing provider-appropriate instruction files, project docs, and team playbooks
2. Real patterns observed in the codebase

Do not create parallel surfaces that duplicate the same guidance in multiple places.

## If you add local instruction files

Use the active agent profile in `workflow/manifest.json` to choose the provider surface:

- Copilot path-scoped rules use `.github/instructions/**/*.instructions.md`.
- Codex directory-scoped rules use nested `AGENTS.override.md` or `AGENTS.md` files.
- Claude directory-scoped rules use `.claude/rules/*.md` with `paths:` frontmatter.
- Antigravity uses nested `AGENTS.md` files where a narrower scope is required.

Do not claim another harness reads a provider-specific surface. Add the smallest file that owns a demonstrated local rule.

## What good local instructions look like

- real build/test/lint commands
- concrete DO/DON'T rules derived from the codebase
- path references that resolve on disk
- one canonical owner per rule
