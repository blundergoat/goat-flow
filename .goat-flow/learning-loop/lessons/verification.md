---
category: verification
last_reviewed: 2026-08-17
---

**Scope:** General verification discipline - what counts as proof, reading before claiming, and checking the thing you actually changed. Siblings own the narrower surfaces: [verification-validators.md](verification-validators.md) for getting a checker right, [verification-scanners.md](verification-scanners.md) for proving a guard guards, [verification-testing.md](verification-testing.md) for what a test must establish, [verification-preflight.md](verification-preflight.md) and [verification-formatting.md](verification-formatting.md) for repo-wide gates, and [verification-gruff.md](verification-gruff.md) for the analyzer.

## Lesson: I edited a dead code path because I assumed one implementation

**Status:** active | **Created:** 2026-08-05
**Decision changed:** Before changing behaviour in a script with capability detection, prove which branch actually executes for the installed tool.
**Trigger phase:** ACT

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

**Status:** active | **Created:** 2026-05-16 | **Incident count:** 4 | **Latest occurrence:** 2026-08-16

**What happened:** I updated status/dependency headers across several milestone files and reframed M11, but left body sections, deferred items, field names, and one filename contradicting the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** I treated the header as the scope change. In planning docs, status/dependency/framing changes ripple through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Recurrence 2026-08-07:** The first usage-insights plan set passed strict plan validation, but a cold-start reread found semantic contradictions the validator cannot see: M08 required a nonexistent quality `proof_class` field, M06 left a placeholder response mode and an under-scoped live sync command, M11 could race M07 on the same instruction files, and M10 assumed persistent markers were necessary after current Claude documentation added skill-scoped hook cleanup. The corrected milestones now cite the live schema and platform contract, use runnable fixture commands, and encode shared-file dependencies.

**Recurrence 2026-08-09:** The revised analysis-derived roadmap passed strict plan validation with zero exporter warnings, but a cold-start path-and-anchor audit found that M06 named `runConfiguredHookCommandSmoke`, which does not exist in the current deny-runtime source. The plan now uses the live `verifyConfiguredHookRuntime` anchor. The first lesson draft then failed learning-loop validation because it cited the gitignored roadmap as durable evidence; the retained evidence points only to tracked source. Evidence anchor: `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`).

**Recurrence 2026-08-16:** Reforecasting M04 changed its calibrated centre from 45 to 47 minutes in `Forecast basis` and `Forecast range`, but left the `Effort estimate` and checklist totals at 45. Strict plan validation rejected the two conflicting centres before product work began. Aligning the headline split and one product and proof estimate restored one auditable forecast. Evidence anchor: `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`).

**Prevention:** After adding or changing a milestone, re-read the whole file, grep old-scope keywords, check the filename, compare every named field with its live schema, resolve shared write paths into dependency headers, and require every command to be literal or name the task that creates it. A reforecast updates the basis, range, headline split, and per-item estimates together before strict validation. Re-verify time-sensitive platform premises against current primary documentation and the installed version. Run structural plan validation last; it proves shape and arithmetic, not semantic executability. In closeout, list what changed in each touched milestone so reviewers can target the same surfaces. Evidence anchors: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`), `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`), `src/cli/quality/schema-types.ts` (search: `QUALITY_EVIDENCE_METHODS`), and `workflow/skills/reference/skill-preamble.md` (search: `Report-Only Skill Contract`). External platform evidence: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) (search: `Hooks in skills and agents`).

---

## Lesson: Browser-verifying local source needs `npm run dev`, not `npx goat-flow dashboard`

**Status:** active | **Created:** 2026-05-09

**What happened:** Verifying the new dashboard skill-quality workbench in a browser, ran `npx goat-flow dashboard .` to launch the dashboard. The Quality view loaded but the Skill Quality artifact list was empty - `skillQualityArtifacts` never populated. The new `loadSkillQualityInventory` method I had just added to `src/dashboard/app.ts` was missing from the served `/assets/app.js`. `curl -s ... /assets/app.js | grep -c loadSkillQualityInventory` returned `0`.

**Root cause:** `npx goat-flow ...` resolves the published `@blundergoat/goat-flow` from `~/.npm/_npx/...`, not the local source tree. The dashboard CLI from the published package bundles the package's own compiled assets - local source edits to `src/dashboard/app.ts` are invisible to it.

**Fix:** Use `npm run dev` (which runs `tsc && npm run build:dashboard && node dist/cli/cli.js dashboard . --dev`) to build and serve the local source. After that, `curl ... /assets/app.js | grep -c loadSkillQualityInventory` returned `2` and the workbench rendered correctly.

**Prevention:** Before browser-verifying a dashboard or CLI source change, confirm the running process is the local build, not the published package. One quick check: `ps aux | grep "node dist/cli/cli.js"` should show the local `dist/` path. If you see `~/.npm/_npx/...`, you are running the published package and your edits are invisible. Evidence anchors: `package.json` (search: `"dev":`), `src/cli/server/dashboard-assets.ts` (search: `loadDashboardAsset`).

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**What happened:** While chunking dashboard terminal initial prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had already narrowed the status to active/starting. The runtime intent was a defensive recheck, but the write loop was synchronous and no local status mutation could make that branch true.

**Root cause:** Treated a defensive runtime status check as free inside a narrowed synchronous scope. TypeScript correctly rejected a comparison that could not happen in that scope.

**Fix:** Capture stable session resources after the initial guard (`const pty = session.pty`) and keep the synchronous chunk write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `const pty = session.pty`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22
**Decision changed:** A double-check includes strict artifact validation and a source-diff read after focused tests.
**Trigger phase:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-03

**What happened:** User asked to "double check" multiple times. Each time, re-ran typecheck + tests + scan. Never caught stale shape references, documentation inconsistencies, or content quality issues that three external agents found immediately by reading the actual files.
**Root cause:** Interpreted verification as "run the pipeline" instead of "read what changed." Tests only cover what they test.
**Fix:** Added removed-pattern check to preflight. "Double check" should include: (1) run pipeline, (2) grep removed patterns, (3) read 3-5 changed files for content accuracy.

**Recurrence (2026-08-03):** Focused review-validator tests reported 48 passes, but the subsequent scoped-diff read found that `\S.+` required two characters where the declared compact-field contract required only non-empty text. The implementation returned to `in-progress`, changed the quantifier to `\S.*`, and reran the focused suite before the testing gate. Evidence anchors: `src/cli/review-validate-common.ts` (search: `COMPACT_CLEAN_REVIEW_FIELDS`) and `test/unit/review-validate.test.ts` (search: `rejects empty, undefended, or repeated compact disclosures`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31 | **Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**What happens:** The agent completes milestone tasks but ticks zero checkboxes. The user discovers it during review. CLAUDE.md VERIFY says "MUST tick `- [x]` on each task as it's completed - not at the end." The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, the "tick as you go" step competes with "do the next thing" and loses. The agent tracks completion mentally but never writes it to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger prevention rule. M1: "tick immediately." M29: "FIRST action must be editing the milestone file." M32: "before doing anything else." All failed because documentation-level enforcement does not work for this pattern - the forcing function competes with whatever the agent wants to do next, and loses.

**Mechanical enforcement was tried and withdrawn (do not re-propose it blind).** ADR-037 (search: `shipped and reverted`) shipped `plan-checkbox-guard.sh` as a Claude-only Stop hook in v1.12.0 - exactly the "hook or gate" this lesson asks for. ADR-037 (search: `tombstone only`) removed it one day later in v1.12.1: the reminder cost default Stop surface, dashboard hook list, installer/config schema, manifest, and audit fixtures, while non-Claude Stop delivery stayed unverified and stale registrations could keep invoking a deleted script. ADR-037 also explicitly rejects swapping in a replacement reminder immediately, because that "risks rebuilding the same plan-state heuristics under a new name" - a replacement needs its own plan.

**Status:** Unresolved, and deliberately so. The gap is real but the obvious fix has already been paid for once and reverted. Any new proposal must start from ADR-037's rejection list and show what it does differently - not restate "needs a hook."

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

## Lesson: Skill RED baselines must retain current owner guidance

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Before treating an unskilled run as evidence for a new skill, include every current owner and classify each failure against those owners before crediting the candidate.
**Trigger phase:** VERIFY
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
**Incident count:** 1 | **Latest occurrence:** 2026-08-17

**What happened:** M39 verification exposed three false-proof shapes in one pass. A negative regex for the unsafe rewrite instruction also rejected the safe sentence “does not rewrite them automatically.” A command that piped audit JSON into inline Node was blocked before either parallel check ran. The direct retry exited zero but omitted `--harness`; its JSON explicitly said `"harness": false` and carried no harness scope, so it had not exercised `settings-rules-matched`.

**Root cause:** I treated a matched token and a zero exit as proof without first checking whether the assertion distinguished safe from unsafe prose, whether the hook allowed the command to execute, or whether the output identified the intended CLI mode.

**Prevention:** Pin negative assertions to the complete unsafe instruction while positively requiring the safe replacement. Treat a hook block as no execution evidence and switch to an allowed data tool or file-redirection shape before rerunning. For mode-gated CLI proof, assert the mode sentinel and the target result row before accepting exit zero. Evidence anchors: `test/unit/audit-harness/settings-rules-matched.test.ts` (search: `offers deliberate review instead of an automatic rewrite`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to interpreter`), `src/cli/cli.ts` (search: `--harness`), and `src/cli/audit/audit.ts` (search: `harness: options.harness`).
