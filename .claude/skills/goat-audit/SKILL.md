# /goat-audit

Multi-pass codebase quality review. More thorough than a normal review — a systematic audit.

## When to Use

For systematic quality review, before major releases, before publishing documentation updates, or when investigating a class of issues across the repo.

## Process

### Pass 1 — Scan
- Read target files/directories systematically
- Log every potential finding with file:line evidence
- Cast a wide net — include anything that might be an issue
- Categories: consistency, cross-reference integrity, evidence quality, completeness, shell script correctness

### Pass 2 — Verify
- Re-read each finding from Pass 1 against the actual files
- Remove false positives (findings that don't hold up on second look)
- Remove duplicates
- Strengthen evidence for remaining findings

### Pass 3 — Rank
- Rank by severity: Critical / High / Medium / Low
- Rank by blast radius (how many files are affected)
- Group related findings

### Pass 4 — Self-check
- For each remaining finding, ask: "Did I fabricate this?"
- Re-verify file:line references are correct and current
- Remove any finding where evidence doesn't hold up
- Flag findings where confidence is low

## Constraints

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
