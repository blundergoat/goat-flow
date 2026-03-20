# Lessons

Behavioural mistakes made by the agent during this project. Each entry describes what went wrong and how to avoid repeating it.

## Entries

### Agents resolve contradictions by following whichever source they read first
**What happened:** system-spec.md showed the old 5-step execution loop while execution-loop.md had the updated 6-step version with SCOPE. The setup prompt says "Read docs/system-spec.md" first. Both rampart and sus-form-detector agents absorbed the spec's loop and either didn't notice or couldn't override execution-loop.md. 7 of 8 gaps in sus-form-detector traced to this single contradiction.

**Prevention:** When updating any concept that appears in multiple files, update the file agents read FIRST (system-spec.md) before or at the same time as the authoritative source. Never assume agents will reconcile contradictions — they follow the first version they encounter.

**created_at:** 2026-03-20

### Agents under line pressure cut "small but required" sections
**What happened:** Both rampart and sus-form-detector agents dropped Sub-Agent Objectives (f) and Communication When Blocked (g) when compressing CLAUDE.md toward the line target. The instructions said "Do NOT skip sections (f)-(i)" but only in Prompt B — Prompt A (used for new projects) didn't have this warning.

**Prevention:** Every constraint that agents are likely to cut under pressure must appear in BOTH the template (execution-loop.md) AND the prompt that invokes it (Prompt A in setup-claude.md). A rule in only one place is a rule that gets missed.

**created_at:** 2026-03-20

## Patterns

_(Promote here when 3+ entries share a theme.)_
