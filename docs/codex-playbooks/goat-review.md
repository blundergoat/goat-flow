# GOAT Review

## When to Use

Use before merging meaningful changes, after external review comments, or whenever you want an independent read-only assessment.

## Process

1. Identify the changed files and intended outcome.
2. Read the changed files in context plus related footguns and setup docs.
3. Check correctness, cross-reference integrity, test/validation coverage, and autonomy-tier violations.
4. If reviewing external comments, investigate each independently before agreeing.

Constraints:
- MUST review the change in full context, not just the diff
- MUST provide file:line evidence for every finding
- MUST use RFC 2119 severity: MUST / SHOULD / MAY
- MUST check the Definition of Done gates
- MUST NOT apply fixes directly

## Output

```md
## Code Review: [change]

### MUST Fix
- **[title]** - [file:line] - [why this blocks merge]

### SHOULD Fix
- **[title]** - [file:line] - [why this matters]

### MAY Improve
- **[title]** - [file:line] - [optional improvement]

### What's Good
- [specific positive observation]

### Definition of Done Check
- [ ] Preflight passes
- [ ] Context validation passes
- [ ] No unapproved boundary changes
- [ ] Learning loop updated if applicable
- [ ] Post-rename grep clean if applicable
```
