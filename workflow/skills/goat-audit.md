---
name: goat-audit
description: "Multi-phase quality audit with negative verification, fabrication self-check, and pattern rollup."
goat-flow-skill-version: "0.7.0"
---
# /goat-audit

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use for systematic quality review of a codebase area — before releases,
after major changes, or when code quality is uncertain.

**NOT this skill:**
- Reviewing a specific diff or PR → /goat-review
- OWASP-driven security assessment → /goat-security
- Investigating to understand code → /goat-investigate
- Diagnosing a specific bug → /goat-debug

## Step 0 — Gather Context

<!-- ADAPT: Replace illustrative questions with your project's common audit targets -->

**Structural questions (always ask or confirm):**
1. What's the scope and purpose? (e.g., "security audit of src/auth/", "consistency check across all docs")

**Illustrative questions (adapt):**
2. <!-- ADAPT: "Which categories matter most? (security, correctness, consistency, test coverage)" -->
3. <!-- ADAPT: "Any areas to skip? (generated code, vendor, known tech debt)" -->

**Auto-detect:** Read `git log --oneline -10` and branch state to suggest scope.
Present: "Based on recent activity, I'd suggest auditing [area]. Correct?"

**Scope guidance:** For >20 files, recommend splitting into focused audits.
For ≤8 files, intermediate checkpoints auto-advance.

## Phase 1 — Scan

<!-- ADAPT: Adjust category list and weights for your project -->

Scan categories, weighted by audit purpose:

| Category | Security audit | Consistency audit | General |
|----------|---------------|-------------------|---------|
| Security | Critical | Medium | High |
| Correctness | High | Medium | High |
| Cross-reference integrity | Medium | Critical | Medium |
| Test coverage | Medium | Low | High |
| Performance | Low | Low | Medium |
| Consistency | Low | Critical | Medium |
| Style | Low | Low | Low |

For each finding, log: category, `file:line`, description, severity.
<!-- ADAPT: Use your agent's parallel execution capability, or scan areas sequentially. -->

**CHECKPOINT:** "Phase 1 complete. [N] findings across [M] files. Proceeding to verification."

**Recurrence check:** Before reporting, search `docs/footguns.md` for entries
in the scanned area. Cross-reference findings with known footguns.

## Phase 2 — Verify & Self-Check

Two activities in one phase (previously separate passes):

**A) Negative verification:** For each finding, attempt to DISPROVE it.
Re-read the code at the cited `file:line`. Look for evidence that contradicts
the finding. The goal is adversarial: "Can I prove this finding is wrong?"
Remove genuine false positives.

*Example:* "Finding: No input validation on `/api/users`. Disproof attempt:
checked middleware chain — `express-validator` at `middleware.ts:12` handles
this route. Result: FALSE POSITIVE, removed."

**B) Fabrication self-check:** Re-verify every `file:line` reference.
Does the file exist? Does the cited line contain what the finding claims?
Remove any finding where the evidence doesn't hold up.

**Self-diagnostic ratios:**
- If >50% of findings removed in this phase → initial scan was too noisy. Note this.
- If >20% removed by fabrication check → agent was confabulating. Flag to user.

**CHECKPOINT:** "[N] findings remain after removing [M] false positives. Proceeding to ranking."

## Phase 3 — Rank & Rollup

Rank surviving findings by severity (see Shared Conventions above).

**Pattern rollup:** If 3+ findings share a root cause, group them:
"This is a systemic pattern, not [N] separate issues: [pattern description]."

**Out-of-scope findings:** Issues discovered outside the declared scope go
in a separate section — don't bury them, but don't let them dilute the audit.

**Anti-fix discipline:** Review your output for fix language. Rephrase any
recommendations as findings. Audits report — they don't fix.

## Phase 4 — Present

Use the Output Format template below. Include:
- Findings by severity with footgun MATCH/CLEAR
- "What I Didn't Examine" — areas within scope that were skipped
- Pattern rollup for systemic issues
- Out-of-scope findings (separate section)

**BLOCKING GATE:** Present final report. Offer:
(a) drill into a specific finding
(b) expand to a related area
(c) check a specific category more deeply
(d) close the audit

## Common Failure Modes

1. **Fix proposals** — agent recommends solutions instead of reporting findings. The anti-fix discipline check prevents this.
2. **Rubber-stamp self-check** — agent confirms its own findings without re-reading. The fabrication ratio threshold catches this.
3. **Gate fatigue** — user says "proceed" at every checkpoint without reading. Collapsing intermediate gates to CHECKPOINTs helps.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST attempt to disprove each finding (negative verification)
- MUST NOT propose fixes — audit reports only
- MUST re-verify file:line references in self-check
- MUST group 3+ related findings as systemic patterns
- MUST separate out-of-scope findings from in-scope findings
- MUST NOT fabricate file paths or function names

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: what was examined, what was found, what matters most -->

## Findings

### MUST Fix (Blocking)
- **[title]** — `file:line` — [description]
  Footgun match: MATCH [entry] | CLEAR
  Evidence: OBSERVED | INFERRED (missing: [what direct evidence is needed])

### SHOULD Fix
- **[title]** — `file:line` — [description]

### MAY Fix (Optional)
- **[title]** — `file:line` — [description]

## What I Didn't Examine
<!-- List files/areas skipped and why -->

## Patterns
<!-- If 3+ findings share a root cause, group as systemic issue -->
```

## Chains With

- /goat-review — audit findings become a review checklist for specific changes
- /goat-security — audit reveals security concerns → deeper assessment
- /goat-debug — audit finds a specific bug → diagnosis needed

**Handoff shape:** `{scope, findings_by_severity, patterns, out_of_scope_findings}`
