---
category: multi-agent
last_reviewed: 2026-09-05
---

## Pattern: Multi-agent critique - how to run it effectively

**Context:** Commissioning multiple independent agent reviews of a framework, architecture, or release candidate: large surface area (docs + code + scripts + CI + installed outputs), high cost of a missed finding (audit honesty bugs, user-facing false paths), or pre-release validation.

**Approach:**
1. Give each reviewer the same prompt. Don't share prior reviews - contamination defeats independence.
2. Use different models, not just different instances. Each family has its own systematic blind spots; among the supported runners (`src/cli/audit/drift-values.ts`, search: `KNOWN_AGENT_IDS`) that means one each of Codex, Antigravity, and Copilot beside Claude rather than three Claudes.
3. Synthesize and verify after each review. Track first-discovery per finding and dispute false claims with source evidence before accepting them; expect 15-20% of claims per review to need verification.
4. Stop when score variance drops. Consecutive reviews clustering in a tight band means coverage is probably adequate; wide variance means major categories are still being missed.

**Sweet spot by task type:**
- Routine PR or module review: 1, maybe 2 if high-stakes
- Feature or component audit: 3, from different models
- Framework or architecture audit: 4-5, with explicit surface-area scoping in the prompt
- Pre-release with audit honesty concerns: up to 7; accept the synthesis overhead

**Key insight:** MAJOR findings can appear late. Late-session reviews on this repo surfaced audit-honesty findings (Codex compaction hook false positive, ask_first glob comparison bug) that no earlier reviewer raised. Both would have shipped.

**What NOT to do:**
- Don't rank findings by how many reviewers found them. The most important findings are often found by exactly one reviewer.
- Don't use score to select which reviewer to trust. Score tracks coverage, not quality.
- Don't skip synthesis. Raw multi-agent output is noisier than single-agent output; synthesis is where reliability comes from.

## Pattern: Convert self-declared critique gates into executable checks

**Context:** A multi-agent critique skill asks sub-agents to declare dimensions, isolation, lens coverage, or severity calibration, and the orchestrator routes on those declarations.

**Approach:** Verify every self-declaration that changes routing, severity, or acceptance on the orchestrator side, highest blast radius first: re-read a sample finding to confirm its dimension tag, grep fresh-eyes output for forbidden namespace references, and only then trust the coverage math. Lower-stakes declarations such as quota and lens completeness can stay prose until they repeatedly fail. Never let a prompt rule feed automatic HIGH severity or phase progression on the sub-agent's own assertion; a prompt can request discipline but cannot prove it happened.

**Evidence:** `workflow/skills/goat-critique/SKILL.md` (search: `leak scan`) and (search: `coverage gate`) are the executable checks that replaced self-report-only gates.

## Pattern: Delegated-work review before user handoff

**Context:** A coordinating review must verify delegated or reviewer-suggested edits against the live tree before handoff, because earlier suggestions may already have changed the files a later suggestion assumes.

**Approach:** Review independently: re-run every done criterion yourself, check scope with `git diff --stat`, read the full diff against stated intent, and audit new tests for meaningful assertions. Judge documented deviations on merit; treat undocumented deviations as review failures, because the user cannot evaluate a change they were never told about. After two failed revision loops on one approach, stop patching and re-plan. This is a verification pattern, not executor dispatch: it authorises no worktrees, implementation, commits, or pushes.

**Evidence:** `.goat-flow/learning-loop/lessons/review-feedback.md` (search: `Blindly applying review feedback without verifying findings`) records eight review rounds, including false or stale findings that source inspection rejected.
