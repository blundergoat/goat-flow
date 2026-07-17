---
category: verification
last_reviewed: 2026-07-17
---

## Lesson: Stryker sandboxes need local-state ignores and mutation-safe test selection

**Status:** active | **Created:** 2026-05-15 | **Merged during:** M11 learning-loop consolidation

**What happened:** The first `scripts/mutation-test.sh` audit-engine run failed before mutation testing because Stryker copied gitignored `.goat-flow/scratchpad` content into its sandbox. After local-state ignores were added, the dry run still failed because instrumented source broke learning-loop semantic-anchor checks and the sandbox lacked `dist/cli/cli.js` for the main-module guard. On 2026-06-14, `post-turn-safety` also looped Claude Stop by scanning ignored `_temp/stryker-tmp/sandbox-*` env examples copied from scratchpad material.

**Root cause:** Mutation sandboxes are not the same as the live checkout. They copy and instrument files, so repo self-inspection tests and local working artifacts can break before a mutation campaign begins.

**Prevention:** For mutation-test helpers, run `bash scripts/mutation-test.sh '<target>' -- --dryRunOnly` before a full campaign. Keep Stryker sandbox inputs focused on committed anchors, ignore `.goat-flow/logs/`, `.goat-flow/scratchpad/`, and `.goat-flow/plans/` local contents, and keep post-turn/generated-output scanners scoped to committable content rather than gitignored local state. Use mutation-safe test selection for source-text and built-dist guards. Evidence anchors: `scripts/mutation-test.sh` (search: `ignorePatterns`), `scripts/mutation-test.sh` (search: `--test-skip-pattern`), and `workflow/hooks/post-turn-safety.sh` (search: `scan_untracked_changes`).

---

## Lesson: Gruff comment fixes must satisfy both humans and the analyzer

**Status:** active | **Created:** 2026-05-25

**What happened:** During gruff docs cleanup, comments in `src/cli/server/decoders.ts` made sense to a maintainer but still failed `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, and `docs.missing-why-for-complex-code`. In the same cleanup, renaming dashboard terminal paste metadata passed focused tests but left stale ambient and VM-test helper shapes caught by `npm run typecheck`.

**Root cause:** I treated human-readable comments and a local rename as complete before checking the analyzer vocabulary and parallel type surfaces.

**Prevention:** For gruff-driven comment work, read `code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. If a rename replaces a comment, grep the old identifier and run `npm run typecheck`. Evidence anchors: `src/cli/server/decoders.ts` (search: `Parse a JSON request body without throwing`), `src/cli/server/decoders.ts` (search: `This stays explicit because`), `src/dashboard/globals.d.ts` (search: `shouldDelaySubmit`), `.goat-flow/learning-loop/patterns/workflow.md` (search: `Gruff docs cleanup is a tight analyzer loop`).

## Lesson: Gruff hook compatibility probes need real configs and wrapper PATH

**Status:** active | **Created:** 2026-05-28

**What happened:** While verifying `workflow/hooks/gruff-code-quality.sh` against `/home/devgoat/projects/gruff-workspace/gruff-go`, `gruff-php`, `gruff-py`, and `gruff-rs`, the first hook-shaped probes failed or produced no output for reasons unrelated to JSON compatibility. Placeholder `.gruff-*.yaml` files such as `rules: {}` were invalid or too incomplete for several analyzers, and the Rust probe replaced `PATH` with only gruff binary directories plus `/usr/bin:/bin`, hiding `cargo` from `gruff-rs/bin/gruff-rs`.

**Root cause:** I treated sibling gruff CLIs as interchangeable binaries but skipped two runtime surfaces that are part of the hook contract: schema-bearing project config files and wrapper-script dependencies inherited from the caller's normal `PATH`.

**Prevention:** When testing `gruff-code-quality.sh` against sibling gruff implementations, copy or reference each project's real `.gruff-*.yaml`, preserve the normal `PATH` while prefixing local gruff binaries, and run both checks: direct `analyse --format json` schema probes and hook-shaped probes with changed ranges. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `discover_binary`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `changed line finding`).

## Lesson: Gruff doc comments can expose hidden complexity warnings

**Status:** active | **Created:** 2026-05-30

**What happened:** Adding a maintainer comment to `src/dashboard/app.ts` `_uploadTerminalImages` cleared a docs finding but exposed new `complexity.npath` and `design.god-function` warnings. The helper extraction then passed TypeScript but failed preflight ESLint on an unnecessary assertion.

**Root cause:** I checked only the targeted docs rule and assumed a comment-only patch could not change broader warning or lint counts.

**Prevention:** After a large gruff docs batch, run `npx gruff-ts analyse --format json --fail-on none` and compare warning count, then run the lint/preflight gate for any helper extraction. Do not remove a useful comment just to hide a surfaced warning. Evidence anchors: `src/dashboard/app.ts` (search: `encodeTerminalUploadFiles`), `src/dashboard/app.ts` (search: `showTerminalUploadResult`).

## Lesson: docs.missing-internal-function-doc must not be silenced; baseline the residue

**Status:** active | **Created:** 2026-05-29

**What happened:** Gruff-ts reported 337 `docs.missing-internal-function-doc` findings across 73 files. Adding boilerplate JSDoc to every short helper would satisfy the rule but violate the repo's "rewrite/rename before comment" doctrine.

**Root cause:** Two correct rules collide: gruff rules must not be disabled, but comments must only explain non-obvious WHY. This rule had no tuning options, leaving only fix, rename, or baseline.

**Prevention:** Triage `docs.missing-internal-function-doc` with the gruff-code-quality playbook. Add comments only when they meet the contract bar; otherwise rename or baseline with rationale. Revisit when gruff-ts gains threshold/name-match tuning. Evidence anchors: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Doc comments are mandatory under that playbook`), `scripts/preflight-checks.sh` (search: `Gruff Policy`).

## Lesson: RegExp constructor assertions need a real escape helper

**Status:** active | **Created:** 2026-05-28

**What happened:** While adding a hook smoke test for extension-based gruff binary selection, the first assertion escaped path separators for a `RegExp` constructor with `replaceAll("/", "\\\\/")`. The hook output used the expected slash-separated PHP fixture path, but the generated regex expected an extra backslash and the focused test failed.

**Root cause:** I treated slash escaping for regex literals and `RegExp` constructor strings as the same problem. In constructor strings, `/` is not a delimiter and does not need escaping; only regex metacharacters do.

**Prevention:** When asserting dynamic paths or rule IDs through `new RegExp(...)`, use a small `escapeRegex` helper for regex metacharacters instead of ad hoc slash replacement. Evidence anchors: `test/integration/gruff-code-quality-smoke.helpers.ts` (search: `function escapeRegex`) and `test/integration/gruff-code-quality-smoke.test.ts` (search: `selects the gruff binary from the edited file extension`).

## Lesson: Harness fixture counts must match the reported unit

**Status:** active | **Created:** 2026-05-25

**What happened:** During the gruff documentation pass on `src/cli/audit/harness/check-verification.ts`, the focused evidence-before-claims test failed because the fixture expected `4 present instruction file` even though Codex and Antigravity both pointed at the same `AGENTS.md`. The harness reported the correct deduplicated count: 3 unique present instruction files.

**Root cause:** The assertion counted agent profiles, while the check reports unique instruction-file paths. Shared instruction files make those units diverge.

**Prevention:** In harness tests, name and assert the reported unit explicitly: profiles, unique files, findings, or checks. When a fixture deliberately maps multiple agents to the same instruction file, document that duplicate-path case next to the fixture helper. Evidence anchors: `test/unit/audit-harness/check-evidence-before-claims.test.ts` (search: `unique present instruction files`), `src/cli/audit/harness/check-verification.ts` (search: `instructionFilePaths`), `test/fixtures/evidence-before-claims.ts` (search: `antigravity: "AGENTS.md"`).

## Lesson: Validators can require explicit inventories and phrases despite README pointers

**Status:** active | **Created:** 2026-05-24

**What happened:** Replacing explicit playbook filenames in `.goat-flow/architecture.md` with a README pointer failed `skill-playbook-inventory-drift`; replacing instruction Key Resources examples with only an index pointer then failed `Instruction parity`.

**Root cause:** I optimized for low-drift prose before reading the validators that require direct filenames and phrases.

**Prevention:** Before replacing explicit inventories or required phrases with index pointers, grep content-quality, factual-drift, parity, and preflight checks. If a validator checks direct filename or phrase inclusion, keep the explicit text and add the index pointer around it. Evidence anchors: `src/cli/audit/check-factual-semantic-drift.ts` (search: `driftSkillPlaybookInventory`), `scripts/check-instruction-parity.mjs` (search: `tool-playbook Key Resources`).

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16

**What happened:** I updated status/dependency headers across several milestone files and reframed M11, but left body sections, deferred items, field names, and one filename contradicting the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** I treated the header as the scope change. In planning docs, status/dependency/framing changes ripple through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Prevention:** After a milestone scope change, re-read the whole file, grep old-scope keywords, check the filename, and scan for doctrine violations such as `confidence` or file-line evidence. In closeout, list what changed in each touched milestone so reviewers can target the same surfaces. Evidence anchor: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`).

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, ran `npx goat-flow dashboard .` to launch the dashboard. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

---

## Lesson: Behavior-scope changes need assertion updates before the first focused run

**Status:** active | **Created:** 2026-05-04

**What happened:** Several behavior-scope changes updated the main implementation but missed adjacent assertions: setup remediation still expected `--harness --agent codex`, `/goat-plan` prompts still expected inline-only wording, PTY paste launch still had env/argv expectations, and the tool-playbook router row still had an old regex.

**Root cause:** I updated the route contract and one obvious test, but did not grep for every old flag/phrase that encoded the previous behavior.

**Prevention:** When changing endpoint, launch-context, setup-prompt, or router semantics, grep focused tests for the old flags and phrases before the first run. Search the implementation and smoke/audit tests for old launch-context wording, env vars, runner flags, and setup commands. Evidence anchors: `src/cli/server/terminal.ts` (search: `initialInput`), `test/smoke/dashboard-endpoints.test.ts` (search: `injects POSIX launch prompts through PTY input`), `src/cli/audit/check-goat-flow.ts` (search: `Instruction file skill-docs pointer`).

**Recurrence (2026-07-13):** M07 added eight manifest-backed deprecated-hook comparisons, while the clean drift fixture still expected the old comparison total. The test now derives the added count from `hooks.stale_names` instead of copying another literal. Evidence anchor: `test/integration/audit-drift.test.ts` (search: `expectedDeprecatedHookComparisons`).

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**What happened:** While chunking dashboard terminal initial prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had already narrowed the status to active/starting. The runtime intent was a defensive recheck, but the write loop was synchronous and no local status mutation could make that branch true.

**Root cause:** Treated a defensive runtime status check as free inside a narrowed synchronous scope. TypeScript correctly rejected a comparison that could not happen in that scope.

**Fix:** Capture stable session resources after the initial guard (`const pty = session.pty`) and keep the synchronous chunk write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `const pty = session.pty`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

---

## Lesson: New validators must run against the live repo before closeout

**Status:** active | **Created:** 2026-04-29

**What happened:** M06 added decision-file validation and the fixture tests passed, but the first live `node --import tsx src/cli/cli.ts stats . --check` run failed against existing ADR files and one stale lesson reference.

**Root cause:** Treated fixture coverage as enough proof for a repository-wide validator. The new rule was correct, but the live repo contained older records that predated the stricter contract.

**Fix:** After adding any validator that scans a project-wide artifact directory, run it against the live repository before the milestone gate and budget time for the live cleanup it exposes.

**Recurrence (2026-07-13):** M07 ownership fixtures passed focused manifest tests, but full preflight found three packaged-mode `ManifestJson` fixtures that omitted the new required `file_ownership` contract. It also caught ESLint complexity and Knip exports outside the focused commands. After a manifest schema change, grep every `ManifestJson` fixture and run the full static/test gate, not only the new validator suite. Evidence anchors: `test/unit/packaged-install.test.ts` (search: `file_ownership`), `src/cli/manifest/manifest-json.ts` (search: `OWNERSHIP_EVIDENCE_FINDERS`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Status:** Unresolved. Needs mechanical enforcement (hook or gate), not more rules.

---

## Lesson: Heading regexes can silently truncate router-table checks

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); markdown-parsing principle survives in later parser lessons

**What happened:** Tightened `2.4.3` to parse the Router Table directly, but the first extractor used a multiline regex with `$` in the lookahead. In JavaScript regexes, `$` under `/m` matches end-of-line, so the match stopped after the `## Router Table` heading and never included the rows below it. The new regression also referenced an undefined fixture constant, so the first focused test run broke twice before the real logic was verified.
**Root cause:** Reached for a compact heading regex instead of reusing the repo’s line-based section parsing style, then wrote a regression that depended on a fixture helper that did not exist in that file.
**Fix:** For markdown section extraction, prefer line-based parsers over multiline heading regexes with `$`. For new regressions, build the smallest self-contained fixture possible unless the shared fixture object is already in scope.

---

## Lesson: Path normalization can invalidate later path-shape heuristics

**Status:** historical | **Created:** 2026-04-03 | **Reason:** Rubric check 2.4.3 no longer exists (ADR-013); normalization-invariant principle applies to any parser

**What happened:** After normalizing router references by trimming trailing slashes, the follow-up `2.4.3` filter still looked for the literal substring `/skills/`. That turned `.claude/skills/` into `.claude/skills`, so the canonical passing fixture dropped from `100` to `99` even though the router row was correct.
**Root cause:** Mixed two phases of logic without rechecking the invariant after normalization. The filter assumed the original slash shape still existed after the normalizer had deliberately removed it.
**Fix:** When a parser normalizes paths, downstream checks must use shape tests that still hold after normalization, such as segment-boundary regexes (`/\/skills(?:\/|$)/`) instead of raw substring checks that depend on trailing separators.

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05

**What happened:** Observed during parallel Claude sessions: two agents writing to the same learning-loop file simultaneously. Learning loop files (`.goat-flow/logs/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`) are append-only by convention, but nothing prevents concurrent writes. Session logs use date-slug filenames which reduces collisions, but category bucket files (e.g. `.goat-flow/learning-loop/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Session logs already use unique filenames - extend this pattern to footgun/lesson entries when multi-agent mode is detected

---

## Lesson: Manifest canonical vs stale_names misclassification silently broke skill installs

**Status:** active | **Created:** 2026-04-16

**What happened:** `workflow/manifest.json` and `src/cli/constants.ts` both listed only `"goat"` as canonical even though the installer and repo shipped seven skills. Audit, dashboard, and setup therefore reported "1/1 installed" while six functional skills were missing from a consumer install.

**Root cause:** A contract test proved two sources agreed, but both sources were wrong in the same direction; neither was checked against ground truth on disk or the installer list.

**Prevention:** Agreement tests need a ground-truth leg. For skill counts, validate manifest/constants against actual skill directories or installer inputs, not only against each other. Evidence anchors: `workflow/install-goat-flow.sh` (search: `for skill in`), `workflow/manifest.json` (search: `canonical`), `src/cli/constants.ts` (search: `getSkillNames`).

---

## Lesson: Redundant context files survive architecture changes because nobody measures token cost

**Status:** active | **Created:** 2026-04-16

**What happened:** RULES.md (432 words, 6 sections) loaded on every `/goat` dispatch was almost entirely duplicated from CLAUDE.md and skill-preamble.md. A coding agent critique flagged it: "432 words of token budget consumed for ~30 words of unique signal." The file had existed since the mono-skill dispatcher model. When the architecture split into 7 skills with a shared preamble, the preamble absorbed the same rules but nobody deleted RULES.md. Then an audit check was added requiring it, an install script clause was added to copy it, and a template was created for it - each reinforcing the file's perceived necessity.

**Root cause:** No step in the setup or review process measures whether a shared-context file provides net-new information. Files that are "loaded on every invocation" are never challenged on token cost. Once a file exists and is wired into audit checks, it becomes self-justifying: the audit requires it, so it must be needed.

**Fix:** Deleted RULES.md. Moved 2 unique lines to skill-preamble.md. Removed audit check and install script special-case.

**Prevention:** When reviewing shared-context files (anything loaded on every turn or every skill invocation), compare section-by-section against other loaded files. If >80% duplicates existing loaded content, merge the unique lines and delete the file. Architecture changes that add new shared surfaces (like skill-preamble.md) should include a cleanup pass of older surfaces they subsume.

---

## Lesson: Dashboard API reviews need invalid-path assertions, not just happy-path shape checks

**Status:** active | **Created:** 2026-04-16

**What happened:** The new dashboard HTTP integration suite initially focused on successful responses and basic endpoint reachability. When an explicit negative-path test for `GET /api/audit?path=/does/not/exist` was added, the route returned `200` with an audit-shaped payload instead of a JSON error. The same risk applied to setup, critique, and stack-detection routes because they accepted a `path` string but did not first verify that it existed and was a directory.

**Root cause:** The dashboard server delegated path handling to downstream helpers and implicitly trusted them to reject bad inputs. That made the contract look healthy in happy-path tests while a false-success path remained live. The original tests asserted status enums and endpoint availability, but not that invalid inputs failed loudly.

**Fix:** Added a shared `requireProjectDirectory()` guard in `src/cli/server/dashboard.ts` and used it before audit, setup, critique, and stack-detection work. Expanded `test/integration/dashboard-server.test.ts` to cover invalid audit and browse paths, plus stronger JSON/content-shape assertions across the API.

**Prevention:**
1. For every dashboard route that accepts a filesystem path, add at least one invalid-path test alongside the happy path.
2. Treat `fetch().json()` shape assertions as necessary but insufficient - contract tests also need status-code assertions for malformed or nonexistent inputs.
3. When a route wraps shared project helpers, validate the path at the HTTP boundary instead of assuming downstream code will reject it consistently.

---

## Lesson: New dashboard assets must work in both built and source-run server paths

**Status:** active | **Created:** 2026-04-20

**What happened:** Moving the dashboard preset catalog into `src/dashboard/preset-prompts.json` compiled cleanly and updated the production build copy step, but the first focused verification run failed every dashboard-server integration test. `serveDashboard()` immediately tried to read `dist/dashboard/preset-prompts.json`, and the source-run test harness starts the server from `src/cli/server/dashboard.ts` without guaranteeing that newly added static files already exist under `dist/`.

**Root cause:** Verified the TypeScript surface but missed the dashboard server's dual runtime shape. The server can be exercised from built artifacts and from source-driven test runs. The new JSON asset was only wired for the built path, so verification exposed a runtime assumption that typecheck could not see.

**Fix:** Keep the production copy step in `package.json`, but make the dashboard server prefer `dist/dashboard/preset-prompts.json` and fall back to `src/dashboard/preset-prompts.json` when the built copy is absent. Re-run the focused dashboard + manifest tests after the fallback lands.

**Prevention:**
1. After introducing a new dashboard static asset, verify both the build script path and the source-run server/test path.
2. Treat `npm run typecheck` as schema coverage only; any new file-loading path still needs a runtime test.
3. When the dashboard server reads shipped assets during startup, prefer a controlled fallback instead of assuming `dist/` is always populated in local verification flows.

---

## Lesson: Shared runtime helpers must be re-owned explicitly during server splits

**Status:** active | **Created:** 2026-04-20

**What happened:** Extracting the dashboard terminal concern into `src/cli/server/dashboard-terminal.ts` compiled most of the new code, but the first verification run still failed `npm run typecheck`. `src/cli/server/dashboard.ts` still called the old shared `getWSS()` for dev-mode live reload even though terminal WebSocket ownership had moved into the new module, and the new terminal upgrade helper left one stale `Socket` type annotation even though Node's HTTP upgrade callback supplies a `Duplex`.

**Root cause:** The refactor moved the obvious terminal route bodies first but left one cross-cutting shared helper assumption behind. The old shape had one lazily created WebSocket server serving both live reload and terminal attach flows, so splitting one concern requires explicitly deciding who owns the remaining live-reload server and updating the upgrade-socket types at the same time.

**Fix:** Give live reload its own local `getLiveReloadWSS()` in `dashboard.ts`, keep the terminal module responsible only for terminal upgrades, and align the helper signature with the actual HTTP upgrade socket type (`Duplex`). Re-run `npm run typecheck` before trusting the focused dashboard integration suite.

**Prevention:**
1. When splitting server concerns that previously shared one lazy resource (`getWSS`, caches, singleton managers), make ownership explicit for every remaining caller before declaring the extraction done.
2. For Node HTTP upgrade handlers, verify the callback parameter types against the real server API during the extraction instead of copying a narrower type from a local helper.

---

## Lesson: Repeated doc claims need grep verification after the first patch

**Status:** active | **Created:** 2026-04-21

**What happened:** A small doc-only fix changed one `Sessions rail (cap=7)` claim to `cap=10`, but the first patch missed a second occurrence later in the same release note and briefly introduced a copy-edit typo in `CHANGELOG.md` while applying the correction.
**Root cause:** Treated the first matching line as the whole problem instead of verifying all repeated claims for that concept across the touched docs before closing the edit.
**Fix:** After a doc truthfulness fix, run a focused `rg` for both the old phrase and the corrected concept across every touched doc before claiming the update is complete.

**Prevention:**
1. For duplicated release-note bullets or summary sections, assume the same claim may appear more than once and verify with `rg`, not by eyeballing one section.
2. After any doc-only patch, read the exact changed hunk or `git diff` once before closeout to catch accidental copy-edit regressions.

---

## Lesson: Copilot instruction line caps count trailing newlines

**Status:** active | **Created:** 2026-04-25

**What happened:** A v1.3.0 version-bump pass added one Essential Commands line to `.github/copilot-instructions.md`. `wc -l` reported 120 lines, but `npm test` still failed the Copilot contract because the test counts `readFileSync(...).split(/\r?\n/)`, so a trailing newline makes a 120-line file count as 121 entries.

**Root cause:** I checked the human line count after the failure instead of reading the contract's counting helper first. The repository's enforced ceiling is the test helper, not `wc -l`.

**Prevention:**
1. When touching `.github/copilot-instructions.md`, keep `wc -l` below the configured target or run the instruction-line-count gate in `bash scripts/preflight-checks.sh` before broader verification.
2. For line-budget failures, read the exact line-count implementation before deciding how many lines need to be trimmed. Evidence anchor: `scripts/preflight-checks.sh` (search: `line_target`).

---

## Lesson: Runtime hook messages must stay paired with agent-config templates

**Status:** active | **Created:** 2026-04-27

**What happened:** Updated `.github/hooks/hooks.json` to improve the PowerShell fallback message, then the first `bash scripts/preflight-checks.sh` run failed `Agent Config Parity` because `workflow/hooks/agent-config/copilot-hooks.json` still contained the old string.

**Root cause:** Treated the installed Copilot hook config as the only file needing the UX copy change. The workflow template is the parity source for installed agent configs, so any installed hook-message change needs the template change in the same patch.

**Prevention:** When changing `.github/hooks/hooks.json`, grep `workflow/hooks/agent-config/` for the same hook payload and update the matching template before the first preflight run. Evidence anchor: `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

---

## Lesson: Quality diff compares saved report IDs, not report file paths

**Status:** active | **Created:** 2026-07-12

**What happened:** During final quality-report verification, I passed two JSON file paths to `quality diff`. The CLI exited 2 because an explicit comparison is one colon-delimited `<from-id>:<to-id>` argument; selecting the latest same-agent reports with `--agent codex --mode agent-setup` then completed successfully.

**Root cause:** I inferred a conventional two-path diff interface instead of reading the command contract before the auxiliary close-out check.

**Prevention:** Run `goat-flow quality diff --agent <id> --mode <mode>` for the latest matching pair, or pass one `<from-id>:<to-id>` argument as documented in `docs/cli.md` (search: `quality diff [<from-id>:<to-id>]`). Do not pass report filesystem paths.

---

## Lesson: New subcommands need parser headroom before the first GREEN refactor

**Status:** active | **Created:** 2026-07-13

**What happened:** The first M02 `skill doctor` implementation passed its behavioral suite (`20 passed`, `0 failed`) but failed the whole-file quality gate. `parseSkillPositionals` and `validateSkillFlags` exceeded ESLint complexity limits, the first doctor collector had two more complexity failures, and adding one branch pushed `cli-parser.ts` and `cli-handlers.ts` above the 750-line gruff threshold. The final preflight later caught an unnecessary `renderSkillDoctorMarkdown` export and a bare backticked filename in `docs/cli.md` (search: `Canonical workflow source`) that focused tests, ESLint, typecheck, Prettier, and targeted gruff did not cover.

**Root cause:** I treated a behavioral GREEN as permission to finish the command inside two already-large shared modules. The tests proved output behavior, but they did not measure whether the new subcommand left the parser and dispatch surfaces easy to verify. Importing doctor helpers back into the parser would also have violated the existing lazy-import pattern by loading audit and manifest dependencies for unrelated commands.

**Fix:** Extract lightweight positional/flag rules into `src/cli/skill-command-parser.ts` (search: `parseSkillPositionals`), keep doctor runtime imports behind `src/cli/cli-handlers.ts` (search: `handleSkillCommand`), and split collection decisions inside `src/cli/skill-doctor.ts` (search: `inspectFrontmatterFields`). Whole-file ESLint, typecheck, and targeted gruff then passed without suppressions or threshold changes.

**Prevention:**
1. Before extending a shared parser or dispatcher, measure its line and complexity headroom; near-threshold files need an extraction in the initial GREEN design.
2. Keep parser modules dependency-light. A diagnostic subcommand may lazy-load audit/manifest code after dispatch, but argv parsing must not import that runtime.
3. Before the human gate, run Knip and path-integrity through full preflight; focused TypeScript and analyzer checks do not prove the command's public exports or documentation references are clean.
3. After behavioral GREEN, run whole-file ESLint, typecheck, and gruff before documentation or task completion; the verification unit is the changed file set, not only the new test cases.

---

## Lesson: Required CLI choices need omission tests

**Status:** active | **Created:** 2026-07-13
**Decision changed:** Test valid, invalid, and omitted forms for every required CLI choice; omission must not silently select a default. | **Trigger phase:** VERIFY
**Incident count:** 1 | **Latest occurrence:** 2026-07-13

**What happened:** M17's plan and handler required `--scenario deny-hook`, but the parser returned that value when the flag was absent. Positive, invalid-value, and live explicit-command checks all passed, so only a final omission probe exposed the false choice.

**Root cause:** I treated the sole current scenario as a harmless default even though explicit user selection was part of the command's safety contract.

**Fix and prevention:** Add an omission RED test before implementation and make the parser exit 2 when the required value is absent. Evidence anchors: `src/cli/cli-parser.ts` (search: `parseHookScenarioArg`) and `test/unit/hooks-runtime-evidence.test.ts` (search: `requires an explicit hook verification scenario group`).

---

## Lesson: Milestone plans need exporter-contract verification before handoff

**Status:** active | **Created:** 2026-07-17  
**Decision changed:** After writing or restructuring `M*.md` files, validate them with the shipped plan exporter before handoff; visual Markdown completeness is insufficient. | **Trigger phase:** VERIFY  
**Incident count:** 1 | **Latest occurrence:** 2026-07-17

**What happened:** The 1.15.0 milestone files looked structurally complete and passed a custom heading/count check, but the first `plans export` preview warned that all 11 records lacked portable objectives and boundary notes. The files used a level-two `Objective` section instead of the exporter's bold `Objective` field, omitted `Boundary Notes`, and initially placed CAO incident gates in peer sections that the exporter would not include in task bodies.

**Root cause:** I validated the authoring layout I had produced instead of the repository's consumer contract. A Markdown reader could infer the intended fields, while `parseMilestoneMarkdown` intentionally recognizes a narrower portable schema.

**Fix and prevention:** Use `**Objective:**`, `## Scope`, `## Boundary Notes`, `## Tasks`, `## Testing Gate`, and `## Exit criteria` for portable milestones. Put task subgroups under level-three headings so they remain inside `Tasks`. Before handoff, run `node dist/cli/cli.js plans export <plan-path> --format json` and require every record to have zero warnings; when shell policy rejects a pipe into an interpreter, import `parseMilestoneMarkdown` directly in a read-only local verification script. Evidence anchors: `src/cli/plans-export.ts` (search: `addMissingFieldWarning`) and `src/cli/plans-export.ts` (search: `readMilestoneSection`).
