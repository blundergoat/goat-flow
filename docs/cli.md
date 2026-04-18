# CLI Reference

## Commands

### `goat-flow audit [path] [flags]`

Validate setup correctness. The base audit runs two deterministic scopes (all pass/fail): GOAT Flow Setup and Agent Setup. Pass `--harness` to add the AI Harness Completeness scope (16 checks across 5 concerns — verifies structural installation of each concern). Harness results contribute to the overall audit status. Default command when run without arguments.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one manifest-backed agent id. Run `goat-flow manifest` to inspect the current registry. |
| `--harness` | Add AI Harness Completeness scope (16 checks, installed/not-installed per concern) |
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

### `goat-flow quality [path] --agent <id>`

Generate a structured quality-assessment prompt for a selected agent. Requires `--agent`. This command stays compose-only: it prints the prompt and never writes report history by itself.

```bash
goat-flow quality . --agent claude         # Quality prompt for Claude
goat-flow quality . --agent codex          # Quality prompt for Codex
```

If prior same-agent quality history exists under `.goat-flow/logs/quality/`, the prompt includes the latest saved report so the next review can mark current findings as `new` or `persisted`.

### `goat-flow quality capture --from-file <path> | --from-stdin`

Extract a saved quality report from an agent response and persist it locally. The CLI scans fenced `json` blocks, accepts the one whose top-level `report_kind` is `goat-flow-quality-report`, validates the schema, assigns positional finding ids, and writes both the structured report and companion prose.

```bash
goat-flow quality capture --from-file claude-quality.md   # Save one agent response
pbpaste | goat-flow quality capture --from-stdin          # Capture directly from stdin
```

Saved files land under `.goat-flow/logs/quality/<YYYY-MM-DD>-<agent>[-NN].json` and `.md`. Same-day recaptures increment deterministically (`-02`, `-03`, ...).

### `goat-flow quality history [--agent <id>] [--all] [--format json]`

List saved quality reports and same-agent setup deltas. By default the text view shows the 20 most recent runs; `--all` lifts that limit.

```bash
goat-flow quality history --agent claude    # Claude-only saved runs
goat-flow quality history --all             # All saved runs
goat-flow quality history --format json     # Machine-readable report history
```

### `goat-flow quality diff [<from-id>:<to-id>] --agent <id> [--format json]`

Compare two saved same-agent reports. Without an explicit pair, diff uses the two most recent saved runs for `--agent`. With an explicit pair, use saved-report basenames such as `2026-04-01-claude:2026-04-15-claude`.

```bash
goat-flow quality diff --agent claude
goat-flow quality diff 2026-04-01-claude:2026-04-15-claude --format json
```

`quality diff` derives `resolved`, `new`, `persisted`, and `stuck` from positional finding ids. `stuck` is a subset of persisted high-severity findings and resets after history gaps longer than 30 days.

### `goat-flow setup [path] --agent <id>`

Generate a setup prompt adapted to the project's current state. Detects existing goat-flow installations and routes to upgrade path if appropriate.

Supported agent ids are read from `workflow/manifest.json` via `src/cli/agents/registry.ts`, so the CLI help and validation stay aligned with the machine-readable support matrix.

```bash
goat-flow setup --agent claude    # Claude setup/upgrade prompt
goat-flow setup --agent codex     # Codex setup/upgrade prompt
```

### `goat-flow status [path]`

Show project adoption state (`bare`, `partial`, `v0.9`, `outdated`, `current`, `error`) and recommended next action (`setup`, `migration`, `upgrade`, `fix`, `audit`, `incomplete`).

```bash
goat-flow status .                    # Check current project state
```

### `goat-flow dashboard [path]`

Launch the web dashboard for auditing, setup, and terminal management.

```bash
goat-flow dashboard               # Launch on default port
goat-flow dashboard --dev         # Live reload mode
```

## Workflow Examples

Common tasks and the commands to run:

| I want to... | Command |
|--------------|---------|
| Check if my project is ready | `npx goat-flow audit .` |
| Check harness completeness | `npx goat-flow audit . --harness` |
| Get a quality prompt | `goat-flow quality . --agent claude` |
| Save an agent's quality review | `goat-flow quality capture --from-file claude-quality.md` |
| Review quality trend history | `goat-flow quality history --agent claude` |
| Compare two saved quality runs | `goat-flow quality diff --agent claude` |
| Set up a new project | `goat-flow setup . --agent claude` |
| Use this in CI | `npx goat-flow audit . --format json` |
| Open the dashboard | `goat-flow dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if audit doesn't pass
npx goat-flow audit . --format json --output report.json
```

**First-time setup:**

```bash
# 1. See where your project stands
npx goat-flow audit .
# 2. Generate a setup prompt for your agent
goat-flow setup . --agent claude
# 3. Open the dashboard for guided setup
goat-flow dashboard .
```

## Global flags

| Flag | Description |
|------|-------------|
| `--help, -h` | Show help |
| `--version, -v` | Show version |
