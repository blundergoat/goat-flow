# Step 03 - Install Skills

Install the 7 goat-flow skills (6 functional + 1 dispatcher) in the agent's skills directory.

## Pre-existing skills

If non-goat-prefixed skills exist (e.g., audit/, review/, preflight/), IGNORE them - they are the project's custom skills. Do not modify, delete, or merge them.

## Skills to install

Read the detailed templates in `workflow/skills/` (each skill is a directory containing `SKILL.md` and, for some skills, a nested `references/` subdir) before creating. Create or update these 7 skills in the agent's skills directory (see agent config file for path):

1. **goat-debug/SKILL.md** - Diagnosis-first debugging. Hypothesis tracking, recurrence checks. Includes investigate mode for code exploration.
2. **goat-review/SKILL.md** - Structured code review + quality audit. RFC 2119 severity, negative verification, footgun matching.
3. **goat-security/SKILL.md** - Threat-model-driven security assessment. Exploitability ranking, dependency auditing.
4. **goat-plan/SKILL.md** - Milestone planner and manager. Routes to inline or file-write mode based on scope and signals: inline for hotfix/small features, file-write for Standard+ scope.
5. **goat-critique/SKILL.md** - Multi-perspective critique using sub-agent orchestration. 3 agents (risk, alternatives, fresh eyes), 5 phases, cross-examination, and synthesis.
6. **goat-qa/SKILL.md** - Testing gap analyser. Compares code changes against testing coverage to find undertested risks and misaligned test effort.
7. **goat/SKILL.md** - Dispatcher. Routes natural language to the right skill. Required - audit checks for it (audit check: agent-skills).

## Requirements for each skill

Each SKILL.md MUST include:
- `goat-flow-skill-version:` in YAML frontmatter matching the current goat-flow version
- Sections: When to Use, Step 0 / Gather Context, Process with phased steps, Constraints, Output Format

**Exception:** The dispatcher (`goat/SKILL.md`) uses `How It Works` instead of `When to Use` and has no Output Format section. The validator accepts this.

**IMPORTANT: Install skills VERBATIM from the templates. Do NOT adapt, compress, rewrite, or remove any sections.** Copy `SKILL.md` plus any `references/*.md` files listed under that skill. Skills are the same for every project - project-specific context comes from the instruction file, `.goat-flow/footguns/`, `.goat-flow/lessons/`, and any optional local instruction files the project already has. Cutting or rewriting skill content causes more damage than generic examples ever will.

## Shared meta references

Install the meta references from `workflow/skills/reference/`:
- `.goat-flow/skill-reference/README.md` from `workflow/skills/reference/README.md` - meta references index
- `.goat-flow/skill-reference/skill-preamble.md` from `workflow/skills/reference/skill-preamble.md` - essential preamble read on every skill invocation
- `.goat-flow/skill-reference/skill-conventions.md` from `workflow/skills/reference/skill-conventions.md` - full conventions reference read only on full-depth invocations

## Standalone playbooks

Install the playbook pack from `workflow/skills/playbooks/`:
- `.goat-flow/skill-playbooks/README.md` from `workflow/skills/playbooks/README.md` - index for tool/capability playbooks and availability-check discipline
- `.goat-flow/skill-playbooks/browser-use.md` from `workflow/skills/playbooks/browser-use.md` - browser evidence capture reference used when tasks involve URLs, local HTML, screenshots, localhost pages, or rendered UI
- `.goat-flow/skill-playbooks/page-capture.md` from `workflow/skills/playbooks/page-capture.md` - batch page capture reference for multi-page browser evidence workflows
- `.goat-flow/skill-playbooks/skill-quality-testing.md` from `workflow/skills/playbooks/skill-quality-testing.md` - short index for skill authoring and hardening
- `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md` from `workflow/skills/playbooks/skill-quality-testing/tdd-iteration.md` - RED/GREEN/REFACTOR and pressure-test methodology
- `.goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md` from `workflow/skills/playbooks/skill-quality-testing/adversarial-framing.md` - review-class skill hardening patterns
- `.goat-flow/skill-playbooks/skill-quality-testing/deployment.md` from `workflow/skills/playbooks/skill-quality-testing/deployment.md` - deployment checklist and reference-pack budget rules

## Gitignore exception check (load-bearing for git tracking)

The playbook files are copied to disk by the installer, but `.goat-flow/.gitignore` ignores everything (`*`) by default and re-includes committed surfaces with `!` exceptions. Pre-1.6.1 installs are missing the `!skill-playbooks/` and `!skill-playbooks/**` exception lines, so the playbook pack is silently hidden from git even though the files exist locally.

Verify the parent gitignore is current after running the installer:

```bash
grep -E '^!skill-playbooks/(\*\*)?$' .goat-flow/.gitignore
grep -E '^!skill-reference/(\*\*)?$' .goat-flow/.gitignore
```

Both greps must return matches. If either is missing, the installer either did not run or was an older version. Re-run `npx @blundergoat/goat-flow@latest install . --agent <id>` (it always overwrites `.goat-flow/.gitignore`), then `git add .goat-flow/skill-playbooks/ .goat-flow/skill-reference/` to track files that were previously hidden. The `goat-flow-gitignore` audit check enforces this.

## Clean stale cross-agent skills

After installing canonical skills for the current agent, check other agents' skill directories for stale goat-flow skill names. For Claude: check `.agents/skills/`, `.github/skills/`. For Codex: check `.claude/skills/`, `.github/skills/`. For Gemini: check `.claude/skills/`, `.github/skills/`. For Copilot: check `.claude/skills/`, `.agents/skills/`. Do NOT check the current agent's own skill directory here - that was handled during installation above. Stale names to look for (manifest `skills.stale_names`):

`goat-audit`, `goat-investigate`, `goat-onboard`, `goat-reflect`, `goat-resume`, `goat-preflight`, `goat-research`, `goat-simplify`, `goat-refactor`, `goat-context`, `goat-sbao`, `goat-test`

Delete any stale directories found. Then check the corresponding agent instruction file (`AGENTS.md`, `GEMINI.md`, `CLAUDE.md`) for references to deleted skills - remove or update those references.

Do NOT delete non-goat-prefixed skills (e.g., `audit/`, `review/`, `migration-debug/`) - those are the project's custom skills.

## Version check

After installing, verify each SKILL.md frontmatter has the correct `goat-flow-skill-version` key. Compare against the version in any `workflow/skills/` template frontmatter. Mismatched versions will cause the auditor to flag them.

---

**Verification gate:**
- [ ] All 7 skill files exist in the agent's skills directory
- [ ] goat/SKILL.md (dispatcher) exists
- [ ] All 7 skills have matching `goat-flow-skill-version` tags
- [ ] `.goat-flow/skill-reference/README.md` exists
- [ ] `.goat-flow/skill-reference/skill-preamble.md` exists
- [ ] `.goat-flow/skill-reference/skill-conventions.md` exists
- [ ] `.goat-flow/skill-playbooks/README.md` exists
- [ ] `.goat-flow/skill-playbooks/browser-use.md` exists
- [ ] `.goat-flow/skill-playbooks/page-capture.md` exists
- [ ] `.goat-flow/skill-playbooks/skill-quality-testing.md` exists
- [ ] `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md` exists
- [ ] `.goat-flow/skill-playbooks/skill-quality-testing/adversarial-framing.md` exists
- [ ] `.goat-flow/skill-playbooks/skill-quality-testing/deployment.md` exists
- [ ] `.goat-flow/.gitignore` contains `!skill-playbooks/` and `!skill-playbooks/**` un-ignore entries
- [ ] `.goat-flow/.gitignore` contains `!skill-reference/` and `!skill-reference/**` un-ignore entries
- [ ] Instruction file router table references the skills directory

**Progress marker:** Append one line to the shared setup session log:
- `Step 03 complete: 7 skills installed`

NEXT: proceed to `04-architecture-code-map.md`
