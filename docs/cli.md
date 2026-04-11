# CLI Reference

## Commands

### `goat-flow scan [path] [flags]`

Score a project against the goat-flow rubric.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one agent: claude, codex, gemini |
| `--format <type>` | Output: json, text, markdown, html (default: auto) |
| `--verbose` | Show per-check details |
| `--min-score <n>` | CI gate: exit 1 if score below threshold (0-100) |
| `--min-grade <g>` | CI gate: exit 1 if grade below threshold (A-D) |
| `--output <file>` | Write to file instead of stdout |
| `--guide` | Show prioritized setup guidance instead of scores |

```bash
goat-flow scan .                          # Score current directory
goat-flow scan --agent claude --verbose   # Detailed Claude scan
goat-flow scan --min-score 80             # CI gate
goat-flow scan --format json --output report.json
```

### `goat-flow setup [path] --agent <id>`

Generate a setup prompt adapted to the project's current state. Detects existing goat-flow installations and routes to upgrade path if appropriate.

```bash
goat-flow setup --agent claude    # Claude setup/upgrade prompt
goat-flow setup --agent codex     # Codex setup/upgrade prompt
```

### `goat-flow info rubrics`

List all rubric checks with ID, name, tier, points, and description. Reads directly from scanner code - always current.

```bash
goat-flow info rubrics                    # All checks
goat-flow info rubrics --tier foundation  # Foundation tier only
```

### `goat-flow info anti-patterns`

List all anti-pattern deductions with ID, name, deduction value, and remediation.

```bash
goat-flow info anti-patterns
```

### `goat-flow dashboard [path]`

Launch the web dashboard for scanning, setup, and terminal management.

```bash
goat-flow dashboard               # Launch on default port
goat-flow dashboard --dev         # Live reload mode
```

## Workflow Examples

Common tasks and the commands to run:

| I want to... | Command |
|--------------|---------|
| Check if my project is ready | `goat-flow scan .` |
| Set up a new project | `goat-flow setup . --agent claude` |
| See what checks exist | `goat-flow info rubrics` |
| Use this in CI | `goat-flow scan . --min-score 80 --format json` |
| Get verbose output | `goat-flow scan . --verbose` |
| Open the dashboard | `goat-flow dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if score drops below 80
goat-flow scan . --min-score 80 --format json --output report.json
```

**First-time setup:**

```bash
# 1. See where your project stands
goat-flow scan .
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
