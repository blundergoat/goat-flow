---
applyTo: "**"
---
<!-- Source: ai/instructions/conventions.md — keep in sync -->

# Base — GOAT Flow

Documentation framework for AI coding agent workflows. Markdown docs + TypeScript CLI scanner.

## Architecture

- `src/cli/` — TypeScript CLI scanner (rubric, evaluators, scoring, prompts)
- `src/dashboard/` — Tailwind HTML dashboard (M3, not built yet)
- `docs/` — Framework documentation (spec, five-layers, six-steps, reference)
- `setup/` — Paste-and-run setup prompts for Claude, Codex, Gemini, Copilot
- `workflow/` — Skill templates, playbook templates, local context templates
- `scripts/` — Shell maintenance scripts (preflight, context-validate, deny)

## Commands

```bash
npm run build          # Compile TypeScript to dist/
npm test               # Run all tests (node:test + tsx)
npm run typecheck      # Type-check without emitting
npm run self-scan      # Scan this repo with goat-flow
shellcheck scripts/*.sh scripts/maintenance/*.sh
bash scripts/preflight-checks.sh   # Full preflight gate
bash scripts/context-validate.sh   # Validate GOAT Flow structure
scripts/run-cli.sh                 # Interactive CLI menu
```

## Conventions

- TypeScript ESM, Node 20.6+, zero runtime deps
- `node:test` for testing — no Jest/Vitest
- All shell scripts: `set -euo pipefail`, pass shellcheck
- Rubric checks are typed data in `src/cli/rubric/` — not parsed from markdown
- Fragments in `src/cli/prompt/fragments/` — one per recommendation key, tagged `create` or `fix`
- Version single source of truth: `src/cli/rubric/version.ts` (cli.ts imports from there)

## Do / Don't

- Do: keep instruction files under 120 lines (hard limit 150)
- Do: use `file:line` evidence format in footguns and examples
- Do: run `shellcheck` on all `.sh` changes
- Don't: add runtime dependencies — zero-dep is a design constraint
- Don't: hardcode version strings — import from `version.ts`
- Don't: create documentation files unless explicitly asked
- Don't: modify `docs/system-spec.md` without understanding it's the canonical spec

## Generated Files

Never edit directly:
- `dist/` — compiled output from `npx tsc`
- `node_modules/`

## Dangerous Operations

- `docs/system-spec.md` — canonical spec, referenced everywhere. Changes cascade.
- `setup/shared/execution-loop.md` — template for all instruction files. Changes affect every project.
- `workflow/skills/` — templates that agents copy. CI validates the generated files match.
- Renaming any file — breaks cross-references. Grep old pattern after rename.
