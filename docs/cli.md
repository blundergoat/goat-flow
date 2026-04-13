# CLI Reference

## Commands

### `goat-flow audit [path] [flags]`

Validate setup correctness across two scopes: GOAT Flow Setup (pass/fail) and AI Harness Score (per-agent percentage). Default command when run without arguments.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one agent: claude, codex, gemini |
| `--harness` | Add advisory quality scoring by harness concern |
| `--format <type>` | Output: json, text, markdown (default: auto) |
| `--verbose` | Show per-check details |
| `--output <file>` | Write to file instead of stdout |

```bash
goat-flow audit .                          # Audit current directory
goat-flow audit . --harness                # Build + advisory quality grades
goat-flow audit . --agent claude           # Audit scoped to Claude
goat-flow audit . --format json            # JSON output for CI
goat-flow audit . --output report.json     # Write to file
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
| Check if my project is ready | `goat-flow audit .` |
| See advisory quality scores | `goat-flow audit . --harness` |
| Get a critique prompt | `goat-flow critique . --agent claude` |
| Set up a new project | `goat-flow setup . --agent claude` |
| Use this in CI | `goat-flow audit . --format json` |
| Open the dashboard | `goat-flow dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if audit doesn't pass
goat-flow audit . --format json --output report.json
```

**First-time setup:**

```bash
# 1. See where your project stands
goat-flow audit .
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
