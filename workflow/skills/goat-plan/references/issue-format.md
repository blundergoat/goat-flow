---
goat-flow-reference-version: "1.12.0"
---
# ISSUE.md Format

Write `ISSUE.md` in the task directory alongside milestone files. This is the stakeholder-facing summary - the thing pasted into a GitHub issue or PR description. Milestone files are the developer's execution plan; ISSUE.md is the case for the work.

## Structure

### Why (benefits)

Present tense. Each bullet names a benefit and explains why it matters. Lead with the outcome, not the implementation. Ground claims in evidence (scores, incident counts, user reports) when available.

```markdown
## Why

- **Benefit statement.** Evidence and reasoning for why this matters. What breaks or stays broken without this work.
- **Second benefit.** ...
```

Include an "Out of scope" list at the end of Why for deliberate exclusions that a reviewer might ask about.

### What (requirements)

Future tense. What needs to be delivered - not how. Each bullet is a testable requirement. A reviewer reading only this section should know what to verify in the diff.

```markdown
## What

- Dashboard login needs refresh-token rotation so signed-in users can continue work after access tokens expire
- Session storage needs atomic refresh-token replacement so concurrent requests cannot restore stale credentials
- Operational documentation needs to explain the supported rotation behaviour and rollback trigger
```

Do not duplicate file-level detail that the milestone files or diff already show. No past tense - this section reads as "here is what must ship" even if the work is already done (the Phase 4 revision flips tense to confirm delivery).

### How (developer task checklist)

Checkbox list. Ordered by execution sequence. Each item is an action a developer performs, not a description of what changed. Include verification steps (typecheck, grep, sync mirrors) as their own checkboxes - they are tasks too.

```markdown
## How

- [ ] Prove the OAuth provider returns a replacement refresh token
- [ ] Wire refresh-token replacement into the login session flow
- [ ] Add automated coverage for refresh success, stale-token rejection, and concurrent refresh attempts
- [ ] Run verification: `npm run typecheck`, focused auth tests, and a local browser refresh-session check
- [ ] Final pass: update milestone evidence, confirm cross-references, and prepare the human verification summary
```

### Out of scope (follow-ups)

Plain-text list, no checkboxes. Items deliberately excluded from this work that may become separate issues.

## Anti-patterns

- **ISSUE.md that duplicates milestones.** If a bullet in What names specific files, line numbers, or implementation steps, it belongs in a milestone, not here.
- **Past-tense What section.** What describes requirements, not history. Phase 4 revises the tense to confirm delivery.
- **How without verification steps.** Every How section should end with at least one verification checkbox.
- **Why that describes the implementation.** "Add E/R tables to three skills" is What, not Why. "Skills that ground their failure modes perform better" is Why.
