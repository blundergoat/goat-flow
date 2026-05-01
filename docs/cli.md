# CLI Reference

## Commands

### `goat-flow`

Open an interactive menu. This is the default when the CLI is run with no arguments.

```bash
npx @blundergoat/goat-flow@latest
```

The menu can start the dashboard, copy/update goat-flow system files, generate a setup prompt, audit the current project, or show project status.

### `goat-flow audit [path] [flags]`

Validate setup correctness. The base audit runs two deterministic scopes (all pass/fail): GOAT Flow Setup and Agent Setup. Pass `--harness` to add the AI Harness Completeness scope (17 checks across 5 concerns - verifies structural installation of each concern). Harness results contribute to the overall audit status.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one manifest-backed agent id. Run `npx goat-flow manifest` to inspect the current registry. |
| `--harness` | Add AI Harness Completeness scope (17 checks, installed/not-installed per concern) |
| `--check-drift` | Add skill template-vs-installed drift detection (orphan directories, byte-level divergence) |
| `--check-content` | Add cold-path content lint (vague terms, generic instructions, factual-claim drift) |
| `--format <type>` | Output: json, text, markdown (default: auto) |
| `--verbose` | Show per-check details |
| `--output <file>` | Write to file instead of stdout |

```bash
npx goat-flow audit .                      # Audit current directory
npx goat-flow audit . --harness            # Include AI harness completeness checks
npx goat-flow audit . --agent claude       # Audit scoped to Claude
npx goat-flow audit . --format json        # JSON output for CI
npx goat-flow audit . --output report.json # Write to file
```

### `goat-flow quality [path] --agent <id> [--mode <mode>]`

Generate a structured quality-assessment prompt for a selected agent. Requires `--agent`. `--mode` selects the assessment contract: `agent-setup` (default), `process`, `harness`, or `skills`. The prompt tells the agent to write its final JSON report directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` (gitignored); prose findings come back in the agent's reply, the JSON does not.

```bash
npx goat-flow quality . --agent claude         # Quality prompt for Claude
npx goat-flow quality . --agent claude --mode harness
npx goat-flow quality . --agent codex          # Quality prompt for Codex
```

The agent derives the date/time from its shell and generates a 5-character lowercase-alphanumeric random suffix so parallel runs do not collide. If prior same-agent, same-mode quality history exists, the generated prompt embeds the latest saved report so the new review can mark current findings as `new` or `persisted`.

### `goat-flow quality history [--agent <id>] [--all] [--format json]`

List saved quality reports and same-agent setup deltas. By default the text view shows the 20 most recent runs; `--all` lifts that limit.

```bash
npx goat-flow quality history --agent claude    # Claude-only saved runs
npx goat-flow quality history --all             # All saved runs
npx goat-flow quality history --format json     # Machine-readable report history
```

### `goat-flow quality diff [<from-id>:<to-id>] --agent <id> [--format json]`

Compare two saved same-agent reports. Without an explicit pair, diff uses the two most recent saved runs for `--agent`. With an explicit pair, use saved-report basenames (the filename without `.json`).

```bash
npx goat-flow quality diff --agent claude
npx goat-flow quality diff 2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb --format json
```

`quality diff` derives `resolved`, `new`, `persisted`, and `stuck` from positional finding ids. `stuck` is a subset of persisted high-severity findings and resets after history gaps longer than 30 days.

### `goat-flow manifest [--check] [--format json]`

Print the resolved single-source-of-truth manifest (agent registry, installed skills, required files, and derived facts). Pass `--check` to validate that the static manifest matches observed repo state (exits non-zero on drift, used by CI).

```bash
npx goat-flow manifest                    # Print resolved manifest as Markdown
npx goat-flow manifest --format json      # Machine-readable manifest
npx goat-flow manifest --check            # Fail if manifest disagrees with live filesystem
```

### `goat-flow stats [--check] [--format json|markdown]`

Report learning-loop health: live entry counts by bucket, stale file refs, and `last_reviewed` freshness. Use `--check` in CI - it exits non-zero if any bucket is missing `last_reviewed`, uses a malformed date, or contains stale file references.

```bash
npx goat-flow stats                       # Learning-loop health report
npx goat-flow stats --check               # CI gate for bucket hygiene
npx goat-flow stats --format json         # Machine-readable report
```

### `goat-flow setup [path] --agent <id>`

Generate a setup prompt adapted to the project's current state. Detects existing goat-flow installations and routes to upgrade path if appropriate.

Supported agent ids are read from `workflow/manifest.json` via `src/cli/agents/registry.ts`, so the CLI help and validation stay aligned with the machine-readable support matrix.

```bash
npx goat-flow setup --agent claude    # Claude setup/upgrade prompt
npx goat-flow setup --agent codex     # Codex setup/upgrade prompt
npx goat-flow setup . --agent claude --apply
```

Use `--apply` when you want setup to run the deterministic file-copy installer instead of printing a prompt. Use `--force` with `--apply` only when existing settings and `.goat-flow/config.yaml` should be overwritten.

### `goat-flow install [path] --agent <id> [--force]`

Copy or update goat-flow system files without an agent: skills, shared skill references, hook scripts, agent settings templates, `.goat-flow/` README/gitignore anchors, and `.goat-flow/config.yaml` when it is missing. Existing settings and config are skipped unless `--force` is passed.

```bash
npx @blundergoat/goat-flow@latest install . --agent claude
npx @blundergoat/goat-flow@latest install . --agent codex --force
```

The installer does not create project-specific content such as the instruction file, architecture, code map, glossary, patterns, footguns, or lessons. Run `goat-flow setup . --agent <id>` afterward for the guided prompt that creates or refreshes those surfaces.

### `goat-flow status [path]`

Show project adoption state (`bare`, `partial`, `v0.9`, `outdated`, `current`, `error`) and recommended next action (`setup`, `migration`, `upgrade`, `fix`, `audit`, `incomplete`).

```bash
npx goat-flow status .                    # Check current project state
```

### `goat-flow dashboard [path]`

Launch the web dashboard for auditing, setup, and terminal management.

```bash
npx goat-flow dashboard               # Launch on default port
npx goat-flow dashboard --dev         # Live reload mode
```

## Workflow Examples

Common tasks and the commands to run:

| I want to... | Command |
|--------------|---------|
| Check if my project is ready | `npx goat-flow audit .` |
| Check harness completeness | `npx goat-flow audit . --harness` |
| Copy/update system files | `npx goat-flow install . --agent claude` |
| Get a quality prompt | `npx goat-flow quality . --agent claude` |
| Get a harness quality prompt | `npx goat-flow quality . --agent claude --mode harness` |
| Review quality trend history | `npx goat-flow quality history --agent claude` |
| Compare two saved quality runs | `npx goat-flow quality diff --agent claude` |
| Generate a setup prompt | `npx goat-flow setup . --agent claude` |
| Use this in CI | `npx goat-flow audit . --format json` |
| Open the dashboard | `npx goat-flow dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if audit doesn't pass
npx goat-flow audit . --format json --output report.json
```

**First-time setup:**

```bash
# 1. See where your project stands
npx goat-flow audit .
# 2. Copy deterministic system files
npx goat-flow install . --agent claude
# 3. Generate a setup prompt for project-specific files
npx goat-flow setup . --agent claude
# 4. Open the dashboard for guided setup
npx goat-flow dashboard .
```

## Global flags

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
