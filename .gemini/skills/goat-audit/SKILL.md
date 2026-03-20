# /goat-audit

Systematic 4-pass codebase quality review.

## When to Use

Before major releases, after large refactors, or when investigating a class of issues.

## Process

1. **Pass 1 - Scan:** Systematic read of target area, logging all potential findings with file:line evidence.
2. **Pass 2 - Verify:** Re-read each finding from Pass 1 to eliminate false positives.
3. **Pass 3 - Rank:** Prioritize findings by severity (Critical / High / Medium / Low).
4. **Pass 4 - Self-Check:** Explicitly ask "Did I fabricate this?" and re-verify evidence.

## Constraints

- MUST NOT report findings without file:line evidence.
- MUST NOT skip the self-check pass (Pass 4).
- MUST NOT propose fixes during the audit.

## Output Format

```
## Audit Results

### Summary
- Pass 1: [N] findings
- Pass 4: [N] after self-check (-[N] removed)

### Findings (Ranked)
- **[Severity] [Title]** - [file:line] - [description]
```
