---
category: verification-review
last_reviewed: 2026-05-03
---

## Lesson: Multi-agent critique finds findings single reviewers miss - but synthesis is the expensive part

**Status:** active | **Created:** 2026-04-13

**What happened:** A multi-agent critique run on goat-flow v1.1.0 surfaced more defects than any single reviewer caught alone. MAJOR audit-honesty findings (Codex compaction hook false positive, ask_first glob-unaware false positive) were each raised by a single reviewer. First-pass reviews established the bulk of findings; later reviews added diminishing but non-zero value, including MAJOR findings no earlier reviewer had raised.

**What this means for critique practice:**
1. Multi-agent critique is worth doing for large surfaces. A single thorough review will miss things, and the things it misses can be important.
2. Model diversity matters more than reviewer count. Different model families have different systematic blind spots - one family may under-weight documentation surfaces, another may miss integration glue. Mixing families covers more ground than stacking instances of one.
3. The synthesis + verification layer is where the value is captured. A non-trivial share of raw multi-agent claims will be wrong or need active verification. Unverified multi-agent output is noisier, not more reliable.
4. Sweet spot: several reviews from different model families for a framework/architecture audit; fewer for a feature or module.
5. Score convergence across reviewers is the signal that coverage is adequate - not review count. High score variance means some reviewer missed a major category.

**Prevention:** When commissioning multi-agent critique, plan for synthesis work. Budget time to: (a) verify disputed claims against source code, (b) track first-discovery of each finding, (c) dispute false claims with evidence. The critique is an input that requires judgment, not a spec that gets executed.

---
## Lesson: Blindly applying review feedback without verifying findings

**Status:** active | **Created:** 2026-04-11
**What happened:** After receiving 8 critic reviews of the goat-flow framework, the agent started fixing every cited `file:line` without first checking whether the findings were still valid. Several of the cited issues had already been fixed by sub-agents earlier in the same session. The agent was about to edit files that were already correct, potentially reintroducing bugs or making nonsensical changes.

**Root cause:** Treating review output as a task list instead of as claims to verify. The agent read "CLAUDE.md:11 still has 6-step loop" and jumped to editing without running `sed -n '11p' CLAUDE.md` first. Reviews are evidence-tagged opinions, not commands. The evidence can be stale by the time you read it - especially when multiple agents are editing the same repo in the same session.

**Prevention:**
1. Before acting on any review finding, verify the cited evidence is still current: read the actual file at the cited line
2. Batch-verify all findings first (`grep`, `sed -n`, `head`), then fix only what's actually broken
3. Reviews from agents that didn't run the latest code are particularly likely to cite stale evidence
4. "8 critics agree" does not mean "8 critics are right" - they may all be reading the same stale state

---
## Lesson: 14 self-dogfooding bugs survived 9 rounds of critique and 17 milestones

**Status:** active | **Created:** 2026-04-11
**What happened:** After M17, 6 external critics independently reviewed the goat-flow framework itself (not installed projects). They found 14 verified bugs that had survived all prior milestones: foundation.ts emitting v1.0, SKILL_TEMPLATES missing goat-sbao, config.yaml referencing a renamed script, README overclaiming hooks, stale test fixtures encoding the wrong skill count, setup fragments still creating coding-standards (removed in M13), classify-state marking "healthy" from version alone, and more. Every bug was a 1-5 line fix.

**Why these were missed:**
1. **Tests validated shape, not truth.** Contract tests checked "does this section heading exist" not "is the skill count correct." An old `evaluate-check.test.ts` assertion literally said "All 6 skills present" - nobody noticed when goat-sbao made it 7.
2. **Self-critique was pipeline-focused.** Every milestone ran `tsc`, `npm test`, `scan`, `preflight`. All passed. None caught that README said "Six" or that foundation.ts hardcoded v1.0. The pipeline tests what it tests; it doesn't read prose.
3. **No external review until R8+.** The first 7 rounds critiqued goat-flow as installed on OTHER projects. Nobody reviewed the goat-flow repo itself until round 8. Self-review is blind to self-consistency.
4. **Rename survivors.** A setup-validator rename left config.yaml on the old path, and `presets.js` was renamed to `preset-prompts.js` while architecture.md kept the old name. No grep-after-rename discipline for config/docs (only code).

**Prevention:**
1. Add contract tests that link canonical constants to docs: `SKILL_NAMES.length` must match README, docs, config, SKILL_TEMPLATES, and test fixtures
2. After any rename, grep ALL file types (not just `.ts` and `.md` - also `.yaml`, `.json`, `.sh`)
3. Periodically invite external review of the goat-flow repo itself, not just installed output
4. `preflight-checks.sh` should verify SKILL_NAMES count consistency across surfaces

---
## Lesson: Blindly applying critique recommendations without verifying claims

**Status:** active | **Created:** 2026-04-14

**What happened:** A critique agent claimed `.goat-flow/architecture.md` (search: `18 build checks`) had the wrong build-check breakdown: "says 7+9, actual code shows 12+4." The claim was accepted at face value and the doc was changed. A subsequent refactor restructured the checks into `SETUP_CHECKS` and `AGENT_CHECKS`; the current breakdown is **14 setup + 4 agent** (18 total). The preflight's "Architecture doc counts match code" check now validates both total and sub-breakdown because incorrect breakdowns previously passed automated gates.

**Root cause:** The first critique agent likely miscounted or read a stale build of the code. The claim was plausible (it got the total right), which made it easy to accept without running the verification command. The same session also changed `code-map.md` correctly for a different issue, creating a false sense that all claims were verified.

**Evidence:** `node --input-type=module -e "const a=await import('./dist/cli/audit/check-goat-flow.js'); const b=await import('./dist/cli/audit/check-agent-setup.js'); console.log('setup:', a.SETUP_CHECKS.length, 'agent:', b.AGENT_CHECKS.length)"` - outputs 14 setup + 4 agent (18 total).

**Prevention:**
1. Before changing any numeric claim in a canonical doc, run the verification command yourself - never trust a critique's count.
2. The preflight should validate sub-breakdowns, not just totals.
3. Treat external critique findings as hypotheses, not facts. Verify each one independently before applying.

---
## Lesson: Structural audit passing hides cold-path content drift (8-critique finding)

**Status:** active | **Created:** 2026-04-15

**What happened:** Eight independent critiques (3 Claude, 5 Codex) reviewed the goat-flow v1.1.0 setup on its own repo. All 8 confirmed structural integrity: 7 skills matched templates, 57 tests passed, all router paths resolved, deny hook self-test passed, architecture doc numeric claims verified. Despite this, the 8 critiques collectively found 20+ verified content-accuracy failures in cold-path surfaces that no automated check caught. Examples at the time (all since resolved or removed): ~~`docs/audit-and-critique.md` describing checks that no longer exist in code~~; `docs/coding-standards/conventions.md` had claimed zero runtime deps when `package.json` had js-yaml and ws; `.goat-flow/glossary.md` pointed Task Tracking at the wrong file; `.goat-flow/code-map.md` listed a script under the wrong directory; ~~`scripts/stop-lint.sh` existing despite ADR-015 saying it was removed~~; `.goat-flow/tasks/.gitignore` ignored all milestone files while goat-plan claimed durable shared state. Setup scored 58-90/100 across the 8 critiques - the range itself shows the split between structural soundness and content accuracy.

**Root cause:** The audit validates structure (files exist, versions match, paths resolve) but not content truth. Preflight validates some doc/code counts but not descriptions, claims, or cross-file consistency. Cold-path docs are updated manually and drift as code changes. Step 01 (`workflow/setup/01-system-overview.md` (search: `## State check`)) now requires a cold-path truth spot-check before stopping (prevention #2 below, implemented), but coverage depends on which claims the agent chooses to verify.

**Evidence:** All findings verified with direct file reads and command output during the critique session. The critique convergence table documents which critiques found which findings.

**Prevention:**
1. Add content-drift checks to preflight or audit: doc check descriptions match code, convention claims match package.json, glossary canonical files exist
2. ~~Change Step 01 early-stop to require content-drift checks, not just structural audit pass~~ (done: Step 01 now requires cold-path truth spot-check before stopping)
3. Add a cold-path truth audit step to the release process: verify footguns, docs, coding-standards, glossary, and code-map against actual code before each release
4. Consider auto-generating audit docs from check code exports to prevent drift permanently

---
## Lesson: Cross-critique review catches cold-path drift that single reviews and preflight miss

**Status:** active | **Created:** 2026-04-16

**What happened:** A single diff review of 89 files on feat/1.1.0 found 2 cross-reference breakages (setup prompt, code-map skill tree). Then 4 independent coding agent critiques were run. Together they surfaced 15 additional cold-path issues: wrong check counts in CONTRIBUTING.md (8 vs 16), stale .js extensions in architecture.md and code-map, CLI help text with wrong harness count (15 vs 16), 6 stale footgun entries, and footgun file ordering that violated the scan contract. One critique (Critique 4) also produced a false positive (PreToolUse blind spot) that was disproved by finding the check in a different file (check-constraints.ts).

**Root cause:** Cold-path docs (CONTRIBUTING.md, code-map, architecture, footguns, CLI help text) are not validated by preflight for content accuracy -- only for structural presence and path resolution. A single reviewer reads the diff but not the surrounding docs. Multiple independent reviewers each read different files and catch different drift. The cold-path drift footgun already documented this pattern but the footgun's own evidence list had gone stale, demonstrating the recursive nature of the problem.

**Fix:** Applied all 15 fixes. Updated cold-path drift footgun with Round 2 evidence. Preflight now passes (33 checks, 0 errors).

**Prevention:**
1. After any rename, count change, or structural reorganization, grep for the old names/numbers across ALL docs, not just the files in the diff.
2. Run multi-agent critique on release branches -- the cross-review pattern (compare findings across 3+ independent reviewers, verify each, disprove false positives) is the most effective cold-path drift detector available.
3. Consider automating: extract check counts from code exports and validate against doc claims in preflight.

---
## Lesson: Verification rationalization anti-patterns

**Status:** active | **Created:** 2026-04-18

**What happens:** The 5 hallucination red-flags in AGENTS.md:51-58 forbid claims without evidence (tests pass, completion, fix verification, hedged claims, check passed). Agents still ship unverified claims under pressure by producing rationalizations that feel distinct from the forbidden claim but are logically equivalent to it. "I'm 95% confident", "the sub-agent said it passed", "the change looks correct" - each slips past the red-flags because the red-flags name the violation, not the specific excuse pattern.

**Root cause:** The red-flags catalog what NOT to claim. They do not enumerate the specific rationalizations that convert "I didn't run the proof" into "it's fine." Under pressure (deadline, fatigue, long turn, trusted sub-agent report, partial run that "mostly worked"), the agent reaches for a rationalization the red-flags do not explicitly name, and the claim lands anyway.

**Rationalizations to reject:**
- "Confidence ≠ evidence" - high subjective confidence does not substitute for running the verification command in this message.
- "Just this once" - partial compliance compounds into no compliance. There is no exemption for a single turn.
- "The downstream agent said success, so it passes" - delegated claims are subject to the same red-flags; do not launder an unverified sub-agent output by restating it yourself.
- "Partial check is enough" - a subset of tests is not the test suite. If the red-flag applies to the whole check, a partial run does not discharge it.
- "Code changed, so probably fixed" - red-flag #3 requires re-running the reproduction that originally demonstrated the bug. "Probably fixed" is a hedged claim (red-flag #4).
- "Looks correct to me" - structural inspection is not verification. If the red-flag demands output, reading code is not output.

**Fix:** The Proof Gate in `skill-preamble.md` names the positive procedure (identify → run fresh → read → verify → cite). This lesson names the negative counterpart: the rationalization patterns that specifically defeat the red-flags. Before any completion, fix, or "passing" claim, check whether the next sentence you are about to write matches one of the patterns above. If it does, stop and satisfy the Proof Gate instead - or downgrade the claim to UNVERIFIED and state what evidence is still missing.

---
