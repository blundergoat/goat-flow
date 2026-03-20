# AI Workflow Improvement Plan -- Implementation Prompts

**Implements:** `workflow/_reference/system-spec.md` (Prime edition, v1.5)

---

## Before You Start: Guidelines Ownership Audit

If your project has an `ai-agent-guidelines.instructions.md` file (or similar shared coding standards file), audit it FIRST. Remove any content that overlaps with what CLAUDE.md will own:

**Remove from guidelines (CLAUDE.md will own these):**

- Execution loop / workflow steps
- Definition of Done
- Stop-the-line rules
- Working memory / context management conventions
- Autonomy tiers or permission rules
- Log file references (lessons.md, footguns.md)

**Keep in guidelines (these stay):**

- Operating principles (correctness over cleverness, smallest change, etc.)
- Engineering best practices (API discipline, testing, type safety)
- Communication style (concise, one question, verification story)
- Error handling patterns (triage checklist, safe fallbacks, rollback)
- Task management templates
- Git hygiene

Do this manually before running any prompts. The prompts assume the split is already clean.

**No shared guidelines file?** If your project uses domain-specific `.github/instructions/` files instead of a single shared file, skip this audit. The domain files describe coding patterns per domain, not workflow rules -- they don't overlap with CLAUDE.md.

**Commit or stash first.** Prompt B overwrites CLAUDE.md and creates domain-reference.md. Run `git stash` or `git commit` before starting. If the output is wrong, `git checkout -- CLAUDE.md` restores the original.

---

## Phase 0 (New Project Bootstrap)

Use ONLY when setting up a brand new project with no existing CLAUDE.md or workflow config.

```
I'm setting up AI workflow configuration for this project. The stack is:
- Languages: [list your languages]
- Build: [your build command, or "none -- interpreted language"]
- Lint: [your lint command]
- Test: [your test command]
- Format: [your format command, or "none -- no formatter configured"]

Read workflow/_reference/system-spec.md. Generate the Minimal tier:
1. CLAUDE.md (under 120 lines) with the default execution loop, autonomy
   tiers, definition of done, and router table adapted to my project
2. .claude/hooks/deny-dangerous.sh (PreToolUse hook blocking dangerous commands)
3. .claude/settings.json with the deny-dangerous hook registered and
   permissions deny list for git commit and git push

Do NOT create skills, profiles, agent evals, or CI workflows yet.
After creating the files, count CLAUDE.md lines and report the count.
```

---

## Phase 1

Phase 1 is split into three prompts. Run them in order.

### Phase 1a -- Foundation

**Choose your starting point:**

- **No existing CLAUDE.md:** Use Prompt A below
- **Existing CLAUDE.md with domain content:** Use Prompt B below (moves domain content to a reference doc, then builds the workflow CLAUDE.md)

#### Prompt A -- New CLAUDE.md (no existing file)

```
Read workflow/_reference/system-spec.md. This is our AI workflow
improvement plan (Prime edition, v1.5). Phase 1 builds Layers 1-3
(runtime, local context, and skills).

This project is a [APP / LIBRARY / SCRIPT COLLECTION]. The stack is:
- Languages: [list]
- Build: [command, or "none -- interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none -- no formatter configured"]

Implement Phase 1a now.

CLAUDE.md (Layer 1 -- Runtime):
1. Create CLAUDE.md. Target: under [120 for apps / 100 for libraries] lines.
   Use bad/good examples not prose. Structure:

   a) Version header (v1.0 -- YYYY-MM-DD)

   b) Default Execution Loop: READ -> CLASSIFY -> ACT -> VERIFY -> LOG
      - READ: read relevant files first, never fabricate codebase facts
        (include bad/good example)
      - CLASSIFY: complexity and mode table. Include question vs directive
        disambiguation
      - ACT: behaviour per mode as a table. State declaration rule.
        Anti-planning-loop rule. Anti-BDUF guard with bad/good example
      - VERIFY: continuous test loop. Stop-the-line with two-level
        escalation. Revert-and-rescope tactic
      - LOG: docs/lessons.md, docs/footguns.md, and docs/confusion-log.md
        with when-to-use table. Footgun propagation rule.
        Context-based loading rules

   c) Autonomy Tiers: Always / Ask First / Never
      - Adapt Ask First boundaries for THIS project's specific risks
      - Include micro-checklist for Ask First items

   d) Definition of Done: 6 gates

   e) Working Memory: Working Notes for 5+ turn tasks, context escalation
      ladder, session handoff protocol

   f) Sub-Agent Objectives: one focused objective, structured return, 5-call budget

   g) Communication When Blocked: one question with recommended default

   h) Router table: pointers to skills, docs, playbooks, profiles

   i) Essential commands

   If over line target, apply cut priority from the plan.

DOCS (seed files):
2. docs/lessons.md -- Format header, empty Entries/Patterns sections
3. docs/footguns.md -- If the file already exists, MERGE with it: keep
   existing entries, add new footguns discovered from reading the codebase.
   If the file doesn't exist, create it and seed with real footguns only.
   Do NOT invent hypothetical ones. Do NOT replace existing entries.
4. docs/confusion-log.md -- Format header
5. tasks/handoff-template.md -- Status, Current State, Key Decisions,
   Known Risks, Next Step

ARCHITECTURE DOCS:
6. docs/architecture.md -- Read the codebase and write a short overview
   (under 100 lines): what the system does, major components, data flows,
   non-obvious constraints, deliberate trade-offs. Every line specific to
   THIS codebase. TODOs for what you can't determine from reading the code.

7. docs/decisions/ directory with ADR template.
   If you can identify 1-2 real architectural decisions from the code,
   create ADR files. Do NOT invent decisions.

OWNERSHIP SPLIT REPORT:
8. If a guidelines file was trimmed in the pre-audit step, create
   docs/guidelines-ownership-split.md documenting what was moved,
   what was removed, and why. This preserves migration rationale.

LOCAL CLAUDE.md FILES (Layer 2):
9. Read docs/footguns.md and the codebase structure. For directories with
   2+ footgun entries, Ask First boundaries, or conventions differing from
   project default: create a local CLAUDE.md (under 20 lines each).
   If no directories qualify, create none and note why.
   Skip directories already covered by .github/instructions/ files with
   applyTo scoping -- those serve the same auto-loading purpose.

VERIFICATION:
- Count CLAUDE.md lines. MUST be under target.
- Verify all docs seed files exist.
- Report CLAUDE.md line count and number of local CLAUDE.md files created.
```

#### Prompt B -- Existing CLAUDE.md (migrate domain content)

```
Read workflow/_reference/system-spec.md. This is our AI workflow
improvement plan (Prime edition, v1.5). Phase 1 builds Layers 1-3
(runtime, local context, and skills).

This project is a [APP / LIBRARY / SCRIPT COLLECTION]. The stack is:
- Languages: [list]
- Build: [command, or "none -- interpreted language"]
- Test: [command]
- Lint: [command]
- Format: [command, or "none -- no formatter configured"]

The current CLAUDE.md has domain reference content (architecture,
design patterns, important files, conventions). This needs to be
preserved but separated from the workflow system.

Implement Phase 1a now, in this order:

STEP 1 -- Move domain content:
1. Read the current CLAUDE.md completely.
2. Move ALL domain-specific reference content to docs/domain-reference.md.
   Keep it intact -- this is technical reference loaded on demand.
   Domain content includes: architecture overviews, design patterns,
   file tables, conventions, pipelines, matching strategies, dictionary
   workflows -- anything that describes HOW THE PROJECT WORKS rather than
   how the AGENT SHOULD BEHAVE.
3. Keep in CLAUDE.md: project identity (one line), essential commands,
   and any agent-behavioural rules that already exist.

STEP 2 -- Rewrite CLAUDE.md:
4. Rebuild CLAUDE.md with the execution loop. Target: under [120/100] lines.
   Use bad/good examples not prose.

   Include ALL of these sections (adapted for this project):

   a) Version header (v1.0 -- YYYY-MM-DD)
   b) Project identity (one line)
   c) Essential commands (compact)
   d) Default Execution Loop: READ -> CLASSIFY -> ACT -> VERIFY -> LOG
      - READ: read relevant files first, never fabricate codebase facts
        (include bad/good example adapted for this project)
      - CLASSIFY: complexity and mode table. Include question vs directive
        disambiguation
      - ACT: behaviour per mode as a table. State declaration rule.
        Anti-planning-loop rule. Anti-BDUF guard with bad/good example
      - VERIFY: continuous test loop. Stop-the-line with two-level
        escalation. Revert-and-rescope tactic
      - LOG: docs/lessons.md, docs/footguns.md, and docs/confusion-log.md
        with when-to-use table. Footgun propagation rule.
        Context-based loading rules
   e) Autonomy Tiers with project-specific Ask First boundaries
   f) Definition of Done: 6 gates
   g) Working Memory: Working Notes for 5+ turn tasks, context escalation
      ladder, session handoff protocol
   h) Sub-Agent Objectives: one focused objective, structured return,
      5-call budget
   i) Communication When Blocked: one question with recommended default
   j) Router table pointing to: docs/domain-reference.md, skills,
      and all other docs files
   k) Essential commands (if not already placed in section c)

   Do NOT skip sections (f)-(i) -- they are small but required.

STEP 3 -- Docs seed files:
5. docs/lessons.md -- Format header, empty
6. docs/footguns.md -- If the file already exists, MERGE with it: keep
   existing entries, add new footguns from reading the codebase.
   If the file doesn't exist, create and seed with real footguns only.
   Do NOT invent hypothetical ones. Do NOT replace existing entries.
7. docs/confusion-log.md
8. tasks/handoff-template.md

STEP 4 -- Ownership split report:
9. Create docs/guidelines-ownership-split.md documenting what was moved
   from the original CLAUDE.md, what was kept, and why. This preserves
   the migration rationale in a committed file.

STEP 5 -- Local CLAUDE.md files (Layer 2):
10. For qualifying directories only (2+ footguns, Ask First boundaries,
    differing conventions). Under 20 lines each. Create none if no
    directories qualify. Skip directories already covered by
    .github/instructions/ files with applyTo scoping.

VERIFICATION:
- Count CLAUDE.md lines. MUST be under target.
- Verify docs/domain-reference.md contains all moved content.
- Compare original CLAUDE.md against new CLAUDE.md + domain-reference.md
  to check nothing was silently dropped.
- Verify all docs seed files exist.
- Report CLAUDE.md line count, domain-reference.md line count, and
  number of local CLAUDE.md files created.
```

### Phase 1b -- Skills

```
Read workflow/_reference/system-spec.md and the CLAUDE.md created in
Phase 1a. This phase creates skill files (Layer 3).

This project is a [APP / LIBRARY / SCRIPT COLLECTION].

PRE-EXISTING SKILLS:
If skills already exist in .claude/skills/ (from a previous setup or
manual creation), do NOT delete them. Review each existing skill against
the requirements below. Update skills that are missing required sections
(RFC 2119 constraints, output templates, hard gates). Add new skills
that don't exist yet. This is update-and-extend, not replace.

Create these 5 skills under .claude/skills/:

1. preflight/SKILL.md -- RFC 2119 constraints. MUST run your stack's
   build/lint checks. SHOULD run formatter, full test suite. MAY skip
   formatter when debugging. Include dependency audit.
2. research/SKILL.md -- Minimum template: Files Involved, Request Flow,
   Boundaries Touched, Risks/Gotchas (min 3 with file:line evidence).
   Hard gate: no planning until human reviews research.md.
3. debug-investigate/SKILL.md -- Diagnosis-first. Include: "If you want
   to 'just try something' before tracing the code path, STOP."
   Include diagnosis output template.
4. audit/SKILL.md -- 4-pass: Discovery -> Verification -> Prioritisation ->
   Self-Check. Pass 4 fabrication gate. MUST NOT propose fixes.
5. code-review/SKILL.md -- Structured review with RFC 2119 constraints.
   Do NOT name this skill "review" -- it shadows Claude Code's
   built-in /review command. Always use "code-review".

VERIFICATION:
- Verify all skill files exist with required sections.
- Verify CLAUDE.md router table references the skill directories.
  Update the router table if needed.
- Run preflight checks.
```

### Phase 1c -- Enforcement

```
Read workflow/_reference/system-spec.md and the CLAUDE.md created in
Phase 1a. This phase creates hooks and CI validation.

PRE-EXISTING HOOKS:
If hooks already exist in .claude/settings.json (inline commands or
script references), migrate them to external scripts under .claude/hooks/
before adding new hooks. Replace inline commands with:
bash "$(git rev-parse --show-toplevel)/.claude/hooks/script-name.sh"

HOOKS:
1. .claude/settings.json -- All hooks are command-type only.

   Permissions deny list:
   "deny": ["Bash(*git commit*)", "Bash(*git push*)"]

   PreToolUse hook: .claude/hooks/deny-dangerous.sh
   - Matcher: "Bash"
   - Block (exit 2 with error message telling Claude what to do instead):
     - rm -rf without explicit path scoping
     - git push to main/master/production
     - git push --force (suggest --force-with-lease)
     - chmod 777
     - Pipe-to-shell (curl | bash, wget | sh)
     - .env modifications
     - git commit --no-verify or git commit -n
     [ADD PROJECT-SPECIFIC BLOCKS: e.g., direct edits to binary/generated
      files that must be modified through tooling]
   - Exit 0 for everything else

   Stop hook: .claude/hooks/stop-lint.sh
   - Stack-adaptive: check git diff for modified file types, run relevant
     checks only
   - MUST exit 0 even when errors found (informational only)
   - Guard against missing tools (command -v check)
   - Infinite loop guard (STOP_HOOK_ACTIVE check)
   - Exclude slow checks (>10s) -- those go in /preflight

   PostToolUse hook: .claude/hooks/format-file.sh
   - Matcher: "Edit|Write"
   - Format based on file extension using project's formatter
   - Silence failures
   SKIP PostToolUse hook if no formatter is configured for your stack
   (e.g., shell scripts). Do not create a format hook that re-runs
   the linter -- that duplicates the Stop hook.

   HOOK PATH RESOLUTION:
   ALL commands MUST use: bash "$(git rev-parse --show-toplevel)/.claude/hooks/your-hook.sh"

   HOOK STRUCTURE in settings.json:
   "PreToolUse": [{ "matcher": "Bash", "hooks": [{ ... }] }],
   "Stop": [{ "hooks": [{ ... }] }],
   "PostToolUse": [{ "matcher": "Edit|Write", "hooks": [{ ... }] }]

GITIGNORE additions:
   - .claude/settings.local.json
   - tasks/todo.md
   - tasks/handoff.md

CI (for projects using GitHub Actions):
2. .github/workflows/context-validation.yml:
   - CLAUDE.md line count (warn if >target, error if >150)
   - Router table file references exist
   - Skills directories have SKILL.md files
   - Local CLAUDE.md files are under 20 lines each

SECRET SCANNING (manual step -- document, don't execute):
3. Add a note to README (not CLAUDE.md -- the line budget is too tight):
   "Secret scanning: install gitleaks, create ~/.git-hooks/pre-commit,
   set git config --global core.hooksPath ~/.git-hooks"
   Do NOT execute these commands -- they affect all repos on the machine.

VERIFICATION:
- Verify .claude/settings.json is valid JSON.
- Verify deny-dangerous.sh blocks: rm -rf, git push main, git push --force,
  chmod 777, pipe-to-shell, --no-verify.
- If stop hook created, verify it exits 0 even when errors found.
- Run preflight checks.
```

---

## Phase 2

```
Read workflow/_reference/system-spec.md and the current CLAUDE.md.
Work through this list in order.

AGENT EVAL SUITE:
1. Create agent-evals/ directory for agent regression testing.
   Add a README.md explaining what evals are and how to use them.

   Search this codebase's git history and issues for real incidents.
   For each, create agent-evals/[incident-name].md (flat files, not
   subdirectories) with:
   - Bug description
   - Single replay prompt
   - Expected outcome
   - Known failure mode tested

   If the codebase has fewer than 5 qualifying incidents, create as many
   as exist. For projects with no incident history: create 1-2 from common
   failure modes for your stack. Replace with real incidents as they occur.

PLAYBOOK UPDATES (skip if docs/playbooks/ doesn't exist):
2. If 02-mob-elaboration-prompt.md exists: add Parameters section,
   category-first question approach, structured question output,
   annotation cycle section.
3. If 03-sbao-ranking-prompt.md exists: verify Keep/Drop/Decide synthesis.

RFC 2119 PASS:
4. Apply MUST/SHOULD/MAY to every rule in CLAUDE.md.
   - MUST: execution loop steps, autonomy tiers, definition of done
   - SHOULD: log hygiene, working memory, session handoffs, footgun propagation
   - MAY: structural debt trigger, communication when blocked
   Compress prose in the SAME pass. CLAUDE.md MUST stay under target.

PER-ROLE PERMISSION PROFILES:
5. Create .claude/profiles/ with profiles adapted to your stack.
   Each profile restricts Edit and Bash permissions. Always Read: **.
   Add to CLAUDE.md router table.

CI VALIDATION:
6. If not created in Phase 1c, create context-validation.yml.

VERIFICATION:
- Count CLAUDE.md lines. MUST stay under target after RFC 2119 pass.
- Verify permission profile JSON files are valid (if created).
- Run preflight.
- Report CLAUDE.md line count.
```
