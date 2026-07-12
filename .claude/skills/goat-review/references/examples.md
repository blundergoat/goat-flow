---
goat-flow-reference-version: "1.13.1"
---
# goat-review Reference Examples

This reference carries detailed examples that would overload the review protocol.
Use it to calibrate refutations, final output, and explicit direction audits.
Every live claim still requires a verified file plus semantic anchor.

## Direction / Opportunity Audit

Run this area-audit variant only when the user explicitly asks what the repository should do next. Record the current read-only verification baseline first; a failing build or test is a prerequisite, not an opportunity. Every item needs repo-grounded evidence and exactly one class:

- **unfinished intent** - TODO/FIXME clusters, dead flags, or stubs.
- **stated-but-undelivered** - docs or flags promise behavior no live surface provides.
- **surface asymmetry** - an export has no import, CRUD lacks one operation, or an integration works one way.
- **adjacent possible** - a cheap extension is implied by the existing architecture.
- **friction worth productizing** - docs, examples, issues, or support text repeat the same manual workaround.

Emit these under `## Direction / Opportunity Audit`, without MUST/SHOULD/MAY tags. Rank only this opportunity/backlog output by impact divided by effort, discounted by confidence and fix risk. Defect findings remain severity-ordered and continue to control Ship Verdict. Generic ideas without a live anchor are rejected, not padded into the list.

Route rejected material by lifespan:

- **Per-run refutations:** keep Pass-2 evidence in random-suffixed `.goat-flow/logs/review/` ledgers.
- **Local cross-run rejections:** record the rationale in the active plan's `backlog.md` or a named plan-local rejection section.
- **Durable policy decisions:** use an ADR or learning-loop entry only when the decision changes future work beyond the current plan.

## Worked Example - Refuted Template Suspicion

Use this shape when Pass 1 raises a plausible template or output-format suspicion and Pass 2 disproves it. This example uses real `goat-review` files and anchors.

**Review surface:** `SKILL.md`, `references/automated-review.md`, `references/refuter-spec.md`

**Pass 1 suspicion (diff-only):**
- `SKILL.md` (search: `Review Integrity`) may omit the automated-review and refuter integrity lines even though the references require them.

**Pass 2 actions:**
1. Open `SKILL.md` and re-read `Review Integrity`.
2. Search for `Automated-reviewer overlap`.
3. Search for `Refuter pass`.
4. Open `references/automated-review.md` (search: `Automated-reviewer overlap`) and `references/refuter-spec.md` (search: `Review Integrity Extension`) to compare the reference contract with the main output template.

**Expected outcome:**
- Mark the suspicion `REFUTED` when `SKILL.md` contains both output-template lines.
- Do not surface a final finding.
- Write a refutation ledger entry:
  - Original suspicion: `SKILL.md` may omit automated-review and refuter integrity lines.
  - Refuting evidence: `SKILL.md` (search: `Automated-reviewer overlap`); `SKILL.md` (search: `Refuter pass`).
  - Rationale: the main template now exposes both conditional integrity extensions, so the references are reachable during normal review output.

**Zero-finding final note:** "Checked Review Integrity against both optional references; no issue surfaced because the output template includes the required conditional lines."

## Worked Example - Full Output Block (end-to-end)

The refuted-suspicion example above walks one Pass 1 -> Pass 2 transition. This example shows the **entire Output Format filled in**, so a cold reader sees how every section is populated with real values rather than the empty template in `SKILL.md` (search: `## Output Format`). Following the convention in `## Finding Format Examples` below, it uses real `goat-review` anchors: treat it as the block to emit when a reviewed diff *weakens* the cited rules. The illustrative review surface is a small PR that (a) replaces the Blast Radius Rule's external call-site grep with a `// TODO` comment and (b) deletes the refuter authentication pre-flight. Proof class is `STATIC` for both findings because the review surface is documentation: the reviewer verifies by re-reading the live file, not by executing it.

**Review surface:** PR mode (`gh pr view 412`); base `origin/main`, head `a1b2c3d`; 2 files, 86 changed lines; under the 20-file / 3000-line chunking threshold, so no chunking. Copilot reviewed the PR. Pass 3 was offered because the `[MUST:needs-decision]` finding matched trigger 3. After the runtime, authentication, findings-only payload, one-call cap, cost impact, and local fallback were disclosed,
the user explicitly approved one refuter call; the refuter received the full findings list and upheld both.

```markdown
## TL;DR
Reviewed PR #412 (2 files, 86 lines): the diff removes the contract-change call-site search and the refuter auth gate. One MUST and one SHOULD surfaced; both confirmed in Pass 2 and upheld cross-model. Do not merge as-is.

## Review Integrity
- Scope snapshot: source=PR, base=origin/main, head=a1b2c3d, uncommitted=no, chunking=no
- Files opened in Pass 2: 2/2  (diff-only: none)
- Evidence: 2 OBSERVED / 0 INFERRED
- Refutations logged: 1
- Size: 2 files, 86 lines  (chunked: no)
- Automated-reviewer overlap: 1 overlap with copilot-pull-request-reviewer, 1 net-new
- Refuter pass: yes; confirmed=2, refuted=0, unresolved=0, leads-verified=0, model=codex
- Degradation flags: spec-drift-skipped
- Conclusion: confident

## Findings

### MUST
- [MUST:needs-decision] [CONFIRMED-CROSS-MODEL] [overlap:copilot-pull-request-reviewer] **Blast Radius Rule no longer forces a call-site search on contract changes** `SKILL.md` (search: `Blast Radius Rule`) - the diff replaces the `rg`/`grep` consumer search with a `// TODO`, so a signature, return-type, or event-shape change can now ship without a single consumer verified; downstream callers break at runtime with no review signal. Needs-decision because relaxing the rule is a policy call the author may have intended. | Footgun: none | Evidence: OBSERVED | Proof: STATIC

### SHOULD
- [SHOULD:patch] [CONFIRMED-CROSS-MODEL] [new] **Refuter pre-flight auth check deleted** `references/refuter-spec.md` (search: `Pre-flight Check`) - removing the `codex login status` / `claude auth status` gate lets Pass 3 spawn an unauthenticated refuter that fails silently and is recorded as a clean `confirmed=0` instead of `cross-model-refuter-failed`; reviews then read as cross-verified when they were not. | Footgun: none | Evidence: OBSERVED | Proof: STATIC

## Systemic Patterns
<!-- 2 findings with distinct root causes and distinct fixes - no systemic parent emitted -->

## Pre-existing Nearby
- None.

## Pre-existing Issues
- None in scope for this diff.

## Breaking Changes
- None to the emitted skill contract; both findings remove safeguards rather than change a public interface.

## Top 5 Risks (cross-tier)
1. [MUST:needs-decision] **Contract changes ship without call-site verification** `SKILL.md` (search: `Blast Radius Rule`) - highest-harm regression: silent runtime breakage in unverified consumers.
2. [SHOULD:patch] **Unauthenticated refuter passes as success** `references/refuter-spec.md` (search: `Pre-flight Check`) - false cross-model confidence on every Pass 3.

## Ship Verdict
Decision: **NO**
Reasoning: The MUST finding (Blast Radius Rule removal) remains unaddressed by the diff, which forces NO per the Ship Verdict rule (unresolved MUST -> NO); the cross-model refuter upheld both findings. The SHOULD compounds the risk by masking refuter failures. Review Integrity is `confident`, so the verdict is not downgraded further.
Confidence: HIGH

## What's Good
- The diff keeps the two-pass discipline and the Refutation Ledger path intact.

## What I Didn't Examine
- The CI workflow that invokes the refuter (out of diff scope); flagged for the author.
```

## Finding Format Examples

Use concrete harm and proof class. These examples use real anchors from this skill surface; apply them when a reviewed diff removes, bypasses, or contradicts the cited rule.

**Systemic pattern:**

```markdown
## Systemic Patterns
- [SHOULD:patch] **Group repeated output-contract drift under one parent** - affected anchors: `SKILL.md` (search: `MUST group 3+ related findings as systemic patterns`), `SKILL.md` (search: `## Systemic Patterns`); repeated failure: three related findings share one output-contract root cause; harm: reviewers scatter one root cause across separate bullets, making the required fix easy to under-scope. | Evidence: OBSERVED | Proof: STATIC
```

**PR automated-review overlap:**

```markdown
- [SHOULD:patch] [overlap:copilot-pull-request-reviewer] **Report PR metadata ingestion failure explicitly** `references/automated-review.md` (search: `automated-review-uningested`) - If `gh pr view` returns `reviews,comments` but parsing fails, the review must degrade explicitly instead of reporting no bot findings; otherwise duplicated findings look net-new. | Footgun: none | Evidence: OBSERVED | Proof: STATIC
```

## Excuse/Reality Table (Full)

| Excuse | Reality |
|--------|---------|
| "Trusted author wrote it, Pass 2 will just refute everything - skip it" | In-group trust has historically produced the worst misses in auth/signing/rate-limit code. Open the files. |
| "CI is green, so boundary and signing edges are already covered" | CI tests what was thought of. Review looks for what wasn't. Green CI raises, not answers, the Pass-2 question. |
| "Tight window + demo tomorrow - MAY-only cosmetic pass is proportionate" | An incomplete review merged into a demo window is worse than a `coverage-degraded` conclusion returned on time. |
| "Findings would be zero anyway, so Review Integrity is paperwork" | Review Integrity IS the zero-findings signal. `files-not-opened` tells the reader you stopped early. |
| "The symbol is unique enough that grep is overkill" | Unique symbols still need external verification because the bug is in the consumer, not the emitter. |
| "Refuted suspicions are noise - logging them wastes tokens" | The ledger is the integrity surface. Without it, REFUTED is indistinguishable from "didn't bother to check." |
