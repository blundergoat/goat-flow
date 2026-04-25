---
name: goat-review
description: "Use when reviewing a diff, PR, or set of code changes, or auditing a codebase area for quality issues. Triggers: 'review this', 'code review', 'audit X', 'look at these changes'."
goat-flow-skill-version: "1.3.0"
---
# /goat-review

## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.

## When to Use

Use when reviewing a diff, PR, or set of changes. Also for quality audits of a codebase area.

**Boundary:** goat-review owns code quality, style, correctness. goat-security owns threat models, compliance, CVEs, auth boundaries. If you find a security issue, flag it and suggest `/goat-security`.

**NOT this skill:** OWASP assessment → /goat-security. Understanding code → /goat-debug. Generating tests → /goat-qa. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Scope, Size, Spec

> "Reviewing [X] -- diff review (quick), PR review against a base branch, or area audit with DoD cross-checks (full)?"

- If user already says "quick", "PR", or "full", confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: which files, what concerns you, diff / PR / audit.
- Auto-detect scope: (1) explicit input, (2) staged changes, (3) unstaged changes, (4) PR-style when HEAD is on a non-default branch with commits ahead of the detected review base, (5) git diff.

**PR mode (prefer PR link):** when the user picks PR, first ask for the PR URL or number rather than the base branch - it collapses base, head, description, and linked issues into one input. Prompt: "PR URL or number? (e.g. `#123` or `https://github.com/owner/repo/pull/123`) - or say 'local' if the branch isn't pushed." If the user supplies a PR reference and `gh` is available (see preamble External Context Sources), resolve it with `gh pr view <ref> --json baseRefName,headRefName,headRefOid,url,title,body` and source the diff via `gh pr diff <ref>`. Record the PR URL and base SHA in Review Integrity's Size line. The description/linked issues are treated as spec context, not as findings.

**PR mode (branch vs base, fallback):** when no PR link is supplied or `gh` is unavailable, resolve the base before diffing: (1) use an explicit user-provided base, (2) otherwise detect the remote default branch from `git symbolic-ref --short refs/remotes/origin/HEAD` (strip `origin/`) or `git remote show origin`, (3) otherwise ask: "Base branch? (detected: none. Current: `$(git branch --show-current)`. I'll `git fetch origin <base>` first so the review is against the latest upstream tip.)", (4) if discovery fails and the user cannot provide a base, use `main` only as a last-resort fallback and record `base-detection-failed`. Then run `git fetch origin <base> --quiet` (best-effort; do not fail the review if offline or the remote is unreachable). Source the diff via `git diff origin/<base>...HEAD` (three-dot merge-base; matches what GitHub/GitLab PR UIs show). If the fetch fails or `origin/<base>` is not resolvable, fall back to local `<base>` and record `base-fetch-failed` as a degradation flag in Review Integrity so the reader knows the comparison was against stale local state. Record the resolved base and its short SHA in Review Integrity's Size line.

**Size sizing (before Pass 1):** measure the diff. If it exceeds **20 files OR 3000 changed lines**, propose chunking by file group and ask. If the user proceeds un-chunked, record as `large-diff-unchunked` for Review Integrity.

**Spec source (opt-in):** if `.goat-flow/tasks/.active` exists, read it to find the active plan subdir and scan for a milestone file with `Status: in-progress` or `testing-gate`. If found, offer: "Include Spec Drift check against M[NN] exit criteria?" Default: skip for quick, offer for full. Note the choice in Review Integrity.

**Temporary review artifacts:** If you need to persist a repo diff, scoped diff, grep summary, or similar helper file during review, write it under `.goat-flow/scratchpad/` only. Do not drop ad hoc review artifacts at repo root. Use a filename with a random suffix so concurrent review agents do not collide; prefer `mktemp -p .goat-flow/scratchpad goat-review-<artifact>.XXXXXX.txt` or an equivalent `<base>.<random>.txt` pattern.

**Footgun check:** Use the preamble's grep-first learning-loop retrieval on `.goat-flow/footguns/` for the target area. Present matches or an explicit retrieval miss; do not broad-load the bucket.

## Diff Review (Quick) - Two-Pass Discipline

The review runs two sequential passes. This is a deliberate reading discipline, not a doer-verifier split: you are the reviewer throughout, Pass 2 is the source of truth, and findings are only surfaced after Pass 2.

### Pass 1 - Blind Suspicion (diff only)

Read the diff **without opening full files**. The point is to see what the diff itself reveals before the author's surrounding code anchors you.

Scan for:
- **Severity cues:** auth/permission checks, secret handling, SQL/shell/API calls, data mutation, state transitions
- **Edge-case sweep - 5 meta-categories, specifics bubble up as the diff warrants:**
  - *Boundary conditions* - off-by-one, pagination/index bounds, empty collections, integer overflow
  - *Nullish values* - null / undefined / default branches, missing optional fields
  - *Concurrency* - race windows, shared state, concurrent access
  - *Error handling* - timeouts, retries/backoff, silent exception swallowing
  - *Contract changes* - signature, return type, error channel, status code, event shape

Write raw suspicions with `file:line` drawn from the diff. Do NOT verify, confirm, or dismiss in this pass. Over-capture is fine; Pass 2 filters.

### Pass 2 - Grounded Verification (full files)

Now read full files for context. For each Pass-1 suspicion:

- **Try to DISPROVE it** (negative verification). Re-read the `file:line`, look for a guard, an upstream check, a framework mitigation, or a contract that removes the risk.
- Mark each suspicion: **CONFIRMED** / **REFUTED** / **UNRESOLVED**. Drop REFUTED.
- Add findings that only became visible with file context (integration breakage, call-site contract mismatch, regression in a sibling file).
- Re-verify every `file:line` reference exists before writing the final output.

| Excuse | Reality |
|--------|---------|
| "Trusted author wrote it, Pass 2 will just refute everything - skip it" | In-group trust has historically produced the worst misses in auth/signing/rate-limit code. Open the files. |
| "CI is green, so boundary and signing edges are already covered" | CI tests what was thought of. Review looks for what wasn't. Green CI raises, not answers, the Pass-2 question. |
| "Tight window + demo tomorrow - MAY-only cosmetic pass is proportionate" | An incomplete review merged into a demo window is worse than a `coverage-degraded` conclusion returned on time. |
| "Findings would be zero anyway, so Review Integrity is paperwork" | Review Integrity IS the zero-findings signal. `files-not-opened` tells the reader you stopped early. |

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

Finding line prefix: `[SEVERITY:ACTION]`. Example: `[MUST:needs-decision]`.

### Pre-existing Separation

- **Pre-existing Nearby** (in-scope surface): a pre-existing bug in the same function or tightly-coupled call-site the diff touches. Surface as a one-line pointer under `## Pre-existing Nearby`. Does not block.
- **Pre-existing Issues** (out-of-scope): pre-existing bugs outside the diff's surface. List under `## Pre-existing Issues` without severity tags. Does not block.

### Footgun Cross-Check

Check each finding with targeted grep-first retrieval against `.goat-flow/footguns/`. When a direct match exists, include it. Omit the footgun tag when no direct match is found after the one allowed reword.

**BLOCKING GATE:** Present findings using Output Format below, then pause for human to drill in.

**Review DoD gate:** for reporting-only review, verify findings, cross-references, and scope boundaries; do not imply the reviewer must run implementation tests/lint or rename greps unless those checks are directly needed to verify a finding. If the user asks to implement fixes after review, switch to the instruction file's implementation DoD.

**Proof Gate:** Apply the Proof Gate from `skill-preamble.md` to every surfaced finding - each `file:line` must be re-read fresh in this session before presentation; downgrade any finding whose evidence cannot be re-verified to UNVERIFIED.

## Area Audit (Full)

When the target is a codebase area (not a diff). For >20 files, recommend splitting. Two-pass discipline still applies per file cluster: skim the surface for suspicions, then open files for verification. Pre-existing issues ARE in scope (they are the point of an area audit).

**BLOCKING GATE:** Present findings and pause. If calibration is uncertain, consider `/goat-critique`.

## Spec Drift (opt-in)

Only emitted when the Step 0 prompt was accepted and a live milestone file was found. Reads the milestone's **Exit Criteria** and **Assumptions** blocks, then splits output by direction - the two cases surface under different sections and carry different weight:

- **Exit-criteria drift → advisory, no severity tag.** A criterion is marked `- [x]` (done) in the milestone but the diff does not support it. The *milestone* is stale. Surface under `## Spec Drift` prefixed `[advisory]`. Do NOT tag MUST/SHOULD/MAY - this is milestone hygiene for the human to reconcile, not a code defect.
- **Assumption invalidation → review finding with severity.** The diff makes a milestone Assumption false. The *plan* is now broken and the human must choose (update the assumption, fix the diff, or abandon). Surface under `## Findings` as `[MUST:needs-decision]`, **not** under `## Spec Drift`.
- **Open criterion now satisfied → ready-to-tick note.** An open `- [ ]` criterion is now supported by the diff. Surface under `## Spec Drift` prefixed `[ready-to-tick]`. Advisory only - human ticks the milestone file.

If no drift, no invalidation, and no ready-to-tick criteria, still emit the section with "No drift detected against M[NN]" so the reader knows the check ran.

## Review Integrity (confidence signal)

Every review ends with this section. It is the anti-hallucination surface - the reader should be able to tell at a glance how confident the review is.

List:
- **Files opened in Pass 2:** count / total in diff. List paths that were read diff-only.
- **Evidence tags:** N OBSERVED / M INFERRED across findings.
- **Size:** lines changed, files changed. If chunked, state which group was reviewed and which are pending.
- **Degradation flags** (any that apply): `chunked-partial`, `large-diff-unchunked`, `high-inference-ratio`, `files-not-opened`, `unfamiliar-area`, `missing-types`, `spec-drift-skipped`, `footguns-unread`, `base-detection-failed` (PR mode only), `base-fetch-failed` (PR mode only).
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
- MUST tag every surfaced finding with `[SEVERITY:ACTION]`
- MUST check each finding with targeted grep-first retrieval against `.goat-flow/footguns/`; omit the tag when no direct match after the allowed reword
- MUST order findings by severity, not by file or discovery order
- MUST emit Review Integrity on every run
- MUST propose chunking when the diff exceeds 20 files OR 3000 changed lines
- MUST emit Spec Drift only when opt-in triggered; if skipped, log `spec-drift-skipped` in Review Integrity
- MUST split Spec Drift output by direction: exit-criteria drift as `[advisory]` (no severity tag), assumption invalidation as `[MUST:needs-decision]` under `## Findings`, open-criterion satisfaction as `[ready-to-tick]`
- MUST store any temporary review artifact files (saved diffs, scoped diffs, grep summaries) under `.goat-flow/scratchpad/` with a random suffix in the filename; never write them to repo root
- MUST attempt to disprove each Pass-1 suspicion during Pass 2
- MUST group 3+ related findings as systemic patterns
- MUST NOT make file edits in review or audit mode unless the user says "implement"
- MUST NOT frame Pass 1/Pass 2 as doer/verifier - same reviewer, structured reading discipline (ADR-005)
- **Zero-findings HALT:** If Pass 2 produces zero findings across MUST/SHOULD/MAY, do not silently approve. State explicitly what was checked (boundary conditions, null/undefined, concurrency, error handling, contract changes) and why no issues surfaced. Zero findings must be defended, not assumed.
- Universal constraints from skill-preamble.md apply.

## Output Format

```markdown
## TL;DR  <!-- what was reviewed, found, matters most -->

## Review Integrity
- Files opened in Pass 2: <k>/<n>  (diff-only: <list or "none">)
- Evidence: <N> OBSERVED / <M> INFERRED
- Size: <files> files, <lines> lines  (chunked: <group or "no">)
- Degradation flags: <list or "none">
- Conclusion: <confident | coverage-degraded | high-inference | partial>

## Findings

### MUST
- [MUST:patch] **[title]** `file:line` - [desc] | Footgun: [entry or none] | Evidence: OBSERVED/INFERRED
- [MUST:needs-decision] **[title]** `file:line` - [desc] | ...

### SHOULD
- [SHOULD:patch] ...

### MAY
- [MAY:patch] ...

## Spec Drift   <!-- only when opt-in triggered; otherwise omit and log spec-drift-skipped -->
<!-- advisory-only entries (exit-criteria drift, ready-to-tick); assumption invalidation goes under ## Findings as [MUST:needs-decision] -->
- [advisory] **[criterion title]** - claimed done in M[NN] but not supported by diff
- [ready-to-tick] **[criterion title]** - now satisfied by diff, milestone still shows `- [ ]`

## Pre-existing Nearby  <!-- in-function only; one-liners; no blocking tags -->

## Pre-existing Issues  <!-- out-of-scope pre-existing bugs -->

## Breaking Changes

## What's Good

## What I Didn't Examine
```
