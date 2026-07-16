---
goat-flow-reference-version: "1.14.0"
---
# goat-review Reference Examples

This reference carries detailed examples that would overload the review protocol.
Use it to calibrate refutations, final output, and explicit direction audits.
Every live claim still requires a verified file plus semantic anchor.

## Direction / Opportunity Audit

Run this area-audit variant only when the user explicitly asks what the repository should do next. Record the current read-only verification baseline first. A failing build or test remains a defect finding and must not be reclassified as an opportunity; establish a passing or explicitly failing current baseline before proposing opportunities. Every item needs repo-grounded evidence and exactly one class:

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

## Worked Example - Confirmed PR #56 Finding

This incident records a finding from PR #56 at head `861c0acad3de7043f0a6f27cd8c1a78419b935c5`.

**Review surface:** `src/cli/audit/check-artifact-integrity.ts` (search: `checkSharedFileSets`), `src/cli/skill-author.ts` (search: `PLAYBOOK_TEMPLATE`), and `test/integration/audit-drift-artifact-integrity.test.ts` (search: `accepts an explicitly user-owned consumer playbook`).

**Pass 1 suspicion:** The drift audit appeared to classify every unmapped installed playbook as stale even though `goat-flow skill new` creates consumer-only playbooks at that location.

**Pass 2 reproduction:** A generated `lefthook.md` under `.goat-flow/skill-docs/playbooks/` produced a `stale installed shared artifact` finding because it was absent from the package mirror map.

**Finding:** The audit contradicted the documented consumer-project route and made a valid local playbook fail drift checks.

**Resolution:** Generated consumer playbooks now carry explicit `goat-flow-ownership: "user-owned"` frontmatter. The audit exempts only playbooks with that marker, while unmarked stale package artifacts remain findings. The regression covers both outcomes.

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
