# CLI Reference

## Commands

### `goat-flow`

Open an interactive menu. This is the default when the CLI is run with no arguments.

```bash
npx @blundergoat/goat-flow@latest
```

The menu can start the dashboard, copy/update goat-flow system files, generate a setup prompt, audit the current project, or show project status.

### `goat-flow audit [path] [flags]`

Validate setup correctness. The base audit runs two deterministic scopes (all pass/fail): GOAT Flow Setup and Agent Setup. Pass `--harness` to add the AI Harness Completeness scope (17 checks across 5 concerns - verifies structural installation of each concern). Harness results contribute to the overall audit status. Audit JSON/text also includes an advisory per-agent enforcement matrix; it explains hard, limited, soft, missing, and unknown enforcement evidence without changing pass/fail status.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one manifest-backed agent id. Run `npx goat-flow manifest` to inspect the current registry. |
| `--harness` | Add AI Harness Completeness scope (17 checks, installed/not-installed per concern) |
| `--check-drift` | Add skill template-vs-installed drift detection (orphan directories, byte-level divergence) |
| `--check-content` | Add cold-path content lint (vague terms, generic instructions, factual-claim drift) |
| `--untrusted-target` | Skip executing the target's deny-hook code (its configured launcher string and managed script). By default the audit runs that code for runtime proof; pass this when auditing a checkout you don't trust so the deny-mechanism check stays static (no execution). |
| `--format <type>` | Output: json, text, markdown, sarif (default: auto) |
| `--verbose` | Show per-check details |
| `--output <file>` | Write to file instead of stdout |

```bash
npx goat-flow audit .                      # Audit current directory
npx goat-flow audit . --harness            # Include AI harness completeness checks
npx goat-flow audit . --agent claude       # Audit scoped to Claude
npx goat-flow audit . --format json        # JSON output for CI
npx goat-flow audit . --format sarif       # SARIF output for CI/code scanning upload
npx goat-flow audit . --output report.json # Write to file
```

The enforcement matrix is deliberately conservative. It reports local facts such as deny-hook registration, secret-path file-read coverage, secret shell-read blocking, deny-hook self-test evidence, and runtime-shaped blocked-payload smoke evidence. General file read/write restriction capability remains `unknown` unless goat-flow has explicit evidence; it is not inferred from setup success or from a perfect constraints score.

`--format sarif` exports the same deterministic audit findings as SARIF 2.1.0. It is an interchange format for CI and SARIF-aware tools; goat-flow is still reporting harness/setup integrity findings, not source-code vulnerabilities. Failing setup, agent, and harness checks become SARIF results. `--check-drift` and `--check-content` findings are included when those audit sections are enabled. Checks without target-file evidence are emitted without fabricated locations; GitHub code scanning accepts SARIF without annotations, but it only displays code annotations for results that include `locations[]`.

### `goat-flow quality [path] --agent <id> [--mode <mode>]`

Generate a structured quality-assessment prompt for a selected agent. Requires `--agent`. `--mode` selects the assessment contract: `agent-setup` (default), `process`, `harness`, or `skills`. The prompt tells the agent to write its final JSON report directly to `.goat-flow/logs/quality/<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` (gitignored); prose findings come back in the agent's reply, the JSON does not.

```bash
npx goat-flow quality . --agent claude         # Quality prompt for Claude
npx goat-flow quality . --agent claude --mode harness
npx goat-flow quality . --agent codex          # Quality prompt for Codex
```

The agent derives the date/time from its shell and generates a 5-character lowercase-alphanumeric random suffix so parallel runs do not collide. If prior same-agent, same-mode quality history exists, the generated prompt embeds the latest saved report so the new review can mark current findings as `new` or `persisted`.

The CLI command composes the prompt with fresh audit context. The dashboard
Quality page may use cached audit enrichment for passive page loads, but its
Regenerate action follows the same fresh-audit path.

### `goat-flow quality candidacy <description> [--draft <file>] [--format json]`

Decide what kind of artifact a draft or description should become before authoring it. Returns one of `skill | reference | instruction-file | learning-loop | cli-command | do-not-create` with a deterministic rationale.

```bash
npx goat-flow quality candidacy "I want a workflow that reviews risky migrations before deploy"
npx goat-flow quality candidacy --draft ./draft.md
```

Candidacy is read-only. See [Skill Authoring](skill-authoring.md) for the full authoring workflow.

### `goat-flow skill new [<description>] [--name <slug>] [--draft <file>] [--interactive] [--yes]`

Scaffold a new skill or playbook from a description, validate a draft's location, or run interactively. Runs `quality candidacy` first; only writes a file after confirmation (`--yes` for non-interactive flows).

```bash
npx goat-flow skill new "I want a workflow that reviews risky database migrations before deploy" --name db-migration-review
npx goat-flow skill new --draft ./draft.md          # validate location only, never writes
npx goat-flow skill new --interactive               # prompts for description, name, confirmation
```

Default destinations: skills install to `.claude/skills/<name>/SKILL.md`; playbooks/references install to `.goat-flow/skill-docs/playbooks/<name>.md`. The command does not edit `workflow/manifest.json`.

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

### `goat-flow quality validate <path-to-report>`

Validate a saved quality report JSON file against the report schema. Checks that the file exists, parses as JSON, and conforms to the expected quality-report shape. Exits `2` on a missing file, invalid JSON, or a schema violation, and `0` when the report is well-formed -- useful for verifying an agent-written report before consuming it.

```bash
npx goat-flow quality validate .goat-flow/logs/quality/2026-04-01-0900-claude-aaaaa.json
```

### `goat-flow manifest [--check] [--format json]`

Print the resolved single-source-of-truth manifest (agent registry, agent capability metadata, installed skills, required files, and derived facts). Pass `--check` to validate that the static manifest matches observed repo state and capability schema (exits non-zero on drift, used by CI).

```bash
npx goat-flow manifest                    # Print resolved manifest as Markdown
npx goat-flow manifest --format json      # Machine-readable manifest
npx goat-flow manifest --check            # Fail if manifest disagrees with live filesystem
```

### `goat-flow stats [--check] [--format json|markdown]`

Report learning-loop health: live entry counts by bucket, stale file refs, and `last_reviewed` freshness. Use `--check` in CI - it exits non-zero if any bucket is missing `last_reviewed`, uses a malformed date, contains stale file references, or has a generated `INDEX.md` that no longer matches its bucket content (`index-stale`; a never-generated index is only an advisory warning).

```bash
npx goat-flow stats                       # Learning-loop health report
npx goat-flow stats --check               # CI gate for bucket hygiene + index freshness
npx goat-flow stats --format json         # Machine-readable report
```

### `goat-flow index [path]`

Regenerate the generated learning-loop `INDEX.md` files for `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/` from bucket content. Each row maps one active entry to its source file with a grep-friendly `(search: "...")` anchor and a one-sentence hook; resolved entries are skipped. Output is deterministic - re-running with unchanged buckets produces a zero diff - and buckets whose directory is absent are skipped. Run it after adding, editing, renaming, or resolving any learning-loop entry; `stats --check` fails until you do.

```bash
npx goat-flow index                       # Regenerate all four bucket indexes
npx goat-flow index ../other-project      # Regenerate indexes in another project
```

### `goat-flow events tail [path] [--limit <n>] [--format json]`

Read the newest local evidence-envelope events from
`.goat-flow/logs/events/*.jsonl`. Text output is JSONL for piping; `--format json`
returns a pretty JSON array. Event records are checkout-local runtime continuity,
not committed project knowledge.

```bash
npx goat-flow events tail . --limit 20
npx goat-flow events tail . --limit 50 --format json
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

Copy or update goat-flow system files without an agent: skills, shared skill references, hook scripts, agent settings templates, `.goat-flow/` README/gitignore anchors, and `.goat-flow/config.yaml` when it is missing. Existing settings are skipped unless `--force` is passed. Existing config files are preserved, but legacy `agents:` allowlists are removed so the dashboard and aggregate CLI audit do not hide supported agent installs. The installer also appends `node_modules/` to the project root `.gitignore` when missing. For outdated or v0.9 projects the installer automatically updates the config version field and (for v0.9) removes deprecated skill directories; use `--force` for a full overwrite instead.

The shared references include `.goat-flow/skill-docs/README.md` for meta-reference doctrine, while `.goat-flow/skill-docs/playbooks/README.md` indexes tool/capability playbooks such as `browser-use.md` and `page-capture.md`. Generated or repaired instruction files include a Router Table pointer to `.goat-flow/skill-docs/playbooks/` so agents check local availability playbooks before declaring a tool unavailable.

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

Launch the web dashboard for auditing, setup, and terminal management. The Home learning-loop card shows per-bucket index freshness and can regenerate the selected project's generated `INDEX.md` files. Re-run `goat-flow index` after adding, editing, renaming, or resolving entries; `goat-flow stats --check` fails while the index is stale.

```bash
npx goat-flow dashboard               # Launch on default port
npx goat-flow dashboard --dev         # Live reload mode
```

### `goat-flow hooks <list|enable|disable|sync> [hook-id] [path]`

Manage the project's registered guardrail, quality, and safety hooks (`deny-dangerous`, `gruff-code-quality`, `post-turn-safety`, `plan-checkbox-guard`) in `.goat-flow/config.yaml`, then reconcile the per-agent hook config files so every agent stays in sync.

```bash
npx goat-flow hooks list                        # Show each hook's enabled/disabled state
npx goat-flow hooks list --json                 # Machine-readable hook state
npx goat-flow hooks enable gruff-code-quality   # Enable one hook and sync agent configs
npx goat-flow hooks disable gruff-code-quality  # Disable one hook and sync agent configs
npx goat-flow hooks sync                         # Re-apply config.yaml hook state to agent configs
```

`enable` and `disable` require a `<hook-id>` (exit 2 if omitted). `sync` re-applies the `.goat-flow/config.yaml` hook state to every agent's hook config without changing which hooks are enabled.

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
| Inspect local dashboard/session events | `npx goat-flow events tail . --limit 20` |
| Generate a setup prompt | `npx goat-flow setup . --agent claude` |
| Decide what kind of artifact to author | `npx goat-flow quality candidacy "..."` |
| Scaffold a new skill | `npx goat-flow skill new "..." --name <slug>` |
| Use this in CI | `npx goat-flow audit . --format json` |
| Export SARIF for code scanning | `npx goat-flow audit . --format sarif --output goat-flow-audit.sarif` |
| Open the dashboard | `npx goat-flow dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if audit doesn't pass
npx goat-flow audit . --format json --output report.json
```

**GitHub code scanning SARIF example:**

```yaml
permissions:
  contents: read
  security-events: write

steps:
  - uses: actions/checkout@v4
  - name: Run goat-flow audit as SARIF
    id: goat-flow-audit
    run: |
      set +e
      npx goat-flow audit . --harness --check-drift --check-content --format sarif --output goat-flow-audit.sarif
      status=$?
      echo "status=$status" >> "$GITHUB_OUTPUT"
      exit 0
  - name: Upload goat-flow SARIF
    uses: github/codeql-action/upload-sarif@v3
    if: always()
    with:
      sarif_file: goat-flow-audit.sarif
      category: goat-flow-audit
  - name: Enforce goat-flow audit gate
    if: steps.goat-flow-audit.outputs.status != '0'
    run: exit 1
```

The upload step is separate from the audit gate so failed audits still publish their SARIF file. GitHub categories distinguish multiple SARIF uploads for the same commit. Current GitHub code-scanning limits include 10 MB per gzip-compressed SARIF file, 25,000 results per run, and only the top 5,000 results displayed.

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
