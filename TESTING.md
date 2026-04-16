# Testing

The test suite uses Node's built-in test runner (`node:test` + `node:assert`). No external test framework.

## Running tests

```bash
npm test                          # Run all tests
npx tsc --noEmit                  # Type-check without emitting
npx eslint src/cli/               # Lint
bash scripts/preflight-checks.sh  # Full preflight gate (includes all of the above)
```

## Test structure

Tests live in `test/` with subdirectories:

- `unit/` - config reader, classify-state, CLI parsing, skill constants, rubric registry
- `integration/` - audit (build + quality), audit on well-configured projects, critique with audit data
- `contract/` - cross-surface consistency (skill count, version alignment, no-scan phrasing, JSON shape)
- `fixtures/` - test data for isolated check evaluation

## What the tests guard

- Audit output has no scan references
- Step 06 references audit (not scanner)
- package.json version matches AUDIT_VERSION
- SKILL_NAMES matches manifest.json canonical skills
- Build check IDs are unique
- Quality checks cover all 5 harness concerns
- manifest.json paths use .goat-flow/ prefix
- Skill templates do not reference workflow/ in install sections
- Build/quality checks produce correct results on healthy and broken projects
- Config reader handles valid YAML, invalid YAML, and missing files
- CLI parsing: audit is default, scan is rejected, removed flags rejected
- Critique generates non-empty prompts with required sections
