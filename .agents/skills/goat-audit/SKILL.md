---
name: goat-audit
description: "Run a multi-pass quality audit on the codebase"
---
# GOAT Audit

## When to Use

Use for systematic repo review, before a release, or when a whole class of issues needs to be checked across docs, scripts, and prompts.

## Process

1. **Pass 1 - Scan:** log every plausible issue with file:line evidence.
2. **Pass 2 - Verify:** re-read each finding, remove false positives, strengthen evidence.
3. **Pass 3 - Rank:** group surviving issues by severity and blast radius.
4. **Pass 4 - Self-check:** ask "did I fabricate this?" and remove anything unsupported.

## Constraints

- MUST follow all 4 passes in order
- MUST provide file:line evidence for every surviving finding
- MUST include a fabrication self-check in Pass 4
- MUST report how many findings were removed in each pass
- MUST NOT report findings without file:line evidence
- MUST NOT skip the self-check pass
- MUST NOT propose fixes (audit reports, it does not fix)

## Output

```md
## Audit Results

### Summary
- Pass 1: [N] potential findings
- Pass 2: [N] after false positive removal (-[N] removed)
- Pass 3: [N] ranked findings
- Pass 4: [N] after self-check (-[N] fabrication removed)

### Critical
- **[title]** - [file:line] - [evidence]

### High
- **[title]** - [file:line] - [evidence]

### Medium
- **[title]** - [file:line] - [evidence]

### Low
- **[title]** - [file:line] - [evidence]
```
