---
category: review-feedback
last_reviewed: 2026-08-11
---

**Scope:** Weighing human and multi-agent critique - why synthesis is the expensive half, not applying findings before verifying them, and what repeated review rounds still miss. Automated reviewer output is [review-bot-evidence.md](review-bot-evidence.md).

## Lesson: Multi-agent critique finds findings single reviewers miss - but synthesis is the expensive part

**Status:** active | **Created:** 2026-04-13

**Prevention:** When commissioning multi-agent critique, plan for synthesis work. Budget time to: (a) verify disputed claims against source code, (b) track first-discovery of each finding, (c) dispute false claims with evidence. The critique is an input that requires judgment, not a spec that gets executed.

**What happened:** A multi-agent critique run on goat-flow v1.1.0 surfaced more defects than any single reviewer caught alone. MAJOR audit-honesty findings (Codex compaction hook false positive, ask_first glob-unaware false positive) were each raised by a single reviewer. First-pass reviews established the bulk of findings; later reviews added diminishing but non-zero value, including MAJOR findings no earlier reviewer had raised.

**What this means for critique practice:**
1. Multi-agent critique is worth doing for large surfaces. A single thorough review will miss things, and the things it misses can be important.
2. Model diversity matters more than reviewer count. Different model families have different systematic blind spots - one family may under-weight documentation surfaces, another may miss integration glue. Mixing families covers more ground than stacking instances of one.
3. The synthesis + verification layer is where the value is captured. A non-trivial share of raw multi-agent claims will be wrong or need active verification. Unverified multi-agent output is noisier, not more reliable.
4. Sweet spot: several reviews from different model families for a framework/architecture audit; fewer for a feature or module.
5. Score convergence across reviewers is the signal that coverage is adequate - not review count. High score variance means some reviewer missed a major category.

---
## Lesson: Blindly applying review feedback without verifying findings

**Status:** active | **Created:** 2026-04-11
**Incident count:** 2 | **Latest occurrence:** 2026-07-19

**Prevention:**
1. Before acting on any review finding, verify the cited evidence is still current: read the actual file at the cited line
2. Batch-verify all findings first (`grep`, `sed -n`, `head`), then fix only what's actually broken
3. Reviews from agents that didn't run the latest code are particularly likely to cite stale evidence
4. "8 critics agree" does not mean "8 critics are right" - they may all be reading the same stale state
5. For hook findings, reproduce through the actual agent event path; direct command-string replay is only launcher evidence

**What happened:** After receiving 8 critic reviews of the goat-flow framework, the agent started fixing every cited `file:line` without first checking whether the findings were still valid. Several of the cited issues had already been fixed by sub-agents earlier in the same session. The agent was about to edit files that were already correct, potentially reintroducing bugs or making nonsensical changes.

**Recurrence (2026-07-19):** A quality report treated replaying the `.codex/hooks.json` launcher directly from `/tmp` as proof that real Codex Bash calls wedge outside the repo. Before any patch, a real Codex unified-exec call with `workdir=/tmp` completed, and the current official hook contract confirmed that hook commands run from the session cwd. The proposed launcher change was dropped because the replay proved only standalone launcher behaviour, not the agent runtime path.

**Root cause:** Treating review output as a task list instead of as claims to verify. The agent read "CLAUDE.md:11 still has 6-step loop" and jumped to editing without running `sed -n '11p' CLAUDE.md` first. Reviews are evidence-tagged opinions, not commands. The evidence can be stale by the time you read it - especially when multiple agents are editing the same repo in the same session.

---
## Lesson: 14 self-dogfooding bugs survived 9 rounds of critique and 17 milestones

**Status:** active | **Created:** 2026-04-11
**Incident count:** 2 | **Latest occurrence:** 2026-07-19
**Decision changed:** Multi-phase skill contracts must extract and compare the producing phase and its output template; whole-file phrase presence is insufficient.

**Prevention:** Give a canonical constant a contract test that checks it against every surface restating it, including README, docs, config, templates, and fixtures, and validate that count against ground truth on disk rather than against another copy of the same claim; the manifest and constants both being wrong in the same direction is the failure this guards. After any rename, grep every file type rather than TypeScript and Markdown alone, including YAML, JSON, and shell. Periodically invite external review of this repository itself rather than only installed output. For multi-phase prose contracts, assert that each classified tier reaches the phase and output where users act on it. Evidence anchor: `src/cli/constants.ts` (search: `getSkillNames`).

**What happened:** After M17, 6 external critics independently reviewed the goat-flow framework itself (not installed projects). They found 14 verified bugs that had survived all prior milestones: foundation.ts emitting v1.0, SKILL_TEMPLATES missing goat-sbao, config.yaml referencing a renamed script, README overclaiming hooks, stale test fixtures encoding the wrong skill count, setup fragments still creating coding-standards (removed in M13), classify-state marking "healthy" from version alone, and more. Every bug was a 1-5 line fix.

**Recurrence (2026-07-19):** The goat-qa exhaustive matrix and its Phase 3 headings were contract-tested, but Standard Phase 2 still limited its test-plan mapping and Undertested Risks template to CRITICAL/HIGH, silently dropping MEDIUM High-value gaps at the blocking gate.

**Evidence:** `workflow/skills/goat-qa/SKILL.md` (search: `Exhaustive priority matrix`; `Phase 2 - Gap Analysis`) contained the contradiction; `test/contract/skill-hardening-skills-2.test.ts` (search: `carries MEDIUM high-value gaps into goat-qa Standard Phase 2`) now extracts both the phase and output template.

**Name note:** `goat-sbao` was the predecessor of `goat-critique` per ADR-009.

**Why these were missed:**
1. **Tests validated shape, not truth.** Contract tests checked "does this section heading exist" not "is the skill count correct." An old `evaluate-check.test.ts` assertion literally said "All 6 skills present" - nobody noticed when goat-sbao made it 7.
2. **Self-critique was pipeline-focused.** Every milestone ran `tsc`, `npm test`, `scan`, `preflight`. All passed. None caught that README said "Six" or that foundation.ts hardcoded v1.0. The pipeline tests what it tests; it doesn't read prose.
3. **No external review until R8+.** The first 7 rounds critiqued goat-flow as installed on OTHER projects. Nobody reviewed the goat-flow repo itself until round 8. Self-review is blind to self-consistency.
4. **Rename survivors.** A setup-validator rename left config.yaml on the old path, and `presets.js` was renamed to `preset-prompts.js` while architecture.md kept the old name. No grep-after-rename discipline for config/docs (only code).

---
## Lesson: Blindly applying critique recommendations without verifying claims

**Status:** active | **Created:** 2026-04-14

**Prevention:**
1. Before changing any numeric claim in a canonical doc, run the verification command yourself - never trust a critique's count.
2. The preflight should validate sub-breakdowns, not just totals.
3. Treat external critique findings as hypotheses, not facts. Verify each one independently before applying.

**What happened:** A critique agent claimed `.goat-flow/architecture.md` (search: `20 build checks`) had the wrong build-check breakdown: "says 7+9, actual code shows 12+4." The agent accepted the claim at face value and changed the doc. A subsequent refactor restructured the checks into `SETUP_CHECKS` and `AGENT_CHECKS`, and the breakdown has moved since: it was 14 setup plus 4 agent when this lesson was written and 16 plus 4 when last measured on 2026-09-05, as checks such as `goat-flow-gitignore` and `hook-version` were added. Never quote that pair from memory or from this entry; recompute it with the command below. Preflight's architecture-count check now validates the total and the sub-breakdown, because an incorrect breakdown with a correct total previously passed every automated gate.

**Root cause:** The first critique agent likely miscounted or read a stale build of the code. The claim was plausible (it got the total right), which made it easy to accept without running the verification command. The same session also changed `code-map.md` correctly for a different issue, creating a false sense that all claims were verified.

**Evidence:** `node --input-type=module -e "const a=await import('./dist/cli/audit/check-goat-flow.js'); const b=await import('./dist/cli/audit/check-agent-setup.js'); console.log('setup:', a.SETUP_CHECKS.length, 'agent:', b.AGENT_CHECKS.length)"` outputs the current setup and agent counts; their sum is the build-check total.

---
## Lesson: Structural audit passing hides cold-path content drift (8-critique finding)

**Status:** active | **Created:** 2026-04-15

**Prevention:** Run the content-drift audit as well as the structural one before claiming a release-ready state, and verify footguns, docs, coding standards, glossary, and code map against actual code as a release step; a structural pass says nothing about whether a claim is true. This is now partly mechanical: `src/cli/audit/check-content-quality.ts`, `src/cli/audit/check-factual-claims.ts`, and `src/cli/audit/check-factual-semantic-drift.ts` ship as audit checks, and Step 01 requires a cold-path truth spot-check before stopping (`workflow/setup/01-system-overview.md`, search: `## State check`). Coverage still depends on which claims the agent chooses to verify, so the manual pass is not optional.

**What happened:** Eight independent critiques (3 Claude, 5 Codex) reviewed the goat-flow v1.1.0 setup on its own repo. All 8 confirmed structural integrity: 7 skills matched templates, 57 tests passed, all router paths resolved, deny hook self-test passed, architecture doc numeric claims verified. Despite this, the 8 critiques collectively found 20+ verified content-accuracy failures in cold-path surfaces that no automated check caught. Examples at the time (all since resolved or removed): ~~`docs/audit-and-critique.md` describing checks that no longer exist in code~~; `docs/coding-standards/conventions.md` claimed zero runtime deps when `package.json` had js-yaml and ws; `.goat-flow/glossary.md` pointed Task Tracking at the wrong file; `.goat-flow/code-map.md` listed a script under the wrong directory; ~~`scripts/stop-lint.sh` existing despite the removed historical `ADR-015-remove-stop-lint-from-core.md`, whose decision now lives in current `ADR-037-separate-post-turn-safety-from-validation.md`~~; `.goat-flow/plans/.gitignore` ignored all milestone files while goat-plan claimed durable shared state. Setup scored 58-90/100 across the 8 critiques - the range itself shows the split between structural soundness and content accuracy.

**Root cause:** The audit validates structure (files exist, versions match, paths resolve) but not content truth. Preflight validates some doc/code counts but not descriptions, claims, or cross-file consistency. Cold-path docs are updated manually and drift as code changes. Step 01 (`workflow/setup/01-system-overview.md` (search: `## State check`)) now requires a cold-path truth spot-check before stopping (prevention #2 below, implemented), but coverage depends on which claims the agent chooses to verify.

**Evidence:** All findings verified with direct file reads and command output during the critique session. The critique convergence table documents which critiques found which findings.

---
## Lesson: Cross-critique review catches cold-path drift that single reviews and preflight miss

**Status:** active | **Created:** 2026-04-16

**Prevention:** After any rename, count change, or structural reorganization, grep the old names and numbers across every doc rather than the files in the diff. Run multi-agent critique on release branches: comparing findings across three or more independent reviewers, verifying each, and disproving false positives is the most effective cold-path drift detector available. Preflight now derives architecture check counts from the code exports and compares them with the doc claims, which closes the count axis; the prose, description, and cross-file axes remain manual.

**What happened:** A single diff review of 89 files on feat/1.1.0 found 2 cross-reference breakages (setup prompt, code-map skill tree). Then 4 independent coding agent critiques were run. Together they surfaced 15 additional cold-path issues: wrong check counts in CONTRIBUTING.md (8 vs 16), stale .js extensions in architecture.md and code-map, CLI help text with wrong harness count (15 vs 16), 6 stale footgun entries, and footgun file ordering that violated the scan contract. One critique (Critique 4) also produced a false positive (PreToolUse blind spot) that was disproved by finding the check in a different file (check-constraints.ts).

**Root cause:** Cold-path docs (CONTRIBUTING.md, code-map, architecture, footguns, CLI help text) are not validated by preflight for content accuracy -- only for structural presence and path resolution. A single reviewer reads the diff but not the surrounding docs. Multiple independent reviewers each read different files and catch different drift. The cold-path drift footgun already documented this pattern, but the footgun's own evidence list had gone stale, demonstrating the recursive nature of the problem.

**Fix:** Applied all 15 fixes. Updated cold-path drift footgun with Round 2 evidence. Preflight now passes (33 checks, 0 errors).

---
## Lesson: Verification rationalization anti-patterns

**Status:** active | **Created:** 2026-04-18

**Prevention:** Before any completion, fix, or passing claim, check whether the sentence you are about to write is a rationalization rather than the claim itself, then either satisfy the Proof Gate or downgrade the claim to unverified and say what evidence is missing. The canonical list of rationalizations lives in one place and is not duplicated here: `.goat-flow/skill-docs/skill-preamble.md` (search: `Rationalisations to reject`). The instruction files route to it beside the red-flags, in `CLAUDE.md` (search: `The red-flags above name WHAT not to claim`).

**What happened:** The four red-flags in `AGENTS.md` (search: `Hallucination red-flags`) forbid claims without evidence: checks passed, completion, fix verification, and hedged claims. Agents still shipped unverified claims under pressure by producing rationalizations that feel distinct from the forbidden claim while being logically equivalent to it, such as high stated confidence, a sub-agent's reported success, or the change looking correct.

**Root cause:** The red-flags catalogue what not to claim without naming the specific excuses that convert "I did not run the proof" into "it is fine", so under deadline, fatigue, a long turn, or a trusted sub-agent report the agent reaches for an excuse the red-flags never named and the claim lands anyway.

---
