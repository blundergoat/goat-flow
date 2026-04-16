# ADR-037: Skill integrity in public audit - deferred (design gap)

**Date:** 2026-04-13
**Status:** Advisory - not implemented in M30
**Related:** M30 A7

## Context

`scripts/validate-goat-flow-setup.sh:205–243` validates real skill structure (required sections, frontmatter, content). `src/cli/facts/agent/skills.ts:49–299` extracts comparable facts. But `src/cli/audit/agent-setup-checks.ts` only checks skill-file existence and version tags - the richer structure data is extracted but unused by public checks.

## Proposed Check

Add a build check in `agent-setup-checks.ts` (setup scope) that reads each installed SKILL.md and verifies:
1. Frontmatter has `name:` field
2. Frontmatter has `goat-flow-skill-version:` field
3. Required section `## Shared Conventions` is present

The check would use `ctx.fs.readFile(skillPath)` (already on `ReadonlyFS` interface) and `ctx.structure.skills.canonical` (already available in context). No new imports needed.

## Kill Criteria Triggered

Implementing this check correctly requires the test fixture stub FS to return SKILL.md content for `ctx.fs.readFile()` calls. The current `stubFS` in `test/fixtures/projects/index.ts` returns null for all `readFile()` calls on skill paths - the check would always report no structure failures against test fixtures.

Fixing this requires either:
- Adding SKILL.md content to the stub FS (changes test fixtures)
- Making the check skip gracefully when `readFile` returns null (masks real failures in the test environment)

Both paths cross the kill criteria: "If implementing requires changing test fixtures... close as advisory."

## Decision

Deferred. Record the design gap. Implement in a future milestone when test fixture infrastructure is extended to support file content stubs for skill files.

## Implementation Notes

When re-approaching:
1. Add a `readFile` stub mechanism to `makeCtx` / `stubFS` that can be pre-seeded with file content
2. Create a test fixture with a minimal valid SKILL.md (frontmatter + `## Shared Conventions` section)
3. Add the build check using existing `ctx.fs.readFile()` - no new imports needed
4. The check fits naturally after `skillVersionsPresent` in `agent-setup-checks.ts`
