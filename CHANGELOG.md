# Changelog

## v1.4.2 - 2026-05-04

Dashboard agent-targeting fix, audit scope consistency for setup prompts, harness-card prompt scope, and harness fix prompt improvements.

- **Dashboard agent targeting** - Home "Fix First" card, harness fix prompts, and action commands now resolve the target agent from audit data (`failingHarnessAgent()`) instead of always using `activeRunner`. Prevents misleading `--agent claude` commands when a different agent (e.g. codex at 93%) has the actual failing harness check. Quality pill label now shows which agent the score belongs to. (`src/dashboard/views/home.html`)
- **Audit scope consistency** - The `/api/setup` route now runs audit with `harness: true` and requests `harness-card` prompt scope, matching the harness-scored grades shown on Setup target cards. Previously the route used `harness: false` while the display used harness scores, producing contradictory pass/fail signals on the same page. (`src/cli/server/dashboard-routes.ts`)
- **Harness-card prompt scope** - New `SetupPromptScope` type (`"full" | "harness-card"`) in `compose-setup.ts`. Harness-card scope isolates status and failed-check collection to `scopes.harness` only (excluding metrics and acknowledged checks), with a dedicated pass renderer (`renderHarnessCardPass`) and scope-aware re-run commands that include `--harness`. Full scope now collects failures from all three audit scopes (setup + agent + harness) instead of omitting harness.
- **Harness fix prompt rework** - `harnessFixPrompt()` in the Home view now targets `failingHarnessAgent()`, includes agent-scope and harness-scope check failures alongside concern findings, filters out metrics and acknowledged checks, and provides a safe empty-scores fallback that asks the agent to re-run audit before proposing fixes.
- **Setup cache invalidation** - Fresh audit loads now clear cached `setupOutputs` and reset the project-path tracker, triggering prompt regeneration when the Setup view is active. Prevents stale prompts from persisting after a re-audit. (`src/dashboard/app.ts`)
- **Footgun: runner-vs-target agent confusion** - New entry in `.goat-flow/footguns/dashboard.md` documenting the `activeRunner` vs failing-agent conflation and the audit-scope mismatch, with real evidence from 2026-05-03 (basedata.halaxy.net project) and three prevention rules.
- **goat-plan skill wording** - Clarified that `/goat-critique` is invoked as the delegated alternatives pass before writing milestone files. Updated across all 4 agent skill copies.
- **Test coverage** - 2 new `/api/setup` integration tests for harness-card pass-through and failure remediation, with a ~100-line `makeDashboardSetupPromptProject()` factory. 2 new `composeSetup` unit tests for scope-aware routing. 1 new `dashboardGenerateSetupPrompt` unit test verifying cache invalidation on project-path change. `makeAuditReport()` helper extended with `harnessChecks` parameter.
- **Release propagation** - Package/config/manifest, skill mirrors, shared references, security reference packs, fixtures, hooks, and instruction files bumped to 1.4.2. Manifest snapshot `v1.4.2.json` frozen.

## v1.4.1 - 2026-05-03

Instruction file quality guards, execution loop skill integration, deny-dangerous search command blocking, harness audit expansion, and shared tool-playbook discoverability.

- **Instruction file quality guards** - `preflight-checks.sh` gained four guards: line count against the configured target, router table parity across instruction files and setup templates, encyclopedia/downstream detection (flagging verbatim setup-template content in live instruction files), and Quality Bar template presence. Backed by a 351-line contract test suite (`instruction-quality-guards.test.ts`).
- **Deterministic parity guard** - New `scripts/check-instruction-parity.mjs` validates canonical section order and required phrases across all four instruction files and their setup templates, catching structural drift between what setup generates and what the live files contain.
- **Execution loop skill integration** - goat-* skills now declare mode/depth at Step 0, replacing READ. SCOPE gates on write phases (e.g. `/goat-plan` Phase 2, `/goat-debug` D3) require explicit approval before file writes. Added to all four instruction files and setup agent templates.
- **Deny-dangerous search command blocking** - New `strip_shell_quotes_for_path_scan()` catches secret paths split or quoted with shell tricks (`cat '.'env`). Search command operand analysis blocks attempts to read secrets via search tool arguments or pattern files (`grep foo .env`, `grep -f .env`). Self-test suite expanded with search and quoting scenarios across all 6 hook copies.
- **Harness audit expansion** - Verification concern now scans for recent (≤14-day) validation artifacts in `.goat-flow/logs/`. Recovery concern tracks unchecked milestone items, next-action clarity, testing-gate status, and archive state. Constraints concern refactored with clearer fact-gathering. Audit test coverage expanded.
- **Skill-reference discoverability** - Generated and maintained instruction files now append the READ rule that agents must check `.goat-flow/skill-reference/` before declaring a tool or capability unavailable, and their Router Tables point at the tool playbooks directory.
- **Skill Reference Index** - Installs `.goat-flow/skill-reference/README.md` from `workflow/skills/reference/README.md`, with a ToolSearch/harness-only anti-pattern callout, available-reference table, authoring guidance for new references, and browser-use incident provenance.
- **Audit enforcement** - Added the default setup check [`instruction-file-skill-reference-pointer`](docs/audit-checks.md#setup-scope-14). When `.goat-flow/skill-reference/` exists, audit fails if the README index is missing or any present instruction file lacks a literal `.goat-flow/skill-reference/` pointer; projects without the directory get a skipped check.
- **Instruction file budget** - Line target raised from 120 to 125 across `config.yaml`, `compose-quality.ts`, and the Copilot template to accommodate skill-reference and execution-loop additions.
- **Release propagation** - Package/config/manifest, skill mirrors, shared references, security reference packs, fixtures, hooks, and instruction files bumped to 1.4.1. Manifest snapshot `v1.4.1.json` frozen.

## v1.4.0 - 2026-05-02

Cross-rater skill quality audit, skill hardening, deny-dangerous security fixes, structural reorg, dispatcher rewrite, and v1.3.3 features rolled in.

- **Cross-rater skill quality audit** - Three independent raters (Claude, Codex, Gemini) scored all 6 skills on a 10-axis rubric. Average improved from 76/100 to 87/100. All 6 skills now have Excuse/Reality tables grounded in real incidents.
- **Skill hardening** - goat-review gained Proof Capsule (4-class classification), Refutation Ledger, Blast Radius Rule, Ship Verdict, Step 0.5 Intent Reconstruction, and Pass 3 Cross-Model Refuter. goat-debug gained Debug Integrity and D1.5 Minimise. goat-security gained Security Assessment Integrity, Phase 5.5 Exploit Chaining, and Persist Gate. goat-critique gained Phase 5.5 meta-audit, Phase 5.6 outcome capture, and integration hooks. goat-qa gained A1.5 Scope-Size Gate, Verification Integrity with OBSERVED/INFERRED/UNVERIFIED tagging, and Coverage Depth vocabulary.
- **Deny-dangerous security fixes** - `rm_is_safely_scoped` hardened against trailing-slash bypass (`rm -rf src/`), multi-path bypass (`rm -rf src/old /`), and tilde-path bypass (`rm -rf ~/.ssh`). Restored accidentally-removed `sudo` prefix stripping and `env -S`/`--split-string` parsing for git-push enforcement. 18 new self-test cases across all 6 hook copies.
- **goat-critique context leak scan** - Scan now only flags references absent from the input artifact, preventing false positives when critiquing goat-flow itself.
- **Browser-use installer** - Added `browser-use` CLI wrapper alongside `browser-use-python` so `browser-use doctor` and subcommands work after install.
- **Dashboard session pruning** - `dashboardEndAllSessions` now prunes `_projectActiveSession` alongside other session structures, preventing stale mappings to deleted sessions.
- **Structural reorg** - Patterns directory split into 5 categorised buckets. 5 skill-specific reference packs relocated from shared `skill-reference/` to per-skill `references/` subdirectories. DDT layer removed (ADR-027).
- **Dispatcher rewrite** - Route Snapshot output contract, multi-intent decomposition, GATHER checklist, no-inspect constraint, degraded-routing fallback. ADR-023 amended.
- **Page-capture shared reference** - New `page-capture.md` for batch Playwright MCP capture. Wired into installer, drift checks, preflight sync, and content-quality audit.
- **Project-stack detection** - Separated test frameworks from app frameworks. Added 30+ framework/language/deploy/formatter signals. Fixed Jinja false-positive. Added Docker Compose V2 filenames.
- **Dashboard** - Workspace sidebar collapse, harness percentage parity (metric checks excluded from scores), aggregate boundary scoring, path-only task intake guard, ISSUE.md auto-creation in goat-plan, configurable goat-review local PR base.
- **Quality-report evidence** - `prior_report_id` for delta tracking, `delta_tag` validation, per-finding evidence fields.
- **Release propagation** - Package/config/manifest, skill mirrors, shared references, security reference packs, fixtures, hooks, and instruction files bumped to 1.4.0. Backfilled v1.3.1 and v1.3.2 manifest snapshots.

## v1.3.2 - 2026-05-01

Release-readiness hardening for decision records, dashboard audit performance, harness model alignment, and quality-report evidence.

- **Decision-record quality gate** - `.goat-flow/decisions/README.md` and the setup template now define a hard ADR filter, routing table, anti-patterns, required structure, and pre-write checklist. `goat-flow stats --check` fails non-`README.md` / non-`ADR-NNN-kebab-case-title.md` files and malformed ADRs missing `**Status:**`, `**Date:**`, `## Context`, `## Decision`, or a trade-off section, with routing guidance back to tasks, footguns, lessons, scratchpad, or issues.
- **Non-destructive decisions migration** - Fresh installs get the stricter decisions README, while existing projects keep customised `.goat-flow/decisions/README.md` files because the installer now uses `copy_if_missing` for that template. The old `.goat-flow/decisions/.gitkeep` anchor is removed.
- **Decision coverage and warning cleanup** - Content-quality audit now dynamically discovers current `ADR-NNN-*.md` files instead of relying on a hard-coded ADR list. The noisy `decision-metadata` warning stream for missing recommended `Author(s)` / `Ticket/Context` fields is removed; those fields remain recommended in the README but no longer pollute every `stats --check` run.
- **Dashboard audit fact profiles** - Audit now supports `full` and `dashboard-summary` fact profiles. Aggregate dashboard audits skip stack detection, stack-dependent checks must declare `requiresStack`, and regression tests pin that dashboard-summary audits do not call `detectStack` or read unavailable stack facts.
- **Dashboard audit cache and profiler** - `/api/audit?quality=true` caches eligible packaged aggregate reports using package version, config version, and high-impact input signatures; `fresh=true` bypasses the cache. Cache writes are synchronous to avoid the CI race fixed in this PR, and `scripts/profile-dashboard-audit.mjs` is published through `npm run profile:dashboard-audit`.
- **Filesystem and stack-detection performance** - `ReadonlyFS` gains `existsGlob()` for first-match recursive probes, and stack detection uses it for existence-only checks instead of materialising full glob result arrays on hot paths.
- **Five-concern harness model** - Removed `workspace_boundary` as a separate 6th harness concern. The `boundary-guidance-present` check (whether instruction files distinguish the controlling workspace from the selected target) moves to Context as an advisory check. The `boundary-path-separation` metric is removed. The harness model is now 5 concerns (context, constraints, verification, recovery, feedback loop) with 17 checks, matching the public harness engineering literature (Hashimoto, Bockeler, Anthropic, HumanLayer, LangChain).
- **Harness scoring honesty** - Metric checks no longer inflate concern score denominators or numerators in the CLI backend or the dashboard frontend. Dashboard `agentScore()` calculations in home, quality, and setup views now exclude metric checks from the pass/total ratio, matching how concern scores already worked. The test-runner metric now reports `fail` when no configured test command exists while still remaining informational.
- **Setup prompt verification gate** - The audit-pass setup prompt now says "Run now" instead of "Next step (recommended)" for the `--harness` command, preventing agents from skipping the harness verification gate.
- **Quality-report evidence contract** - Quality prompts and schema now carry `prior_report_id` so `delta_tag` has an explicit same-agent baseline. Runtime-backed findings can include compact evidence fields such as command, exit code, warning count, summary, and excerpt without pasting raw terminal blocks into JSON.
- **Package and release metadata** - Package version/config/manifest/installed skill and hook surfaces are bumped to `1.3.2`; npm description and keywords now position goat-flow as an AI harness engineering framework, and the dashboard audit profiler script is included in the published package.
- **Release regressions** - Added or expanded coverage for dashboard-summary no-stack behavior, dashboard audit cache speed/invalidation/cleanliness, existing-project decisions README compatibility, legacy decision-note failure guidance, dynamic ADR discovery, `existsGlob()`, harness concern model alignment, quality schema evidence fields, and stale-version strings in synthetic project fixtures.

## v1.3.1 - 2026-04-29

- **Commit-message guidance rewritten** - `.github/git-commit-instructions.md` and its mirror `docs/coding-standards/git-commit.md` now name the failure mode directly: ban weak-verb subjects (*enhance, improve, streamline, clarify, update, tweak, polish*), prescribe concrete verbs (*add, remove, replace, rename, fix, deny, gate, harden, cache*), require a body whenever the subject names more than one axis or has a non-obvious motivation, and include three bad→good rewrites built from the actual recent log. Adds a `type` selection table, drops the redundant typecheck/test/shellcheck list (preflight already runs them), and corrects the `.goat-flow/` what-not-to-commit list. Both files are now byte-equivalent below their preambles. New lesson `.goat-flow/lessons/agent-behavior.md` "Commit subjects paraphrased the diff with weak verbs" records the audit of the last 10 commits that motivated the rewrite.
- **Windows Workspace terminal fix** - `src/cli/server/terminal.ts` now builds PTY launch specs per platform, using PowerShell on native Windows while preserving the existing POSIX interactive-shell flow for Linux, WSL, and macOS. Windows runner detection now prefers runnable `.exe` / `.cmd` shims over extensionless npm wrapper files, fixing `Open terminal` failures such as `File not found` on the Workspace page.
- **Workspace terminal launch responsiveness** - The dashboard now creates the backend terminal session before waiting on xterm CDN assets, shows an immediate `Launching terminal...` state on the Workspace button, warms xterm in the background when the Workspace view opens, and cleans up the backend session if xterm asset loading still fails after creation.
- **Terminal regression coverage** - `test/smoke/dashboard-endpoints.test.ts` now pins the Windows runner-shim preference plus both Windows and POSIX PTY launch plans. The same file's path-validation assertion now uses `fileURLToPath(import.meta.url)` so the smoke suite exercises the intended "not a directory" branch on Windows too.
- **Cross-platform dashboard build scripts** - `package.json` now uses `node:fs` helpers for build cleanup, chmod, and dashboard asset copy steps instead of shell-specific `rm`, `mkdir`, `cp`, and `chmod` chains. `npm run build` / `npm run dashboard` now work under native Windows `cmd.exe` instead of failing at `mkdir -p dist/dashboard` with `The syntax of the command is incorrect.`
- **Dashboard Home audit latency fix** - Home-summary `/api/audit` loads now request presence-only deny-hook evidence so the page no longer pays four per-agent `deny-dangerous.sh --self-test` runs on Windows before rendering. Deeper verification paths such as explicit per-agent audits and quality/setup flows still keep full runtime deny-hook validation.
- **Audit-route regression coverage** - `test/integration/dashboard-server.test.ts` now pins the `/api/audit` summary contract that skips deny-hook self-tests during dashboard summary loads, while `test/integration/audit-build.test.ts` keeps the deeper quality/setup audit isolation checks in place.
- **Learning-loop guidance** - `.goat-flow/patterns.md` now captures the rule behind the dashboard latency fix: summary surfaces should use cheap evidence, while drill-in routes keep the expensive runtime proofs.

## v1.3.0 - 2026-04-27

Plan completion protocol, browser-use shared reference, hook/push enforcement, dashboard prompt/quality upgrades, instruction artifact routing, harness-score honesty, performance/reference-version improvements, harness docs, and README rewrite.

- **Browser-use shared reference** - Browser-use guidance consolidated from per-skill copies into `.goat-flow/skill-reference/browser-use.md`. `/goat-debug` now detects UI bugs at Step 0, uses browser-use for D1 hypothesis testing and D4 post-fix verification, and offers installation guidance when unavailable. Manifest, install, drift, preflight, and quality checks treat browser-use as shared doctrine.
- **Hook and push enforcement** - ADR-025 blocks all agent-initiated `git push` across README, Help, harness, hook, and settings surfaces. Deny hooks gained no-space redirect detection (`echo foo>.env`), escaped regex dots to prevent false positives, `npm token delete/revoke` blocking, command-parsing fixes, and aggregate audit-scope support. New hook version comparison audit and hook drift detection in `check-drift.ts`; `bump-version.sh` syncs hook templates to all installed mirrors.
- **goat-plan Phase 4 - Plan Complete** - Formal completion protocol requiring an AI verification gate (every milestone, task, exit criterion, and testing gate evidenced from the current session) and a blocking human verification gate before close-out. Agents must not self-destruct plan artifacts or delete files without approval. Added to `skill-conventions.md` as shared doctrine.
- **Skill protocol hardening** - `/goat-plan` adds a mid-implementation proof checkpoint. `/goat-review` discovers PR base dynamically instead of assuming `origin/main` and separates reporting-only DoD from implementation DoD. `/goat-qa` includes Verification Integrity in first gap-analysis output. `/goat-critique` checks sub-agent output completeness before trusting self-report. Delegation-consent and interruption-freeze wording tightened across skill and instruction surfaces.
- **Quality modes and reporting** - `goat-flow quality . --mode <mode>` for mode-specific prompts, history, and diffs. Dashboard quality page adds GOAT Flow Process, Agent Installation, Harness Engineering, and Skills modes with the same persistence and validation contract as agent setup. Report contract enforces provenance fields (`scope`, `rubric_version`, `quality_mode`, per-finding `evidence_method`); dashboard uses injected package version.
- **Dashboard upgrades** - Custom prompt library with create/edit/delete, favorites, and global-safety gating. Preset catalog carries richer metadata (route, source, prerequisites, write risk, cost tier) with dry-run launch tests. Home/Workspace views improve cached-audit age display (minutes to hours to days) and tighten terminal/session handling for project switching. "Agent Setup Quality" renamed to "Agent Installation."
- **Performance** - Request-scoped read cache in `createFS` eliminates redundant disk reads across audit passes. `runAuditBatch()` shares config across aggregate and per-agent passes, removing the N+1 re-parse pattern. Quality history scans newest-first and stops at the first valid match. Agent detection and learning-loop enrichment cached with TTL. Audit cache writes switched to async fire-and-forget.
- **Reference version auditability** - Shared skill references, goat-security reference packs, and fixtures now carry `goat-flow-reference-version` frontmatter. `bump-version.sh`, `check-versions.mjs`, preflight, quality prompts, and contract tests verify reference docs alongside `SKILL.md` frontmatter.
- **Harness scoring honesty** - Feedback-loop checks now fail on stale footgun/lesson file references instead of treating them as informational. Recovery harness reports milestone checkbox progress as informational context rather than failing on unchecked gitignored files. Workspace Boundary treated as qualitative cross-cutting risk, not a deterministic harness score.
- **Instruction artifact routing** - `CLAUDE.md`, `AGENTS.md`, `GEMINI.md`, Copilot instructions, setup templates, and skill preamble now route "add a footgun/lesson/decision/pattern" requests to documentation artifacts instead of runtime code. README guidance added to footgun and lesson buckets.
- **Harness engineering site** - Standalone harness engineering page with structured data, SEO metadata, and OG imagery. Landing assets moved under `docs/site/`; footer and redundant-link copy cleaned up.
- **Learning loop** - `sizeBytes` property in bucket stats; `stats --check` warns when any bucket exceeds 40KB. Home view handles missing `footgunCount`/`lessonCount` gracefully. New lessons for deny-hook probe coverage and preflight-as-release-gate failures; new footguns for portable PR base selection and shared-reference drift. Stale local-path evidence rewritten.
- **README rewrite** - Dashboard-first positioning with view-by-view descriptions (Home, Setup, Prompts, Workspace, Projects, Quality) replacing the previous execution-loop framing. Updated getting-started and feature comparison table.

## v1.2.5 - 2026-04-24

CLI silently exited without running when invoked through a symlink - which is every `npx goat-flow`, `./node_modules/.bin/goat-flow`, and npm `scripts` invocation. Fixed the main-module guard and added a regression test.

- **fix: CLI no-op via symlink** - The ESM main-module guard compared `resolve(process.argv[1])` against `fileURLToPath(import.meta.url)`. `path.resolve()` does not follow symlinks, but Node's ESM loader resolves symlinks for `import.meta.url` by default. When the CLI was launched through the `node_modules/.bin/goat-flow` symlink (the standard npm/npx path), the two sides never matched, `main()` never ran, and the process exited 0 with zero output. The fix wraps both sides in `fs.realpathSync()` via an `isMainModule()` helper, with a try/catch for synthetic `argv[1]` values. Introduced in 918ca3e (v1.2.4).
- **regression test** - `test/integration/main-guard.test.ts` creates a temp-dir symlink to `dist/cli/cli.js` and verifies `--version` produces output through both the symlink and the real path. This is the exact invocation path that broke.
- **footgun** - New `.goat-flow/footguns/cli.md`: "ESM main-module guard breaks under symlinks" documents the structural trap and prevention rules.
- **lesson** - `.goat-flow/lessons/verification.md`: "Test suite must exercise the published invocation path" - all 359 tests passed while the CLI was broken for every real consumer, because no test went through the `.bin/` symlink.

## v1.2.4 - 2026-04-23

Quality report fixes, node-pty as optional dependency, configurable terminal timeout, dashboard settings/export, QA prompt improvements, preset prompt library expansion, ADR-024 semantic anchors, manifest snapshot backfill, and lesson line-ref validation.

- **node-pty optional** - Moved from `dependencies` to `optionalDependencies`. Install no longer fails on Linux/WSL without C++ build tools. Dashboard terminal banner now shows platform-specific install guidance.
- **Terminal timeout** - Configurable idle timeout via `config.yaml` `terminal.idle-timeout` (default 8 hours, was hardcoded 60 min). `0` disables auto-kill. Dashboard settings view shows current value.
- **Session export** - Export button on workspace sessions downloads terminal output as `.txt`.
- **Deny hook fix** - Quoted literal backticks (e.g. `printf 'use \` here'`) no longer trigger false-positive command-substitution blocks.
- **Content quality audit** - Setup templates excluded from legacy execution-loop detection. ADR-021/022/023 added to target list and decisions README.
- **Instruction file retrieval** - All four agent instruction files now include `.goat-flow/decisions/` in retrieval for architecture/policy/setup tasks.
- **goat-qa skill** - Standard mode output template split into Phase 2 (gap analysis, presented at gate) and Phase 3 (testing plan, gated by approval). Step 0 retrieval now includes patterns.md and decisions.
- **Preset prompts** - 23 to 28 presets. Five new: Critique a Plan, Critique an Artifact, Pressure-Test a Skill, Mermaid Flow Diagram, Test Plan vs Code Changes. Existing presets sharpened with change-type-first probing, tester-voice, output format hints, and security lenses.
- **docs/skills.md** - Planning Route corrected (File-Write default at Standard+). goat-critique sub-agent count corrected to 3. goat-qa Standard trigger clarified.
- **ADR-024: Semantic anchors over line numbers** - Line numbers banned from footgun/lesson evidence. All entries migrated to grep-friendly `(search: "pattern")` anchors. Instruction files (CLAUDE.md, AGENTS.md, GEMINI.md, copilot-instructions.md) and evaluation templates updated. `stats --check` validates search anchors against file content, catching stale evidence that line-number validation never could. Propagation sweep: `compose-quality.ts` quality prompt, `harness-quality.md`, `harness-audit.md`, setup templates (footguns-readme, 05-customise, 06-final-verification), `skill-conventions.md` entry templates, `glossary.md`, `architecture.md`, `code-map.md`, `README.md`, `goat-flow-landing.html`, and `help.html` all updated. Live-work contexts (skill-preamble, execution-loop VERIFY, adversarial-framing, review/debug/security/critique skills) correctly retain `file:line` for fresh code citation. Glossary Evidence Standard entry updated to describe both modes.
- **Manifest snapshot backfill** - Frozen v1.2.0–v1.2.4 snapshots added to `workflow/manifest-snapshots/`. Snapshot test expanded from single-version to all-release coverage (v1.1.0–v1.2.4). README updated with version table.
- **Lesson line-ref validation** - `invalidLineRefs` added to lesson facts in `stats --check` (was footguns-only). Lessons with out-of-bounds `file:line` refs now surface in health checks.
- **Decisions directory** - `.gitkeep` replaced with `README.md` containing ADR writing guidance. Installer copies the template; manifest and audit check updated for the new anchor file.
- **Quality prompt hardening** - `compose-quality.ts` adds a CRITICAL write-verification step: agents must `ls` the output file after writing to confirm it persists. `docs/audit-and-quality.md` corrected from "runs 7 skill invocations" to file-analysis-preferred approach.
- **Content-drift Round 3** - 3 findings from independent Copilot quality reports resolved: `docs/skills.md` /goat-plan summary, quality assessment invocation language, and architecture hot-path listing now includes `copilot-instructions.md`.
- **Learning loop** - 3 new lessons: fresh-eyes critique leak-scan citation format, line-number evidence debt (ADR-024 origin), snapshot fixture metadata beyond typed contract. 5 bucket files reviewed (2026-04-24).
- **Ask First boundary** - `.goat-flow/skill-reference/` added to CLAUDE.md Ask First boundaries. Shared doctrine loaded by every skill now requires approval before edits.
- **Presenting Findings format** - `skill-conventions.md` gains a "Presenting Findings" section standardising summary/problem/solution one-liner format for tasks, findings, and recommendations.
- **GEMINI.md cleanup** - Removed stale `.github/instructions/` from local-instruction checklist. Footgun evidence guidance updated to semantic anchors.

## v1.2.3 - 2026-04-22

`.env.example` read-only handling, richer dashboard presets, dashboard audit caching, reporting-only quality prompts, active-plan local-state handling, goat-critique contract tightening, terminal fixes, prompt-label tracking, deployment scripts, prompt-loading polish, shared-reference doc cleanup, widened dashboard lint coverage, and goat-qa gate clarification. 19 commits, 92 files changed, 2,584 insertions, 708 deletions.

- **Secret-file guardrails** - `.env.example` allowed for read-only inspection; real `.env`/`.env.*` and other secret paths stay blocked. All `deny-dangerous.sh` copies, agent settings, and ignore files updated with self-tests for the distinction.
- **Dashboard** - Richer preset prompts with explicit scope/evidence/handoff framing. Audit caching for packaged installs (keyed by version, `fresh=true` bypass). Dedicated loading states for setup/quality. Prompt labels now carry the runner name so terminal sessions show which agent launched them.
- **Terminal fixes** - Per-runner prompt flag (`-i`) for Copilot/Gemini sessions. Fixed duplicate paste from browser default handler firing alongside xterm clipboard write.
- **Landing page and deployment** - Standalone product page (`docs/goat-flow-landing.html`). New `deploy-landing.sh` (S3/CloudFront/ACM/Route 53) and `bump-version.sh` (version bump across all files in one pass).
- **Quality prompts** - "Reporting-only" mode replaces strict read-only language, allowing gitignored validation artifacts while forbidding tracked-file writes. Walkthrough comment prompt added. Execution-loop and footgun evidence corrected.
- **Skill contracts** - goat-critique: explicit invocation binding (no triviality bypass), tighter retrieval/rubric handling, context-leak scanning, per-agent tool budgets. goat-qa: Phase 2 is now a blocking gate awaiting human decision before producing the test plan.
- **Active plan semantics** - `.goat-flow/tasks/.active` treated as an advisory local pointer, not a setup invariant. Missing/stale markers fall back to listing task dirs and asking. ADR-017, glossary, code-map, and quality prompt aligned.
- **Shared-reference docs** - Explicit `skill-quality-testing` split-file references replace brace shorthand. goat-security project-policy template documented across all agent skill copies.
- **Preflight coverage** - ESLint widened to `src/dashboard` in preflight and CI. Dashboard lint config and cleanup so the wider gate passes.
- **Cross-doc cleanup** - Router tables, code-map script listings, and instruction-file references synced to match current filesystem state.

## v1.2.2 - 2026-04-21

Dashboard browser-code split, release metadata bump, and CLI documentation corrections.

- **Dashboard app split** - `src/dashboard/app.ts` is now the Alpine state/composition layer, with readers, projects, prompts, setup/quality, and terminal flows moved into focused classic browser scripts loaded before `app.js`.
- **Asset coverage** - Dashboard integration tests now assert the split script tags and asset endpoints. Knip ignores cover the classic script entry points so unused-export checks do not treat script-tag globals as dead code.
- **Docs + release metadata** - README and public docs now consistently show `npx goat-flow` for package usage. Package, manifest, config, instruction headers, skill frontmatter, and current test stubs are bumped to v1.2.2.
- **Cleanup** - Removed dead type imports exposed by full typecheck and formatted the prompts view so preflight remains clean after the split.

## v1.2.1 - 2026-04-20

Dashboard project rename, `gh`-powered PR/issue intake for `goat-review` and `goat-qa`, install anchors for `decisions/` and `logs/sessions/`, and follow-up doc/footgun/lesson fixes.

- **Dashboard project rename** - Inline header rename (double-click name or ✎ button) with user-supplied titles persisted alongside paths/favorites in `.goat-flow/dashboard-state.json`. New `decodeProjectTitles` server-boundary decoder (120-char cap, whitespace-only drops the override so clearing round-trips to the path-derived fallback). `displayNameFor(path)` replaces path-basename derivation across sorting, projects page, and sessions rail. Project accent color is now hashed from path (not display name) so renames don't shift the color.
- **External context sources (shared preamble)** - New section in `.goat-flow/skill-reference/skill-preamble.md` making `gh` (when installed and authenticated) the preferred channel for issues, PRs, Dependabot alerts, and CI runs. Fetched content is treated as citable evidence; when `gh` is missing the user is asked to paste rather than have the skill fabricate.
- **goat-review PR intake** - "PR mode" now asks for a PR URL or number first (`gh pr view --json` + `gh pr diff`) instead of the base-branch prompt - one input collapses base, head, description, and linked issues. Base-branch-vs-fetch flow retained as fallback when no PR link is supplied or `gh` is unavailable. Updated across `.claude/`, `.agents/`, `.github/`, and `workflow/` skill copies.
- **goat-qa PR / issue intake** - Step 0 Intake now asks for the linked PR or issue (`gh pr view` / `gh issue view`) so gap analysis maps against stated acceptance criteria rather than code shape alone. New `no-intent-spec` degradation flag in Verification Integrity when the spec is unavailable. Updated across all four skill copies.
- **Install + manifest anchors** - New `touch_anchor` helper in `workflow/install-goat-flow.sh` seeds `.goat-flow/decisions/.gitkeep` and `.goat-flow/logs/sessions/.gitkeep` on install so the learning-loop + continuity-note directories exist in fresh projects. `workflow/manifest.json` adds both anchors to required paths.
- **Preset prompts** - "Testing Gap Analysis" renamed to "Testing Gap & Overlap Analysis" with a new PR-scoped prompt body: overlap audit that excludes work already covered by PHPStan / Doctrine / CI access-control scanner / PHPUnit / Cypress / dev notes / Copilot review comments, then four grounding questions (A. entry points, B. production data shape, C. access control, D. prior incidents) with VERIFIED/INFERRED labels, then a time-budgeted residual test plan ranked by signal-per-minute, a sufficiency verdict, and one "action required on PR" item when testing can't compensate for a code-level issue. Description updated to match.
- **Docs + footguns** - `README.md` switches from `npx goat-flow` to `goat-flow` in usage examples (expects a global install). `docs/audit-and-quality.md` satellite-agents example corrected (`.gemini/skills/` → `.github/skills/`). New footgun in `.goat-flow/footguns/docs-and-crossrefs.md`: **Prose examples for agent-specific paths drift from the manifest** - name-based inference (`gemini` → `.gemini/skills/`) is wrong by default because codex and gemini both share `.agents/skills/`, and `doc-paths-resolve` only checks existence, so a plausible-but-wrong path that happens to exist passes the audit silently. Prevention: grep `workflow/manifest.json` before hand-writing agent-specific paths. `goat-plan` Excuse/Reality table drops the "team is experienced, spike is overkill" row.
- **Lesson + auditor footgun** (`1899366`) - Preflight's sanitization pipeline (`| grep -oE '^[0-9]+$' | tail -1`) could turn non-empty node output into empty output for the first time; `setup_count` was only assigned inside the `[[ -n "$build_count" ]]` branch but referenced unconditionally later, crashing under `set -u` with `unbound variable`. New lesson in `.goat-flow/lessons/agent-behavior.md` on tracing downstream references when adding output filters, and a matching auditor footgun update.

## v1.2.0 - 2026-04-20

Skill renames, Copilot CLI support, audit subsystem expansion (drift/content/manifest), proof-gate verification, structured learning loop, and an M17 quality-report follow-up wave that closed a CRITICAL Bash secret-read gap. 324 files changed, 86 commits.

- **Renames** - `goat-sbao`→`goat-critique`, `goat-test`→`goat-qa`, CLI `critique`→`quality`. Old names recorded in `workflow/manifest.json:stale_names`. Dashboard view, `/api/critique`→`/api/quality`, `critique.html`→`quality.html`, `docs/audit-and-critique.md`→`docs/audit-and-quality.md`.
- **Copilot CLI** - 4th agent (ADR-020). `.github/skills/`, `.github/hooks/`, `.copilotignore`, standalone `.github/copilot-instructions.md`. `deny-dangerous.sh` emits `permissionDecision` JSON for all four agents.
- **Audit + manifest** - New `audit --check-drift` (installed vs template skills), `audit --check-content` (cold-path linter for docs/footguns/lessons), `goat-flow manifest` (validate/list/show). Factual + snapshot claim checks against `workflow/manifest.json`. Dead-CLI-command scanning in fenced code blocks. `getProjectStructure()` removed; callers use `loadManifest()`.
- **Harness typing** - 16 checks split into `integrity`/`advisory`/`metric`. Score reflects integrity + unacknowledged advisory only. `harness.acknowledge: [check-id]` opts out deliberate skips. `Notification`/`compact` hook removed (never a real Claude Code event).
- **Hallucination red-flags** - 5 rules added to CLAUDE.md VERIFY: tests-pass needs terminal output, completion needs files-list, fix needs reproduction steps, no hedged claims, check-passed needs verbatim output.
- **Proof-gate + skill hardening** - Shared evidence gate (file:line, exit codes, transcripts) across `goat-debug`/`goat-qa`/`goat-review`/`goat-security`. goat-review: two-pass reading, severity (BLOCK/WARN/NOTE) + action (FIX/INVESTIGATE/ACCEPT) tags, spec-drift lane, Review Integrity self-check. goat-qa audit mode: A1 scope→A2 inventory→A3 coverage→A4 gap report. goat-critique locked to delegated-only mode (ADR-021).
- **goat-security** - 7 per-topic reference packs: auth-authz, cicd-and-agent-surfaces, common-threats, dependency-and-supply-chain, file-upload-and-paths, project-policy-template, secrets-and-data-exposure (ADR-023).
- **Learning loop** - `last_reviewed` frontmatter on footguns/lessons/decisions. New `goat-flow stats --check` with per-bucket freshness bands + search-anchor resolution. Active-plan marker `.goat-flow/tasks/.active` disambiguates live vs archived plans. 6 glossary terms added.
- **Quality reports** - Agents write JSON directly to `.goat-flow/logs/quality/` (HHMM+rand5 filename); `quality capture` removed. Schema v2 adds per-finding `evidence_method` + optional `scope`/`rubric_version`. New `goat-flow quality validate` and dashboard quality-history view.
- **Dashboard** - Dedicated Prompts page with category filters, Sessions rail (cap=10), quality-history view. Server split into `dashboard.ts` + `dashboard-routes.ts` + `dashboard-terminal.ts` + `setup-detect.ts` + `dashboard-assets.ts`. Presets moved to `src/dashboard/preset-prompts.json`, stack tables to `workflow/project-stack-data.json`. State persistence in `.goat-flow/dashboard-state.json` (was port-scoped localStorage).
- **goat-critique overhaul** - Conversational Phase 4 gate (question-first format with defaults), top-of-output Verdict block, SKEPTIC/ANALYST/STRATEGIST as explicit per-finding sub-fields, rubric coverage gates, Phase 3 budget cap (max 3 cross-exam agents) + early-exit on consensus, Agent C isolation hardening, Phase 3 persistence to `.goat-flow/logs/critiques/`, sharpened Agent B (ranked alternatives + must-surface-one).
- **follow-ups** - CRITICAL: `deny-dangerous.sh` now blocks Bash reads of `.env*`/`.ssh/`/`.aws/`/credentials/`*.pem`/`*.key` across all 4 hook dirs (settings.json Read() deny doesn't bind Bash). Server-boundary runtime decoders (`src/cli/server/decoders.ts`) for every HTTP/WS ingress. `loadConfig` fail-closed on validation error. Agent-id canonical source: `AgentId` union + `KNOWN_AGENT_IDS` tuple (ADR-022). Dashboard under TS bar. CLI ESLint 20→0 warnings. `npm test`: 307/307.

## v1.1.0 - 2026-04-17

Scanner/rubric system removed. Replaced by deterministic audit with 16 build checks (12 project setup + 4 per-agent) and 16 advisory harness checks across 5 concerns. Deterministic install script. Dashboard overhaul with dynamic recommended actions. 528 files changed.
- 
- **Critique Fixes** - Dual-critique synthesis resolved 10 findings. Fixed architecture.md build check count (17→16). Removed stop-lint.sh from core (project-specific concern, will revisit in a later version). Resolved 3 stale footgun entries (advisory hooks, swallows failures, dispatcher verb gap). Removed dead goat-review "code-review instruction file" reference. Reworded goat-test "multi-model" to actionable "cross-agent verification". Added analyse/evaluate/critique verbs to dispatcher disambiguation table. Improved critique prompt with 7 refinements: no-mutation warning, audit PASS caveat, severity definitions, scoped tool guidance, footgun currency checks, numeric claim verification, skill testing clarification.
- **Audit System** - Replaced scanner/rubric engine (79 checks + 12 anti-patterns, point-based scoring) with audit system. 12 project-wide setup checks (config, directories, required files) are agent-agnostic. 4 per-agent checks (instruction file, skills, settings, deny-dangerous hook) run independently per agent. Advisory harness scoring (`--harness`) grades 5 concerns with 16 checks total: context, constraints, verification, recovery, feedback loop. Audit became the sole evaluation engine.
- **Install Script** - `workflow/install-goat-flow.sh` handles all mechanical file copying: 7 skill templates, hooks, settings, templates, reference files, config scaffold. Deterministic, agent-aware (`--agent claude|codex|gemini`), idempotent. A separate migration script existed during v1.1.0 and was later removed as unused.
- **Setup Prompts** - Stripped stack/toolchain info, signal-driven tasks, stale artifact cleanup, multi-agent consistency directives. Setup prompt now: run install script → follow numbered setup steps → verify with audit. Upgrade prompt (v0.9/v1.0) structured as numbered steps with scripts first.
- **Dashboard** - Dynamic recommended actions panel: setup failing → fix wizard + fix agent buttons; harness checks failing → fix harness buttons; quality < 100% → fix harness buttons with per-concern recommendations; healthy → review/test/security presets. Per-agent harness score cards with grade, concern bars, and expandable recommendations. Projects page sorts alphabetically, clicks navigate to home view.
- **Config Agent Filtering** - Auditor respects `config.yaml` agents list. Project setup checks are agent-agnostic. Per-agent checks only run for agents with instruction files present. Config always lists all three agents (claude, codex, gemini) - setup is per-agent, not project-locked.
- **CLI Renames** - `--quality` → `--harness`. `quality-checks.ts` → `harness-checks.ts`. `build-checks.ts` → `agent-setup-checks.ts`. Dashboard label "AI Harness Checks" → "Agent Setup Checks".
- **Critique** - `goat-flow critique . --agent claude` generates agent-driven review prompts from audit data. Separate from audit (subjective vs deterministic).
- **Security** - `execSync` → `execFileSync` in hook syntax validator (shell injection fix). Host header validation on all dashboard API routes.
- **Skills** - 7 canonical skills (goat, goat-debug, goat-plan, goat-review, goat-sbao, goat-security, goat-test). Quick/full depth modes. Conversational structure with Step 0 adaptive gate. Skills installed verbatim from templates - project-specific context comes from instruction file and `.goat-flow/` docs.
- **Setup Flow** - 6 numbered steps (system overview → instruction file → install skills → architecture/code-map → customise → verification). Agent-specific configs in `workflow/setup/agents/`. Upgrade paths for v0.9 and v1.0 projects.
- **Hooks** - `deny-dangerous.sh` supports stdin and argv input, `--self-test` flag, blocks `rm -rf`, force push, `--no-verify`, `chmod 777`, pipe-to-interpreter patterns. Post-turn lint hook removed from core - project-specific concern (see `workflow/hooks/README.md`).
- **Templates** - 5 project templates (feature-brief, mob-elaboration, compliance-checklist, flow-diagram-guide, requirements-template) remain in `workflow/templates/` as reference material. Removed from core install (no longer copied to `.goat-flow/templates/`).
- **Tests** - 51 tests across unit, integration, and contract suites. Config filtering, scope coverage, quality concern coverage, cross-agent consistency.


## v1.0.0 - 2026-04-05

Version bump from v0.10.0 for semver compatibility (`^0.9.x` won't resolve to `0.10.0`).

- **CLI** - Removed `--no-open` flag and auto-open browser logic from dashboard. Removed `spawn` import. Dashboard always prints URL, user opens manually.
- **Dependencies** - `ws` moved from optionalDependencies to dependencies (required for dashboard WebSocket). `node-pty` stays optional.
- **Keywords** - Added `ai-agent`, `claude-code`, `copilot`, `dashboard`, `llm`, `scanner` to package.json for npm discoverability.

## v0.10.0 - 2026-04-05

SBAO Phase 3, dashboard redesign, rubric priority grading, security hardening, copilot support, 48-file CLI refactor. 115 checks + 20 anti-patterns. 1,166 tests.

- **Dashboard Redesign** - Neutral zinc palette (#1a1a1e/#111114/#27272a), CSS extracted to `styles.css`, JS extracted to `app.js` (index.html 89 lines). Dark/light themes with `gf-*` design token classes. Live reload dev mode (`npm run dev`).
- **Home Page** - Action-driven: dynamic "What to do next" cards (issues → fix/details/workspace, passing → code review/test/security with play icons). Scanner-style 4-column agent cards with color-coded tier bars (green >80%, orange 50-80%, red <50%). Agents table with per-agent terminal launch. Welcome state for unconfigured projects.
- **Scanner** - Single-page with inline detail expansion (no separate detail page). Hover states via CSS classes. Severity badges themed for light mode.
- **Workspace** - Prompt preview on sidebar click (right panel shows prompt text + Launch button). Run state tracking (amber running, green pass). Category-colored filter pills. Round outline play/send buttons.
- **Setup** - Left column card (title + agents + detected config), right prompt card with dark code background. "Formatter" label. Page heading.
- **Config** - Two-row layout (path picker + role selector). userRole toggle (click to select, click again to deselect). Local-only (not in committed config). "Open Setup Wizard" button when config.yaml missing.
- **Header** - Centered nav, goat emoji, green project name. "Terminal:" agent selector with disabled state during session. Green dot on Workspace nav when terminal running.
- **Copilot** - Agent detection, terminal sessions, Runner type, RUNNER_BINARIES. Dashboard showed a dimmed card when not scanned. This experiment was later removed.
- **Security** - Host header validation on all API routes (DNS rebinding). Write/Edit deny for 12 sensitive file patterns. Terminal resize validation (`clampDim`). Session map cleanup on kill.
- **persona→userRole** - Renamed across config reader, types, facts, rubric, prompts, tests, fixtures. Added `tester` to schema.
- **SBAO** - goat-plan Phase 3 rewritten as multi-agent critique: 2 core trio + 1 fresh-context (never split perspectives). Bold reminder in skill file. SBAO routing in dispatcher.
- **Presets** - all 19 rewritten to `/goat [plain language]`. Guided forms removed.
- **Rubric** - priority field (required/recommended/optional) on all checks. Grade: A=all req+rec, B=all req+80% rec, C=all req. Full tier bonus-only. 24 checks hidden. `telemetry` in KNOWN_TOP_LEVEL_KEYS.
- **Scanner** - hook honesty, router validation, severity-grouped output. GOAT_FLOW_INLINE_SETUP dead code removed.
- **CLI** - 48 files refactored, 45→0 complexity violations. `setup/`→`workflow/setup/`, `ai/`→`.goat-flow/`. Server logging (errors, host blocks, dev request log).
- **Learning Loop** - category bucket files. Alpine.js `:style` footgun documented. SBAO agent structure lesson (3 recurrences). Checkbox discipline lesson (3 recurrences).
- **Tests** - 275→1,166. Terminal idle timeout updated for session deletion. Tautological/dead assertions fixed. deny-dangerous.sh hardened (long-form flags, pipe-to-interpreter).
- **Structure** - `docs/skills/` with Mermaid diagrams, `.goat-flow/glossary.md`, preflight with decimal timing. Footer: "Built by BlunderGOAT · v0.10.0".

## v0.9.4 - 2026-04-02

Scanner honesty, config file, directory restructure, embedded terminal, dashboard UX. Driven by 6 cross-project reviews + real-project testing. 275 tests.

- **Scanner** - stop faking Codex enforcement facts, remove harmful AP2, fix goat-goat derivation bug, new AP20/AP21, `.env` Edit/Write deny check, devDeps-only JS detection
- **Config** - `.goat-flow/config.yaml` with `js-yaml`, directory-based footguns/lessons (YAML frontmatter entries), committed vs local split, migration scripts
- **Restructure** - `docs/lessons/`→`.goat-flow/lessons/`, `docs/decisions/`→`.goat-flow/decisions/`, `agent-evals/`→`.goat-flow/evals/`, `ai/instructions/`→`.goat-flow/coding-standards/`, `tasks/`→`.goat-flow/tasks/` (gitignored)
- **Skills** - all 5 check footguns in Step 0, dispatcher enriched with modes/chaining, version sync to 0.9.4
- **Setup** - stale skill cleanup (8 old names), router rewrite, static CI template, format hook wires into settings.json
- **Terminal** - `node-pty` + `ws` as optionalDeps, `TerminalManager` with multi-runner (claude/codex/gemini), REST API (create/list/delete/health), WebSocket streaming, idle timeout, Origin check. xterm.js lazy-loaded from CDN, Launch button on preset cards, Setup Launcher panel (pick agent + runner), session indicator, Ctrl+Shift+D exit
- **Dashboard** - dark mode toggle fixed, copy feedback on cards, Escape collapses checks, agent switch preserves tab, Reset filters, brighter focus rings, anti-patterns hidden during search. Deep Critique preset added (6-phase system review)
- **Tests** - 239→275 (+36). New: eval parser/loader, serve-dashboard API, terminal server

## v0.9.3 - 2026-03-30

Skill consolidation, scanner improvements, enforcement hardening. Driven by cross-project reviews from consumer projects. 101 checks + 17 anti-patterns. 216 tests.

- **Skills (9→6)** - goat-investigate/simplify/refactor merged into goat-debug/review/plan as modes. goat-security expanded with compliance + dependency audit. Dispatcher added as 6th canonical skill. All synced across 3 agent dirs. 1,790→1,067 lines.
- **Scanner** - AP deductions in default output. AP18 (ADAPT comments), AP19 (absolute paths in hooks). Fabrication detection validates file:line ranges. CI patterns hardened to invocation matching.
- **Enforcement** - `.env` Edit/Write deny. Format hook skips agent config dirs. guard-write-size.sh template. `--dangerously-skip-permissions` bypass documented.
- **Setup** - Migration fragments include router + CI sync. Python subdirectory detection fix. Ask First short/full forms. Dispatcher disambiguation + target-aware routing.

## v0.9.2 - 2026-03-30

Post-publish fixes. README restructured as dashboard-first. npm package description updated. Dashboard removed auto-open browser. Setup prompt "9 skills" wording fixed.

## v0.9.1 - 2026-03-30

Dashboard, full coding-standards wiring, skill conversation enforcement, npm publish. 103 checks + 16 anti-patterns. 191 tests.

- **Dashboard** - `goat-flow dashboard` local server with live scanning, 4 tabs, dark mode, ARIA accessibility. Alpine.js + Tailwind CSS v4 via CDN. `--format html/markdown` for reports.
- **Coding Standards** - All 57 templates routed (was 25). Framework detection: Laravel, Symfony, Django, FastAPI, Rails, Spring, Express, Cypress. 21 new fragment map entries.
- **Skills** - All 9 synced across 3 agent dirs (27 files). Step 0 adaptive gate. 100% conversational compliance (was 80%). Restored audit/onboard/hypothesis features.
- **Scanner** - Removed 2.2.5g (package mutation deny). Dispatcher counted for evaluation diversity. XSS fix, CORS wildcard removed.
- **npm** - Published as `@blundergoat/goat-flow`. 197 files, 300KB packed. Source maps excluded. `--output` flag.

## v0.9.0 - 2026-03-29

Dispatcher skill, coding-standards refresh, scanner hardening, telemetry, signal-aware setup. 104 checks + 16 anti-patterns. 167 tests.

- **Coding Standards** - Backend: Go/DRF/Rust/Spring/.NET/TS Node. Frontend: 9-framework routing. Security: llm-security, phi-compliance, 5 framework-specific. DevOps: terraform, packer.
- **Scanner** - Dispatcher + Shared Conventions checks. AP16 deprecated skills (-5), AP17 dangling refs (-3). Signal follow-through (LLM, PHI, formatter). Eval frontmatter enforcement.
- **Setup** - `mapSignalsToTemplates()` auto-routes phi/llm templates. `renderSignals()` produces tasks. `scan-logger.ts` per-agent JSONL.
- **Skills** - Dispatcher + Shared Conventions across all dirs. Preflight: headers, skills, templates, dual-agent consistency. Format hook (prettier), deny hooks (package + cloud).

## v0.8.0 - 2026-03-28

Skill model cleanup (10→8), setup prompt fix, documentation alignment, rubric scoring cleanup. 97 checks + 15 anti-patterns. 138 tests.

- **Rubric** - Advisory checks converted to scored. Zero-point checks removed. Empty decisions dir moved to AP16. Handoff template requires all 5 sections.
- **Skills (10→8)** - goat-reflect/audit→goat-review, goat-onboard→goat-debug, goat-context removed. goat-investigate/simplify/refactor merged as modes. Deprecated dirs deleted. This was later subsumed by the 9→6 consolidation.
- **Setup** - Fragment map fix (add-skill-* no longer resolve to goat-debug). `--agent all` removed. Language mapper expanded to 10 languages.
- **Docs** - 21 stale "10 skills" refs fixed across README, docs/, setup/, src/cli/. CI template fixed to canonical 8 skills. Setup prompts remained reference-based.
- **Tests** - 96→138. Full-pass fixture updated. 9-project audit: all score A (96-100%).

## v0.7.0 - 2026-03-26

Reference-based setup prompts, scanner accuracy, CLI simplification. Setup output ~860→~90 lines. 92 checks + 12 anti-patterns.

- **Setup** - ~90-line prompts with template path tables. Agent-branched tables, language mapper, `GOAT_FLOW_INLINE_SETUP=1` rollback.
- **Scanner** - 3.3.4 sync Jaccard ≥0.85. Lessons strips HTML comments. AP11 fires on EITHER empty. Check 2.2.7 removed with the ask-first-guard rollback.
- **Templates** - enforcement.md jq/sed guidance. docs-seed.md concrete commands. execution-loop.md DoD gate.
- **Removed** - `fix`/`audit` CLI commands. ask-first-guard hooks. 77→96 tests.

## v0.6.0 - 2026-03-24

10 skills, 49 coding standards, eval runner, multi-agent infra, CLI quality overhaul. 94 checks + 12 anti-patterns.

- **Scanner** - 4 new checks, 3 new APs. Confidence-weighted scoring. Deny hook security audit. Projects drop from 100% to 92-99%.
- **Skills** - 10 skills (+goat-onboard/reflect/resume). 49 coding standards (backend 13, frontend 14, security 12). Eval runner with YAML frontmatter.
- **CLI** - 0 ESLint warnings, 0 knip exports. 6 god functions split. JSDoc on all 35 files. Strict tsconfig.
- **Infra** - .codex/ dir, composite GitHub Action. Deny hooks hardened. CODEOWNERS, CONTRIBUTING, SECURITY added.

## v0.5.0 - 2026-03-22

All 7 skills rewritten with conversational structure. 84 checks. All 3 agents score A 100%.

- **Skills** - goat-preflight→goat-security. Conversational choices at every phase. goat-debug recurrence, goat-plan kill criteria, goat-test Track 0, goat-review diff-aware.
- **Scanner** - Quality threshold unified at 0.8. New: skill chaining (2.1.14), structured choices (2.1.15).
- **Infra** - Preflight rewritten. CLAUDE.md compressed to 119 lines. Copilot bridge file.

## v0.4.0 - 2026-03-22

CLI scanner + prompt generator, local context system. 80 checks. All 6 projects score A (93-98%).

- **Scanner** - 80-check rubric (3 tiers + 9 APs), 90 prompt fragments. `scan`/`fix`/`setup`/`audit` commands. `--min-score` CI gate. 78 tests.
- **Local Context** - `.goat-flow/coding-standards/` with router. Copilot bridge files. 11 workflow templates. Migration guide.
- **Fixes** - 9 new quality checks. Phantom paths, stale refs fixed across 6 projects. ProjectShape/confusion-log removed.

## v0.3.0 - 2026-03-21

Multi-agent alignment. First public release under MIT license.

- **Tri-Agent** - Claude Code, Gemini CLI, Codex with unified `.agents/skills/`. 7 skills with YAML frontmatter. goat-research→goat-debug, created goat-plan/goat-test.
- **Safety** - Reverted Gemini overwrites. `mv -n` enforcement. Overwrite protection in Never tier.
- **Public** - MIT LICENSE, README rewrite. CI validates router tables + skill dirs. 3 footguns, 2 lessons logged.

## v0.2.0 - 2026-03-21

Workflow deployed across 7 projects. Multi-agent support. 11 diagnostic rounds.

- **Loop** - 6-step: READ→CLASSIFY→SCOPE→ACT→VERIFY→LOG. Complexity budgets. Debug gate. LOG triggers on VERIFY failure + human correction.
- **Skills (7)** - goat-plan (triangular tension), goat-test (3-track doer-verifier). goat-review depth requirement.
- **Enforcement** - 5-item Ask First checklist. deny-dangerous covers Edit/Write. Content-preserving write guard (>80% blocked).
- **Multi-Agent** - Codex + Gemini CLI. Truth order defined. Data honesty labels. Context rot defense (40-60%).

---

## v0.1.0 - 2026-03-20

First release. Complete workflow system.

- **System** - 5-layer architecture. 6-step execution loop with SCOPE. 3-layer enforcement (permissions→hooks→rules). Autonomy tiers. DoD (6 gates). Doer-verifier testing.
- **Skills (6)** - preflight, debug, audit, research, review, plan. Planning playbooks (feature brief, mob elaboration, SBAO, implementation checklists). Testing playbooks (doer-verifier, 3 tracks).
- **Docs** - system-spec, five-layers, six-steps, getting-started, design-rationale. Cross-agent comparison. CI context validation.
