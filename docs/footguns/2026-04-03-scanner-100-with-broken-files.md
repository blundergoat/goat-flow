---
name: Scanner gives 100% while generated files are broken
status: open
created: 2026-04-03
evidence_type: ACTUAL_MEASURED
---

The scanner awards 100% (A grade) to projects that have:
- Broken `ai/README.md:3` (invalid content)
- `settings.json` missing hook registration that the rubric claims exists (`src/cli/facts/agent.ts:630`, `src/cli/rubric/standard.ts:292` check file existence only)
- Physically broken skill files (`.claude/skills/goat-plan/SKILL.md:182` — stale tail, `:198` — references deleted goat-investigate)
- Malformed eval frontmatter (duplicate YAML blocks)
- CI workflow containing literal scanner-bait comments (`.github/workflows/context-validation.yml:40`)

**Evidence:** Found by Codex on strands-php-client (100% score, broken ai/README.md), blundergoat-platform (100% score, broken goat-plan SKILL.md + unregistered hook), ambient-scribe (duplicate eval frontmatter).

**Impact:** The scanner rewards formatting compliance, not functional correctness. Users trust A/100 as "setup is good" when it means "setup matches regex patterns."

**Fix:** M18 in `.goat-flow/tasks/0.10.0/M18-scanner-ux.md`. Add semantic validation: verify hook registration, validate skill file content, parse eval frontmatter, check ai/README.md references resolve.
