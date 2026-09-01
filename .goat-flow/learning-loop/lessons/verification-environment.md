---
category: verification-environment
last_reviewed: 2026-08-30
---

**Scope:** Whether the build, tree, or sandbox that produced the evidence is the one the claim is about - a published package standing in for local source, a mutation sandbox that is not the checkout, and suite results taken while another session writes the tree. What counts as proof in general is [verification.md](verification.md); what a test must establish is [verification-testing.md](verification-testing.md).

## Lesson: Stryker sandboxes need local-state ignores and mutation-safe test selection

**Status:** active | **Created:** 2026-05-15 | **Merged during:** M11 learning-loop consolidation

**Prevention:** For mutation-test helpers, run `bash scripts/mutation-test.sh '<target>' -- --dryRunOnly` before a full campaign. Keep Stryker sandbox inputs focused on committed anchors, ignore `.goat-flow/logs/`, `.goat-flow/scratchpad/`, and `.goat-flow/plans/` local contents, and keep post-turn/generated-output scanners scoped to committable content rather than gitignored local state. Use mutation-safe test selection for source-text and built-dist guards. Evidence anchors: `scripts/mutation-test.sh` (search: `ignorePatterns`), `scripts/mutation-test.sh` (search: `--test-skip-pattern`), and `workflow/hooks/post-turn-safety.sh` (search: `scan_untracked_changes`).

**What happened:** The first `scripts/mutation-test.sh` audit-engine run failed before mutation testing because Stryker copied gitignored `.goat-flow/scratchpad` content into its sandbox. After local-state ignores were added, the dry run still failed because instrumented source broke learning-loop semantic-anchor checks and the sandbox lacked `dist/cli/cli.js` for the main-module guard. On 2026-06-14, `post-turn-safety` also looped Claude Stop by scanning ignored `_temp/stryker-tmp/sandbox-*` env examples copied from scratchpad material.

**Root cause:** Mutation sandboxes are not the same as the live checkout. They copy and instrument files, so repo self-inspection tests and local working artifacts can break before a mutation campaign begins.

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, I ran `npx goat-flow dashboard .`. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

---

## Lesson: A full-suite result is not attributable when another session is mutating the tree

**Status:** active | **Created:** 2026-08-18
**Incident count:** 4 | **Latest occurrence:** 2026-08-27
**Decision changed:** In a checkout another session or verification command is writing to, prove attribution from the change set and the failure message before reporting a suite result as yours or as pre-existing. Scope the claim you make to the contracts covering your files.
**Trigger phase:** VERIFY

**Prevention:** Keep a written list of the files you actually edited; that list, not `git diff`, is your change set. Prove a failure is not yours by reading its assertion and showing it names a file outside that list - a filename overlap is not proof either way, since one test file can hold both a failing gitignore assertion and an unrelated reference to your files. Run the focused contracts covering your change as the gate you claim, and report the full-suite number separately with its attribution stated. Treat build commands that replace shared outputs such as `dist` as writers, and run package/archive tests only after those builds finish. Never `git stash` to isolate; a second session can commit between the stash and the pop. Related: [[Parallel sessions need concurrency-safe file patterns]] covers write contention on the same files, which is a different failure from this one.

**What happened:** `npm test` reported 2066 pass / 0 fail after a playbook edit, then 2069 tests with 3 failures a few minutes later. The suite had grown by three tests and gained failures without my change set growing. `git diff --name-only test/` was useless for attribution because it returned the union of my one edited test file and eleven the other session had modified. Reading the failure messages settled it: both traceable failures asserted `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS must match workflow/setup/reference/goat-flow-gitignore`, and both that template and `.goat-flow/.gitignore` were modified in the tree by the other session's ignore-aware-search work. My six-file change set touched no gitignore.

**Root cause:** I reached for a whole-repo gate as the proof of a scoped change. In a shared checkout the suite measures the tree, not the diff, so its result carries another session's or concurrent command's in-flight state. `git status` and `git diff` describe the working tree the same way, so neither separates authorship.

**Recurrence 2026-08-23:** M17's no-schema gate first used broad `src/cli` and `test` status as an ownership signal. It ran clean before M17 wrote its decision, then a concurrent `writing-agent-facing-instructions.md` batch made twelve paths appear dirty even though M17 had not edited them. After stopping for approval, I narrowed proof to the exact M17-owned paths and an all-diff search for checkpoint-schema vocabulary. Evidence anchors: `src/cli/audit/skill-docs-contract.ts` (search: `.goat-flow/skill-docs/playbooks/writing-agent-facing-instructions.md`) and `workflow/skills/goat-plan/SKILL.md` (search: `mid-proof before switching modules`).

**Recurrence 2026-08-27:** Running `npm run build` and the packaged-hook canary concurrently let the build delete and recreate `dist` while the test archived the package. The archive exposed the declared CLI path without the corresponding file, so the combined run failed 91/92 at `existsSync(declaredCliEntryPath)`. The isolated canary after build completion passed 2/2, proving verification-command interference rather than a package regression. Evidence anchors: `package.json` (search: `rmSync('dist'`) and `test/integration/packaged-hook-install.test.ts` (search: `existsSync(declaredCliEntryPath)`).

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Extend the unique-filename pattern to footgun/lesson entries when multi-agent mode is detected

**What happened:** Observed during parallel Claude sessions: two agents writing to the same learning-loop file simultaneously. Learning loop files (`.goat-flow/logs/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`) are append-only by convention, but nothing prevents concurrent writes. Session logs use date-slug filenames, which reduce collisions, but category bucket files (e.g. `.goat-flow/learning-loop/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.
