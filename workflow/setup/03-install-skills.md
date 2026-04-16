# Step 03 - Install Skills

Install the 7 goat-flow skills (6 functional + 1 dispatcher) in the agent's skills directory.

## Pre-existing skills

If non-goat-prefixed skills exist (e.g., audit/, review/, preflight/), IGNORE them - they are the project's custom skills. Do not modify, delete, or merge them.

## Skills to install

Read the detailed templates in `workflow/skills/` (each skill is a directory containing `SKILL.md`, e.g., `goat/SKILL.md`, `goat-debug/SKILL.md`) before creating. Create or update these 7 skills in the agent's skills directory (see agent config file for path):

1. **goat-debug/SKILL.md** - Diagnosis-first debugging. Hypothesis tracking, recurrence checks. Includes investigate mode for code exploration.
2. **goat-review/SKILL.md** - Structured code review + quality audit. RFC 2119 severity, negative verification, footgun matching.
3. **goat-security/SKILL.md** - Threat-model-driven security assessment. Exploitability ranking, dependency auditing.
4. **goat-plan/SKILL.md** - Milestone task file generator and manager. Creates structured milestone files with testing gates and assumption tracking.
5. **goat-sbao/SKILL.md** - Multi-perspective critique using sub-agent orchestration. 3 agents (risk, alternatives, fresh eyes), 5 phases, cross-examination, and synthesis.
6. **goat-test/SKILL.md** - Testing gap analyser. Compares code changes against testing coverage to find undertested risks and misaligned test effort.
7. **goat/SKILL.md** - Dispatcher. Routes natural language to the right skill. Required - audit checks for it (audit check: agent-skills).

## Requirements for each skill

Each SKILL.md MUST include:
- `goat-flow-skill-version:` in YAML frontmatter matching the current goat-flow version
- Sections: When to Use, Step 0 / Gather Context, Process with phased steps, Constraints, Output Format

**Exception:** The dispatcher (`goat/SKILL.md`) uses `How It Works` instead of `When to Use` and has no Output Format section. The validator accepts this.

**IMPORTANT: Install skills VERBATIM from the templates. Do NOT adapt, compress, rewrite, or remove any sections.** Skills are the same for every project - project-specific context comes from the instruction file, `.goat-flow/footguns/`, `.goat-flow/lessons/`, and any optional local instruction files the project already has. Cutting or rewriting skill content causes more damage than generic examples ever will.

## Skill conventions

Install both convention files from `workflow/skills/reference/`:
- `.goat-flow/skill-preamble.md` from `workflow/skills/reference/skill-preamble.md` - essential preamble read on every skill invocation
- `.goat-flow/skill-conventions.md` from `workflow/skills/reference/skill-conventions.md` - full conventions reference read only on full-depth invocations

## Clean stale cross-agent skills

After installing canonical skills for the current agent, check other agents' skill directories for stale goat-flow skill names. For Claude: check `.agents/skills/`. For Codex: check `.claude/skills/`, `.agents/skills/`. For Gemini: check `.claude/skills/`. Do NOT check the current agent's own skill directory here — that was handled during installation above. Stale names to look for:

`goat-audit`, `goat-investigate`, `goat-onboard`, `goat-reflect`, `goat-resume`, `goat-preflight`, `goat-research`, `goat-simplify`, `goat-refactor`, `goat-context`

Delete any stale directories found. Then check the corresponding agent instruction file (`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`) for references to deleted skills - remove or update those references.

Do NOT delete non-goat-prefixed skills (e.g., `audit/`, `review/`, `migration-debug/`) - those are the project's custom skills.

## Version check

After installing, verify each SKILL.md frontmatter has the correct `goat-flow-skill-version` key. Compare against the version in any `workflow/skills/` template frontmatter. Mismatched versions will cause the auditor to flag them.

---

**Verification gate:**
- [ ] All 7 skill files exist in the agent's skills directory
- [ ] goat/SKILL.md (dispatcher) exists
- [ ] All 7 skills have matching `goat-flow-skill-version` tags
- [ ] `.goat-flow/skill-preamble.md` exists
- [ ] `.goat-flow/skill-conventions.md` exists
- [ ] Instruction file router table references the skills directory

**Progress marker:** Append one line to the shared setup session log:
- `Step 03 complete: 7 skills installed`

NEXT: proceed to `04-architecture-code-map.md`
