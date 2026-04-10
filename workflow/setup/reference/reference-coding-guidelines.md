# Reference — Coding Guidelines

Coding guidelines are no longer part of the base setup flow. Add them later, after the agent has real project context and repeated examples to learn from.

## When to add them

Create local instruction files only when you are seeing real drift:

- repeated style inconsistencies across sessions
- repeated review feedback on the same patterns
- stable domain or stack rules that do not fit in the hot-path instruction file

## Source-of-truth order

When generating local instructions, prefer this order:

1. Existing project docs such as `.github/instructions/`, `docs/`, or team playbooks
2. Real patterns observed in the codebase
3. The security reference library under `workflow/reference/security/` for topic coverage

Do not create parallel surfaces that duplicate the same guidance in multiple places.

## If you add `.goat-flow/coding-standards/`

- Start with `conventions.md` only
- Add `frontend.md`, `backend.md`, `security.md`, or `testing.md` only when they reflect real project patterns
- If `.github/instructions/` already exists, either keep it canonical or make `.goat-flow/coding-standards/` the canonical source and bridge from it
- For Copilot, create `.github/instructions/*.instructions.md` bridge files only after the canonical local instruction files exist

## What good local instructions look like

- real build/test/lint commands
- concrete DO/DON'T rules derived from the codebase
- path references that resolve on disk
- one canonical owner per rule
