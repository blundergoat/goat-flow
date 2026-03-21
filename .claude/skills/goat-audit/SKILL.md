---
description: "Run a multi-pass quality audit on the codebase"
---
# /goat-audit

Multi-pass codebase quality review. More thorough than a normal review — a systematic audit.

---

## Step 0 — Gather Context

Ask the user before auditing:

1. **What's the scope?** (whole repo, specific directory, specific concern like "security" or "cross-references")
2. **Why now?** (pre-release, investigating a class of issues, routine quality check)
3. **Any areas to focus on?** (or "cast a wide net")
4. **Any known issues to skip?** (so the audit doesn't flag things already being tracked)

Do NOT start scanning until the user has answered. An unscoped audit wastes passes on irrelevant areas.

---

## Pass 1 — Scan

Read target files/directories systematically. Log every potential finding with file:line evidence. Cast a wide net — include anything that might be an issue.

Categories: consistency, cross-reference integrity, evidence quality, completeness, shell script correctness, security, test coverage gaps, architectural concerns.

Report: "Pass 1 complete. Found [N] potential findings. Starting verification."

---

## Pass 2 — Verify

Re-read each finding from Pass 1 against the actual files:
- Remove false positives (findings that don't hold up on second look)
- Remove duplicates
- Strengthen evidence for remaining findings

Report: "Pass 2 complete. [N] findings remain after removing [N] false positives."

---

## Pass 3 — Rank

Rank surviving findings:
- **Critical** — data loss, security vulnerability, broken functionality
- **High** — bugs, missing enforcement, broken cross-references
- **Medium** — inconsistencies, stale docs, missing tests
- **Low** — style issues, minor improvements, cosmetic

Group related findings.

---

## Pass 4 — Self-check

For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where evidence doesn't hold up
- Flag findings where confidence is low

Report: "Pass 4 complete. [N] findings remain after removing [N] in self-check."

---

## Present Results

Present the full audit to the user. Ask: "Any of these you want me to dig deeper on? Any that look like false positives?"

Do NOT propose fixes. The audit reports — it does not fix.

---

## Constraints

- MUST gather context before scanning (Step 0)
- MUST complete all 4 passes in order
- MUST provide file:line evidence for every finding
- MUST include Pass 4 self-check — this catches fabrication
- MUST report how many findings were removed in each pass
- MUST NOT report findings without file:line evidence
- MUST NOT skip the self-check pass
- MUST NOT propose fixes (audit reports, it does not fix)

## Output Format

```
## Audit Results

### Summary
- Pass 1: [N] potential findings
- Pass 2: [N] after false positive removal (-[N] removed)
- Pass 3: [N] ranked findings
- Pass 4: [N] after self-check (-[N] fabrication removed)

### Critical
- **[title]** - [file:line] - [description + evidence]

### High
- **[title]** - [file:line] - [description + evidence]

### Medium
- **[title]** - [file:line] - [description + evidence]

### Low
- **[title]** - [file:line] - [description + evidence]
```
