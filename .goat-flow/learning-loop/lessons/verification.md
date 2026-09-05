---
category: verification
last_reviewed: 2026-09-05
---

**Scope:** General verification discipline - what counts as proof, reading before claiming, and checking the thing you actually changed. Siblings own the narrower surfaces: [verification-validators.md](verification-validators.md) for getting a checker right, [verification-scanners.md](verification-scanners.md) for proving a guard guards, [verification-testing.md](verification-testing.md) for what a test must establish, [verification-preflight.md](verification-preflight.md) and [verification-formatting.md](verification-formatting.md) for repo-wide gates, [verification-gruff.md](verification-gruff.md) for the analyzer, [verification-environment.md](verification-environment.md) for whether the build, tree, or sandbox you measured is the one your claim is about, and [milestone-accounting.md](milestone-accounting.md) for timing receipts and plan arithmetic.

## Lesson: A plan's named defect is a claim to verify, not a finding to implement

**Status:** active | **Created:** 2026-08-30
**Decision changed:** Reproduce a planned defect against live code before building the fix or the abstraction it implies, even when the milestone, a critique, and a runtime spot-check all assert it.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 2 | **Latest occurrence:** 2026-08-30

**Prevention:** Treat every defect a plan names as a RED to reproduce first. When the claim is about which of two inputs a component uses, read the caller that supplies them before designing anything, because parameter names do not carry the contract. If the RED passes against unchanged code, stop and record a refutation rather than adjusting the test until it fails; keep the passing case as a control and re-derive the real defect from the same evidence.

**What happened:** 1.17.0 M74 planned a fix for `handleQualityRequest` resolving audit, prior-report, and event ownership against the wrong project for target-owned quality modes. The milestone asserted it, an accepted critique listed it, and a failing integration test plus a `qualityModeOwningProjectPath` helper were written on that basis. Reading the caller then showed the dashboard client already resolves mode ownership and sends the owning project as `path`, so the route was correct and the helper re-resolved an already-resolved value.

**Root cause:** The request parameters are named `path` and `target`, which read as controller and selected target. That reading came from the names rather than from the client that populates them, and the plan's wording reinforced it.

**Evidence:** The replacement control case passed against unchanged route code, and a real defect surfaced from the same reading: `ctx.validatedPath` substitutes the server default for an empty value, so a request sending no target still rendered one. Anchors: `src/dashboard/dashboard-setup-quality.ts` (search: `function dashboardQualityReportProjectPath`), `src/cli/server/dashboard-quality-routes.ts` (search: `const requestedTarget`), `test/integration/dashboard-server-dashboard-api-quality.test.ts` (search: `names a selected target only when the request sent one`).

**Recurrence 2026-08-30 (delegated runner):** An M68 C5 cross-harness runner closed its assessment by reporting that the shipped `quality save` heredoc is unusable because the command parser rejects any heredoc containing an object-literal opener as expansion obfuscation, and supplied a reproduction. All three checks disagreed: the reproduction ran clean, a search for that diagnostic across both hook trees returned nothing, and the hook admits exactly that form. The runner hit a real failure and misattributed its cause; recording it unverified would have entered a phantom contract defect into a release gate's evidence. Anchor: `workflow/hooks/deny-dangerous.sh` (search: `large_quality_save_heredoc_is_bounded_data`).

---

## Lesson: Read a validator's pattern before reshaping text to satisfy it

**Status:** active | **Created:** 2026-08-18
**Decision changed:** On a validator rejection, open the assertion and read its pattern before editing the input a second time.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** When a validator rejects text that appears to satisfy its message, grep the emitting message in source and read the pattern before the next edit; error copy describes intent, not grammar, and only the pattern is authoritative. Where a caveat is worth keeping, put it in adjacent prose the validator does not parse rather than bending the pinned field.

**What happened:** `plans check --strict` rejected an `Actual:` line with `measured Actual reason must name receipt <seconds> recorded-unpaused seconds`. The line already contained that exact phrase, so the trailing clause was assumed to need reordering; the rerun failed identically. Reading the rule showed `src/cli/plans-check.ts` (search: `recorded-unpaused seconds`) anchors the reason with a whole-string regex, so the reason must be that string and nothing else. Two edits and two runs were spent on a guess the source answered in one read. The caveat moved into the milestone's Timing Receipt section.

**Root cause:** The message named a required substring and "must name" was read as "must contain", although an anchored regex is the likelier reading for a machine-parsed field and the file was one grep away.

---

## Lesson: I edited a dead code path because I assumed one implementation

**Status:** active | **Created:** 2026-08-05
**Decision changed:** Before changing behaviour in a script with capability detection, prove which branch actually executes for the installed tool.
**Trigger phase:** READ
**Caught at:** ACT

**Prevention:** When a script branches on capability detection, run the detection first and confirm which branch is taken before editing; here `gruff-ts hook --capabilities` answers it in one command. A behaviour change that produces no observable difference is evidence of a dead edit rather than a stubborn bug, so re-check the branch before stacking more changes on top. Evidence anchors: `.goat-flow/hooks/gruff-code-quality.sh` (search: `supports_native_changed_regions`), `.goat-flow/hooks/gruff-code-quality.sh` (search: `process_file_contract`).

**What happened:** Fixing the gruff hook's file-scope blind spot, the `--changed-scope` flag changed in `run_gruff_json` and the behaviour did not move. The hook has two paths, a legacy `analyse` path and a contract path selected when the analyzer advertises `gruff.hook.v1`; gruff-ts 0.4.0 advertises it, so `process_file_contract` runs and the edit was in code that never executes.

**Root cause:** One plausible implementation was matched to the symptom and edited without checking whether it was the live branch, and the file was long enough that the second path sat past where reading stopped.

---

## Lesson: Header-only edits leave bodies contradicting the new scope

**Status:** active | **Created:** 2026-05-16
**Incident count:** 5 | **Latest occurrence:** 2026-08-26

**Prevention:** After adding or changing a milestone, re-read the whole file rather than the header: grep old-scope keywords, check the filename, compare every named field with its live schema, resolve shared write paths into dependency headers, and require every command to be literal or to name the task that creates it. A reforecast updates basis, range, headline split, and per-item estimates together before strict validation. After rewriting ISSUE bands, count nonblank lines against the format authority. Do not begin a supplemental heading with a canonical or legacy section alias, because the export parser matches heading prefixes. Re-verify time-sensitive platform premises against current primary documentation and the installed version. Run structural validation after the final prose addition and before timing finalization; it proves shape and arithmetic, not semantic executability. Evidence anchors: `.goat-flow/skill-docs/skill-conventions.md` (search: `Task Tracking`), `src/cli/plans-check.ts` (search: `must equal the Effort estimate total`), `src/cli/quality/schema-types.ts` (search: `QUALITY_EVIDENCE_METHODS`), `workflow/skills/reference/skill-preamble.md` (search: `Report-Only Skill Contract`), `.agents/skills/goat-plan/references/issue-format.md` (search: `60 nonblank lines`), `src/cli/plans-export.ts` (search: `section.heading.startsWith`). External platform evidence: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks) (search: `Hooks in skills and agents`).

**What happened:** Status and dependency headers were updated across several milestone files and M11 was reframed, but body sections, deferred items, field names, and one filename still contradicted the new scope. Review caught doc-only milestones still requiring code helpers, stale dependencies, an old `confidence` field, and an abandoned filename.

**Root cause:** The header was treated as the scope change, although in planning docs a status, dependency, or framing change ripples through Scope Discipline, Tasks, Exit Criteria, Testing Gate, Deferred, filenames, and schema field names.

**Recurrence 2026-08-07:** A usage-insights plan set passed strict validation while a cold-start reread found contradictions the validator cannot see: a nonexistent quality `proof_class` field, a placeholder response mode with an under-scoped live sync command, two milestones racing on the same instruction files, and an assumption that persistent markers were needed after current Claude documentation added skill-scoped hook cleanup.
**Recurrence 2026-08-09:** The revised roadmap passed strict validation with zero exporter warnings, but a path-and-anchor audit found M06 naming `runConfiguredHookCommandSmoke`, which does not exist in the deny-runtime source; the plan now uses the live anchor. The first lesson draft then failed learning-loop validation for citing the gitignored roadmap as durable evidence. `src/cli/audit/check-agent-deny-runtime.ts` (search: `verifyConfiguredHookRuntime`).
**Recurrence 2026-08-16:** Reforecasting M04 moved its calibrated centre from 45 to 47 minutes in the basis and range while leaving the estimate and checklist totals at 45; strict validation rejected the two conflicting centres before product work began.
**Recurrence 2026-08-26:** During the 1.17.0 reconciliation, the first correction updated dependency and authority statements but left body text saying a corrected contract still pinned the wrong candidate, approval was pending, and rollback restored an absent critique log. The same pass rederived the ISSUE bands correctly but measured 63 nonblank lines against the 60-line target; a snapshot diff and exact counter caught both before delivery. The final closeout then used a `## Proof closure` heading, which the export parser treats as a second canonical Proof section, and strict validation reported conflicting proof representations until it became `## Closure evidence`. The plan is gitignored local evidence.

---

## Lesson: Defensive session rechecks can conflict with TypeScript narrowing

**Status:** active | **Created:** 2026-05-09

**Prevention:** Capture stable session resources after the initial guard, as in `const pty = this.session.pty`, and keep a synchronous write loop free of repeated status predicates. Evidence anchors: `src/cli/server/terminal.ts` (search: `class InitialPromptDelivery`), `src/cli/server/terminal.ts` (search: `chunkTerminalInput`).

**What happened:** Chunking dashboard terminal initial-prompt writes, the first `npm run typecheck` failed with `TS2367` because the loop checked `session.status === "terminated"` after an earlier guard had narrowed the status to active or starting. The intent was a defensive recheck, but the loop was synchronous and no local mutation could make that branch true.

**Root cause:** A defensive runtime status check was treated as free inside a narrowed synchronous scope, and TypeScript correctly rejected a comparison that could not happen there.

---

## Lesson: "Double check" means read the files, not re-run the tests

**Status:** active | **Created:** 2026-03-22
**Decision changed:** A double-check includes strict artifact validation and a source-diff read after focused tests.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-08-23

**Prevention:** A double-check includes the pipeline, removed-pattern searches, strict artifact validation, and a source-diff read of representative changed files; tests alone do not establish content accuracy.

**What happened:** The user asked to double check several times, and each time the response re-ran typecheck, tests, and the scan. It never caught the stale shape references, documentation inconsistencies, or content-quality issues that three external agents found immediately by reading the files.

**Root cause:** Verification was read as running the pipeline rather than reading what changed, and tests only cover what they test.

**Recurrence 2026-08-03:** Focused review-validator tests reported 48 passes, then a scoped-diff read found that `\S.+` required two characters where the declared compact-field contract required only non-empty text; the work returned to in-progress, changed the quantifier to `\S.*`, and reran the focused suite before the gate. `src/cli/review-validate-common.ts` (search: `COMPACT_CLEAN_REVIEW_FIELDS`), `test/unit/review-validate.test.ts` (search: `rejects empty, undefended, or repeated compact disclosures`).
**Recurrence 2026-08-23:** Focused tests, typecheck, formatting, and Gruff were green after a comment and naming pass, but rereading goat-clarity's scope rules found that `zeroHit` belonged to an exported interface, so the general low-risk naming approval did not satisfy the skill's identifier-specific second gate; the rename was reverted before closeout. `.agents/skills/goat-clarity/SKILL.md` (search: `Scope v2 needs second approval`), `src/cli/prompt/learning-loop-context.ts` (search: `export interface LearningLoopContextSelection`).

---

## Lesson: Agent doesn't tick milestone checkboxes (recurrence x4, unresolved)

**Status:** active | **Created:** 2026-03-31
**Incident count:** 4 | **Latest occurrence:** 2026-04-07
**Recurrences:** M1 (2026-03-31), M29 (2026-04-04), M32 (2026-04-05), M08 (2026-04-07)

**Prevention:** Treat checkbox state as part of each task's write transaction: update the active milestone immediately after the task result and before starting another task. Do not reintroduce a Stop-hook reminder without a new decision that satisfies ADR-037's rejection list.

**What happens:** The agent completes milestone tasks and ticks zero checkboxes, and the user discovers it during review. The instruction exists in three places and is ignored every time.

**Root cause:** When parallelizing work or context-switching to user messages, ticking as you go competes with doing the next thing and loses; completion is tracked mentally and never written to the file.

**Why stronger rules haven't worked:** Each recurrence added a stronger rule, from tick immediately, to make it the first action, to do it before anything else. All failed because documentation-level enforcement does not work here: the forcing function competes with whatever the agent wants to do next.

**Why it stays open:** Mechanical enforcement was tried and withdrawn, so do not re-propose it blind. ADR-037 (search: `shipped and reverted`) shipped `plan-checkbox-guard.sh` as a Claude-only Stop hook in v1.12.0, exactly the gate this lesson asks for, and ADR-037 (search: `tombstone only`) removed it a day later in v1.12.1: the reminder cost default Stop surface, dashboard hook list, installer and config schema, manifest, and audit fixtures, while non-Claude Stop delivery stayed unverified and stale registrations could keep invoking a deleted script. That ADR also rejects swapping in an immediate replacement, which risks rebuilding the same plan-state heuristics under a new name. The gap is real, but any new proposal must start from that rejection list and show what it does differently.

---

## Lesson: Skill RED baselines must retain current owner guidance

**Status:** active | **Created:** 2026-08-14
**Decision changed:** Before treating an unskilled run as evidence for a new skill, include every current owner and classify each failure against those owners before crediting the candidate.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 6 | **Latest occurrence:** 2026-08-15

**Prevention:** Run the baseline in four ordered steps.

1. **Freeze the owner manifest.** Give evaluators the same current instructions, playbooks, and routing an ordinary run would receive, and remove only the candidate artifact.
2. **Prove delivery, then evaluability.** Require per-file completion markers at the exact baseline volume before dispatch, because a requested output budget or a successful nested command is not proof the parent evaluator received every byte. Then run one end-to-end capacity probe carrying the full diff, source, learning, consumer, and verification volume; owner-only transport proof is insufficient. If the call constraint cannot carry the complete baseline through that verified run, stop candidacy rather than scoring reduced context.
3. **Freeze fixtures immutably.** For a pull-request fixture, pin comparison commits and require the sorted local diff-path manifest to equal the authenticated files result before dispatch; a closed PR's current base-branch pointer is not evidence.
4. **Classify before scoring.** Map every failed row back to the manifest: violating an already-loaded owner's gate or output stays owner noncompliance even when it repeats. Preserve omitted-owner and loaded-owner noncompliance as fixture evidence, but credit only a candidate-owned failure. Return separate owner, candidate, and infrastructure verdicts, and require a candidate verdict to cite one exact candidate-only clause.

Evidence anchors: `AGENTS.md` (search: `Sub-agents: ONE objective`), `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` (search: `Current constraints`), `.goat-flow/skill-docs/playbooks/code-comments.md` (search: `tie goes to the incumbent`), `.goat-flow/skill-docs/playbooks/naming-and-placement.md` (search: `Reconcile work using one unit per equation`), `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `prefer modes inside an existing skill`).

**What happened:** Goat-clarity candidacy runs reproduced compliant-comment churn after receiving a short project preservation rule, and the first interpretation treated the repetition as evidence for a code-clarity skill. The baseline had omitted the current comment and naming playbooks, including their stronger incumbent-tie rule and the existing ledger and report contract, so the runs measured reduced-context instruction adherence rather than whether a new skill beat ordinary ACT plus its owners.

**Root cause:** "Without the candidate skill" was treated as "with only a distilled fixture rule", which removed both the proposed artifact and the existing alternative and made the counterfactual unfair. Repeated failure cannot establish artifact need when the baseline is weaker than the shipped route.

**Recurrence 2026-08-15 (owner transport):** A compact PR baseline placed all nine owners into one orchestration result; both fresh evaluators received a truncated `gruff-code-quality.md` and no output for the remaining five owners, and stopped before reading either PR. Configuring complete reads is not evidence the evaluator received them, so both runs were transport failures rather than RED.
**Recurrence 2026-08-15 (immutable PR range):** A merged-PR fixture trusted the live `base.sha` in closed-PR metadata after the base branch had advanced, so the local range held hundreds of paths against a handful in the authenticated file list; the fixture was rebuilt from commit-graph evidence and its sorted manifest then matched exactly.
**Recurrence 2026-08-15 (context capacity):** Per-file delivery proved every owner reached a fresh evaluator without truncation, yet one complete run still exhausted the model context on its fifth call after adding the diff, source, learning entries, consumers, and verification output. Transport completeness is not end-to-end evaluability.
**Recurrence 2026-08-15 (mixed score ledgers):** Two isolated baselines received all nine owners and stayed within their call caps; both selected, contained, and reconciled the intended paths but also rewrote a compliant control, and their verifiers placed preservation beside candidate workflow rows and returned one overall failure. The host first recorded candidate reproduction as 1 of 2; re-reading the frozen classification showed the comment churn was owner noncompliance and every candidate-only row had passed, so the receipt was corrected to 0 of 2.

---

## Lesson: Proof gates must distinguish execution, mode, and semantic outcome

**Status:** active | **Created:** 2026-08-17
**Decision changed:** Accept a verification result only after confirming the command executed, selected the intended mode, and asserted the behavior rather than a shared keyword.
**Trigger phase:** VERIFY
**Incident count:** 14 | **Latest occurrence:** 2026-09-04
**Merged:** 2026-09-05 - absorbed two assertion-design recurrences (2026-08-01, 2026-08-23) from `.goat-flow/learning-loop/lessons/audit-contracts.md`.

**Prevention:** Before accepting any proof, answer three questions in order.

1. **Did it execute?** A hook block is not execution evidence: switch to an allowed data tool or a file-redirection shape and rerun. Pass multiline shell wrappers real separators rather than escaped display text, split evidence collection into bounded direct commands when the live guard rejects a compound wrapper, and confirm an edit or command actually ran before accepting downstream output.
2. **Did it select the intended mode?** For mode-gated CLI proof, assert the mode sentinel and the target result row before accepting exit zero.
3. **Did the assertion test the behaviour?** Pin a negative assertion to the complete unsafe instruction and positively require the safe replacement, because a shared suffix is not an absence proof when another feature can use it legitimately. For static prose, prefer independent literal checks against the exact approved strings and re-read the artifact before encoding expectations in a wrapper. To prove a patch introduced no token, use zero-context diff output, inspect only added rows, exclude the header line, and compare whole-tree counts separately; ordinary diff context is not changed content.

For an agent-driven probe, give the exact source line, commit or index the disposable baseline before launch, and require every mechanical postcondition: a successful tool event, the intended file diff or an independently captured state transition, a hook-start marker, a provider-visible marker, and the expected exit status. When a provider renderer may insert metadata, assert the structured event and the unique semantic marker independently rather than requiring display-label adjacency. Never promote the model's final sentence to proof.

Evidence anchors: `test/unit/audit-harness/settings-rules-matched.test.ts` (search: `offers deliberate review instead of an automatic rewrite`), `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to interpreter`), `src/cli/help.ts` (search: `--harness`), `src/cli/audit/audit.ts` (search: `harness: options.harness`), `src/cli/plans-check-structure.ts` (search: `plain-language section`), `.goat-flow/skill-docs/skill-preamble.md` (search: `Proof Gate`).

**What happened:** M39 verification exposed three false-proof shapes in one pass. A negative regex for the unsafe rewrite instruction also rejected the safe sentence saying the tool does not rewrite them automatically. A command piping audit JSON into inline Node was blocked before either parallel check ran. The direct retry exited zero but omitted `--harness`, and its JSON reported harness false with no harness scope, so it had never exercised the check it claimed.

**Root cause:** A matched token and a zero exit were treated as proof, without first asking whether the assertion separated safe from unsafe prose, whether the hook let the command execute, or whether the output named the intended CLI mode.

**Incident ledger:**

**Recurrence 2026-08-01 (baseline that cannot hold still):** M12 required its pre-implementation strict error list to stay byte-identical while the same milestone had to move from `not-started` to an active status. The checker correctly added M12 to the existing multiple-active-milestones line, so every product proof passed while the planned equality could not. When a baseline contains lifecycle state, compare invariant errors plus the named transition, then rerun after the final transition and require the temporary delta to disappear. `src/cli/plans-check-structure.ts` (search: `collectActiveStateErrors`).
**Recurrence 2026-08-23 (names are not calls):** M11's first negative persistence probe searched prompt modules for producer names plus a path phrase and failed on an existing type-only import, although the touched modules contain no write or event call. Negative mutation proof must target executable producer calls; module names and concept vocabulary are classification context, not write evidence.
**Recurrence 2026-08-23:** An M11 determinism wrapper ran both prompt commands, then failed before a verdict because the orchestration isolate reported `ReferenceError: crypto is not defined`; the two zero exits were not accepted, and a fresh rerun compared the complete outputs directly and reported an exact match without hashing.
**Recurrence 2026-08-24 (shared suffix):** A stale-installer-prose sweep matched the valid plans-export sentence because the negative regex named only the shared suffix; the proof was narrowed to the complete stale clause. `docs/cli.md` (search: `Existing output is preserved unless`).
**Recurrence 2026-08-24 (M51 escaped pipe):** A completed milestone escaped a pipeline pipe inside its single-quoted `--check` argument, so the documented command passed a literal escape and exited 0 against an expected exit 2; the real pipeline exposed the intended verdict. `test/integration/deny-dangerous-policy.test.ts` (search: `Policy destructive: eval hides commands from safety checks`).
**Recurrence 2026-08-27 (guessed source line):** A live Codex PostToolUse probe exited 0 and the model replied that it was done, but stderr showed `apply_patch` had searched for a guessed declaration absent from the fixture: the source stayed `BEFORE` and the analyzer-start marker was missing. The corrected retry used the exact source line and produced a completed file-change event, an `AFTER` file, both Gruff startup markers, an analyzer-only provider marker, exit 0, and empty stderr. Because the disposable file was never indexed, ordinary `git diff` stayed empty, so the independent before-state capture supplied the proof and exposed a fixture setup defect. That closed live PostToolUse delivery for the exact bypass-trust exec fixture only. `workflow/hooks/README.md` (search: `does not prove the external provider fired the hook or showed the result to the model`), `test/integration/hook-command-spawn-matrix.test.ts` (search: `delivers a managed Gruff result through Codex's registered Windows override`).
**Recurrence 2026-08-27 (verifier false negative):** The trusted follow-up run completed the file change, started both analyzer exchanges, and delivered the nonce inside valid JSONL, yet the probe reported its marker check false because the assertion required the nonce immediately after a display label while Codex correctly inserted rule, path, and severity metadata first. `workflow/hooks/README.md` (search: `without the bypass flag`).
**Recurrence 2026-09-04 (release prose):** The v1.17.0 release-prose verifier failed first on its own syntax, then because it expected an abbreviated audit command instead of the full version-pinned command in the approved draft. Neither failure described an artifact defect, and after two corrections the approach was rewound to direct literal checks against the reread prose. The draft is gitignored, so the evidence was the two failed proof outputs plus the same-session artifact read.
**Recurrence 2026-09-04 (release repair, seven false proofs):** One repair episode produced seven distinct false proofs, each from a wrapper rather than the artifact. An orchestration wrapper passed literal newline text between shell fragments, so Bash read a fused token, exited 127, and ran neither hash command; the retry with real separators exited 0 and reproduced every accepted hash. An exact-context patch mismatch stayed atomic and was not claimed as a write. The first strict check exited 1 on two invalid plain-language fields, corrected from its literal diagnostics. An all-in-one clarity inventory was blocked before execution, so the retry used bounded read-only commands. A terminal check invoked a nonexistent singular `plan` command and exited 2 until the milestone's command ledger exposed the syntax error. A release-prose wrapper searched the changelog for wording that exists only in the derived draft, and its successor assumed `rg -c` prints a numeric zero when ripgrep instead exits 1 with empty stdout; two corrections on that approach triggered a rewind to independent prose, count, identity, and plan checks. Finally, a predecessor-residue wrapper searched ordinary diff context and exited 1 on an unchanged version line beside a new bullet, while its zero-context added-line-only retry passed and independently counted 63 matches in both committed HEAD and the worktree, proving a verifier false positive. Tracing both scanner providers in the same episode corrected a grep-specific exit comment to provider-neutral wording. The release plans are gitignored, so their outputs remain session evidence; durable controls are `CHANGELOG.md` (search: `Preflight bounds dependency audits`), `src/cli/help.ts` (search: `Advanced commands:`), `scripts/maintenance/scan-secrets.sh` (search: `Using gitleaks`).

---

## Lesson: Focused installer migration tests must isolate the owning block

**Status:** active | **Created:** 2026-08-26
**Decision changed:** For a focused installer migration test, execute the smallest production-owned block or helper that contains the migration; reserve the full installer round trip for its end-to-end gate.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Bind the focused fixture to semantic anchors around the production block, run that exact block with only the primitives it needs, and assert both final filesystem state and operation order. Do not copy the migration sequence into the test, and keep the full installer run as separate repository proof because it covers unrelated stages. Evidence anchors: `workflow/install-goat-flow.sh` (search: `retired_writing_playbook`), `test/integration/setup-install-migrations.test.ts` (search: `installs renamed standalone playbooks before pruning retired filenames`), `test/integration/setup-install.helpers.ts` (search: `timeout: 30000`).

**What happened:** The first renamed-playbook migration test invoked the complete shell installer. On a Windows host the helper reached both replacement copies and both retired-file removals, then hit its 30-second process limit during later skill installation, so the test received `status: null` before its assertions and teardown reported `EPERM` for the contended temporary directory. The corrected fixture executes the installer's real standalone-playbook block with a minimal copy primitive and completed in about two seconds with one passing test.

**Root cause:** A local replacement-before-pruning contract was coupled to every downstream installer stage, and the larger process added runtime and platform failure modes that fail before the test can read migration evidence it has already produced.

---

## Lesson: Moving a learning-loop entry breaks inbound anchors that `stats --check` never inspects

**Status:** active | **Created:** 2026-08-30
**Decision changed:** After moving an entry between buckets, run `goat-flow audit --check-content` as well as `stats --check`; only the content lint resolves citations that point into the moved entry from outside its bucket.
**Trigger phase:** VERIFY
**Caught at:** VERIFY

**Prevention:** Treat a bucket split as a rename with unknown inbound callers. Before regenerating, grep the moved entry titles across committed content rather than filtering to the lessons tree, which misses ADRs, playbooks, and instruction files. After regenerating, run both gates: `stats --check` proves the buckets and generated indexes are internally consistent, and the content audit proves outside documents still resolve their cited anchors. Editing an ADR body also stales `.goat-flow/learning-loop/decisions/INDEX.md`, so regenerate after the citation repair rather than before it.

**What happened:** Splitting four entries out of this bucket into `.goat-flow/learning-loop/lessons/verification-environment.md` moved the anchor for the parallel-sessions entry. The bucket README's own post-split instruction named only `goat-flow index` and `stats --check`, and both ran clean. The break surfaced two steps later in preflight as a cold-path lint warning, because an ADR cited the entry by its old bucket path, and repairing that ADR staled `.goat-flow/learning-loop/decisions/INDEX.md` until it was regenerated a second time.

**Evidence:** `.goat-flow/learning-loop/decisions/ADR-048-concurrent-session-detection.md` (search: `Parallel sessions need concurrency-safe file patterns`) is the inbound citation that broke; `src/cli/audit/check-content-quality.ts` (search: `stale-semantic-anchor`) is the rule that caught it; `.goat-flow/learning-loop/lessons/README.md` (search: `Bucket Size`) is the post-split instruction, since corrected to name both gates.
