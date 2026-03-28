# ADR-007: Consolidate skills from 10 to 8

**Date:** 2026-03-28
**Status:** Accepted

## Context

v0.6.0 shipped 10 skills. Five of these struggled to pass the justification test ("distinct artifact, hard workflow gate, special failure mode, or repeatable structured output"):

- **goat-reflect** produced lessons.md and footguns.md entries — the same artifacts goat-review already produces during its audit and instruction-review modes. No distinct artifact.
- **goat-onboard** produced an orientation document — but goat-investigate already reads architecture, footguns, and router tables. Adding an "onboard mode" to investigate avoids a separate skill for what is essentially a scoped investigation.
- **goat-audit** ran multi-pass quality sweeps — but goat-review's diff-aware analysis with negative verification already covers quality auditing. The distinction between "review a PR" and "audit a codebase area" is a mode switch, not a separate workflow.
- **goat-context** (renamed from goat-resume) reconstructed session state from handoff files — but modern agents (Claude Code, Codex) handle context resumption natively. The skill added no value beyond what `/compact` and `tasks/handoff.md` already provide.

Meanwhile, two capabilities were missing:
- Cross-file refactoring with blast radius analysis (renames that span 10+ files are a top footgun across all 9 projects)
- Code readability improvement without behaviour change (frequently requested but agents default to "add comments" without a structured approach)

Setup across 9 projects consistently showed: agents created goat-reflect/onboard/audit as thin wrappers that duplicated content from their parent skills. The 10-skill set inflated the instruction budget without proportional value.

## Decision

Merge 4 skills into existing skills as modes. Add 2 new skills that pass the justification test.

**Merges:**
- goat-reflect → goat-review (Instruction Review Mode): reviews CLAUDE.md and skill files for staleness, friction signals
- goat-onboard → goat-investigate (Onboard Mode): systematic codebase mapping for new contributors or agents
- goat-audit → goat-review (Audit Mode): codebase-wide quality sweep with negative verification
- goat-context → removed entirely (native agent capability)

**Additions:**
- goat-refactor: both-sides-first reading, grep-after-every-rename, blast radius declaration. Distinct failure mode: stale references after renames (footgun in 7/9 projects).
- goat-simplify: read-assess-rank-propose-implement. Constraint: MUST NOT change behaviour. Distinct artifact: impact-ordered findings with before/after diffs.

**Canonical set:** goat-debug, goat-investigate, goat-plan, goat-refactor, goat-review, goat-security, goat-simplify, goat-test.

## Consequences

- Scanner SKILL_NAMES constant updated to 8; DEPRECATED_SKILL_NAMES array provides migration grace period
- Setup phase-1.md documents the merge mapping so agents know where old functionality lives
- docs/system/skills.md migration note explains the consolidation for users upgrading from v0.6.0
- All 3 agent skill directories (.claude/, .agents/, .github/) must maintain identical 8-skill set
- Rubric check 2.1.11 ("All 8 skills present") updated; recommendation text aligned
- Projects with old skills still installed will trigger AP14 (duplicate skills) or AP15 (outdated versions)
- Modes within goat-review and goat-investigate are triggered by the user's intent, not separate slash commands — this requires the skill to detect context (e.g., "review my instruction files" triggers Instruction Review Mode)
