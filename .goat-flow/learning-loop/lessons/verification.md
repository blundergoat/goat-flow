---
category: verification
last_reviewed: 2026-08-30
---

**Scope:** General verification discipline - what counts as proof, reading before claiming, and checking the thing you actually changed. Siblings own the narrower surfaces: [verification-validators.md](verification-validators.md) for getting a checker right, [verification-scanners.md](verification-scanners.md) for proving a guard guards, [verification-testing.md](verification-testing.md) for what a test must establish, [verification-preflight.md](verification-preflight.md) and [verification-formatting.md](verification-formatting.md) for repo-wide gates, and [verification-gruff.md](verification-gruff.md) for the analyzer.

## Lesson: A plan's named defect is a claim to verify, not a finding to implement

**Status:** active | **Created:** 2026-08-30
**Decision changed:** Reproduce a planned defect against live code before building the fix or the abstraction it implies, even when the milestone, a critique, and a runtime spot-check all assert it.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Treat every defect a plan names as a RED to reproduce first. When the claim is about which of two inputs a component uses, read the caller that supplies them before designing anything; parameter names do not carry the contract. If the RED passes against unchanged code, stop and record a refutation instead of adjusting the test until it fails. Keep the passing case as a control, and re-derive what the real defect is from the same evidence rather than abandoning the investigation.

**Recurrence 2026-08-30 (delegated runner):** An M68 C5 cross-harness runner ended its assessment with a process note stating that the shipped
`quality save` heredoc is unusable because the command parser rejects any heredoc containing `{"` as "expansion obfuscation", and supplied a
reproduction. All three checks disagreed: the reproduction ran clean, `grep -rn 'expansion obfuscation'` over `.goat-flow/hooks/` and
`workflow/hooks/` returned nothing, and the hook contains `large_quality_save_heredoc_is_bounded_data` admitting exactly that form. The runner hit a
real failure and misattributed its cause. Recording it unverified would have entered a phantom contract defect into a release gate's evidence.

**What happened:** 1.17.0 M74 planned a fix for `handleQualityRequest` resolving audit, prior-report, and event ownership against the wrong project for target-owned quality modes. The milestone asserted it, an accepted critique listed it, and I wrote a failing integration test plus a `qualityModeOwningProjectPath` helper on that basis. Reading the caller then showed the dashboard client already resolves mode ownership in `src/dashboard/dashboard-setup-quality.ts` (search: `function dashboardQualityReportProjectPath`) and sends the owning project as `path`, so the route was correct and the helper re-resolved an already-resolved value.

**Root cause:** The request parameters are named `path` and `target`, which read as "controller" and "selected target". That reading was inferred from the names instead of from the client that populates them, and the plan's own wording reinforced it.

**Evidence:** The replacement control case `keeps mode evidence under the requested project when a target differs` passed against unchanged route code. A real defect surfaced from the same reading: `ctx.validatedPath` substitutes the server default for an empty value, so a request sending no `target` still rendered a selected target. Anchors: `src/cli/server/dashboard-quality-routes.ts` (search: `const requestedTarget`) and `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `names a selected target only when the request sent one`).

---

## Lesson: Read a validator's pattern before reshaping text to satisfy it

**Status:** active | **Created:** 2026-08-18
**Decision changed:** On a validator rejection, open the assertion and read its pattern before editing the input a second time.
**Trigger phase:** READ
**Caught at:** VERIFY

**What happened:** `plans check --strict` rejected an M01 `Actual:` line with `measured Actual reason must name receipt <seconds> recorded-unpaused seconds`. The line already contained that exact phrase, so I assumed the trailing clause I had appended needed reordering, moved it ahead of the phrase, and reran. It failed identically. Only then did I read the rule: `src/cli/plans-check.ts` (search: `recorded-unpaused seconds`) anchors the reason with `/^receipt\s+(\d+)\s+recorded-unpaused seconds$/u`, so the reason must be that string and nothing else. Two edits and two runs were spent on a guess the source answered in one read.

**Root cause:** The error message named a required substring, and I read "must name" as "must contain". An anchored regex was the likelier reading for a machine-parsed field, and the file was one grep away.

**Prevention:** When a validator rejects text that appears to satisfy its message, grep the emitting message in source and read the pattern before the next edit. Error copy describes intent, not grammar; only the pattern is authoritative. Where the caveat is genuinely worth keeping, put it in adjacent prose the validator does not parse rather than bending the pinned field - here the split caveat moved into the milestone's Timing Receipt section.

---

## Lesson: I edited a dead code path because I assumed one implementation

**Status:** active | **Created:** 2026-08-05
**Decision changed:** Before changing behaviour in a script with capability detection, prove which branch actually executes for the installed tool.
**Trigger phase:** READ
**Caught at:** ACT

**What happened:** Fixing the gruff hook's file-scope blind spot, I changed the `--changed-scope` flag in `run_gruff_json` and the behaviour did not move. The hook has two paths: a legacy `analyse` path and a `gruff.hook.v1` contract path selected when the analyzer advertises the contract. gruff-ts 0.4.0 advertises it, so `process_file_contract` runs and my edit was in code that never executes.

**Root cause:** I found one plausible implementation, matched it to the symptom, and edited it without checking whether it was the live branch. The file was long enough that the second path was well past where I stopped reading.

**Prevention:** When a script branches on capability detection, run the detection first and confirm which branch is taken before editing - here, `gruff-ts hook --capabilities` answers it in one command. A behaviour change that produces no observable difference is evidence of a dead edit, not of a stubborn bug; re-check the branch before adding more changes on top. Evidence anchors: `.goat-flow/hooks/gruff-code-quality.sh` (search: `supports_native_changed_regions`), `.goat-flow/hooks/gruff-code-quality.sh` (search: `process_file_contract`).

---

## Lesson: Stryker sandboxes need local-state ignores and mutation-safe test selection

**Status:** active | **Created:** 2026-05-15 | **Merged during:** M11 learning-loop consolidation

**What happened:** The first `scripts/mutation-test.sh` audit-engine run failed before mutation testing because Stryker copied gitignored `.goat-flow/scratchpad` content into its sandbox. After local-state ignores were added, the dry run still failed because instrumented source broke learning-loop semantic-anchor checks and the sandbox lacked `dist/cli/cli.js` for the main-module guard. On 2026-06-14, `post-turn-safety` also looped Claude Stop by scanning ignored `_temp/stryker-tmp/sandbox-*` env examples copied from scratchpad material.

**Root cause:** Mutation sandboxes are not the same as the live checkout. They copy and instrument files, so repo self-inspection tests and local working artifacts can break before a mutation campaign begins.

**Prevention:** For mutation-test helpers, run `bash scripts/mutation-test.sh '<target>' -- --dryRunOnly` before a full campaign. Keep Stryker sandbox inputs focused on committed anchors, ignore `.goat-flow/logs/`, `.goat-flow/scratchpad/`, and `.goat-flow/plans/` local contents, and keep post-turn/generated-output scanners scoped to committable content rather than gitignored local state. Use mutation-safe test selection for source-text and built-dist guards. Evidence anchors: `scripts/mutation-test.sh` (search: `ignorePatterns`), `scripts/mutation-test.sh` (search: `--test-skip-pattern`), and `workflow/hooks/post-turn-safety.sh` (search: `scan_untracked_changes`).

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16 | **Incident count:** 5 | **Latest occurrence:** 2026-08-26

**What happened:** I updated status/dependency headers across several milestone files and reframed M11, but left body sections, deferred items, field names, and one filename contradicting the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** I treated the header as the scope change. In planning docs, status/dependency/framing changes ripple through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Recurrence 2026-08-07:** The first usage-insights plan set passed strict plan validation, but a cold-start reread found semantic contradictions the validator cannot see: M08 required a nonexistent quality `proof_class` field, M06 left a placeholder response mode and an under-scoped live sync command, M11 could race M07 on the same instruction files, and M10 assumed persistent markers were necessary after current Claude documentation added skill-scoped hook cleanup. The corrected milestones now cite the live schema and platform contract, use runnable fixture commands, and encode shared-file dependencies.

**Recurrence 2026-08-09:** The revised analysis-derived roadmap passed strict plan validation with zero exporter warnings, but a cold-start path-and-anchor audit found that M06 named `runConfiguredHookCommandSmoke`, which does not exist in the current deny-runtime source. The plan now uses the live `verifyConfiguredHookRuntime` anchor. The first lesson draft then failed learning-loop validation because it cited the gitignored roadmap as durable evidence; the retained evidence points only to tracked source. Evidence anchor: `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`).

**Recurrence 2026-08-16:** Reforecasting M04 changed its calibrated centre from 45 to 47 minutes in `Forecast basis` and `Forecast range`, but left the `Effort estimate` and checklist totals at 45. Strict plan validation rejected the two conflicting centres before product work began. Aligning the headline split and one product and proof estimate restored one auditable forecast. Evidence anchor: `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`).

**Recurrence 2026-08-26:** During the 1.17.0 plan reconciliation, the first correction updated current dependency and authority statements but left body text saying a corrected contract still pinned the wrong candidate, approval was pending, and rollback restored an absent critique log. The same pass rederived the ISSUE bands correctly but measured 63 nonblank lines against the 60-line target. A snapshot diff and exact counter caught both classes before delivery; the correction removed the stale claims and measured 60 lines before the final strict check. The plan is gitignored local evidence; the tracked format authority is `.agents/skills/goat-plan/references/issue-format.md` (search: `60 nonblank lines`).

The final closeout then used `## Proof closure`, which the export parser treats as a second canonical Proof section because semantic aliases match heading prefixes. Strict validation caught `conflicting proof representations`; renaming it to `## Closure evidence` restored one proof representation. Evidence anchor: `src/cli/plans-export.ts` (search: `section.heading.startsWith`).

**Prevention:** After adding or changing a milestone, re-read the whole file, grep old-scope keywords, check the filename, compare every named field with its live schema, resolve shared write paths into dependency headers, and require every command to be literal or name the task that creates it. A reforecast updates the basis, range, headline split, and per-item estimates together before strict validation. After rewriting ISSUE bands or prose, count nonblank lines against `.agents/skills/goat-plan/references/issue-format.md` (search: `60 nonblank lines`). Do not begin supplemental headings with a canonical or legacy section alias. Re-verify time-sensitive platform premises against current primary documentation and the installed version. Run structural plan validation after the final prose addition and before timing finalization; it proves shape and arithmetic, not semantic executability. In closeout, list what changed in each touched milestone so reviewers can target the same surfaces. Evidence anchors: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`), `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`), `src/cli/quality/schema-types.ts` (search: `QUALITY_EVIDENCE_METHODS`), and `workflow/skills/reference/skill-preamble.md` (search: `Report-Only Skill Contract`). External platform evidence: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) (search: `Hooks in skills and agents`).

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, I ran `npx goat-flow dashboard .`. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**What happened:** While I was chunking dashboard terminal initial prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had already narrowed the status to active/starting. The runtime intent was a defensive recheck, but the write loop was synchronous and no local status mutation could make that branch true.

**Root cause:** Treated a defensive runtime status check as free inside a narrowed synchronous scope. TypeScript correctly rejected a comparison that could not happen in that scope.

**Fix:** Capture stable session resources after the initial guard (`const pty = this.session.pty`) and keep the synchronous chunk write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `class InitialPromptDelivery`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22
**Decision changed:** A double-check includes strict artifact validation and a source-diff read after focused tests.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-23

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

**Recurrence (2026-08-03):** Focused review-validator tests reported 48 passes, but the subsequent scoped-diff read found that `\S.+` required two characters where the declared compact-field contract required only non-empty text. The implementation returned to `in-progress`, changed the quantifier to `\S.*`, and reran the focused suite before the testing gate. Evidence anchors: `src/cli/review-validate-common.ts` (search: `COMPACT_CLEAN_REVIEW_FIELDS`) and `test/unit/review-validate.test.ts` (search: `rejects empty, undefended, or repeated compact disclosures`).

**Recurrence (2026-08-23):** Focused tests, typecheck, formatting, and Gruff were green after a comment and naming pass, but rereading goat-clarity's scope rules found that `zeroHit` belonged to an exported interface. The general request for low-risk naming changes did not satisfy the skill's second, identifier-specific Scope v2 approval gate. The rename was reverted before closeout. Evidence anchors: `.agents/skills/goat-clarity/SKILL.md` (search: `Scope v2 needs second approval`) and `src/cli/prompt/learning-loop-context.ts` (search: `export interface LearningLoopContextSelection`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Mechanical enforcement was tried and withdrawn (do not re-propose it blind).** ADR-037 (search: `shipped and reverted`) shipped `plan-checkbox-guard.sh` as a Claude-only Stop hook in v1.12.0 - exactly the "hook or gate" this lesson asks for. ADR-037 (search: `tombstone only`) removed it one day later in v1.12.1: the reminder cost default Stop surface, dashboard hook list, installer/config schema, manifest, and audit fixtures, while non-Claude Stop delivery stayed unverified and stale registrations could keep invoking a deleted script. ADR-037 also explicitly rejects swapping in a replacement reminder immediately, because that "risks rebuilding the same plan-state heuristics under a new name" - a replacement needs its own plan.

**Status:** Unresolved, and deliberately so. The gap is real but the obvious fix has already been paid for once and reverted. Any new proposal must start from ADR-037's rejection list and show what it does differently - not restate "needs a hook."

---

## Lesson: A full-suite result is not attributable when another session is mutating the tree

**Status:** active | **Created:** 2026-08-18
**Incident count:** 4 | **Latest occurrence:** 2026-08-27
**Decision changed:** In a checkout another session or verification command is writing to, prove attribution from the change set and the failure message before reporting a suite result as yours or as pre-existing. Scope the claim you make to the contracts covering your files.
**Trigger phase:** VERIFY

**What happened:** `npm test` reported 2066 pass / 0 fail after a playbook edit, then 2069 tests with 3 failures a few minutes later. The suite had grown by three tests and gained failures without my change set growing. `git diff --name-only test/` was useless for attribution because it returned the union of my one edited test file and eleven the other session had modified. Reading the failure messages settled it: both traceable failures asserted `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS must match workflow/setup/reference/goat-flow-gitignore`, and both that template and `.goat-flow/.gitignore` were modified in the tree by the other session's ignore-aware-search work. My six-file change set touched no gitignore.

**Root cause:** I reached for a whole-repo gate as the proof of a scoped change. In a shared checkout the suite measures the tree, not the diff, so its result carries another session's or concurrent command's in-flight state. `git status` and `git diff` describe the working tree the same way, so neither separates authorship.

**Prevention:** Keep a written list of the files you actually edited; that list, not `git diff`, is your change set. Prove a failure is not yours by reading its assertion and showing it names a file outside that list - a filename overlap is not proof either way, since one test file can hold both a failing gitignore assertion and an unrelated reference to your files. Run the focused contracts covering your change as the gate you claim, and report the full-suite number separately with its attribution stated. Treat build commands that replace shared outputs such as `dist` as writers, and run package/archive tests only after those builds finish. Never `git stash` to isolate; a second session can commit between the stash and the pop. Related: [[Parallel sessions need concurrency-safe file patterns]] covers write contention on the same files, which is a different failure from this one.

**Recurrence 2026-08-23:** M17's no-schema gate first used broad `src/cli` and `test` status as an ownership signal. It ran clean before M17 wrote its decision, then a concurrent `writing-agent-facing-instructions.md` batch made twelve paths appear dirty even though M17 had not edited them. After stopping for approval, I narrowed proof to the exact M17-owned paths and an all-diff search for checkpoint-schema vocabulary. Evidence anchors: `src/cli/audit/skill-docs-contract.ts` (search: `.goat-flow/skill-docs/playbooks/writing-agent-facing-instructions.md`) and `workflow/skills/goat-plan/SKILL.md` (search: `mid-proof before switching modules`).

**Recurrence 2026-08-27:** Running `npm run build` and the packaged-hook canary concurrently let the build delete and recreate `dist` while the test archived the package. The archive exposed the declared CLI path without the corresponding file, so the combined run failed 91/92 at `existsSync(declaredCliEntryPath)`. The isolated canary after build completion passed 2/2, proving verification-command interference rather than a package regression. Evidence anchors: `package.json` (search: `rmSync('dist'`) and `test/integration/packaged-hook-install.test.ts` (search: `existsSync(declaredCliEntryPath)`).

---

## Lesson: Parallel sessions need concurrency-safe file patterns

**Status:** active | **Created:** 2026-04-05

**What happened:** Observed during parallel Claude sessions: two agents writing to the same learning-loop file simultaneously. Learning loop files (`.goat-flow/logs/`, `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`) are append-only by convention, but nothing prevents concurrent writes. Session logs use date-slug filenames, which reduce collisions, but category bucket files (e.g. `.goat-flow/learning-loop/lessons/verification.md`) are shared write targets.

**Root cause:** goat-flow was designed for single-agent sessions. The category bucket format (multiple entries in one file) creates write contention that per-entry files (one file per lesson) wouldn't have.

**Prevention:**
1. Document which files are safe for concurrent access in the plugin instructions
2. For learning loop writes during parallel sessions, use unique filenames (date-agent-slug) rather than appending to shared buckets
3. Extend the unique-filename pattern to footgun/lesson entries when multi-agent mode is detected

---

## Lesson: Skill RED baselines must retain current owner guidance

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Before treating an unskilled run as evidence for a new skill, include every current owner and classify each failure against those owners before crediting the candidate.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 6
**Latest occurrence:** 2026-08-15

**What happened:** Goat-clarity candidacy runs reproduced compliant-comment churn after receiving a short project preservation rule. The first interpretation treated repetition as evidence for a code-clarity skill. The baseline had omitted the current comment and naming playbooks, including their stronger incumbent-tie rule and existing ledger/report contract, so the runs measured reduced-context instruction adherence rather than whether a new skill outperformed ordinary ACT plus its owners.

**Root cause:** “Without the candidate skill” was treated as “with only a distilled fixture rule.” That removed both the proposed artifact and the existing alternative, making the counterfactual unfair. Repeated failure cannot establish artifact need when the comparison baseline is weaker than the shipped route.

**Recurrence (2026-08-15, complete-owner transport):** A compact PR baseline moved fixture sealing out of the evaluator but placed all nine current owners into one orchestration result. Both fresh evaluators received a truncated `gruff-code-quality.md` and omitted outputs for the remaining five owners, even though the nested reads requested larger output budgets. They stopped before reading either PR. The two runs were transport failures, not RED: configuring complete reads is not evidence that the evaluator received them.

**Recurrence (2026-08-15, immutable PR range):** A merged-pull-request fixture trusted the live `base.sha` in closed-PR metadata after the base branch had advanced. The resulting local range contained hundreds of paths while the pull request's `/files` endpoint contained only the original handful, so the first seal described the branch's later history instead of the reviewed change. The fixture was rejected and rebuilt from immutable commit-graph evidence; its sorted local path manifest then matched `/files` exactly.

**Recurrence (2026-08-15, end-to-end context capacity):** Immediate per-file delivery proved that every owner reached a fresh evaluator without truncation, but one complete run still exhausted the model context during its fifth call after adding the selected diff, full source, learning entries, consumers, and verification output. Transport completeness is not end-to-end evaluability. After a probe passes, the worst-case RED fixture must still finish inside the same context and call budget before its result can count.

**Recurrence (2026-08-15, mixed score ledgers):** Two isolated U-selector baselines received all nine owners and completed within their call caps. Both actors selected, contained, and reconciled the intended paths, but they also rewrote a compliant control. Their verifiers placed preservation beside candidate workflow rows and returned one overall failure. The host initially recorded candidate reproduction `1/2`; re-reading the frozen classification showed that comment churn was owner noncompliance and every candidate-only row had passed. Work stopped before recording `2/2`, and the receipt was corrected to `0/2`.

**Prevention:** Freeze the baseline-owner manifest before RED. Give evaluators the same current instructions, playbooks, and routing an ordinary run would receive; remove only the candidate artifact. Prove delivery with per-file completion markers at the exact baseline volume before dispatch; a requested output budget or successful nested command is not proof that the parent evaluator received every byte. Then run one end-to-end capacity probe with the full diff, source, learning, consumer, and verification volume; owner-only transport proof is insufficient. For pull-request fixtures, freeze immutable comparison commits and require the sorted local diff-path manifest to equal the authenticated `/files` result before dispatch; a closed PR's current base-branch pointer is not sufficient evidence. If the five-call constraint cannot carry the complete baseline through a separately verified end-to-end run, stop candidacy instead of scoring reduced context. Before scoring, map every failed row back to that manifest: violating an already-loaded owner's gate or output remains owner noncompliance even when it repeats. Preserve omitted-owner or loaded-owner noncompliance as fixture evidence, but credit only a candidate-owned failure toward candidacy. Require separate owner, candidate, and infrastructure verdicts before any overall result. A candidate verdict must cite one exact candidate-only clause; a generic failure is insufficient. Evidence anchors: `AGENTS.md` (search: `Sub-agents: ONE objective`), `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Current constraints`), `.goat-flow/skill-docs/playbooks/code-comments.md` (search: `tie goes to the incumbent`), `.goat-flow/skill-docs/playbooks/naming-and-placement.md` (search: `Reconcile work using one unit per equation`), and `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `prefer modes inside an existing skill`).

---

## Lesson: Finalized timing receipts require their parsed summaries

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Finalize milestone timing through the plans-time command; when repairing a receipt manually, reconcile both summary lines before claiming measured Actual.
**Trigger phase:** VERIFY

**What happened:** A milestone's segment table, receipt state, and measured Actual were finalized by hand, but the first strict completion check rejected them. The receipt omitted the `Recorded seconds` and `Allocated minutes` lines, so the parser had no summary object against which to validate the Actual claim. After those lines were added, the next check rejected a manually rounded category split that did not follow the canonical largest-remainder allocation.

**Root cause:** The visible segment arithmetic was treated as the whole embedded receipt, then category minutes were rounded by intuition. The strict checker requires both canonical parsed summaries and its deterministic allocation; a complete-looking table alone is insufficient evidence for measured Actual.

**Prevention:** Use `plans time stop <milestone> --finalize` for normal closure. If manual recovery is necessary, compare the receipt with the canonical rendered shape, derive rather than eyeball the largest-remainder split, and rerun strict validation after the terminal status change. Evidence anchors: `docs/cli.md` (search: `plans time stop .goat-flow/plans/<active>/M01-example.md --finalize`), `src/cli/plans-time-receipt.ts` (search: `Compare rounded total, category sum, and largest-remainder allocation`), and `src/cli/plans-check.ts` (search: `measured Actual requires a finalized embedded Timing Receipt`).

---

## Lesson: Proof gates must distinguish execution, mode, and semantic outcome

**Status:** active | **Created:** 2026-08-17
**Decision changed:** Accept a verification result only after confirming the command executed, selected the intended mode, and asserted the behavior rather than a shared keyword.
**Trigger phase:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-27

**What happened:** M39 verification exposed three false-proof shapes in one pass. A negative regex for the unsafe rewrite instruction also rejected the safe sentence “does not rewrite them automatically.” A command that piped audit JSON into inline Node was blocked before either parallel check ran. The direct retry exited zero but omitted `--harness`; its JSON explicitly said `"harness": false` and carried no harness scope, so it had not exercised `settings-rules-matched`.

**Recurrence 2026-08-23:** An M11 determinism wrapper ran both prompt commands, then failed before producing a verdict because the orchestration isolate reported `ReferenceError: crypto is not defined`. The two zero exits were not accepted as proof. A fresh rerun compared the complete outputs directly and reported an exact match without depending on hashing. Evidence anchor: `.goat-flow/skill-docs/skill-preamble.md` (search: `Proof Gate`).

**Recurrence 2026-08-24:** M25's first stale-installer-prose sweep matched the valid plans-export sentence “Existing output is preserved unless `--force`” because the negative regex named only the shared suffix. The proof was narrowed to the complete stale user-owned-content clause before it was accepted. Evidence anchor: `docs/cli.md` (search: `Existing output is preserved unless`).

**Recurrence 2026-08-24 (M51):** The completed milestone escaped a pipeline pipe inside its single-quoted `--check` argument.
The documented command passed literal `\|` and exited 0 despite its expected exit 2.
Running the real `|` pipeline exposed the intended eval verdict.
Evidence anchor: `test/integration/deny-dangerous-policy.test.ts` (search: `Policy destructive: eval hides commands from safety checks`).

**Recurrence 2026-08-27:** An approved Codex CLI 0.149.1 live PostToolUse probe exited 0 and the model replied `LIVE_CODEX_PROBE_DONE`, but stderr showed that `apply_patch` had searched for a guessed declaration absent from the fixture. The source remained `BEFORE` and the analyzer-start marker was absent, so the first turn was invalid evidence. A corrected retry used the exact source line: Codex reported a completed file-change event, the file became `AFTER`, Gruff wrote both startup markers, the provider exposed the analyzer-only marker `LIVE_POSTTOOL_PROVIDER_MARKER_20260827`, the process exited 0, and stderr was empty. That closed live PostToolUse delivery for the exact bypass-trust exec fixture, not for untouched DevGoat or generic trusted sessions. Because the disposable file had not been indexed, ordinary `git diff` stayed empty; the independent before-state capture, file-change event, after-state read, hook marker, and provider-only marker supplied the proof, while also exposing a fixture setup defect. Evidence anchors: `workflow/hooks/README.md` (search: `does not prove the external provider fired the hook or showed the result to the model`) and `test/integration/hook-command-spawn-matrix.test.ts` (search: `delivers a managed Gruff result through Codex's registered Windows override`).

**Recurrence 2026-08-27 (trusted project):** The trusted follow-up PostToolUse run completed the file change, started both analyzer exchanges, and delivered the nonce inside valid JSONL, but the probe summary still reported its marker check as false. The assertion required the nonce immediately after a display label; Codex correctly inserted rule, path, and severity metadata first. The raw agent-message event and independent marker counters proved delivery, exposing a verifier false negative rather than a provider failure. Evidence anchor: `workflow/hooks/README.md` (search: `without the bypass flag`).

**Root cause:** I treated a matched token and a zero exit as proof without first checking whether the assertion distinguished safe from unsafe prose, whether the hook allowed the command to execute, or whether the output identified the intended CLI mode.

**Prevention:** Pin negative assertions to the complete unsafe instruction while positively requiring the safe replacement; a shared suffix is not a safe absence proof when another feature can use it legitimately. Treat a hook block as no execution evidence and switch to an allowed data tool or file-redirection shape before rerunning. For mode-gated CLI proof, assert the mode sentinel and the target result row before accepting exit zero. For agent-driven probes, give the exact source line, commit or index the disposable baseline before launch, and require all mechanical postconditions: successful tool event, intended file diff or independently captured state transition, hook-start marker, provider-visible marker, and expected exit status. When a provider renderer may insert metadata, assert the structured event and unique semantic marker independently; never require display-label adjacency. Never promote the model's final sentence to proof. Evidence anchors: `test/unit/audit-harness/settings-rules-matched.test.ts` (search: `offers deliberate review instead of an automatic rewrite`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to interpreter`), `src/cli/help.ts` (search: `--harness`), and `src/cli/audit/audit.ts` (search: `harness: options.harness`).

---

## Lesson: Focused installer migration tests must isolate the owning block

**Status:** active | **Created:** 2026-08-26
**Decision changed:** For a focused installer migration test, execute the smallest production-owned block or helper that contains the migration; reserve the full installer round trip for its end-to-end gate.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Bind the focused fixture to semantic anchors around the production block, run that exact block with only the primitives it needs, and assert both final filesystem state and operation order. Do not copy the migration sequence into the test. Keep the full installer run as separate repository proof because it covers unrelated installation stages.

**What happened:** The first renamed-playbook migration test invoked the complete shell installer through `runInstaller`. On this Windows host, the helper reached both replacement copies and both retired-file removals, then hit its 30-second process limit during later skill installation. The test received `status: null` before its assertions, and teardown then reported `EPERM` for the still-contended temporary directory. The corrected fixture extracts and executes the installer's real standalone-playbook block with a minimal copy primitive; the original focused command completed in about two seconds with one passing test.

**Root cause:** A local replacement-before-pruning contract was coupled to every downstream installer stage. The larger process added runtime and platform failure modes that could fail before the test interpreted already-produced migration evidence.

Evidence anchors: `workflow/install-goat-flow.sh` (search: `retired_writing_playbook`), `test/integration/setup-install-migrations.test.ts` (search: `installs renamed standalone playbooks before pruning retired filenames`), and `test/integration/setup-install.helpers.ts` (search: `timeout: 30000`).
