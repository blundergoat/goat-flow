# Code Review Standards

## Priority Order

1. **Correctness** -- Does the code do what it claims? Do checks detect what they say?
2. **Cross-references** -- Do paths in docs resolve? Do recommendationKeys match between CheckDef and Fragment?
3. **Consistency** -- Same concept described the same way across files? Version strings in sync?
4. **Line budgets** -- Instruction files under 120 target / 150 hard limit?

## Approval Criteria

All must pass before approving:
- `npm run typecheck` (tsc --noEmit) clean
- `npm test` passes
- `shellcheck scripts/maintenance/*.sh` clean (if .sh files changed)
- `bash scripts/preflight-checks.sh` passes
- No broken cross-references introduced (paths in docs, router tables, Ask First boundaries)
- Version consistency: `package.json` version matches `src/cli/rubric/version.ts` PACKAGE_VERSION
- Every new `CheckDef.recommendationKey` has a matching `Fragment.key` in `prompt/fragments/`

## Anti-Patterns to Flag

- **Hypothetical examples in docs**: CLAUDE.md says "MUST use real incidents, never hypothetical"
- **Duplicated content**: same instructions in both CLAUDE.md and a doc file (causes drift)
- **Generic Ask First boundaries**: template text like "auth, routing, deployment, API, DB" instead of actual project paths
- **Removed patterns**: ProjectShape, detectShape, --shape, confusion-log (ADR enforced by preflight)
- **Hardcoded versions**: version strings should import from `src/cli/rubric/version.ts`
- **console.log outside cli.ts/render/**: preflight warns on this; flag it in review
- **Explicit `any` types**: use `unknown` and narrow instead
- **Missing .js in imports**: NodeNext requires `.js` extensions on relative imports

## Don't Nitpick

- Formatting handled by tsc strict mode (no separate formatter configured)
- Markdown style variations (preflight does not lint markdown)
- Comment style (no jsdoc requirement beyond what exists)
- Test naming conventions (node:test is flexible on describe/it nesting)
