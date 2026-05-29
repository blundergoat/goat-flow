---
name: goat-review
description: "Use when reviewing a diff, PR, or set of code changes, or auditing a codebase area for quality issues. Triggers: 'review this', 'code review', 'audit X', 'look at these changes'."
goat-flow-skill-version: "1.9.0"
---
# /goat-review

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.

## When to Use

Use when reviewing a diff, PR, or set of changes. Also for quality audits of a codebase area.

**Boundary:** goat-review owns quality, style, correctness. goat-security owns threat models, compliance, CVEs, auth boundaries. Security issues: flag and suggest `/goat-security`.

**NOT this skill:** OWASP assessment → /goat-security. Understanding code → /goat-debug. Generating tests → /goat-qa. Planning milestones → /goat-plan. Feature briefs → dispatcher Route Map.

## Step 0 - Scope, Size, Spec

> "Reviewing [X] -- diff review (quick), PR review against a base branch, or area audit + DoD cross-checks (full)?"

- If user already says "quick", "PR", or "full", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering files, concerns, and diff / PR / audit.
- Auto-detect scope: (1) explicit input, (2) staged changes, (3) unstaged changes, (4) PR-style when HEAD is on a non-default branch with commits ahead of the detected review base, (5) git diff.

**PR mode (prefer PR link):** ask for PR URL/number first; it collapses base, head, description, and linked issues. Prompt: "PR URL or number? -- or say 'local' if not pushed." Resolve with `gh pr view <ref> --json baseRefName,headRefName,headRefOid,url,title,body,reviews,comments`; diff via `gh pr diff <ref>`. Record PR URL and base SHA. See `references/automated-review.md` for overlap-tagging protocol.

**PR mode (base fallback):** when no PR link or `gh` unavailable, resolve base in order: (1) explicit user base, (2) `.goat-flow/config.yaml`'s `skills.goat-review.local_pr_base` (record `configured-base=<base>`, or `configured-base-unresolved=<base>` if unresolvable), (3) `git symbolic-ref --short refs/remotes/origin/HEAD` or `git remote show origin`, (4) ask user, (5) last-resort fallback `main` with `base-detection-failed`. Run `git fetch origin <base> --quiet`; diff via `git diff origin/<base>...HEAD`. On fetch failure, fall back to local `<base>` with `base-fetch-failed`. Record resolved base, source, and short SHA in Review Integrity.

**Size sizing (before Pass 1):** measure the diff. If it exceeds **20 files OR 3000 changed lines**, propose chunking by file group and ask. If the user proceeds un-chunked, record as `large-diff-unchunked` for Review Integrity.

**Spec source (opt-in):** if `.goat-flow/tasks/.active` exists, read it to find the active plan subdir and scan for a milestone file with `Status: in-progress` or `testing-gate`. If found, offer: "Include Spec Drift check against M[NN] exit criteria?" Default: skip for quick, offer for full. Note the choice in Review Integrity.

**Temporary review artifacts:** write under `.goat-flow/scratchpad/` only with a random suffix (`goat-review-<artifact>.<random>.txt`). Never write to repo root.

**Footgun check:** Use the preamble's grep-first learning-loop retrieval on `.goat-flow/footguns/` for the target area. Present matches or an explicit retrieval miss; do not broad-load the bucket.

### Review Scope Snapshot (mandatory)

Before Pass 1, record the exact review surface:

- **Source:** staged | unstaged | PR | branch diff | explicit path list
- **Base/Head:** `<branch-or-sha>` / `<branch-or-sha>` (or n/a)
- **Uncommitted included:** yes | no | n/a
- **Size:** `<files>` files, `<changed-lines>` changed lines
- **Chunking:** no | proposed | accepted | skipped-by-user
- **Scope degradation:** `<flags or "none">`

If any value is undetermined, write `unknown` and add a degradation flag.

### Step 0.5 - Intent Reconstruction (mandatory)

Before Pass 1, reconstruct WHY this change exists. Read in priority order: (1) PR description and linked issues via `gh pr view <ref> --json body,title` and `gh issue view <n>`, (2) commit message of HEAD, (3) active milestone exit criteria from `.goat-flow/tasks/.active`. If none exist, flag `intent-unstated` in Review Integrity.

Output three-bullet reconstruction:
- **Stated intent:** what the change claims to do
- **Implied intent:** what the diff actually appears to do
- **Gap:** divergence between stated and implied, or "none"

Pass 1 and Pass 2 anchor to BOTH the diff and the stated intent.

**CHECKPOINT:** Scope locked, intent reconstructed. Proceeding to Pass 1.

## Diff Review (Quick) - Two-Pass Discipline

The review runs two sequential passes. This is a deliberate reading discipline, not a doer-verifier split: you are the reviewer throughout, Pass 2 is the source of truth, and findings are only surfaced after Pass 2.

### Pass 1 - Blind Suspicion (diff only)

Read the diff **without opening full files**. The point is to see what the diff reveals before surrounding code anchors you.

Scan for:
- **Severity cues:** auth/permission checks, secret handling, SQL/shell/API calls, data mutation, state transitions
- **Edge-case sweep - 6 meta-categories, specifics bubble up as the diff warrants:**
  - *Boundary conditions* - off-by-one, pagination/index bounds, empty collections, integer overflow
  - *Nullish values* - null / undefined / default branches, missing optional fields
  - *Concurrency* - race windows, shared state, concurrent access
  - *Error handling* - timeouts, retries/backoff, silent exception swallowing
  - *Contract changes* - signature, return type, error channel, status code, event shape
  - *Observability & DDT testability* - state transitions, background tasks, retries, or async flows lacking logs, telemetry, or signals. Ask: "can a human tell if this succeeded without instrumenting it?" If no: `[SHOULD:needs-signal]` or `[MUST:needs-signal]` per risk

Write raw suspicions with `file + semantic anchor` drawn from the diff. Do NOT verify, confirm, or dismiss in this pass. Over-capture is fine; Pass 2 filters.

**CHECKPOINT:** Pass 1 complete - [N] suspicions captured (no resolution yet). Proceeding to Pass 2 grounded verification.

### Pass 2 - Grounded Verification (full files)

Now read full files for context. For each Pass-1 suspicion:

- **Try to DISPROVE it** (negative verification). Re-read the `file + semantic anchor`, look for a guard, an upstream check, a framework mitigation, or a contract that removes the risk.
- **Blast Radius Rule:** if a suspicion involves a contract change (signature, payload shape, exported type, event shape, error channel, status code), MUST run an external call-site search before resolving. Prefer `rg -n '<symbol>' -t ts -t js -t py -t php -t go -t rust`; if shell `rg` is unavailable, use the host search tool or `grep -rniE '<symbol>'` and record the fallback. Verify at least one consumer. If skipped, stays UNRESOLVED and gets `coverage-degraded`.
- Mark each suspicion: **CONFIRMED** / **REFUTED** / **UNRESOLVED**.
- **Refutation Ledger:** REFUTED suspicions are not silently dropped. Write a ledger to `.goat-flow/scratchpad/goat-review-refutations.<random>.txt`. Each entry: original suspicion (verbatim), refuting evidence (`file + semantic anchor`), one-sentence rationale. Refuted suspicions do not appear in final output; the ledger is the audit trail.
- Add findings that only became visible with file context (integration breakage, call-site contract mismatch, regression in a sibling file).
- Re-verify every `file + semantic anchor` reference exists before writing the final output.

Full Excuse/Reality table: `references/examples.md`. Key entries:

| Excuse | Reality |
|--------|---------|
| "Skip Pass 2 / CI is green / zero findings anyway" | Trust, CI, and empty results don't replace opening files. See full table. |
| "The symbol is unique enough that grep is overkill" | The bug is in the consumer, not the emitter. Run the grep. |
| "Refuted suspicions are noise - logging them wastes tokens" | The ledger is the integrity surface. Without it, REFUTED is indistinguishable from "didn't bother to check." |

### Severity + Action Tagging

Every surfaced finding gets two orthogonal tags:

| Severity | Meaning |
|----------|---------|
| MUST | fix before merge; blocks approval |
| SHOULD | fix before merge unless disputed |
| MAY | nice-to-have |

| Action | Meaning |
|--------|---------|
| patch | fix direction is unambiguous - a coding agent can apply it |
| needs-decision | correct fix requires human input (policy, product call, trade-off) |
| pre-existing | bug exists in unchanged code (see separation below) |
| intent-mismatch | code is correct but does not match stated intent - needs author confirmation |
| needs-signal | code is a black box that degrades manual testability - needs emitted signal, log, or observable return value |

Finding line prefix: `[SEVERITY:ACTION]`. Example: `[MUST:needs-decision]`.

**Proof Capsule:** every finding includes a proof class per `skill-preamble.md` Proof Classification: `RUNTIME` | `CONTRACT-GREP` | `STATIC` | `NOT-REPRODUCED`. MUST/correctness-SHOULD should prefer RUNTIME or CONTRACT-GREP. NOT-REPRODUCED adds `not-reproduced-findings` to Review Integrity.

### Pre-existing Separation

- **Pre-existing Nearby** (in-scope surface): a pre-existing bug in the same function or tightly-coupled call-site the diff touches. Surface as a one-line pointer under `## Pre-existing Nearby`. Does not block.
- **Pre-existing Issues** (out-of-scope): pre-existing bugs outside the diff's surface. List under `## Pre-existing Issues` without severity tags. Does not block.

### Footgun Cross-Check

Check each finding with targeted grep-first retrieval against `.goat-flow/footguns/`. When a direct match exists, include it. Omit the footgun tag when no direct match is found after the one allowed reword.

**BLOCKING GATE:** Present findings using Output Format below, then pause for human to drill in. After the human responds, evaluate Pass 3 auto-trigger conditions before presenting the Ship Verdict - do not skip the refuter when conditions are met.

**Review DoD gate:** for reporting-only review, verify findings, cross-references, and scope. No implementation tests unless a finding requires it. If user says "implement", switch to the instruction file's implementation DoD.

**Proof Gate:** per `skill-preamble.md`.

## Area Audit (Full)

When the target is a codebase area (not a diff). For >20 files, recommend splitting. Two-pass discipline still applies per file cluster: skim the surface for suspicions, then open files for verification. Pre-existing issues ARE in scope (they are the point of an area audit).

**BLOCKING GATE:** Present findings and pause. If calibration is uncertain, consider `/goat-critique`.

## Spec Drift (opt-in)

Only emitted when Step 0 prompt was accepted and a live milestone was found. Reads the milestone's **Exit Criteria** and **Assumptions**, splits by direction:

- **Exit-criteria drift** `[advisory]` under `## Spec Drift` -- criterion marked done but diff doesn't support it. No severity tag.
- **Assumption invalidation** `[MUST:needs-decision]` under `## Findings` -- diff makes an assumption false.
- **Open criterion satisfied** `[ready-to-tick]` under `## Spec Drift` -- advisory, human ticks milestone.

If none detected, emit "No drift detected against M[NN]" so the reader knows the check ran.

## Pass 3 - Cross-Model Refuter (opt-in or auto-triggered)

Triggers when ANY of: (1) user opts in at Step 0, (2) Review Integrity would be `coverage-degraded` or `high-inference`, (3) any `[MUST:needs-decision]` finding exists, (4) any INTENT-MISMATCH finding exists.

**Method:** Use an authenticated external refuter runtime, not the host model. Default host map: Claude -> `codex exec`; Codex/Copilot/Antigravity -> `claude -p` unless a verified stronger opposite runtime is documented. Pass FINDINGS LIST, not the diff. Template: `references/refuter-spec.md`.

**Synthesis:** REFUTER-CONFIRMED findings get `[CONFIRMED-CROSS-MODEL]` upgrade. REFUTER-REFUTED move to `## Refuted by Refuter` with reasoning preserved verbatim. REFUTER-UNRESOLVED keep original severity; add `cross-model-unresolved` to Review Integrity. Refuter leads do not become findings unless host verifies via Pass 2 rules.

**Constraints:** Run the target auth check from `references/refuter-spec.md` first; version-only commands do not count. If no authenticated refuter exists for the current host, skip Pass 3 and emit `cross-model-refuter-failed`. REFUTER-REFUTED stays advisory.

## Review Integrity (confidence signal)

Anti-hallucination surface -- tells the reader at a glance how confident the review is.

- **Files opened in Pass 2:** count / total. Paths read diff-only.
- **Evidence tags:** N OBSERVED / M INFERRED.
- **Size:** lines changed, files changed, chunking state. PR mode: resolved base, source annotation, short SHA.
- **Scope snapshot:** source, base, head, uncommitted, chunking.
- **Refutations logged:** `<N>`
- **Degradation flags:** `chunked-partial`, `large-diff-unchunked`, `high-inference-ratio`, `files-not-opened`, `unfamiliar-area`, `missing-types`, `spec-drift-skipped`, `footguns-unread`, `not-reproduced-findings`, `coverage-degraded`, `configured-base-unresolved=<base>`, `base-detection-failed`, `base-fetch-failed`, `intent-unstated`, `cross-model-refuter-failed`.
- **Conclusion:** `confident` | `coverage-degraded` | `high-inference` | `partial`.

Never leave this section empty. "confident - no degradation flags" is the minimum.

## Constraints

**Diff review (quick):**
- MUST run Pass 1 (diff only) before opening any full files in Pass 2
- MUST NOT surface Pass-1 suspicions that Pass 2 refuted
- MUST NOT flag pre-existing issues as blocking the change

**Area audit (full):**
- MUST scan the declared area regardless of recent changes
- Pre-existing issues ARE in scope

**Both modes:**
- MUST run external call-site search for any contract-change suspicion before resolving (Blast Radius Rule); prefer `rg`, fall back to host search or `grep -rniE`, and flag `coverage-degraded` if skipped
- MUST tag every surfaced finding with `[SEVERITY:ACTION]`
- MUST grep `.goat-flow/footguns/` per finding; omit the tag on no direct match after the allowed reword
- MUST order findings by severity, not by file or discovery order
- MUST emit Review Integrity on every run
- MUST propose chunking when the diff exceeds 20 files OR 3000 changed lines
- MUST emit Spec Drift only when opt-in triggered; if skipped, log `spec-drift-skipped` in Review Integrity
- MUST split Spec Drift output by direction: exit-criteria drift as `[advisory]` (no severity tag), assumption invalidation as `[MUST:needs-decision]` under `## Findings`, open-criterion satisfaction as `[ready-to-tick]`
- MUST store temporary artifacts under `.goat-flow/scratchpad/` with random suffix
- MUST attempt to disprove each Pass-1 suspicion during Pass 2
- MUST group 3+ related findings as systemic patterns
- MUST NOT edit files unless user says "implement"; MUST NOT frame Pass 1/Pass 2 as doer/verifier
- **Consequence Gate:** every MUST and SHOULD finding MUST state concrete harm (what breaks, leaks, regresses, silently fails, corrupts data, or blocks a workflow). If the reviewer cannot name harm, downgrade to MAY.
- **Ship Verdict rules:** unresolved MUST -> NO. SHOULD-only -> YES WITH CONDITIONS. MAY-only -> YES. INTENT-MISMATCH -> NO until author confirms intent. Review Integrity `coverage-degraded`, `high-inference`, or `partial` -> downgrade verdict one step.
- **Zero-findings HALT:** If Pass 2 produces zero findings, state what was checked and why no issues surfaced. Zero findings must be defended.
- Universal constraints from skill-preamble.md apply.

## Output Format

```markdown
## TL;DR  <!-- what was reviewed, found, matters most -->

## Review Integrity
- Scope snapshot: source=<source>, base=<base>, head=<head>, uncommitted=<yes|no|n/a>, chunking=<state>
- Files opened in Pass 2: <k>/<n>  (diff-only: <list or "none">)
- Evidence: <N> OBSERVED / <M> INFERRED
- Refutations logged: <N>
- Size: <files> files, <lines> lines  (chunked: <group or "no">)
- Degradation flags: <list or "none">
- Conclusion: <confident | coverage-degraded | high-inference | partial>

## Findings

### MUST / SHOULD / MAY
- [SEVERITY:ACTION] **[title]** `file + semantic anchor` - [desc] | Footgun: [entry or none] | Evidence: OBSERVED/INFERRED | Proof: RUNTIME/CONTRACT-GREP/STATIC/NOT-REPRODUCED

## Spec Drift   <!-- only when opt-in triggered; otherwise omit and log spec-drift-skipped -->
<!-- advisory-only entries (exit-criteria drift, ready-to-tick); assumption invalidation goes under ## Findings as [MUST:needs-decision] -->
- [advisory] **[criterion title]** - claimed done in M[NN] but not supported by diff
- [ready-to-tick] **[criterion title]** - now satisfied by diff, milestone still shows `- [ ]`

## Pre-existing Nearby  <!-- in-function only; one-liners; no blocking tags -->

## Pre-existing Issues  <!-- out-of-scope pre-existing bugs -->

## Breaking Changes

## Top 5 Risks (cross-tier)
<!-- Five findings most likely to cause harm if merged, ranked regardless of tier. If <5 total, list all. If zero: "No surfaced risks." -->
1. [SEVERITY:ACTION] **[title]** `file + semantic anchor` - one-sentence why

## Ship Verdict
Decision: **YES** | **YES WITH CONDITIONS** | **NO** | **PARTIAL**
Reasoning: <2-3 sentences anchored to Top 5 Risks and Review Integrity>
Conditions to ship: <numbered list, only when YES WITH CONDITIONS>
Confidence: HIGH | MEDIUM | LOW

## What's Good

## What I Didn't Examine
```
