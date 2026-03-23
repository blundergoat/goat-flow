# Conventions

## Project Identity

Documentation framework for AI coding agent workflows. Two parts:
- **TypeScript CLI** (`src/cli/`): scanner, scoring engine, prompt generator, eval parser
- **Markdown docs** (`docs/`, `workflow/`, `setup/`): framework documentation and agent templates
- **Shell scripts** (`scripts/`): maintenance, preflight checks, deny policy

Package: `@blundergoat/goat-flow`. Node >= 22. Zero runtime dependencies.

## Architecture

```
src/cli/
  cli.ts              # Entry point, arg parsing (node:util parseArgs)
  index.ts            # Library re-exports
  types.ts            # All type definitions
  detect/             # Agent and stack detection (agents.ts, stack.ts)
  facts/              # Fact extraction (orchestrator.ts, agent.ts, shared.ts, fs.ts)
  scanner/            # Check evaluators (check-evaluator.ts, scan.ts)
  rubric/             # Check definitions by tier (foundation.ts, standard.ts, full.ts, anti-patterns.ts, registry.ts, version.ts)
  scoring/            # Score computation and recommendations (scorer.ts, recommendations.ts)
  prompt/             # Prompt generation (compose-fix.ts, compose-setup.ts, compose-audit.ts, render.ts, template-filler.ts, registry.ts)
  prompt/fragments/   # Per-check fix/setup instructions (foundation.ts, standard.ts, full.ts, anti-patterns.ts)
  prompt/types.ts     # Fragment, ComposedPrompt, PromptVariables
  evals/              # Agent eval parser (types.ts, loader.ts, parser.ts)
  render/             # Output formatters (json.ts, text.ts)
scripts/
  preflight-checks.sh  # Full preflight gate (shellcheck, tsc, tests, version, ADR)
  context-validate.sh  # Validate GOAT Flow structure (router paths, skills, frontmatter)
  deny-dangerous.sh    # Codex deny policy with --self-test
  maintenance/         # Utility scripts (git-cleanup, scan-secrets, etc.)
test/
  helpers/             # mock-fs.ts, test-project.ts
  facts/               # detect.test.ts
  prompt/              # fragments.test.ts, compose.test.ts
  fixtures/            # scan-fixtures.test.ts
```

## Commands

```bash
npm run build          # tsc -> dist/
npm run test           # node --import tsx --test 'test/**/*.test.ts'
npm run typecheck      # tsc --noEmit
npm run self-scan      # node dist/cli/cli.js .

shellcheck scripts/maintenance/*.sh      # Lint shell scripts
bash -n scripts/maintenance/*.sh          # Syntax-check scripts
bash scripts/preflight-checks.sh         # Full preflight gate
bash scripts/context-validate.sh         # Validate GOAT Flow structure

# CLI commands (after build)
goat-flow scan .                         # Score a project
goat-flow fix --agent claude             # Generate fix prompt
goat-flow setup --agent codex            # Generate setup prompt
goat-flow audit --agent gemini           # Generate audit prompt
goat-flow eval                           # Summarize agent evals
goat-flow --min-score 75                 # CI gate
```

## Conventions

- ESM throughout: `"type": "module"` in package.json, `NodeNext` module resolution
- Use `.js` extensions in all TypeScript import paths (NodeNext requires it)
- `node:test` + `node:assert/strict` for testing (not Jest, not Vitest)
- Strict TypeScript: `"strict": true` in tsconfig.json
- No `any` types. Minimize `as` casts. Use `unknown` and narrow.
- All types in `src/cli/types.ts`. Prompt-specific types in `src/cli/prompt/types.ts`. Eval types in `src/cli/evals/types.ts`.
- RUBRIC_VERSION and SCHEMA_VERSION live in `src/cli/rubric/version.ts`. Package version reads from `package.json` at runtime.
- RUBRIC_VERSION must be bumped when checks/points/detection logic change
- `ReadonlyFS` interface for filesystem access -- scanner never writes to disk
- Zero runtime dependencies. Dev-only: typescript, tsx, @types/node

## DO

- Run `npm run typecheck` after TypeScript changes
- Run `shellcheck` after shell script changes
- Run `npm test` after touching `src/cli/` or `test/`
- Run `bash scripts/preflight-checks.sh` before considering work complete
- Keep rubric checks as typed data (`CheckDef` objects), not imperative code
- Use `custom` detection type with typed `fn` when declarative detection is insufficient
- Tag prompt fragments with `kind: 'create'` or `kind: 'fix'`
- Import version from `rubric/version.ts`, never hardcode

## DON'T

- Don't add runtime dependencies (the scanner must stay zero-dep)
- Don't use `console.log` outside `cli.ts` and `render/` (preflight warns)
- Don't put types outside the three type files (types.ts, prompt/types.ts, evals/types.ts)
- Don't hardcode version strings (import from version.ts)
- Don't use hypothetical examples in docs -- real incidents only
- Don't reference removed ADR patterns (see `scripts/preflight-checks.sh` for the enforced list)

## Generated / Ignored

Never edit or commit: `dist/`, `node_modules/`, `.claude/projects/`, `.claude/worktrees/`, `.claude/settings.local.json`

## Dangerous Operations (Ask First)

These files are high-risk because other files reference them or users depend on them:
- `docs/system-spec.md` -- canonical spec, referenced by 10+ docs
- `docs/system/five-layers.md`, `docs/system/six-steps.md` -- core architecture
- `setup/` -- prompt changes affect what users generate
- `workflow/skills/` -- template changes affect user skill creation
- `docs/reference/design-rationale.md` -- evidence citations
- `src/cli/rubric/version.ts` -- must stay in sync with package.json
- Any file rename (breaks cross-references; CLAUDE.md DoD requires grep-after-rename)
