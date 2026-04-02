---
name: Setup creates parallel surfaces instead of migrating existing ones
status: open
created: 2026-04-03
evidence_type: ACTUAL_MEASURED
---

When a project already has learning-loop artifacts, setup creates NEW parallel surfaces instead of using the existing ones:

- `tasks/` AND `.goat-flow/tasks/` both created
- `docs/footguns.md` (flat) AND `docs/footguns/` (directory) AND `.goat-flow/footguns/` all created
- `docs/lessons.md` AND `ai/lessons/` AND `.goat-flow/lessons/` all created
- `agent-evals/` AND `ai/evals/` both created
- `ai/instructions/` AND `ai/coding-standards/` both created with overlapping content

**Evidence:** Found by Codex on ambient-scribe (4 duplicate surfaces), blundergoat-platform (context-validate.sh:105 requires BOTH old and new), healthkit (contradictory paths in CLAUDE.md vs config.yaml vs skills).

**Impact:** Agents receive contradictory instructions about where to write lessons, footguns, and evals. The same information ends up in multiple places and drifts. Users can't tell which is canonical.

**Fix:** M19 in `.goat-flow/tasks/0.10.0/M19-setup-reliability.md`. Setup must detect existing artifact locations and use them, not create parallel ones.
