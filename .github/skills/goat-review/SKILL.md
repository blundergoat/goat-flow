---
name: goat-review
description: "Use when reviewing a diff, PR, or set of code changes, or auditing a codebase area for quality issues. Triggers: 'review this', 'code review', 'audit X', 'look at these changes'."
goat-flow-skill-version: "1.14.0"
---
# /goat-review

## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md`; on full-depth also read `.goat-flow/skill-docs/skill-conventions.md`.

## When to Use

Use for diff/PR review or codebase-area quality audits.

## Boundary Commands

- **NEVER:** Auto-edit, perform security review, or run an unapproved refuter.
- **ALWAYS:** Reconstruct intent, run both passes, disprove suspicions, and emit the local verdict with Review Integrity.
- **DEFER TO:** Security, debug, QA, planning, or dispatcher routes for their named work.

## Step 0 - Scope, Size, Spec

> "Reviewing [X] -- diff review (quick), PR review against a base branch (quick by default), or area audit + DoD cross-checks (full)?"

- If user already says "quick", "PR", or "full", confirm and continue.
- If the dispatcher chose depth, skip the question.
- If vague, ask one follow-up covering files, concerns, and mode.
- Auto-detect: explicit input; otherwise a dirty worktree (combine staged and unstaged changes into one declared change set); otherwise PR-style branch ahead of base, then `git diff`.

**PR mode:** prefer URL/number; otherwise prompt or use `local`. Get metadata: `gh pr view <ref> --json baseRefName,headRefName,headRefOid,url,number,title,body`; diff: `gh pr diff <ref>`. Record URL/base SHA. Automated-review conclusions stay unread until both local passes finish; Step 0 fetches no review/comment bodies.

**Base fallback:** when no PR link or `gh` unavailable, resolve base from explicit user base, `skills.goat-review.local_pr_base`, remote HEAD, user prompt, then `main` with `base-detection-failed`. Prefer existing refs; only `git fetch origin <base> --quiet` after explicit network approval. Diff `origin/<base>...HEAD` if present, else local `<base>...HEAD` with `base-fetch-skipped` or `base-fetch-failed`. Record base/source/SHA in Review Integrity.

**Scope sizing:** Diff: measure files/changed lines; above **20 files OR 3000 lines**, propose chunking and flag `large-diff-unchunked` if declined. Area: measure files/clusters; above 20 files, propose splitting and flag `large-area-unchunked` if declined.

**Spec source (opt-in):** if `.goat-flow/plans/.active` points to an in-progress/testing milestone, offer: "Include Spec Drift check against M[NN] exit criteria?" Default skip for quick, offer for full. Record checked/skipped/unavailable in Review Integrity; optional skip is not degradation.

**Temporary artifacts:** use `.goat-flow/logs/review/goat-review-<artifact>.<random>.txt` only.

**Footgun check:** use preamble learning-loop retrieval on `.goat-flow/learning-loop/footguns/` for the target area. Present matches or retrieval miss; do not broad-load.

### Review Scope Snapshot (mandatory)

Before Pass 1, record the review surface:

- **Source:** worktree | staged | unstaged | PR | branch diff | area | explicit path list
- **Base/Head:** `<branch-or-sha>` / `<branch-or-sha>` (n/a for area audit)
- **Uncommitted included:** yes | no | n/a
- **Size:** diff `<files>`/`<changed-lines>`; area `<files>`/`<clusters>`
- **Chunking:** no | proposed | accepted | skipped-by-user
- **Scope degradation:** `<flags or "none">`

For `worktree`, inspect both `git diff --cached` and `git diff`; record both path sets.

Unknown mode-applicable values add degradation. Required `n/a` is resolved, not degraded.

### Step 0.5 - Intent Reconstruction (mandatory)

Before Pass 1, reconstruct intent. Diff/PR: PR/issues, HEAD, then active milestone; none means `intent-unstated`. Area: the user's audit brief plus responsibilities inferred from source/docs; change history is not required.

Output three-bullet reconstruction:
- **Stated intent:** change claim or area brief
- **Implied intent:** observed behavior/responsibility
- **Gap:** divergence or "none"

Anchor both passes to diff and stated intent, or the declared area and audit intent.

**CHECKPOINT:** Scope locked, intent reconstructed. Proceeding to Pass 1.

## Diff Review (Quick) - Two-Pass Discipline

Run two sequential local passes; Pass 2 is authoritative and findings surface afterward.

### Pass 1 - Blind Suspicion (diff only)

Read the diff **without opening full files**. The point is to see what the diff reveals before surrounding code anchors you.

Scan for severity cues (auth, secrets, SQL/shell/API calls, mutation, state transitions) and edge cases: boundary conditions, nullish/default branches, concurrency, error handling, contract changes, and observability/DDT testability. For opaque state transitions, background tasks, retries, or async flows, ask: "can a human tell if this succeeded without instrumenting it?" If no, consider `[SHOULD:needs-signal]` or `[MUST:needs-signal]` per risk.

Write raw suspicions with `file + semantic anchor` drawn from the diff. Do NOT verify, confirm, or dismiss in this pass. Over-capture is fine; Pass 2 filters.

**CHECKPOINT:** Pass 1 complete - [N] suspicions captured (no resolution yet). Proceeding to Pass 2 grounded verification.

### Pass 2 - Grounded Verification (full files)

Now read full files. For each Pass-1 suspicion:

- **Try to DISPROVE it** by re-reading the anchor and looking for guards, upstream checks, framework mitigation, or contracts that remove the risk.
- Verdicts: **CONFIRMED** needs positive reachability (caller/input/trigger); failed disproof → **UNRESOLVED**. **ADJUSTED** means real but narrower, with severity restated; **REFUTED** needs a removing guard/contract. Hedges ("confirmed with caveat", "matches prior behaviour", "sloppy but not exploitable") are forbidden.
- **Blast Radius Rule:** for contract changes, search symbol-aware (LSP/MCP) → AST (`ast-grep`) → text (`rg`/`grep`) without ceremony. Text-only adds `callsite-completeness-grep-only`. Audit dynamic dispatch, reflection, DI, string-keyed routes/config, generated code, and external consumers. Verify one consumer; skipped stays UNRESOLVED with `coverage-degraded`.
- **Refutation Ledger:** write REFUTED suspicions to `.goat-flow/logs/review/goat-review-refutations.<random>.txt` with R-ID, suspicion, evidence, and rationale. Keep them out of final output.
- Add findings that only became visible with file context (integration breakage, call-site contract mismatch, regression in a sibling file).
- Re-verify every `file + semantic anchor` reference exists before writing the final output.

### Automated-Review Overlap (PR mode, after local findings)

After Pass 2 records local findings, fetch inline comments with `gh api --paginate 'repos/<owner>/<repo>/pulls/<number>/comments?per_page=100'`, then apply `references/automated-review.md`; never suppress a finding as overlap.

Full Excuse/Reality table: `references/examples.md`. Key entries:

| Excuse | Reality |
|--------|---------|
| "Skip Pass 2 / CI is green / zero findings anyway" | Trust, CI, and empty results don't replace opening files. See full table. |
| "The symbol is unique enough that grep is overkill" | The bug is in the consumer, not the emitter. Run the grep. |
| "Refuted suspicions are noise - logging them wastes tokens" | The ledger is the integrity surface. Without it, REFUTED is indistinguishable from "didn't bother to check." |

### Severity + Action Tagging

Assign stable `R-001…` IDs in report order; preserve them through Top 5 Risks and refuter synthesis. Severity: `MUST` blocks, `SHOULD` fixes before merge unless disputed, `MAY` is optional. Actions: `patch`, `needs-decision`, `intent-mismatch`, or `needs-signal`; `pre-existing` is area-audit-only.

Use prefix `R-NNN [SEVERITY:ACTION]`; MUST/SHOULD lines add `Harm:`.

**Proof Capsule:** every finding includes `RUNTIME` | `CONTRACT-GREP` | `STATIC` | `NOT-REPRODUCED`. Evidence tags measure certainty, proof classes method, verdicts disposition; `UNVERIFIED` ≠ `NOT-REPRODUCED`. MUST/correctness-SHOULD prefer RUNTIME or CONTRACT-GREP. NOT-REPRODUCED adds `not-reproduced-findings`.

### Systemic Patterns

When 3+ surfaced findings share the same root cause, report one parent entry under `## Systemic Patterns` using the highest applicable severity and action tag. Include the affected file anchors, the repeated failure mode, and the concrete harm. Keep individual findings only when they have distinct harm or distinct fixes; otherwise the systemic pattern is the finding.

### Pre-existing Separation

- **Pre-existing Nearby** (in-scope surface): a pre-existing bug in the same function or tightly-coupled call-site the diff touches. Surface as a one-line pointer under `## Pre-existing Nearby`. Does not block.
- **Pre-existing Issues** (out-of-scope): pre-existing bugs outside the diff's surface. List under `## Pre-existing Issues` without severity tags. Does not block.

### Footgun Cross-Check

Check each finding with targeted INDEX-first retrieval against `.goat-flow/learning-loop/footguns/INDEX.md`. When a direct match exists, include it. Omit the footgun tag when no direct match is found after the one allowed reword.

**BLOCKING GATE:** Present findings plus Top 5 Risks and Review Integrity, then pause. If Pass 3 is pending, Ship Verdict must be `PENDING REFUTER/HUMAN`; after response/refuter, present final verdict.

**Review DoD gate:** for reporting-only review, verify findings, cross-references, and scope. No implementation tests unless a finding requires it. If user says "implement", switch to the instruction file's implementation DoD.

**Proof Gate:** per `skill-preamble.md`.

## Area Audit (Full)

Audit the declared area, not a diff; pre-existing issues are in scope.

### Area Pass 1 - Inventory and Risk Hypotheses

For each cluster, inventory responsibilities, interfaces, trust/state boundaries, and critical paths without using recent diff as scope. Record raw suspicions with `file + semantic anchor`; do not resolve them.

### Area Pass 2 - Implementation and Consumer Verification

Open the implementation, relevant tests, and callers/consumers. Disprove suspicions using guards and call-site evidence; apply the Blast Radius Rule. Mark each suspicion `CONFIRMED`, `ADJUSTED`, `REFUTED`, or `UNRESOLVED` and retain the Refutation Ledger. Area findings may use `[SEVERITY:pre-existing]`.

Without a release/merge question, emit `N/A - AREA AUDIT ONLY`.

**BLOCKING GATE:** Present findings and pause. If calibration is uncertain, consider `/goat-critique`.

### Direction / Opportunity Audit

Only on explicit request, add an advisory opportunity output backed by repo-grounded evidence; it does not affect Ship Verdict. Categories, leverage ranking, and rejection routing: `references/examples.md`. Defects stay in normal findings.

## Spec Drift (opt-in)

Only emitted when Step 0 prompt was accepted and a live milestone was found. Reads the milestone's **Exit Criteria** and **Assumptions**, splits by direction:

- **Exit-criteria drift** `[advisory]` under `## Spec Drift` -- criterion marked done but diff doesn't support it. No severity tag.
- **Assumption invalidation** `[MUST:needs-decision]` under `## Findings` -- diff makes an assumption false.
- **Open criterion satisfied** `[ready-to-tick]` under `## Spec Drift` -- advisory, human ticks milestone.

If none detected, emit "No drift detected against M[NN]" so the reader knows the check ran.

## Pass 3 - Cross-Model Refuter (explicit approval only)

Offer Pass 3 when the user opts in, Review Integrity is `coverage-degraded`/`high-inference`, or a MUST-needs-decision/INTENT-MISMATCH exists.

**Approval gate:** A trigger is not approval. Before explicit current-session approval, disclose the runtime and model, authentication state, findings-only payload, one refuter inference call, cost or rate-limit impact, why a second model rather than more reading, and local-only fallback. “Keep going” and urgency do not count. If declined or unanswered, complete the local review, record `Refuter pass: skipped`, and do not add `coverage-degraded` or `cross-model-refuter-failed` solely because the user declined.

**Method:** After approval, follow `references/refuter-spec.md` with an authenticated non-host runtime; pass the R-ID FINDINGS LIST, not the diff.

**Synthesis:** Follow the reference evidence bar. Uncited refutation demotes at most one rung, never removes. A MUST clears Ship Verdict only after host citation re-read; failure retains it unresolved and flags `refuter-citation-unverified`. Unsourced external behaviour stays REFUTER-UNRESOLVED. REFUTER-CONFIRMED gets `[CONFIRMED-CROSS-MODEL]`; verified REFUTER-REFUTED moves to `## Refuted by Refuter`; unresolved keeps severity and flags `cross-model-unresolved`. Leads require Pass 2.

**Constraints:** Before approval, only reference-listed availability/auth checks may run; versions do not prove auth. No authenticated refuter means skip and `cross-model-refuter-failed`.

## Review Integrity (confidence signal)

- **Files opened in Pass 2:** count / total; diff mode also lists paths.
- **Evidence tags:** N OBSERVED / M INFERRED.
- **Verdicts:** `<c>/<a>/<r>/<u>` (confirmed/adjusted/refuted/unresolved).
- **Size:** diff lines or area files/clusters, plus chunking. PR mode: base, source, short SHA.
- **Scope snapshot:** source, base, head, uncommitted, chunking.
- **Refutations logged:** `<N>`
- **Spec drift:** `checked M[NN]` | `skipped` | `unavailable`. Optional skip is not degradation.
- **PR-mode extension:** record `Automated-reviewer overlap: <K> overlap with <reviewer-list>, <M> net-new`; use `no-automated-review-present` when absent and `n/a` outside PR mode.
- **Pass-3 extension:** when Pass 3 runs, is triggered, or is skipped after a trigger, add `Refuter pass: yes | no | skipped; confirmed=<N>, refuted=<M>, unresolved=<K>, leads-verified=<N>, model=<id|n/a>`.
- **Degradation flags:** `chunked-partial`, `large-diff-unchunked`, `large-area-unchunked`, `high-inference-ratio`, `files-not-opened`, `unfamiliar-area`, `missing-types`, `footguns-unread`, `not-reproduced-findings`, `coverage-degraded`, `callsite-completeness-grep-only`, `configured-base-unresolved=<base>`, `base-detection-failed`, `base-fetch-skipped`, `base-fetch-failed`, `intent-unstated`, `automated-review-uningested`, `cross-model-refuter-failed`, `cross-model-unresolved`, `refuter-citation-unverified`.
- **Conclusion:** `confident` | `coverage-degraded` | `high-inference` | `partial`.

Always emit it; minimum: "confident - no degradation flags".

## Constraints

**Diff review (quick):**
- MUST run Pass 1 (diff only) before opening any full files in Pass 2
- MUST NOT surface Pass-1 suspicions that Pass 2 refuted
- MUST NOT flag pre-existing issues as blocking the change

**Area audit (full):**
- MUST scan the declared area regardless of recent changes
- Pre-existing issues ARE in scope

**Both modes:**
- MUST apply the Blast Radius Rule, severity/action tags, Footgun Cross-Check, systemic grouping, and Review Integrity in both modes
- MUST order findings by severity, not by file or discovery order
- MUST propose chunking above 20 files in either mode, or 3000 changed lines in diff mode
- Emit Spec Drift only when opted in. If skipped, record `Spec drift: skipped` without a degradation flag
- Route Spec Drift by direction
- MUST NOT edit files unless user says "implement"; MUST NOT frame Pass 1/Pass 2 as doer/verifier
- **Consequence Gate:** every MUST and SHOULD finding MUST state concrete harm (what breaks, leaks, regresses, silently fails, corrupts data, or blocks a workflow). If the reviewer cannot name harm, downgrade to MAY.
- **Ship Verdict rules (diff/PR or explicit release/merge question):** unresolved MUST or INTENT-MISMATCH -> NO; SHOULD-only -> YES WITH CONDITIONS; MAY-only -> YES. A REFUTER-REFUTED MUST clears only after host citation verification. Downgrade ladder: YES -> YES WITH CONDITIONS -> PARTIAL -> NO. PENDING REFUTER/HUMAN is a pending state, not a ladder rung. Review Integrity `coverage-degraded`, `high-inference`, or `partial` moves one rung.
- **Zero-findings HALT:** If Pass 2 produces zero findings, state what was checked and why no issues surfaced. Zero findings must be defended.
- Universal constraints from skill-preamble.md apply.

## Output Format

```markdown
## TL;DR  <!-- what was reviewed, found, matters most -->

## Review Integrity
- Scope snapshot: source=<source>, base=<base>, head=<head>, uncommitted=<yes|no|n/a>, chunking=<state>
- Files opened in Pass 2: <k>/<n>  (diff paths: <list or "n/a">)
- Evidence: <N> OBSERVED / <M> INFERRED
- Verdicts: <c>/<a>/<r>/<u>
- Refutations logged: <N>
- Size: <files> files, <changed lines | clusters>  (chunked: <group or "no">)
- Automated-reviewer overlap: <K> overlap with <reviewer-list>, <M> net-new | no-automated-review-present | n/a
- Refuter pass: yes | no | skipped; confirmed=<N>, refuted=<M>, unresolved=<K>, leads-verified=<N>, model=<id|n/a>
- Spec drift: <checked M[NN] | skipped | unavailable>
- Degradation flags: <list or "none"; grep-only coverage => callsite-completeness-grep-only>
- Conclusion: <confident | coverage-degraded | high-inference | partial>

## Findings

### MUST / SHOULD / MAY
- R-001 [SEVERITY:ACTION] **[title]** `file + semantic anchor` - [desc] | Harm: [concrete consequence for MUST/SHOULD] | Footgun: [entry or none] | Evidence: OBSERVED/INFERRED | Proof: RUNTIME/CONTRACT-GREP/STATIC/NOT-REPRODUCED

## Systemic Patterns  <!-- only when 3+ findings share one root cause -->
- R-001 [SEVERITY:ACTION] **[pattern title]** - affected anchors: `<file + semantic anchor>`, `<file + semantic anchor>`; repeated failure: <one sentence>; harm: <one sentence>

## Spec Drift   <!-- only when opt-in triggered -->
<!-- advisory-only entries (exit-criteria drift, ready-to-tick); assumption invalidation goes under ## Findings as [MUST:needs-decision] -->
- [advisory] **[criterion title]** - claimed done in M[NN] but not supported by diff
- [ready-to-tick] **[criterion title]** - now satisfied by diff, milestone still shows `- [ ]`

## Pre-existing Nearby  <!-- in-function only; one-liners; no blocking tags -->

## Pre-existing Issues  <!-- out-of-scope pre-existing bugs -->

## Breaking Changes

## Top 5 Risks (cross-tier)
<!-- Five findings most likely to cause harm if unresolved, ranked regardless of tier. If <5 total, list all. If zero: "No surfaced risks." -->
1. R-001 [SEVERITY:ACTION] **[title]** `file + semantic anchor` - one-sentence why

## Ship Verdict
Decision: **YES** | **YES WITH CONDITIONS** | **NO** | **PARTIAL** | **PENDING REFUTER/HUMAN** | **N/A - AREA AUDIT ONLY**
Reasoning: <2-3 sentences anchored to Top 5 Risks and Review Integrity>
Conditions to ship: <numbered list, only when YES WITH CONDITIONS>
Confidence: HIGH | MEDIUM | LOW

## What's Good

## What I Didn't Examine
```
