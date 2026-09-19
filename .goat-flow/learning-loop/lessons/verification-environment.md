---
category: verification-environment
last_reviewed: 2026-09-05
---

**Scope:** Whether the build, tree, or sandbox that produced the evidence is the one the claim is about - a published package standing in for local source, a mutation sandbox that is not the checkout, and suite results taken while another session writes the tree. What counts as proof in general is [verification.md](verification.md); what a test must establish is [verification-testing.md](verification-testing.md).

## Lesson: Stryker sandboxes need local-state ignores and mutation-safe test selection

**Status:** active | **Created:** 2026-05-15 | **Merged during:** M11 learning-loop consolidation

**Prevention:** For mutation-test helpers, run `bash scripts/mutation-test.sh '<target>' -- --dryRunOnly` before a full campaign. Keep Stryker sandbox inputs focused on committed anchors, ignore the local contents of `.goat-flow/logs/`, `.goat-flow/scratchpad/`, and `.goat-flow/plans/`, and keep post-turn and generated-output scanners scoped to committable content rather than gitignored local state. Use mutation-safe test selection for source-text and built-dist guards. Evidence anchors: `scripts/mutation-test.sh` (search: `ignorePatterns`), `scripts/mutation-test.sh` (search: `--test-skip-pattern`), `workflow/hooks/post-turn-safety.sh` (search: `scan_untracked_changes`).

**What happened:** The first audit-engine run failed before mutation testing because Stryker copied gitignored scratchpad content into its sandbox. After local-state ignores were added, the dry run still failed because instrumented source broke learning-loop semantic-anchor checks and the sandbox lacked the built CLI entry for the main-module guard. On 2026-06-14 `post-turn-safety` also looped Claude Stop by scanning ignored sandbox env examples copied from scratchpad material.

**Root cause:** Mutation sandboxes are not the live checkout; they copy and instrument files, so repo self-inspection tests and local working artifacts break before a campaign begins.

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build rather than the published package: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path, and an `~/.npm/_npx/...` path means your edits are invisible. Use `npm run dev`, which builds and serves the local source. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

**What happened:** Verifying a new dashboard skill-quality workbench in a browser through `npx goat-flow dashboard .`, the Quality view loaded but the artifact list stayed empty, because a loader method just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`; counting the method name in the served JavaScript returned 0. After `npm run dev` the same count returned 2 and the workbench rendered.

**Root cause:** `npx goat-flow` resolves the published package rather than the local source tree and serves that package's own compiled assets, so local source edits cannot reach it.

---

## Lesson: A full-suite result is not attributable when another session is mutating the tree

**Status:** active | **Created:** 2026-08-18
**Decision changed:** In a checkout another session or verification command is writing to, prove attribution from the change set and the failure message before reporting a suite result as yours or as pre-existing.
**Trigger phase:** VERIFY
**Incident count:** 4 | **Latest occurrence:** 2026-08-27

**Prevention:** Keep a written list of the files you actually edited; that list, not `git diff`, is your change set. Prove a failure is not yours by reading its assertion and showing it names a file outside that list, because a filename overlap proves nothing either way. Run the focused contracts covering your change as the gate you claim, and report any full-suite number separately with its attribution stated. Treat build commands that replace shared outputs such as `dist` as writers, and run package or archive tests only after those builds finish. Never `git stash` to isolate, because a second session can commit between the stash and the pop. Write contention on the same file is a different failure, covered by `.goat-flow/learning-loop/lessons/verification-environment.md` (search: `Parallel sessions need concurrency-safe file patterns`).

**What happened:** `npm test` reported 2066 pass and 0 fail after a playbook edit, then 2069 tests with 3 failures minutes later; the suite had grown and gained failures without the change set growing. `git diff --name-only test/` was useless for attribution because it returned the union of one edited file and eleven the other session had modified. Reading the failure messages settled it: both traceable failures asserted the gitignore template contract, and both that template and the local ignore file had been modified by the other session, while the six-file change set touched no gitignore.

**Root cause:** A whole-repo gate was used as proof of a scoped change. In a shared checkout the suite measures the tree rather than the diff, and `git status` and `git diff` describe that tree identically for every author, so neither separates authorship.

**Recurrence 2026-08-23:** M17's no-schema gate used broad `src/cli` and `test` status as an ownership signal; it ran clean before M17 wrote its decision, then a concurrent playbook batch made twelve paths appear dirty although M17 had not edited them. Proof was narrowed to the exact M17-owned paths plus an all-diff search for checkpoint-schema vocabulary. `src/cli/audit/skill-docs-contract.ts` (search: `.goat-flow/skill-docs/playbooks/writing-agent-facing-instructions.md`), `workflow/skills/goat-plan/SKILL.md` (search: `mid-proof before switching modules`).
**Recurrence 2026-08-27:** Running `npm run build` and the packaged-hook canary concurrently let the build delete and recreate `dist` while the test archived the package, so the archive exposed the declared CLI path without its file and the combined run failed 91/92. The isolated canary after the build completed passed 2/2, proving verification-command interference rather than a package regression. `package.json` (search: `rmSync('dist'`), `test/integration/packaged-hook-install.test.ts` (search: `existsSync(declaredCliEntryPath)`).

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05
**Decision changed:** Before appending to a shared learning-loop bucket, check whether another session already has it dirty, and treat the append as a read-modify-write that must be re-read immediately beforehand.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Run `git status --short` over the target directory before writing a learning-loop bucket. If the bucket is already modified by another session, do not append: record the entry in a bucket you own, or wait and re-read. Re-read the file immediately before each append rather than writing from a copy read earlier in the session, keep the append to one entry, and run the entry-order contract and `stats --check` afterwards so a clobbered or duplicated entry surfaces immediately. Per-entry files were considered and rejected: ADR-033 keeps category buckets, so the mitigation is sequencing, not file layout. Evidence anchors: `.goat-flow/learning-loop/lessons/README.md` (search: `Bucket Size`), `.goat-flow/learning-loop/footguns/learning-loop-extraction.md` (search: `Bulk learning-loop rewrites can duplicate entries`).

**What happened:** Two agents wrote the same learning-loop file during parallel Claude sessions. The buckets under `.goat-flow/logs/`, `.goat-flow/learning-loop/lessons/`, and `.goat-flow/learning-loop/footguns/` are append-only by convention, but nothing prevents concurrent writes; session logs use date-slug filenames that reduce collisions, while category buckets are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions, so nothing serialises two appends to one bucket and a whole-file write from a stale read silently discards the other session's entry.
