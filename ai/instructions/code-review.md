# Code Review — GOAT Flow

## Priority Order

1. **Correctness** — Does it do what it claims? Are edge cases handled?
2. **Cross-references** — Do renamed/moved files have all references updated?
3. **Consistency** — Does the same concept use the same description everywhere?
4. **Line budgets** — Are instruction files under 120 lines?

## Approval Criteria

- [ ] shellcheck passes on changed `.sh` files
- [ ] `npx tsc --noEmit` passes
- [ ] `npm test` passes
- [ ] No broken cross-references introduced
- [ ] Version strings consistent (check with preflight)

## Anti-Patterns to Flag

1. **Hypothetical examples** — footguns/lessons must use real incidents with `file:line` evidence, never invented examples
2. **Duplicated content** — same rule in multiple instruction files. Should be in one place.
3. **Generic Ask First boundaries** — "auth, routing, deployment" is template text. Must use actual project paths.
4. **Shape/confusion-log references** — removed (ADR-002, ADR-003). Flag any reintroduction.
5. **Hardcoded versions** — should import from `src/cli/rubric/version.ts`, not inline strings

## Don't Nitpick

- Formatting handled by shellcheck (scripts) and tsc (TypeScript)
- Markdown style — no linter enforced, consistency is enough
- Comment style — only flag missing comments where logic isn't self-evident
