# Step 03 — Install Skills

Install the 6 goat-flow skills (5 functional + 1 dispatcher) in the agent's skills directory.

## Pre-existing skills

If non-goat-prefixed skills exist (e.g., audit/, review/, preflight/), IGNORE them — they are the project's custom skills. Do not modify, delete, or merge them.

## Skills to install

Read the detailed templates in `workflow/skills/goat-*.md` before creating. Create or update these 6 skills in the agent's skills directory (see agent config file for path):

1. **goat-debug/SKILL.md** — Diagnosis-first debugging. Hypothesis tracking, recurrence checks. Includes investigate and onboard modes.
2. **goat-review/SKILL.md** — Structured code review + quality audit + simplify mode. RFC 2119 severity, footgun matching.
3. **goat-security/SKILL.md** — Threat-model-driven security assessment. Exploitability ranking, dependency auditing.
4. **goat-plan/SKILL.md** — Planning with SBAO (multi-perspective sub-agent critique) and Mob Elaboration. Kill criteria, milestone archetypes. Includes refactor planning mode.
5. **goat-test/SKILL.md** — 3-phase test plan generation. Doer-verifier principle.
6. **goat/SKILL.md** — Dispatcher. Routes natural language to the right skill. Required — scanner checks for it (check 2.1.20).

## Requirements for each skill

Each SKILL.md MUST include:
- `goat-flow-skill-version:` in YAML frontmatter matching the current goat-flow version
- Sections: When to Use, Step 0 / Gather Context, Process with phased steps, Constraints, Output Format, Chaining

**IMPORTANT: Install skills VERBATIM from the templates. Do NOT adapt, compress, rewrite, or remove any sections.** Skills are the same for every project — project-specific context comes from the instruction file, `.goat-flow/footguns/`, `.goat-flow/lessons/`, and any optional local instruction files the project already has. Cutting or rewriting skill content causes more damage than generic examples ever will.

## Skill conventions

Install `.goat-flow/skill-conventions.md` from `workflow/skills/reference/skill-conventions.md`. This is the shared preamble that all skills reference for evidence format, confidence markers, and learning loop triggers.

## Version check

After installing, verify each SKILL.md frontmatter has the correct `goat-flow-skill-version`. Check the expected version in `workflow/skills/goat-debug.md` line 4. Mismatched versions will cause the scanner to flag them.

---

**Verification gate:**
- [ ] All 6 skill files exist in the agent's skills directory
- [ ] goat/SKILL.md (dispatcher) exists
- [ ] All 6 skills have matching `goat-flow-skill-version` tags
- [ ] `.goat-flow/skill-conventions.md` exists
- [ ] Instruction file router table references the skills directory

**Progress marker:** Append one line to the shared setup session log:
- `Step 03 complete: 6 skills installed`

NEXT: proceed to `04-architecture-code-map.md`
