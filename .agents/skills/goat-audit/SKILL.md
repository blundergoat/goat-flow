---
name: goat-audit
description: "Run a multi-pass quality audit on the codebase"
---
# /goat-audit

## When to Use

Use when running a quality audit on the codebase: systematic codebase quality review, before major releases, or when investigating a class of issues across the codebase. More thorough than a normal review — a systematic audit.

---

## Step 0 — Gather Context

Ask the user before auditing:

1. **What's the scope?** (whole repo, specific directory, specific concern like "security" or "cross-references")
2. **Why now?** (pre-release, investigating a class of issues, routine quality check)
3. **Any areas to focus on?** (or "cast a wide net")
4. **Any known issues to skip?** (so the audit doesn't flag things already being tracked)
5. **What's the purpose?** (security audit, pre-release quality gate, consistency check, etc. — this drives category weighting in Pass 1)
6. **Any known false positives to skip?** Check `docs/audit-allowlist.md` if it exists.

Do NOT start scanning until the user has answered. An unscoped audit wastes passes on irrelevant areas.

---

## Pass 0 — Scope Declaration

Before scanning, declare in writing:

- **Target directories/files:** (list exactly what will be scanned)
- **Out-of-scope areas:** (what will NOT be scanned)
- **Expected file count:** (approximate number of files in scope)

If >15 files in scope, ask the user to narrow before proceeding.

**HUMAN GATE:** "Here's the declared scope. Want me to (a) adjust the scope, (b) proceed to scanning?"

---

## Pass 1 — Scan

Read target files/directories systematically. Log every potential finding with file:line evidence. Cast a wide net — include anything that might be an issue.

**Scope-adaptive categories** — Weight categories based on the stated purpose. A security-focused audit weights security findings higher than style issues. A consistency audit weights cross-reference integrity higher than performance.

Categories (ordered by default severity): security, correctness, cross-reference integrity, performance, consistency, evidence quality, completeness, shell script correctness, test coverage gaps, architectural concerns, style.

**Scope discipline:** Issues found outside the declared scope go to a separate "Out of Scope" section. Do not mix them with in-scope findings.

Report: "Pass 1 complete. Found [N] potential findings ([M] out-of-scope). Starting verification."

**HUMAN GATE:** "Want me to (a) re-examine specific areas, (b) expand the audit scope, (c) narrow the scope, (d) proceed to verification?"

---

## Pass 2 — Verify

Re-read each finding from Pass 1 against the actual files:
- Remove false positives (findings that don't hold up on second look)
- Remove duplicates
- Strengthen evidence for remaining findings

**Negative verification:** For each finding, attempt to DISPROVE it. Ask: "Can I prove this is wrong?" Actively look for evidence that contradicts each finding. A finding that survives disproof is stronger than one that was never challenged.

Report: "Pass 2 complete. [N] findings remain after removing [N] false positives."

**HUMAN GATE:** "Want me to (a) re-examine specific findings, (b) expand the audit scope, (c) narrow the scope, (d) proceed to ranking?"

---

## Pass 3 — Rank

Use severity scale: **SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE**

Rank surviving findings:
- **Critical** — data loss, security vulnerability, broken functionality
- **High** — bugs, missing enforcement, broken cross-references
- **Medium** — inconsistencies, stale docs, missing tests
- **Low** — style issues, minor improvements, cosmetic

Group related findings.

**HUMAN GATE:** "Want me to (a) re-examine specific findings, (b) expand the audit scope, (c) narrow the scope, (d) proceed to self-check?"

---

## Pass 4 — Self-check

For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where evidence doesn't hold up
- Flag findings where confidence is low

Report: "Pass 4 complete. [N] findings remain after removing [N] in self-check."

---

## Pass 5 — Pattern Rollup

After individual findings are verified, summarize systemic patterns across the codebase. If the same class of issue appears 3+ times, roll it up:

- "Found [N] instances of [pattern] — this is a systemic pattern, not [N] separate issues."
- List the individual instances as sub-items under the pattern.
- Recommend addressing the pattern at its root rather than fixing instances one by one.

---

## Present Results

Present the full audit to the user. Ask: "Want me to dig deeper on any of these? Any that look like false positives?"

**HUMAN GATE:** "Want me to (a) re-examine specific findings, (b) expand the audit scope, (c) narrow the scope, (d) wrap up the audit?"

Do NOT auto-advance. Let the human ask follow-up questions, challenge findings, or redirect focus.

Do NOT propose fixes. The audit reports — it does not fix.

---

## Constraints

- MUST gather context before scanning (Step 0)
- MUST declare scope before scanning (Pass 0)
- MUST complete all passes in order
- MUST provide file:line evidence for every finding
- MUST include Pass 4 self-check — this catches fabrication
- MUST report how many findings were removed in each pass
- MUST keep out-of-scope findings separate from in-scope findings
- MUST NOT report findings without file:line evidence
- MUST NOT skip the self-check pass
- MUST NOT propose fixes (audit reports, it does not fix)

---

## Output Format

```
## Audit Results

### Scope
- Target: [directories/files]
- Out-of-scope: [areas excluded]
- Purpose: [stated purpose — drives category weighting]

### Summary
- Pass 1: [N] potential findings ([M] out-of-scope)
- Pass 2: [N] after false positive removal (-[N] removed)
- Pass 3: [N] ranked findings
- Pass 4: [N] after self-check (-[N] fabrication removed)

### Systemic Patterns
- **[pattern name]** — [N] instances — [root cause summary]
  - [file:line] — [instance description]
  - [file:line] — [instance description]

### Critical
- **[title]** - [file:line] - [description + evidence]

### High
- **[title]** - [file:line] - [description + evidence]

### Medium
- **[title]** - [file:line] - [description + evidence]

### Low
- **[title]** - [file:line] - [description + evidence]

### Out of Scope (noted for future audit)
- **[title]** - [file:line] - [description]
```

---

## Learning Loop

If this audit run uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake -> `docs/lessons.md`
- Architectural trap with file:line evidence -> `docs/footguns.md`

---

## Chains With

- **goat-review** — audit findings become a review checklist
- **goat-security** — security-specific audit pass
