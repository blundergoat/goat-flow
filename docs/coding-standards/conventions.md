# Conventions

## Project Identity

Documentation framework for AI coding agent workflows. Two parts:
- **TypeScript CLI** (`src/cli/`): auditor, setup prompt generator, dashboard server
- **Markdown docs** (`docs/`, `workflow/`, `workflow/setup/`): framework documentation and agent templates
- **Shell scripts** (`scripts/`): maintenance, preflight checks, deny policy

Package: `@blundergoat/goat-flow`. Node >= 20.11.0. Runtime dependencies: `js-yaml`, `ws`.

## Architecture

```
src/cli/
  cli.ts              # Entry point, arg parsing (node:util parseArgs)
  index.ts            # Library re-exports
  types.ts            # All type definitions
  constants.ts        # Shared constants (AUDIT_VERSION, SKILL_NAMES, etc.)
  paths.ts            # Path resolution utilities
  classify-state.ts   # Classify project setup state for prompt generation
  config/             # Configuration (index.ts, reader.ts, types.ts)
  detect/             # Agent and stack detection (agents.ts, project-stack.ts)
  facts/              # Fact extraction (orchestrator.ts, fs.ts, agent/, shared/)
  audit/              # Audit engine (audit.ts, check-goat-flow.ts, check-agent-setup.ts, harness/, render.ts, types.ts)
  prompt/             # Prompt generation (compose-setup.ts, compose-quality.ts)
  server/             # Dashboard server modules:
                      #   dashboard.ts (bootstrap, dispatch, live reload)
                      #   dashboard-routes.ts (non-terminal HTTP handlers)
                      #   dashboard-terminal.ts (terminal HTTP/WebSocket wiring)
                      #   dashboard-assets.ts (HTML shell + asset loading)
                      #   setup-detect.ts, terminal.ts, types.ts
src/dashboard/        # Dashboard UI (views/, static assets)
workflow/
  install-goat-flow.sh        # Install workflow assets into a target project
  setup/                      # Agent setup docs and shared setup references
scripts/
  preflight-checks.sh  # Full preflight gate (shellcheck, tsc, tests, version, ADR)
  deny-dangerous.sh    # Codex deny policy with --self-test
  maintenance/         # Utility scripts (git-cleanup, scan-secrets, etc.)
test/
  unit/                # Unit tests
  integration/         # Integration tests
  contract/            # Contract tests
  smoke/               # Smoke tests
  fixtures/            # Test fixtures
```

## Commands

```bash
npm run build          # tsc -> dist/
npm run test           # node --import tsx --test 'test/**/*.test.ts'
npm run typecheck      # tsc --noEmit
npm run audit          # node dist/cli/cli.js audit .

shellcheck scripts/*.sh scripts/maintenance/*.sh                                            # Lint shell scripts
bash -n scripts/*.sh scripts/maintenance/*.sh                                                # Syntax-check scripts
bash scripts/preflight-checks.sh         # Full preflight gate

# CLI commands (after build)
npx goat-flow audit .                        # Validate setup correctness
npx goat-flow audit . --harness              # AI harness completeness checks
npx goat-flow install . --agent claude       # Copy/update system files
npx goat-flow setup --agent claude           # Generate setup prompt
npx goat-flow quality . --agent claude       # Generate quality-assessment prompt
```

## Conventions

- ESM throughout: `"type": "module"` in package.json, `NodeNext` module resolution
- Use `.js` extensions in all TypeScript import paths (NodeNext requires it)
- `node:test` + `node:assert/strict` for testing (not Jest, not Vitest)
- Strict TypeScript: `"strict": true` in tsconfig.json
- No `any` types. Minimize `as` casts. Use `unknown` and narrow.
- All types in `src/cli/types.ts`. Audit-specific types in `src/cli/audit/types.ts`.
- AUDIT_VERSION lives in `src/cli/constants.ts`, derived from `package.json` at runtime (single source of truth)
- Skill frontmatter must embed AUDIT_VERSION - CI enforces this in the "Skill template versions" step
- `ReadonlyFS` interface for filesystem access -- auditor never writes to disk
- Minimal runtime dependencies (js-yaml, ws). Dev-only: typescript, tsx, @types/node

## DO

- Run `npm run typecheck` after TypeScript changes
- Run `shellcheck` after shell script changes
- Run `npm test` after touching `src/cli/` or `test/`
- Run `bash scripts/preflight-checks.sh` before considering work complete
- Write build checks as `BuildCheck` objects (id, name, scope, run) in `audit/check-goat-flow.ts` or `audit/check-agent-setup.ts`
- Write harness checks as `HarnessCheck` objects (id, name, concern, run) in `audit/harness/`
- Import AUDIT_VERSION from `constants.ts`, never hardcode

## DON'T

- Don't add unnecessary runtime dependencies (keep the dependency footprint minimal)
- Don't use `console.log` outside `cli.ts` and `audit/render.ts` (preflight warns)
- Don't put types outside `types.ts` or `audit/types.ts`
- Don't hardcode version strings (derive from package.json via constants.ts)
- Don't use hypothetical examples in docs -- real incidents only
- Don't reference removed ADR patterns (see `scripts/preflight-checks.sh` for the enforced list)
- Don't create `_modified`, `_new`, `_backup`, `_v2` file variants - modify files in-place

## Generated / Ignored

Never edit or commit: `dist/`, `node_modules/`, `.claude/projects/`, `.claude/worktrees/`, `.claude/settings.local.json`

## Dangerous Operations (Ask First)

These files are high-risk because other files reference them or users depend on them:
- `workflow/setup/` -- numbered setup steps (01-system-overview.md through 06-final-verification.md) plus reference docs, referenced by 10+ docs
- `workflow/setup/` -- prompt changes affect what users generate
- `workflow/skills/` -- template changes affect user skill creation
- `src/cli/constants.ts` -- AUDIT_VERSION must match package.json
- Any file rename (breaks cross-references; CLAUDE.md DoD requires grep-after-rename)
