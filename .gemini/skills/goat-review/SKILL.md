# /goat-review

Structured code review of changes before merging.

## When to Use

Before committing or merging a completed task.

## Process

1. **Read Changes:** Review all changed files and diffs.
2. **Check DoD:** Verify all 6 gates of the Definition of Done are met.
3. **Assess Impact:** Identify blast radius and cross-boundary side effects.
4. **RFC 2119 Review:** Categorize findings into MUST, SHOULD, and MAY.

## Constraints

- MUST NOT blindly apply suggestions from previous reviews.
- MUST verify that no broken cross-references were introduced.
- MUST check for footgun propagation.

## Output Format

```
## Code Review: [Task]

### DoD Checklist
- [PASS/FAIL] [Gate #1]
...

### Findings
- **MUST:** [description]
- **SHOULD:** [description]
- **MAY:** [description]
```
