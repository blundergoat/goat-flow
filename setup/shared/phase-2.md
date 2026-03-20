# Phase 2

**Implement immediately after Phase 1.** Do not defer. When asked to set up
GOAT Flow, complete Phase 1 AND Phase 2 in the same session.

Projects with short git history will have fewer real incidents for evals —
that's fine. Seed with stack failure modes and replace with real incidents
as they occur.

These items apply to both Claude Code and Codex.

---

```
Read the system spec and the current instruction file.
Work through this list in order.

AGENT EVAL SUITE:
1. Create agent-evals/ (or codex-evals/) directory for regression testing.
   Add a README.md explaining what evals are and how to use them.

   Search this codebase's git history and issues for real incidents.
   For each, create [incident-name].md (flat files, not subdirectories):
   - Bug description
   - Single replay prompt
   - Expected outcome
   - Known failure mode tested

   If fewer than 5 qualifying incidents, create as many as exist.
   For projects with no history: create 1-2 from common stack failure
   modes. Replace with real incidents as they occur.

RFC 2119 PASS:
2. Apply MUST/SHOULD/MAY to every rule in the instruction file.
   - MUST: execution loop steps, autonomy tiers, definition of done
   - SHOULD: log hygiene, working memory, session handoffs, footgun propagation
   - MAY: structural debt trigger, communication when blocked
   Compress prose in the SAME pass. Instruction file MUST stay under target.

PER-ROLE PERMISSION PROFILES:
3. Create on first use - materialise when the first real role separation
   need occurs.
   For Claude Code: .claude/profiles/ with JSON files.
   For Codex: document roles in AGENTS.md (no native profile support).
   Each profile restricts Edit and Bash permissions. Always Read: **.

CI VALIDATION:
4. If not created in Phase 1c, create context-validation.yml:
   - Instruction file line count (warn if >target, error if >150)
   - Router table file references exist
   - Skills/playbook directories have expected files
   - Local instruction files under 20 lines

VERIFICATION:
- Count instruction file lines. MUST stay under target after RFC 2119 pass.
- Verify permission profile files are valid (if created).
- Run preflight.
- Report instruction file line count.
```
