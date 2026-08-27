# CLI Reference

## Commands

### `goat-flow`

Open an interactive menu. This is the default when the CLI is run with no arguments.

```bash
npx @blundergoat/goat-flow@latest
```

The menu can start the dashboard, copy/update goat-flow system files, generate a setup prompt, audit the current project, or show project status.

### `goat-flow audit [path] [flags]`

Validate setup correctness. The base audit runs two deterministic scopes (all pass/fail): GOAT Flow Setup and Agent Setup. Pass `--harness` to add the AI Harness Completeness scope (18 checks across 5 concerns - verifies structural installation of each concern). Harness results contribute to the overall audit status. Audit JSON/text also includes an advisory per-agent enforcement matrix; it explains hard, limited, soft, missing, and unknown enforcement evidence without changing pass/fail status.

| Flag | Description |
|------|-------------|
| `--agent <id>` | Filter to one manifest-backed agent id. Run `npx @blundergoat/goat-flow@latest manifest` to inspect the current registry. |
| `--harness` | Add AI Harness Completeness scope (18 checks, installed/not-installed per concern) |
| `--check-drift` | Add managed-artifact and peer-instruction drift detection |
| `--check-content` | Add cold-path content lint (vague terms, generic instructions, factual-claim drift) |
| `--trusted-target` | Execute the selected checkout's configured deny-hook handler and managed script for runtime proof. Omit this flag for static inspection. |
| `--untrusted-target` | Deprecated compatibility alias for the static, non-executing default. It remains accepted throughout v1.16.x and will not be removed before v1.17.0. It cannot be combined with `--trusted-target`. |
| `--format <type>` | Output: json, text, markdown, sarif (default: auto) |
| `--verbose` | Show per-check details |
| `--output <file>` | Write to file instead of stdout |

```bash
npx @blundergoat/goat-flow@latest audit .                      # Audit current directory
npx @blundergoat/goat-flow@latest audit . --harness            # Include AI harness completeness checks
npx @blundergoat/goat-flow@latest audit . --agent claude       # Audit scoped to Claude
npx @blundergoat/goat-flow@latest audit . --agent claude --trusted-target # Add trusted checkout runtime proof
npx @blundergoat/goat-flow@latest audit . --format json        # JSON output for CI
npx @blundergoat/goat-flow@latest audit . --format sarif       # SARIF output for CI/code scanning upload
npx @blundergoat/goat-flow@latest audit . --output report.json # Write to file
```

The enforcement matrix is deliberately conservative. It reports local facts such as deny-hook registration, secret-path file-read coverage, secret shell-read blocking, deny-hook self-test evidence, and runtime-shaped blocked-payload smoke evidence. General file read/write restriction capability remains `unknown` unless goat-flow has explicit evidence; it is not inferred from setup success or from a perfect constraints score.

Audit, setup-prompt generation, and quality-prompt generation inspect target hook configuration statically by default. `--trusted-target` opts the selected-agent audit inside those commands into target-controlled runtime execution. The dashboard remains static and has no target-execution flag.

When drift checking is active, the audit compares managed workflow artifacts with their installed copies and checks manifest-declared shared phrases across every distinct sibling instruction file present in the target. The sibling comparison still runs with `--agent <id>` because parity is a relationship between instruction files, not a property of one selected agent. A mismatch names the affected file, section, and phrase without choosing a canonical winner or proposing a rewrite. Multi-agent targets enable drift checking automatically; single-agent targets require `--check-drift`.

`--format sarif` exports the same deterministic audit findings as SARIF 2.1.0. It is an interchange format for CI and SARIF-aware tools; goat-flow is still reporting harness/setup integrity findings, not source-code vulnerabilities. Failing setup, agent, and harness checks become SARIF results. `--check-drift` and `--check-content` findings are included when those audit sections are enabled. Checks without target-file evidence are emitted without fabricated locations; GitHub code scanning accepts SARIF without annotations, but it only displays code annotations for results that include `locations[]`.

### `goat-flow quality [path] --agent <id> [--mode <mode>]`

Generate a structured quality-assessment prompt for a selected agent. Requires `--agent`. `--mode` selects the assessment contract: `agent-setup` (default), `process`, `harness`, or `skills`. The prompt keeps the completed report in memory and sends it to an exact-version `quality save` command. That bounded command strictly accepts the report shape, scrubs accepted strings, revalidates the report, and creates a gitignored file under `.goat-flow/logs/quality/`. Prose findings come back in the agent's reply; the JSON does not. Dashboard-launched enforced Claude reporting sessions use a different persistence contract (ADR-044): the session writes one staged draft with its file tool, and the dashboard server acquires an exclusive per-draft filesystem claim before running the same accept-scrub-revalidate-persist core. Competing processes skip live claims, and stale claims are rejected rather than replayed, so those prompts contain no saver command.

```bash
npx @blundergoat/goat-flow@latest quality . --agent claude         # Quality prompt for Claude
npx @blundergoat/goat-flow@latest quality . --agent claude --mode harness
npx @blundergoat/goat-flow@latest quality . --agent codex          # Quality prompt for Codex
```

The saver derives the date/time and a random suffix so parallel runs do not collide. If prior same-agent, same-mode quality history exists, the generated prompt embeds the latest saved report so the new review can mark current findings as `new` or `persisted`.

The CLI command composes the prompt with fresh, static audit context by default; add `--trusted-target` only after confirming the selected checkout may execute local hook code. The dashboard
Quality page may use cached audit enrichment for passive page loads, but its
Regenerate action follows the same fresh-audit path.

### `goat-flow quality candidacy <description> [--draft <file>] [--format json]`

Decide what kind of artifact a draft or description should become before authoring it. Returns one of `skill | reference | instruction-file | learning-loop | cli-command | do-not-create` with a deterministic rationale.

```bash
npx @blundergoat/goat-flow@latest quality candidacy "I want a workflow that reviews risky migrations before deploy"
npx @blundergoat/goat-flow@latest quality candidacy --draft ./draft.md
```

Candidacy is read-only. See [Skill Authoring](skill-authoring.md) for the full authoring workflow.

### `goat-flow skill new [<description>] [--name <slug>] [--red-log <file>] [--draft <file>] [--interactive] [--yes] [--agent <id>]`

Scaffold a new skill or playbook from a description, validate a draft's location,
or run interactively. Runs `quality candidacy` first. Skill recommendations
require a canonical failing RED receipt before confirmation; playbooks require
confirmation only (`--yes` for non-interactive flows).

```bash
npx @blundergoat/goat-flow@latest skill new "I want a workflow that reviews risky database migrations before deploy" --name db-migration-review --red-log .goat-flow/logs/sessions/2026-07-17-db-migration-review-tdd.md --agent codex
npx @blundergoat/goat-flow@latest skill new --draft ./draft.md          # validate location only, never writes
npx @blundergoat/goat-flow@latest skill new --interactive --name example-skill --red-log .goat-flow/logs/sessions/2026-07-17-example-skill-tdd.md
```

With `--agent`, skills install to that manifest profile's skill directory: Codex and Antigravity use `.agents/skills/<name>/SKILL.md`, Claude uses `.claude/skills/<name>/SKILL.md`, and Copilot uses `.github/skills/<name>/SKILL.md`. Without `--agent`, the existing `.claude/skills/<name>/SKILL.md` default remains. Playbooks/references install to `.goat-flow/skill-docs/playbooks/<name>.md`. The command does not edit `workflow/manifest.json`.

For a skill, `--red-log` must name a regular file under
`.goat-flow/logs/sessions/` whose filename matches
`YYYY-MM-DD-<name>-tdd.md`. Its first RED iteration must contain a concrete
`Scenario:`, at least three distinct pressure types from the authoring
methodology, an `Agent behaviour:` value that starts with an explicit failure
outcome, and at least one non-placeholder quoted rationalisation. Fields from a
later GREEN section do not satisfy RED. Until that receipt validates, no skill
file or draft is written. Fresh scaffolds defer their numeric score until GREEN,
REFACTOR, and STAY GREEN have run. Draft mode remains read-only and scores the
exact selected-agent draft.

### `goat-flow skill doctor [path] [--agent <id>] [--skill <name>] [--format text|json|markdown]`

Explain the static installation and invocation evidence for canonical goat-flow skills. The command is read-only: it never installs, repairs, edits, or invokes a skill.

```bash
npx @blundergoat/goat-flow@latest skill doctor .                              # All supported agent profiles and skills
npx @blundergoat/goat-flow@latest skill doctor . --agent codex               # Codex paths and `$goat-*` invocation text
npx @blundergoat/goat-flow@latest skill doctor . --agent codex --skill goat  # One canonical skill
npx @blundergoat/goat-flow@latest skill doctor . --agent codex --format json # Stable machine-readable report
```

For each selected agent and skill, the report shows:

- Canonical workflow source and installed skill-contract paths, including missing or unreadable state.
- Frontmatter parse status, `name`, trigger `description`, goat-flow version, and invocation-control fields only when the installed metadata actually declares them.
- Manifest-backed invocation syntax (`/goat-*` or `$goat-*`) and agent skill-source classification.
- Mirror status using the same normalized comparison as `audit --check-drift`.
- Static blockers for missing/unreadable files, malformed or empty discovery frontmatter, canonical-name mismatch, and duplicate installed names.
- Existing `install` and `audit --check-drift` commands that can repair or verify the artifact.

The status is `static-pass` when all selected skills are statically eligible and current, `warn` when eligibility remains but source/version/mirror evidence is incomplete or stale, and `fail` when at least one installed contract has a static blocker. `fail` exits 1; invalid agent or skill filters exit 2. JSON exposes `reportKind`, `status`, `target`, `evidenceLimit`, `summary`, and per-agent `skills` arrays. The summary reports `staticallyEligible` and `runtimeRegistration: "unverified"`; it never turns file eligibility into a runtime-availability verdict.

**Evidence limit:** this command checks files and manifest metadata. It cannot prove that a model will auto-trigger a skill, and it does not claim host behavior for unfamiliar invocation-control fields. Use the displayed explicit invocation when you want the skill deliberately.

### `goat-flow quality history [--agent <id>] [--all] [--format json]`

List saved quality reports and same-agent setup deltas. By default the text view shows the 20 most recent runs; `--all` lifts that limit.

```bash
npx @blundergoat/goat-flow@latest quality history --agent claude    # Claude-only saved runs
npx @blundergoat/goat-flow@latest quality history --all             # All saved runs
npx @blundergoat/goat-flow@latest quality history --format json     # Machine-readable report history
```

### `goat-flow quality diff [<from-id>:<to-id>] --agent <id> [--format json]`

Compare two saved same-agent reports. Without an explicit pair, diff uses the two most recent saved runs for `--agent`. With an explicit pair, use saved-report basenames (the filename without `.json`).

```bash
npx @blundergoat/goat-flow@latest quality diff --agent claude
npx @blundergoat/goat-flow@latest quality diff 2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb --format json
```

`quality diff` derives `absent`, `new`, `persisted`, and `stuck` from positional finding ids - those ids are the source of truth. An absent finding is missing from the later report; that alone does not prove it was fixed. The agent-reported `delta_tag` on each finding is consumed as a cross-check, not a classification: when the diff pair matches the newer report's `prior_report_id` baseline, findings whose `delta_tag` contradicts the deterministic class are listed in a `Delta-tag disagreements` section (`deltaTagDisagreements` in JSON output) as a methodology signal about the agent's continuity claims. `stuck` is a subset of persisted high-severity findings and resets after history gaps longer than 30 days.

### `goat-flow quality validate <path-to-report>`

Validate a saved quality report JSON file. Current-report rules run first: a report that satisfies them prints `OK <path>`. A report only the compatibility parser accepts prints `OK LEGACY-COMPATIBLE <path>` and names the missing current-report rule on stderr. That label reports historical readability - the file stays loadable by validate, history, and diff - and not acceptance by `quality save`, which parses strictly and would reject it. Exits `2` on a missing file, invalid JSON, or a report both parsers reject, and `0` for either receipt. Use it to verify an agent-written report before consuming it.

```bash
npx @blundergoat/goat-flow@latest quality validate .goat-flow/logs/quality/2026-04-01-0900-claude-aaaaa.json

# OK <path>                     current report; `quality save` accepts this shape
# OK LEGACY-COMPATIBLE <path>   readable only; stderr names the missing current-report rule
```

### `goat-flow quality save <project>`

Persist one current quality report supplied as JSON on stdin. The command strictly accepts the report shape in memory, scrubs accepted string values, revalidates the report, verifies its project and goat-flow versions, chooses an exclusive file under the selected project's `.goat-flow/logs/quality/`, and prints `OK <absolute-report-path>`. Current reports include `assessment_context` for run comparability and a required `refuted_candidates` array that records the suspected findings the assessor ruled out. The array may be empty. Historical reports that predate either field remain loadable through validate, history, and diff; a missing legacy refutation ledger is exposed as `[]`. The saver rejects caller-selected output paths and redirected report directories.

```bash
npx @blundergoat/goat-flow@latest quality save . <<'JSON'
{"report_kind":"goat-flow-quality-report","goat_flow_version":"<current-version>","agent":"claude","project_path":"<absolute-project-path>","run_date":"YYYY-MM-DD","audit_status":"pass","scope":"framework-self","rubric_version":"<current-version>","quality_mode":"skills","prior_report_id":null,"assessment_context":{"project_revision":"<git-head>","working_tree_state":"clean","grounding_status":"complete","unverified_probes":[],"score_confidence":"high"},"scores":{"setup":{"total":0,"accuracy":0,"relevance":0,"completeness":0,"friction":0},"system":{"total":0,"usefulness":0,"signal_to_noise":0,"adaptability":0,"learnability":0}},"findings":[],"refuted_candidates":[]}
JSON
```

### `goat-flow manifest [--check] [--format json]`

Print the resolved single-source-of-truth manifest (agent registry, agent capability metadata, installed skills, required files, per-file ownership, and derived facts). Markdown summarizes ownership classes and their update behavior; JSON includes the exact path, canonical source or generator, and ownership class. Pass `--check` to validate that the static manifest matches observed repo state and capability schema (exits non-zero on drift, used by CI).

```bash
npx @blundergoat/goat-flow@latest manifest                    # Print resolved manifest as Markdown
npx @blundergoat/goat-flow@latest manifest --format json      # Machine-readable manifest
npx @blundergoat/goat-flow@latest manifest --check            # Fail if manifest disagrees with live filesystem
```

### `goat-flow stats [--check] [--format json|markdown]`

Report learning-loop health: live entry counts by bucket, stale file refs, and `last_reviewed` freshness. Use `--check` in CI - it exits non-zero if any bucket is missing `last_reviewed`, uses a malformed date, contains stale file references, or has a generated `INDEX.md` that no longer matches its bucket content (`index-stale`; a never-generated index is only an advisory warning).

The report also lists **graduation candidates**. The effective incident count is the larger of a valid positive safe-integer `Incident count` and one base incident plus recognized line-start recurrence labels. Only active entries with at least two effective incidents are candidates. Per the feedback-loop doctrine in [harness-engineering.md](harness-engineering.md), that prevention should be promoted to a structural gate (preflight check, CI step, deny pattern) or the entry resolved.

Graduation candidates are report-only: they are omitted from `stats --check`, cannot fail that gate, and have no graduation-specific `--check` mode. A corpus without qualifying entries renders nothing extra.

```bash
npx @blundergoat/goat-flow@latest stats                       # Learning-loop health report
npx @blundergoat/goat-flow@latest stats --check               # CI gate for bucket hygiene + index freshness
npx @blundergoat/goat-flow@latest stats --format json         # Machine-readable report
```

### `goat-flow recall <path> [path...] [--format text|json]`

List active learning-loop entries whose `(search: ...)` evidence anchors cite the files or directories you name. File operands match exact normalized project-relative paths, including equivalent `./` forms. Directory operands match cited files beneath that directory.

Recall prints each matching entry's source path, heading, status, matching citations, and `Decision changed` guidance when present. It never inlines entry bodies or writes output files. Results are ordered by source path and heading, capped at 25 entries, and report the number of additional matches instead of truncating silently.

```bash
npx @blundergoat/goat-flow@latest recall src/cli/server/terminal.ts
npx @blundergoat/goat-flow@latest recall src/cli src/dashboard --format json
```

Use recall after the required INDEX-first Step 0 read when concrete files are already known. It supplements generated learning-loop indexes; it does not replace INDEX retrieval or relevance searches for symptoms and tools.

### `goat-flow learn new [path] --type <kind> --category <bucket> --title <title> [flags]`

Validate and scaffold one explicitly requested footgun, lesson, or pattern.
This is manual authoring, not automatic capture: the command never reads sessions, reports, reviews, or agent output to decide what becomes durable
project knowledge.
Search the generated index and category bucket first; consolidation and the decision to create a new entry remain the author's responsibility.

Use lowercase kebab-case for `--category` and one line for `--title`.
Repeat `--evidence <project-relative-path>` with one same-order `--search <literal>` for each citation.
Footguns require at least one pair plus `--evidence-kind ACTUAL_MEASURED|OBSERVED|EXTERNAL_REFERENCE`; lessons and patterns may omit evidence.
Search values use the same literal citation validator as learning-loop audits, so regex-shaped input is not interpreted as a pattern.

`--dry-run` runs the same destination, schema, duplicate-heading, and citation checks, then prints the entry without writing a bucket or index.
With `--format json`, `learn new` emits `command`, `subcommand`, `targetPath`, `wasWritten`, `warnings`, and `scaffold`.
A real write places the active entry above `## Resolved Entries`, regenerates learning-loop indexes, and runs `stats --check`.
If either follow-up fails after publication, the valid entry remains and the command prints `goat-flow index && goat-flow stats --check` for recovery.
Adjacent atomic replacement prevents partial bytes and the final recheck detects a cooperative editor save.
It does not claim to prevent a lost update in the residual interval after that check.

```bash
npx @blundergoat/goat-flow@latest learn new --type lesson --category verification --title "Check focused proof" --dry-run
npx @blundergoat/goat-flow@latest learn new . --type footgun --category hooks --title "Hook drift" \
  --evidence workflow/hooks/README.md --search "Generated index" --evidence-kind OBSERVED
```

### `goat-flow diagnostics context [path] [--agent <id>] [--format text|json|markdown]`

Measure static context pressure from local goat-flow files without runner telemetry, network calls, provider credentials, prompt bodies, or session logs. The report covers root agent instructions, installed skill bodies, manifest-owned skill references, shared references/playbooks, and learning-loop buckets already extracted by the shared facts pipeline.

```bash
npx @blundergoat/goat-flow@latest diagnostics context .                         # All installed agent mirrors
npx @blundergoat/goat-flow@latest diagnostics context . --agent codex           # Codex instruction and skill mirror
npx @blundergoat/goat-flow@latest diagnostics context . --format json           # Stable machine-readable schema
npx @blundergoat/goat-flow@latest diagnostics context . --format markdown       # Paste-ready report
```

Every surface shows UTF-8 bytes, lines, words when available, and a rough token estimate calculated as `ceil(UTF-8 bytes / 4)`. That estimate is a deterministic comparison aid, not the token count from a model invocation. Pressure labels reuse the selected project's instruction line target/limit, ADR-023's dispatcher/functional/reference word budgets, and the existing 40KB learning-loop bucket warning.

The top-five list ranks budgeted surfaces by their measured value divided by the applicable limit. `--agent` narrows instruction and installed-skill measurements to one runtime; without it, each installed agent mirror remains explicit because those runtimes load different paths. JSON uses the timestamp-free `goat-flow.context-report.v1` schema so repeated reads do not gain artificial drift.

`diagnostics` is the shared readout namespace. Context, readiness, support-bundle, and agent/tool threat-model readouts live here instead of adding unrelated top-level commands; unsupported subcommands exit with usage status 2.

### `goat-flow diagnostics readiness [path] [--agent <id>] [--format text|json]`

Summarize a target's static preparedness across Context, Constraints, Verification, Recovery, and Feedback loop before asking an agent to work there. The report reuses harness audit and stack-detection facts; it does not execute target hooks, tests, build scripts, lint, typecheck, formatting, or detected project commands.

```bash
npx @blundergoat/goat-flow@latest diagnostics readiness .                         # Advisory terminal summary
npx @blundergoat/goat-flow@latest diagnostics readiness . --agent codex           # Selected Codex target evidence
npx @blundergoat/goat-flow@latest diagnostics readiness . --format json           # Stable dashboard-ready schema
```

Each concern receives `ready`, `needs-attention`, `not-ready`, or `unknown`, backed by a separate `verified`, `inferred`, `missing`, or `unknown` evidence state. The report lists at most three failed-check blockers in canonical concern order and cites a target repair file only when failure copy, selected-agent detail, or one unambiguous target path supports it.

Detected test, lint, build, and format commands are shown as `inferred` and `disabled`; the readiness command never runs them. JSON uses the timestamp-free `goat-flow.readiness-report.v1` schema and states the no-execution boundary explicitly. Readiness labels are advisory and do not turn harness gaps into a release gate.

### `goat-flow diagnostics bundle [path] [--agent <id>] [--format text|json]`

Create one local, redacted support artifact from existing manifest, config, agent-setup, audit, quality-history, event-metadata, stack, and environment collectors. Use it when a maintainer needs reproducible setup evidence without asking a user to paste several command outputs.

```bash
npx @blundergoat/goat-flow@latest diagnostics bundle .                         # Concise terminal summary
npx @blundergoat/goat-flow@latest diagnostics bundle . --agent codex --format json
npx @blundergoat/goat-flow@latest diagnostics bundle . --format json --output support-bundle.json
```

JSON uses the stable `goat-flow.support-bundle.v1` schema. It includes allowlisted summaries, counts, capability booleans, and hash-only file fingerprints. It omits raw config values and commands, instruction/settings bodies, audit evidence and failure prose, quality finding bodies and report paths, event payloads and project paths, prompts, terminal scrollback, and full logs. Display metadata passes through the shared durable-text scrubber; this is a practical support boundary, not a claim of perfect data-loss prevention.

Successful evidence collection exits 0 when its composed audit passes. An audit-failing bundle remains parseable and exits 1; collection failure exits 1; a missing target exits 2. In JSON mode every one of those paths writes the same envelope before setting the process exit code. Text is intentionally compact and points users to `--format json` for the complete artifact. Bundles stay local unless the user chooses to share or upload them.

### `goat-flow diagnostics threat-model [path] [--agent <id>] [--format text|json]`

Show the configured agent/tool posture a maintainer reviews before trusting local automation. The report covers dangerous shell commands, network access, broad file writes, repository pushes, secret-bearing paths, and tool-call audit logging for each selected agent.

```bash
npx @blundergoat/goat-flow@latest diagnostics threat-model .                         # Compare configured agent surfaces
npx @blundergoat/goat-flow@latest diagnostics threat-model . --agent codex           # Review only the Codex setup
npx @blundergoat/goat-flow@latest diagnostics threat-model . --format json           # Stable PR/release artifact
```

Each surface is `restricted`, `permissive`, `unknown`, `unsupported`, or `not-configured`, with `SECURITY`, `CORRECTNESS`, or `INTEGRATION` severity and an evidence class such as `static-local`, `manifest-declared`, or `not-observed`. `permissive` means a known local control is absent; `unknown` means current facts cannot support either a protected or exposed claim; `unsupported` means the manifest defines no project-local enforcement surface for that runtime.

This command is advisory static analysis. It reuses manifest-backed agent facts and the present-only audit enforcement matrix, does not execute target hooks or project commands, and never reads secret-file contents. A local hook path or registered event is therefore configuration evidence, not proof that an external coding-agent runtime delivered the hook. Readiness and support-bundle output link to this report without copying its classifier.

### `goat-flow index [path]`

Regenerate the generated learning-loop `INDEX.md` files for `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/` from bucket content. Each row maps one active entry to its source file with a grep-friendly `(search: "...")` anchor and a one-sentence hook; resolved entries are skipped. Output is deterministic - re-running with unchanged buckets produces a zero diff - and buckets whose directory is absent are skipped. Run it after adding, editing, renaming, or resolving any learning-loop entry; `stats --check` fails until you do.

```bash
npx @blundergoat/goat-flow@latest index                       # Regenerate all four bucket indexes
npx @blundergoat/goat-flow@latest index ../other-project      # Regenerate indexes in another project
```

### `goat-flow redact [path] [--output <file>]`

Scrub readable continuation text before it reaches disk. Pipe a session, handoff, review, quality, security, or export draft through stdin; the command replaces common token, auth-header, cookie, private-key, URL-secret, CLI-argument, and environment-assignment shapes while preserving ordinary paths, commands, and issue URLs.

```bash
npx @blundergoat/goat-flow@latest redact
npx @blundergoat/goat-flow@latest redact --output .goat-flow/logs/sessions/handoff.md
```

Paste the candidate text into stdin and send EOF. Without `--output`, the safe text is written to stdout. With `--output`, only the scrubbed result is persisted. This is a practical pre-write guard, not perfect DLP; review sensitive artifacts before sharing them. The separate `redactEvidenceText` API remains a hash-and-length evidence contract and does not produce readable output.

### `goat-flow review validate [report-file] [--output <path>]`

Validate a drafted goat-review Markdown report from a file or stdin. Semantic anchors and the declared refutation ledger resolve against the current working directory, so run it from the reviewed project's root. Structural V1-V6/V8 failures exit `1`; advisory V7 shape warnings and unknown degradation flags are printed but retain exit `0`. By default the result prints to stdout; `--output` writes the same PASS/FAIL report to the selected file.

```bash
npx @blundergoat/goat-flow@latest review validate review.md
npx @blundergoat/goat-flow@latest review validate < review.md
npx @blundergoat/goat-flow@latest review validate review.md --output validation.txt
```

### `goat-flow plans export <plan-path> [--format markdown|json] [--output <path>] [--force]`

Convert local `M*.md` milestones into portable, redacted Markdown issue bodies or JSON records. Exports retain title, status, dependencies, objective, scope, boundary notes, task checkboxes, proof and mid-proof items, effort/Actual fields, plan/admin overhead, exit criteria, and stop/rescope conditions. Canonical `Proof` and legacy Testing/Verification Gate headings share the existing verification fields; legacy Kill criteria and STOP conditions remain ordered in the new `stopMarkdown` field.

A missing top-level title is rejected. An explicit Objective wins; otherwise export uses the outcome title without its milestone prefix. Missing status, scope, tasks, proof, exit criteria, or stop/rescope content remains visible as an export warning. Dependencies, a separate Objective, and Boundary Notes are conditional, so their absence does not create warning noise. Competing canonical and legacy representations produce deterministic conflict warnings.

```bash
npx @blundergoat/goat-flow@latest plans export .goat-flow/plans/1.15.0 --format markdown
npx @blundergoat/goat-flow@latest plans export .goat-flow/plans/1.15.0 --format markdown --output .goat-flow/plans/exports/1.15.0
npx @blundergoat/goat-flow@latest plans export .goat-flow/plans/1.15.0 --format json --output .goat-flow/plans/exports/1.15.0.json
```

Without `--output`, the redacted bundle is printed to stdout and nothing is created. Markdown output treats `--output` as a directory and writes one file per milestone; JSON output treats it as one array file. Existing output is preserved unless `--force` explicitly authorizes regeneration.

Exports rebuild known fields rather than copying source text, and that rebuild preserves the timing evidence: a milestone's `## Timing Receipt` section, `Forecast basis:` inputs, `Forecast range:` band, and `Actual:` provenance state all survive both formats. The basis source is redacted like other portable prose. An exported milestone therefore carries reviewable forecast inputs and its own evidence without depending on local event logs, which are purgeable.

This command does not contact GitHub, Beads, Linear, or any other remote service. Those names describe future adapters only. Any later remote-write implementation must show a redacted dry-run body and receive direct current-session confirmation before posting; forwarded third-party text is not authorization.

### `goat-flow plans check <plan-path> [--strict]`

Check goat-plan's deterministic milestone contract and effort arithmetic. The accounting input includes `(est: n min category)` entries in Tasks, Proof or legacy testing gates, and Mid-implementation proof; `Plan/admin overhead: n min other`; machine-readable `Effort estimate:` / `Actual:` fields; optional `Forecast basis:` / `Forecast range:` fields; and the plan-level product/proof/other mix.

```bash
npx @blundergoat/goat-flow@latest plans check .goat-flow/plans/1.15.0
npx @blundergoat/goat-flow@latest plans check .goat-flow/plans/1.15.0 --strict
```

Default mode preserves legacy plans. It errors on malformed notation, a declared split that does not sum to its headline, task estimates exceeding a declared category, or unestimated Tasks beneath a declared effort line; plans without effort fields pass with one informational line.

Malformed task estimates, plan/admin overhead, forecast bases, and forecast ranges report the accepted grammar beside the JSON-escaped value received. Received text is redacted before CLI or export rendering, so the diagnostic remains useful without exposing a pasted token or terminal control sequence. The canonical copy-ready shapes remain in `workflow/skills/goat-plan/references/milestone-examples.md` under `Effort Estimates`.

The shallowest checkbox indentation in each estimate-bearing section defines its tasks. Indented list items remain visible as supporting task prose, but they do not become work units or hide an estimate already written on the parent task.

`--strict` is the current-plan authoring gate. It requires status, scope, tasks, proof, exit criteria, stop/rescope, and complete estimate accounting. Fenced examples do not supply live fields, headings, or checkboxes; duplicate fields and competing sections fail. Effort values must match the complete notation and fit in safe integers. Multi-milestone plans also require `Depends on: none` or comma-separated exact local milestone IDs. Filenames must start with uppercase `M` plus digits, IDs must be numerically unique, every multi-milestone title must start with its matching ID, dependencies must resolve without self-reference or cycles, and active or completed milestones require completed prerequisites.

Strict lifecycle checks accept `not-started`, `in-progress`, `testing-gate`, `human-verification-pending`, `blocked`, `abandoned`, and `complete`. They reject contradictory snapshots such as checked implementation, proof, mid-proof, or exit items before start; open implementation work at testing; open executor proof or missing Actual at human review; open proof at completion; or multiple active milestones. Only explicitly tagged `[human]` proof may remain open at `human-verification-pending`; checkbox state never proves who approved a gate.

Strict validation checks supplied deterministic structure, not planning judgment. It does not infer risk level or require assumptions, manual proof, rollback, Boundary Notes, or other conditional fields. Default mode remains legacy-compatible, and neither mode reconstructs approval history or evaluates whether proof is semantically sufficient.

`Actual:` accepts four provenance states: `measured`, `retrospective`, `unavailable`, and `incomplete`. A `measured` Actual must reconcile with a finalized `## Timing Receipt` - its minute allocation and its cited raw seconds both have to match. Untagged legacy numerics classify as `retrospective`, so prose claiming measurement never promotes an Actual the receipt does not back. A malformed receipt fails strict validation when a `measured` Actual claims authority from it or while the receipt is active and controls executing work. Hand-written historical receipts sitting beside retrospective Actuals stay advisory, so finished plans are not invalidated by evidence nothing depends on.

`Forecast basis:` and `Forecast range:` remain optional, so legacy point-estimate plans need no migration. A supplied basis counts positive agent-owned Task, Proof, Mid-proof, and admin entries while excluding `[HUMAN]` and zero-minute items. Its positive low-likely-high rates must be ordered; multiplying them by the unit count derives the range by flooring low (minimum one), rounding likely, and ceiling high. The declared unit count, range, and `Effort estimate` headline must all agree. A range without a basis retains its legacy check: `low <= likely <= high`, with likely equal to the headline.

Calibration output is informational and never affects the exit code. It retains estimate-to-Actual ratios and separately divides raw receipt seconds by matching, countable bases. Only `complete` milestones with `measured` Actuals qualify - `complete` is the human ratification signal, so `human-verification-pending` never calibrates a forecast. Below three eligible work-unit samples, authors use the conservative `0.5-2.5-10 min/unit` cold-start prior. At three or more, the report shows each sample plus observed low, median, and high rates; an unfinished basis that still uses different rates receives `reforecast required`. The CLI reports that action but never rewrites the plan.

Plan-level drift beyond 15 percentage points produces an advisory with exit 0. Roughly 70/20/10 is a flexible diagnostic guide, never a quota or pass/fail rule: consolidate duplicated proof, but retain and explain proof justified by the task's risk. This command remains user-invoked and outside `audit` because plans are optional local workflow state. The report prints to stdout; `--output` and `--force` are rejected.

### `goat-flow plans time <start|stop|status> <milestone-file> [--category <c>] [--finalize|--discard-open]`

System-stamp active-work spans into one milestone's `## Timing Receipt`. The CLI supplies UTC and epoch seconds; the agent supplies only the category. Because the receipt lives inside the milestone file, it survives log purges and moves with the plan.

`plans time start` requires exactly one rendered `Status:` field set to `in-progress` or `testing-gate`; fenced and commented examples do not count. Status, stop, finalize, and discard recovery remain available after lifecycle drift. Stop or finalize the clock before changing status to `human-verification-pending`, `blocked`, `abandoned`, or `complete`; strict validation rejects active human-wait and terminal snapshots so those waits cannot inflate measured Actual time.

```bash
goat-flow plans time start .goat-flow/plans/<active>/M01-example.md --category product
goat-flow plans time status .goat-flow/plans/<active>/M01-example.md
goat-flow plans time stop .goat-flow/plans/<active>/M01-example.md
goat-flow plans time stop .goat-flow/plans/<active>/M01-example.md --finalize
```

One span is open at a time. `stop` then `start` performs a pause, a resume, or a category change; switch category when the kind of work changes, since a single span across mixed work produces a `measured` split that measured nothing. `stop --finalize` closes the timeline at the human gate. `stop --discard-open` drops a span with no honest end time - a crash, a suspend, a forgotten pause - and permanently marks the receipt `incomplete`; no recovery path invents an end time.

The milestone path is resolved inside its containing project, and symlinked or hardlinked milestone paths are rejected so a write cannot be redirected outside that root. Each transition also appends a metadata-only `plan.time` event to the local evidence log, but strict validation never reads it: the embedded receipt is the only authority, and deleting local events cannot rot a finalized `measured` Actual. Receipts carry bounded timing metadata only - never prompts, commands, output, or work descriptions.

### `goat-flow events tail [path] [--limit <n>] [--format json]`

Read the newest local evidence-envelope events from
`.goat-flow/logs/events/*.jsonl`. Text output is JSONL for piping; `--format json`
returns a pretty JSON array. Event records are checkout-local runtime continuity,
not committed project knowledge.

```bash
npx @blundergoat/goat-flow@latest events tail . --limit 20
npx @blundergoat/goat-flow@latest events tail . --limit 50 --format json
```

### `goat-flow setup [path] --agent <id> [--dry-run] [--apply] [--force]`

Generate a setup prompt adapted to the project's current state. An existing goat-flow installation routes to the upgrade path instead.

Setup's selected-agent audit is static by default. Add `--trusted-target` only when the setup prompt should include runtime deny-hook proof from a checkout whose hook configuration you have inspected and trust.

Supported agent ids are read from `workflow/manifest.json` via `src/cli/agents/registry.ts`, so the CLI help and validation stay aligned with the machine-readable support matrix.

```bash
npx @blundergoat/goat-flow@latest setup --agent claude    # Claude setup/upgrade prompt
npx @blundergoat/goat-flow@latest setup --agent codex     # Codex setup/upgrade prompt
npx @blundergoat/goat-flow@latest setup . --agent codex --dry-run
npx @blundergoat/goat-flow@latest setup . --agent claude --apply
```

Use `--dry-run` to inspect managed template drift without composing a prompt or invoking the installer. Use `--apply` when you want setup to run the deterministic file-copy installer instead of printing a prompt. Use `--force` with `--apply` only after inspection to accept every inspected system-owned conflict. Settings, hook configs, and `.goat-flow/config.yaml` remain preserved; a replaceable user-owned file requires both `--force-user-owned` and a matching `--force-path`.

### `goat-flow install [path] --agent <id> [--dry-run] [--force] [--update-config-version] [--clean-deprecated]`

Copy or update goat-flow system files without an agent: skills, shared skill references, hook scripts, agent settings templates, `.goat-flow/` README/gitignore anchors, and `.goat-flow/config.yaml` when it is missing. Manifest ownership controls every write: system-owned files refresh from canonical sources, user-owned files seed once, generated files name their regeneration command, deprecated files produce cleanup guidance, and external files are never overwritten. Existing user-owned content is preserved; a source-backed replaceable file needs `--force-user-owned` plus a matching `--force-path`. Existing config files are preserved, but legacy `agents:` allowlists are removed so the dashboard and aggregate CLI audit do not hide supported agent installs. The installer also appends `node_modules/` to the project root `.gitignore` when missing. For outdated or v0.9 projects the installer automatically updates the config version field and (for v0.9) removes deprecated skill directories; use both user-owned authority flags for an eligible explicit replacement instead.

The shared references include `.goat-flow/skill-docs/README.md` for meta-reference doctrine, while `.goat-flow/skill-docs/playbooks/README.md` indexes tool/capability playbooks such as `browser-use.md` and `page-capture.md`. Generated or repaired instruction files include a Router Table pointer to `.goat-flow/skill-docs/playbooks/` so agents check local availability playbooks before declaring a tool unavailable.

```bash
npx @blundergoat/goat-flow@latest install . --agent claude
npx @blundergoat/goat-flow@latest install . --agent codex --dry-run
npx @blundergoat/goat-flow@latest install . --agent codex --force
```

`--dry-run` prints a read-only preview of the install write set as text or stable `goat-flow.managed-setup-preview.v2` JSON. Every row carries a repository-relative path, its manifest ownership, a state, and the proposed action and reason. Exact-copy `system-owned` templates are classified as `unchanged`, `template-changed`, `local-preserved`, `both-changed`, `added`, `adopted`, `removed`, `missing`, or `unmanaged`. Destinations with no package template use four further states: `user-seeded` for a user-owned file install may create once, `user-preserved` for user-owned content install keeps, `user-migrated` for a user-owned file install edits in place, and `regenerated` for a generated file install rewrites from project state. Every row also carries an `authority` decision - `not-required`, `granted-managed`, `granted-path`, `granted-user-owned`, `withheld`, or `refused-path-safety` - resolved against the same flags apply would use, so dry-run accepts every authority and migration flag and still writes nothing. A blocked preview exits 1; invalid flags exit 2. `--output` is the only optional dry-run write and writes the requested report, not setup state or installed files.

The comparison uses SHA-256 hashes only. `.goat-flow/install-state/managed.json` is the sole project-wide baseline: each managed path has one expected hash, generation, and provenance. The same file carries hashless verified-agent receipts that bind a package version to an exact path and row-generation set. A receipt remains confirmed only while its package version, path set, referenced generations, regular target bytes, and cutover marker still match. Any mismatch makes the receipt stale, so it cannot select an installed agent; the baseline row remains available to distinguish a preserved local edit from a later template change.

Before `managed.json` exists, the public CLI inventories every supported agent's legacy `.goat-flow/install-state/<agent>.json` evidence together. Clean, version-ordered evidence bootstraps receipt-free v2 state. One malformed legacy file, or equal or unrankable versions that disagree on a path hash, blocks every agent because selecting one agent cannot resolve project-wide history. Repair the paths named by `goat-flow status . --format json`, then rerun that command; `--force` cannot choose baseline history. Once `managed.json` exists, legacy hashes never regain baseline authority. A public install publishes the v2 state and replaces every supported agent file with a hashless cutover marker under the complete write claims before target mutation. A missing or incompatible marker is reported as `cutover-incompatible` and repaired only through the public install path.

The preview lists every path an approved install may write: source-backed `system-owned` manifest records and the selected agent's canonical skill mirror. It also lists `.goat-flow/config.yaml`, the agent's settings and hook config, the project root `.gitignore`, seeded policy and decision guidance, the active-plan marker, commit guidance, `.goat-flow/install-state/managed.json`, every supported agent's `.goat-flow/install-state/<agent>.json` cutover marker, and the generated learning-loop indexes. Some rows are conditional, so the preview is a superset: `.goat-flow/plans/.active` is written only when exactly one version-named plan directory exists, and commit guidance only in a Git project. It does not enumerate removals: retired templates, deprecated skills, legacy hook copies, and pre-1.9 path migrations are cleanup rather than writes.

Direct `workflow/install-goat-flow.sh` execution remains a low-level copy helper only before v2 authority exists. It skips CLI admission, post-write verification, and receipt publication. After `managed.json` or any cutover marker exists, the script refuses before target mutation and prints the public `goat-flow install` command. Use the public CLI for managed installs so target verification and receipt publication stay in one claimed lifecycle.

If target writes verify but the final state write fails, the CLI reports that installed bytes were not recorded. The previous baseline remains intact and no new confirmed receipt is published. Repair write access to `.goat-flow/install-state/`, then rerun the exact non-force `goat-flow install` command printed by the failure. Do not delete state or add force: force authorizes inspected target conflicts only and cannot repair malformed or conflicting history, stale receipts, cutover evidence, or orphan rows. Ordinary install retains orphan rows until a separate explicit cleanup contract can prove they are retired; it never prunes them by inference.

A locally edited managed file no longer blocks an upgrade on its own. When your bytes differ but this package ships the same template as your last install, the row reads `local-preserved` and install leaves the file alone while every unrelated write proceeds. Only a genuine template change over your edit becomes `both-changed`, which is a conflict you decide.

If the preview blocks, inspect the listed paths, then choose the narrowest authority that covers them:

| Authority | Admits |
|---|---|
| `--force-path <path>` | one named `system-owned` conflict; repeat the flag per path |
| `--force-managed` | every inspected `system-owned` conflict |
| `--force` | alias for `--force-managed` |
| `--force-user-owned` plus a matching `--force-path` | replaces exactly the named user-owned file from its template |

`--force-user-owned` on its own exits 2: replacing your content is never a broad choice. A `--force-path` that matches no row in the preview also fails, naming why - a typo, or a user-owned path that still needs `--force-user-owned`. No authority reaches a symlinked, non-regular, or unreadable destination; those stay blocked until you repair the path. The preview itself needs no rollback because it changes nothing. Before an authorized replacement, preserve the listed files with version control or a separate backup; after apply, use that same VCS/backup evidence to restore them if the result is not wanted.

### Atomic installer writes

Apply completes each copied, generated, or transformed file in a uniquely named staging directory beside its destination. Only a complete payload is renamed into place. If copy or generation fails, or the process receives `INT`, `TERM`, or `HUP`, the previous destination stays intact and goat-flow removes only its own staging payload. A warning that says `staging cleanup incomplete` includes the exact leftover directory to inspect; goat-flow never recursively removes unexpected content from it.

Adjacent staging keeps the final rename on the destination filesystem. If that rename still fails, goat-flow reports `atomic replacement failed` and stops without a non-atomic copy fallback. Legacy migrations likewise preserve their source when same-filesystem rename cannot be proved. The guarantee is per file rather than whole-install transactional: completed earlier files remain applied when a later file fails.

For a failed staged replacement, no content rollback is needed because the old destination remains visible. For a successful replacement that you later reject, inspect the listed path with `git diff -- <path>` and restore a tracked file with `git restore -- <path>`, or restore an untracked file from the backup taken before apply. Fix the reported path or filesystem problem before rerunning install.

The installer does not create project-specific content such as the instruction file, architecture, code map, glossary, patterns, footguns, or lessons. Run `goat-flow setup . --agent <id>` afterward for the guided prompt that creates or refreshes those surfaces.

### `goat-flow status [path]`

Show project adoption state (`bare`, `partial`, `v0.9`, `outdated`, `current`, `error`) and recommended next action (`setup`, `migration`, `upgrade`, `fix`, `audit`, `incomplete`).

```bash
npx @blundergoat/goat-flow@latest status .                    # Check current project state
```

### `goat-flow dashboard [path]`

Launch the web dashboard for auditing, setup, and terminal management. The Home learning-loop card shows per-bucket index freshness and can regenerate the selected project's generated `INDEX.md` files. Re-run `goat-flow index` after adding, editing, renaming, or resolving entries; `goat-flow stats --check` fails while the index is stale.

```bash
npx @blundergoat/goat-flow@latest dashboard               # Launch on default port
npx @blundergoat/goat-flow@latest dashboard --dev         # Live reload mode
```

### `goat-flow hooks <list|enable|disable|sync|verify> [hook-id] [path]`

Manage the project's registered guardrail, quality, and safety hooks (`deny-dangerous`, `gruff-code-quality`, `post-turn-safety`) in `.goat-flow/config.yaml`, then reconcile the per-agent hook config files so every agent stays in sync.

```bash
npx @blundergoat/goat-flow@latest hooks list                        # Show desired and per-agent effective state
npx @blundergoat/goat-flow@latest hooks list --json                 # Machine-readable hook state
npx @blundergoat/goat-flow@latest hooks enable gruff-code-quality   # Enable one hook and sync agent configs
npx @blundergoat/goat-flow@latest hooks disable gruff-code-quality  # Disable one hook and sync agent configs
npx @blundergoat/goat-flow@latest hooks sync                         # Re-apply config.yaml hook state to agent configs
npx @blundergoat/goat-flow@latest hooks verify . --agent claude --scenario deny-hook --trusted-target
npx @blundergoat/goat-flow@latest hooks verify . --agent claude --scenario post-turn-hook --trusted-target
npx @blundergoat/goat-flow@latest hooks verify . --agent claude --scenario gruff-hook --trusted-target
```

Goat Flow registers Codex project hooks for the `PreToolUse` deny policy, opt-in `PostToolUse` Gruff analysis on `apply_patch`, and default `Stop` safety. The Windows registration adds Codex's documented `commandWindows` override, which invalidated the earlier Codex CLI 0.147.0 `PostToolUse` and `Stop` delivery capture. A Codex CLI 0.149.0 capture proved that the changed `PreToolUse` registration delivered a deny result; that evidence expires at 2026-09-21T02:17:08.834Z. A trusted Codex CLI 0.149.1 `exec` capture subsequently completed `apply_patch`, ran Gruff, and delivered its analyzer-only marker through the changed PostToolUse registration; that evidence expires at 2026-09-25T20:17:22.830Z. Both records remain `scenario-unverified` until their fixed-scenario gates pass, while Stop remains `provider-capture-stale`. Exact configured-command replay does not upgrade provider-delivery evidence. Project-layer trust and handler trust remain separate, and app-server, remote execution, Stop, and other provider combinations are unclaimed. See the [hook runtime matrix](../workflow/hooks/README.md#agent-event-name-mapping) for registered and disabled combinations.

`enable` and `disable` require a `<hook-id>` (exit 2 if omitted). `sync` re-applies the `.goat-flow/config.yaml` hook state to every agent's hook config without changing which hooks are enabled.

`hooks verify` requires `--agent <id>` and an explicit `--scenario`: one group (`deny-hook`, `post-turn-hook`, `gruff-hook`) or `all` to run every group in one command. There is no default; omitting `--scenario` exits `2`. Without `--trusted-target`, it returns explicit `unsupported` results and does not start the selected checkout's hook code. After you confirm the checkout is trusted, `--trusted-target` sends fixed provider-shaped inputs through the exact command generated for the selected agent, with the hook's registered timeout and bounded output capture. Deny probes use 30 seconds; post-turn and Gruff probes use 90 seconds. The deny group checks three blocked commands and one read-only control. The post-turn group checks a valid Stop result and an invalid event. The Gruff group checks unsupported input, a non-source edit, and a source edit whose analyzer result may be clean, advisory, incomplete, or unavailable. The inputs are inspected; their command operands are never executed. The deprecated `--untrusted-target` flag remains an explicit alias for the safe default during the v1.16.x compatibility window.

Each scenario reports `pass`, `fail`, `unsupported`, `not-configured`, or `error`. Only an accepted expected/observed match with a successfully written local event counts as `pass`; any other result makes the report exit 1. JSON uses `goat-flow.hook-runtime-report.v1`. `--scenario all` runs the groups in sequence, keeps every group's result even after one fails, and wraps the unchanged per-group reports in one `goat-flow.hook-runtime-batch.v1` document; the batch exits 1 unless every group passed. Reports and `hook.verify` events carry hook and scenario ids, verdict metadata, evidence level, duration, and reason codes - never input payloads, command operands, findings, stdout, or stderr.

Hook self-tests remain the broad internal regression corpus. `hooks verify` proves fixed outcomes at this checkout's exact configured-command boundary. It does not launch the external coding agent, prove provider-side hook delivery or model visibility, promote a live-support state, or change the cost or semantics of `audit --harness`.

## Workflow Examples

Common tasks and the commands to run:

| I want to... | Command |
|--------------|---------|
| Check if my project is ready | `npx @blundergoat/goat-flow@latest audit .` |
| Check harness completeness | `npx @blundergoat/goat-flow@latest audit . --harness` |
| Copy/update system files | `npx @blundergoat/goat-flow@latest install . --agent claude` |
| Get a quality prompt | `npx @blundergoat/goat-flow@latest quality . --agent claude` |
| Get a harness quality prompt | `npx @blundergoat/goat-flow@latest quality . --agent claude --mode harness` |
| Review quality trend history | `npx @blundergoat/goat-flow@latest quality history --agent claude` |
| Compare two saved quality runs | `npx @blundergoat/goat-flow@latest quality diff --agent claude` |
| Scrub a durable handoff before saving it | `npx @blundergoat/goat-flow@latest redact --output .goat-flow/logs/sessions/handoff.md`, then paste stdin and send EOF |
| Inspect local dashboard/session events | `npx @blundergoat/goat-flow@latest events tail . --limit 20` |
| Generate a setup prompt | `npx @blundergoat/goat-flow@latest setup . --agent claude` |
| Decide what kind of artifact to author | `npx @blundergoat/goat-flow@latest quality candidacy "..."` |
| Scaffold a new skill after RED | `npx @blundergoat/goat-flow@latest skill new "..." --name <slug> --red-log <session-log>` |
| Explain whether installed skills are statically eligible | `npx @blundergoat/goat-flow@latest skill doctor . --agent codex` |
| Use this in CI | `npx @blundergoat/goat-flow@latest audit . --format json` |
| Export SARIF for code scanning | `npx @blundergoat/goat-flow@latest audit . --format sarif --output goat-flow-audit.sarif` |
| Open the dashboard | `npx @blundergoat/goat-flow@latest dashboard .` |

**CI pipeline example:**

```bash
# Fail the build if audit doesn't pass
npx @blundergoat/goat-flow@latest audit . --format json --output report.json
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
      npx @blundergoat/goat-flow@latest audit . --harness --check-drift --check-content --format sarif --output goat-flow-audit.sarif
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
npx @blundergoat/goat-flow@latest audit .
# 2. Copy deterministic system files
npx @blundergoat/goat-flow@latest install . --agent claude
# 3. Generate a setup prompt for project-specific files
npx @blundergoat/goat-flow@latest setup . --agent claude
# 4. Open the dashboard for guided setup
npx @blundergoat/goat-flow@latest dashboard .
```

## Help and version flags

| Flag | Description |
|------|-------------|
| `--help, -h` | Show global or contextual help without running a project command |
| `--version, -v` | Show version |

Global `goat-flow --help` stays concise so you can choose a workflow quickly.
Run `goat-flow <command> --help` for contextual help with that command's usage, subcommands, flags, and examples.

Help uses static CLI metadata and returns before command dispatch, so it remains available when the target project is missing, incomplete, or drifted.
Help does not route nested subcommand requests separately: `goat-flow hooks verify --help` shows the top-level `hooks` topic.
Use this reference for the full subcommand grammar.
