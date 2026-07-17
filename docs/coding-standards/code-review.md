# Code Review Standards

## Priority Order

1. **Correctness** -- Does the code do what it claims? Do checks detect what they say?
2. **Cross-references** -- Do paths in docs resolve? Do check IDs in setup docs match check-goat-flow.ts / check-agent-setup.ts?
3. **Consistency** -- Same concept described the same way across files? Version strings in sync?
4. **Line budgets** -- Instruction files under 125 target / 150 hard limit?

## Approval Criteria

All must pass before approving:
- `npm run typecheck` (tsc --noEmit) clean
- `npm run format:check` (Prettier check) clean
- `npm test` passes
- `shellcheck scripts/maintenance/*.sh` clean (if .sh files changed)
- `bash scripts/preflight-checks.sh` passes
- No broken cross-references introduced (paths in docs, router tables, Ask First boundaries)
- Version consistency: AUDIT_VERSION in `src/cli/constants.ts` matches `package.json`

## Anti-Patterns to Flag

- **Hypothetical examples in docs**: CLAUDE.md says "MUST use real incidents, never hypothetical"
- **Duplicated content**: same instructions in both CLAUDE.md and a doc file (causes drift)
- **Generic Ask First boundaries**: template text like "auth, routing, deployment, API, DB" instead of actual project paths
- **Removed patterns**: references to removed ADR concepts (see `scripts/preflight-checks.sh` for the enforced list)
- **Hardcoded versions**: AUDIT_VERSION must derive from `package.json` via `constants.ts`
- **console.log outside cli.ts/render/**: preflight warns on this; flag it in review
- **Explicit `any` types**: use `unknown` and narrow instead
- **Missing .js in imports**: NodeNext requires `.js` extensions on relative imports

## Don't Nitpick

- Formatting owned by Prettier; run `npm run format:check` and do not hand-nitpick formatter-owned whitespace
- Markdown style variations (preflight does not lint markdown)
- Comment style (no jsdoc requirement beyond what exists)
- Test naming conventions (node:test is flexible on describe/it nesting)
