# CLI Reference

## Commands

### `goat-flow audit [path] [flags]`

Validate setup correctness. The base audit runs two deterministic scopes (all pass/fail): GOAT Flow Setup and Agent Setup. Pass `--harness` to add the AI Harness Completeness scope (16 checks across 5 concerns — verifies structural installation of each concern). Harness results contribute to the overall audit status. Default command when run without arguments.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one agent: claude, codex, gemini |
| `--harness` | Add AI Harness Completeness scope (16 checks, installed/not-installed per concern) |
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

### `goat-flow critique [path] --agent <id>`

Generate a structured critique prompt for a selected agent. Requires `--agent`.

```bash
goat-flow critique . --agent claude        # Critique prompt for Claude
goat-flow critique . --agent codex         # Critique prompt for Codex
```

### `goat-flow setup [path] --agent <id>`

Generate a setup prompt adapted to the project's current state. Detects existing goat-flow installations and routes to upgrade path if appropriate.

```bash
goat-flow setup --agent claude    # Claude setup/upgrade prompt
goat-flow setup --agent codex     # Codex setup/upgrade prompt
```

### `goat-flow status [path]`

Show project adoption state (`bare`, `partial`, `v0.9`, `v1.0`, `v1.1`) and recommended next action (`setup`, `migration`, `upgrade`, `audit`).

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
| Get a critique prompt | `goat-flow critique . --agent claude` |
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
