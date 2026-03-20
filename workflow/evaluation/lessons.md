# Prompt: Create docs/lessons.md

Paste this into your coding agent to create the lessons learned file for the learning loop.

---

## The Prompt

```
Create docs/lessons.md for this project. This file captures behavioural
mistakes the agent makes - things it did wrong that should not be
repeated in future sessions. It's part of the learning loop (LOG step
of the execution loop).

Create with this format header and empty sections:

# Lessons Learned

## Entries
<!-- Format: YYYY-MM-DD | Category | Lesson | Evidence -->
<!-- Categories: fabrication, mode-drift, premature-fix, scope-creep, missed-read, other -->

## Patterns
<!-- Recurring themes extracted from entries above -->
<!-- Review entries monthly. When 3+ entries share a theme, extract the pattern here -->

Every entry added by the agent must include this flag at the start:
> [!WARNING] AI-GENERATED: UNVERIFIED
The human removes this flag after reviewing the entry. CI will fail
if this flag exists on the main branch.

The file starts EMPTY. Do NOT invent entries. Entries are added after
real mistakes occur during coding sessions. Example of a real entry:

2026-03-15 | missed-read | Assumed API contract without reading
frontend consumer. The endpoint expected { items: [] } but backend
returned { data: [] }. | src/api/items.ts:47, src/pages/Items.tsx:23

VERIFICATION:
- Verify docs/lessons.md exists
- Verify it has the Entries and Patterns sections with format comments
- Verify it contains NO fabricated entries
```
