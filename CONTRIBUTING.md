# Contributing to GOAT Flow

Thanks for your interest in contributing. This guide covers environment setup, project layout, and PR workflow.

## Dev Environment Setup

Requires Node.js 20+ and Bash.

```bash
npm install          # install dependencies
npm run build        # compile TypeScript (tsc)
npm test             # run the test suite (node:test)
npm run format       # auto-format with Prettier
```

## Running the Auditor Locally

After building, audit the current project:

```bash
npm run audit                     # shorthand
node dist/cli/cli.js audit .      # direct invocation (accepts any path)
```

## Running the Dashboard in Dev Mode

```bash
npm run dev    # builds, then launches the browser dashboard with --dev flag
```

## Running Preflight Checks

The preflight gate runs typecheck, tests, shellcheck, version consistency, and ADR enforcement:

```bash
bash scripts/preflight-checks.sh
```

For shell scripts only: `shellcheck scripts/maintenance/*.sh`

ESLint covers both `src/cli/` and `src/dashboard/`. The config references both `tsconfig.json` and `tsconfig.dashboard.json` so each tree is typed-linted under its own compiler options.

Do not run `npm run build` and `preflight-checks.sh` concurrently - the build's `rm -rf dist/` will cause preflight to skip the audit check.

## Project Structure

| Directory | What lives there |
|-----------|-----------------|
| `src/cli/` | CLI auditor, audit checks (`audit/`), stack detector (`detect/`), setup prompt generator |
| `src/dashboard/` | Browser-based dashboard - HTML + Alpine.js + vanilla JS |
| `workflow/` | Setup templates, skill templates, hooks |
| `.goat-flow/` | Project-specific config, architecture, decisions, footguns, lessons |
| `scripts/` | Shell scripts for validation, maintenance, publishing |
| `test/` | Unit, integration, contract, and smoke tests (uses `node:test`) |

## How to Add a New Audit Check

There are two check systems - pick the right one:

- **Build checks** (`src/cli/audit/check-goat-flow.ts` + `check-agent-setup.ts`) - 19 checks (15 setup scope + 4 agent scope) that gate CI pass/fail. Adding here makes it a blocking audit requirement.
- **Quality checks** (`src/cli/audit/harness/`) - 17 checks grouped by 5 concerns. Gating when `--harness` is passed; not included in this repo's default CI.

Every new `BuildCheck` and `HarnessCheck` must also ship a `provenance` record using `CheckEvidence` from `src/cli/audit/provenance-types.ts`. Populate the source, normative level, verified date, and supporting `evidence_paths` / `source_urls` in the same change as the check itself. Provenance is emitted per check in JSON output; text output stays unchanged unless you are deliberately changing the human-facing renderer.

## How to Add a New Skill Template

Skill templates live in `workflow/skills/` as directories (e.g., `workflow/skills/goat-debug/SKILL.md`), mirroring the installed layout (e.g., `.claude/skills/goat-debug/SKILL.md`). Shared conventions are in `workflow/skills/reference/` (skill-preamble.md, skill-conventions.md); setup copies these to `.goat-flow/skill-reference/` on install. Standalone tool/capability playbooks (browser-use, page-capture, skill-quality-testing) live in `workflow/skills/playbooks/` and install to `.goat-flow/skill-playbooks/`. Skills are installed verbatim from templates to project skill directories. Add your template directory and register it in the setup flow.

## How to Add a New Stack to the Detector

Stack detection lives in `src/cli/detect/project-stack.ts`. Add a new detection case that inspects project files (package.json, config files, etc.) and returns the appropriate stack identifier.

## How to Contribute

1. Fork the repository
2. Create a feature branch off `dev` (`git checkout -b my-change`)
3. Make your changes
4. Run the checks: `bash scripts/preflight-checks.sh`
5. Open a pull request against `dev` (not `main`)

## PR Conventions

- Conventional commit format: `type(scope): description` - e.g., `refactor(ci): enhance CI workflow`, `feat(dashboard): improve UX`
- Multi-line body when spanning multiple areas (blank line after summary)
- Before opening: `npm run typecheck`, `npm test`, and `shellcheck` on any changed `.sh` files must all pass
- See `docs/coding-standards/git-commit.md` for full conventions

## Code Style

- **Markdown** for documentation (target ~120-line files)
- **Bash** for maintenance and validation scripts (`scripts/`)
- **TypeScript** for the CLI auditor (`src/cli/`) and dashboard server

## AI Assistance Disclosure

Contributions generated with AI coding assistants are welcome. Please disclose AI assistance in your PR description. All contributions are reviewed by humans before merging.

## Reporting Issues

Open a GitHub issue. Include:
- What you expected
- What happened instead
- Steps to reproduce (if applicable)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).
