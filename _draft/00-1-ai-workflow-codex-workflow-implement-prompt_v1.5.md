# Codex Workflow Implementation Prompt

**Version:** v1.5 | 2026-03-15

Give this to Codex. Prefer a single session. If the repo is too large for one clean pass, finish the foundation first and report the split explicitly instead of bluffing completeness.

## Changelog

| Version | Date       | Changes |
| ------- | ---------- | ------- |
| v1.5    | 2026-03-15 | Filename references made pattern-based (no exact version). Dirty worktree and dual-agent repo guidance. Preflight wrapper pattern. guidelines-ownership-split.md as standard output. State declaration SHOULD not MUST. Omittable sections clarified. Footgun merge-with-existing. All 5 playbooks for all projects (removed single-domain skip). Permissions deny row added to equivalence table |
| v1.3    | 2026-03-14 | Initial version |

---

## Context Prompt

Paste this first:

```text
I have an AI workflow system designed for Claude Code that I want to adapt
for Codex. The core idea: instead of a wall of rules, give the agent a
5-step execution loop (READ -> CLASSIFY -> ACT -> VERIFY -> RECORD) with
autonomy tiers, a definition of done, and a learning loop.

Read these files for the full system design:
- The AI workflow improvement plan file (look for
  ai-workflow-improvement-plan-prime in the filename — it may have
  version suffixes or prefixes like 00-1-)
- The AI workflow article file (look for ai-workflow-ARTICLE-prime
  in the filename)

Now adapt this system for Codex. NOT a copy - a Codex-native implementation
that respects how Codex actually works. Key differences from Claude Code:

CODEX MECHANICS (respect these):
- AGENTS.md is the root instruction file (not CLAUDE.md)
- No slash commands - use playbook .md files in docs/codex-playbooks/
- No hooks system - use AGENTS.md rules + verification scripts
- apply_patch for edits (not Edit/Write tool)
- Codex may run in cloud sandboxes or local constrained shells depending on client.
  Design for least privilege either way.
- No /compact, no /clear, no /insights - context is per-task
- No .claude/ directory structure
- No settings.json or profiles
- No permissions deny list (this is the biggest enforcement gap vs
  Claude Code — document it honestly in the deny-dangerous script,
  don't pretend it's equivalent)

REPO STATE:
- If this project already has a Claude Code implementation (.claude/,
  CLAUDE.md, agent-evals/), leave those files untouched. Create Codex
  equivalents alongside them (AGENTS.md, codex-evals/, docs/codex-playbooks/).
- If workflow docs already exist untracked in the worktree (docs/lessons.md,
  docs/architecture.md, docs/domain-reference.md, tasks/), treat them as
  pre-existing: read, merge with, or rewrite in place. Do not create
  duplicates. Report them as "modified" not "new" in the final output.
- If docs/footguns.md is a shared file used by both agents, merge with
  it carefully. Do not remove entries that the Claude Code implementation
  may depend on without flagging the removal.

WHAT TO BUILD (in this order):

1. AGENTS.md (root runtime file)
   - Keep it concise. Do not fetishise a line count, but keep the runtime
     file short with referenced docs for detail.
   - Default execution loop: READ -> CLASSIFY -> ACT -> VERIFY -> RECORD
     - READ: read relevant files first, never fabricate. Include bad/good example
     - CLASSIFY: declare mode (Answer, Plan, Implement, Debug, Review) +
       complexity. Question vs directive disambiguation. State declaration
       is SHOULD (not MUST like Claude Code — Codex's per-task context
       makes drift less likely).
     - ACT: mode-constrained behaviour table. Anti-planning-loop rule.
       Anti-BDUF guard with bad/good example.
     - VERIFY: run tests after meaningful changes. Two-level escalation
       (isolated -> note and continue; cross-boundary -> full stop + diagnosis).
       Two failed approaches on same fix = stop and report.
     - RECORD: docs/lessons.md (behavioural mistakes) + docs/footguns.md
       (architectural landmines). Context-based loading rules.
       Footgun propagation rule: when adding a footgun that maps to a
       specific directory, note the directory in the entry.
   - Autonomy tiers: Always / Ask First / Never
     - Adapt Ask First boundaries for THIS project
     - Include micro-checklist for Ask First items
     - Never: delete tests, modify secrets, make commits unless asked,
       no destructive git operations
   - Definition of Done: 6 gates (tests green, verification passes,
     no unapproved boundary changes, logs updated if tripped, notes current,
     grep after renames)
   - Router table: pointers to playbooks, docs, evals
   - Essential commands for this project

   The following sections from the Claude Code plan are SHOULD for Codex,
   not MUST. Include them if they fit naturally; omit with a note if they
   don't:
   - Sub-agent objectives (Codex task model is different)
   - Communication when blocked (Codex tasks are shorter-lived)
   - Structural debt trigger (MAY in both versions)
   - Working-memory escalation ladder (no /compact equivalent;
     tasks/todo.md and tasks/handoff.md are sufficient)

   If AGENTS.md already exists:
   - preserve project-specific identity and essential commands
   - preserve any repo-specific safety rules unless they clearly conflict with
     the new ownership split
   - migrate domain reference material (architecture, design patterns,
     conventions) into docs/architecture.md or docs/domain-reference.md
   - report what was moved, what was kept, and why
   - then rebuild the execution loop on top

2. Guidelines ownership split
   - If a coding-standards or guidelines file exists, audit for overlap
   - If the pre-existing AGENTS.md itself functioned as a guidelines file,
     apply the split to it: workflow rules stay in AGENTS.md, domain
     reference moves to docs/domain-reference.md
   - AGENTS.md owns: execution loop, autonomy tiers, DoD, log files, router
   - Guidelines file owns: engineering practices, coding patterns, testing
     strategy, communication style
   - Remove overlap from guidelines. Before editing, produce a
     before/after overlap report listing every line or section to be removed
     and why. Do not auto-remove without this diff.
   - Create docs/guidelines-ownership-split.md documenting what was
     removed from the original file and why. This is a committed
     artefact, not just chat output.
   - Do not rewrite unrelated docs or repo policy files outside this ownership split.

3. Docs seed files (create ALL of these - no implied files)
   - docs/lessons.md - format header, empty Entries/Patterns sections
   - docs/footguns.md - if the file already exists, merge with it: keep
     existing entries, add new footguns from reading the codebase. If the
     file doesn't exist, create and seed with real ones only. Include
     file:line evidence. Do NOT replace existing entries.
   - docs/architecture.md - short overview (under 100 lines): what the
     system does, components, data flows, constraints, trade-offs
   - tasks/todo.md - empty runtime file for working notes during tasks
   - tasks/handoff.md - empty runtime file with handoff template
     (Status, Current State, Key Decisions, Known Risks, Next Step)

4. Codex playbooks (docs/codex-playbooks/)
   Create these as standalone .md files the agent reads on demand:

   - preflight.md - mechanical verification with priority markers.
     MUST: build + lint + type-check when applicable.
     SHOULD: full test suite, formatter.
     Include dependency audit step.
   - research.md - deep-read template: Files Involved, Request Flow,
     Boundaries Touched, Risks/Gotchas (min 3 with file:line evidence).
     Hard gate: no planning until human reviews output.
   - debug-investigate.md - diagnosis-first. "If you want to just try
     something before tracing the code path, STOP." Diagnosis output
     template with file:line evidence. No fixes until human reviews.
   - audit.md - 4-pass: Discovery -> Verification -> Prioritisation ->
     Self-Check ("did I fabricate this?"). MUST NOT propose fixes.
   - code-review.md - structured review with priority markers and
     autonomy tier awareness.

   Create all 5 playbooks regardless of project type.

5. Verification scripts (scripts/)
   - scripts/preflight-checks.sh - runs build, lint, test for the stack.
     Exit non-zero on failure. If the project already has a preflight
     script (e.g., preflight-checks.sh at the root), create this as a
     WRAPPER that calls the existing script plus adds workflow-specific
     checks. Do not replace the existing script.
   - scripts/context-validate.sh - checks AGENTS.md references exist,
     playbook files have required sections, and docs/footguns.md contains
     real evidence-backed entries or explicitly states "none confirmed yet".
   - scripts/deny-dangerous.sh - codifies the deny policy for
     human/agent review, preflight, and CI. It does NOT intercept
     commands automatically - Codex has no hook system. Reference
     this script from AGENTS.md rules and preflight checks.
     Document blocks for: rm-rf (unscoped), force push, .env edits,
     no-verify commits, any git commit, any git push.
     Add project-specific blocks for files that must be modified
     through tooling.
     Include a --self-test flag that validates all patterns.

6. Codex evals (codex-evals/)
   Create a README.md explaining what evals are and how to use them.

   Search git history for real incidents:
   git log --oneline --all | grep -iE 'fix|revert|bug|broke|regression'

   For each, create codex-evals/[incident-name].md with:
   - Origin: real-history | synthetic-seed
   - Bug description
   - Single replay prompt
   - Expected outcome
   - Failure mode tested

   If fewer than 5 real incidents, add from these common failure modes:
   - Question answered without code changes (CLASSIFY test)
   - Rename followed by grep for old pattern (VERIFY test)
   - Ask First boundary respected (autonomy test)
   - Debug diagnosis before fix attempt (ACT test)
   - Two failed approaches triggers stop (VERIFY test)

VERIFICATION:
- AGENTS.md exists and is concise
- All docs seed files exist (including tasks/todo.md and tasks/handoff.md)
- All 5 playbook files exist with required sections
- Verification scripts are executable and run without errors
- Footguns are real (from codebase) with file:line evidence, or
  docs/footguns.md explicitly states "none confirmed yet"
- Evals reference real incidents where possible
- Router table in AGENTS.md points to all created files
- docs/guidelines-ownership-split.md exists
- Report: AGENTS.md line count, number of playbooks, number of footguns,
  number of evals, guidelines file reduction (if applicable)
```

---

## After Codex Runs - Human Checklist

- [ ] AGENTS.md: does the execution loop read naturally, not like a copy of CLAUDE.md?
- [ ] Footguns: are they real? Check file:line references against actual code
- [ ] Footguns: if shared with Claude Code, were any entries removed? Review removals
- [ ] Guidelines split: diff the before/after. Was anything useful dropped?
- [ ] guidelines-ownership-split.md exists and documents the migration
- [ ] Evals: do the replay prompts test what they claim to test?
- [ ] Verification scripts: run each one manually. Do they pass?
- [ ] Router table: click every reference. Do the files exist?
- [ ] Ask First boundaries: are they specific to THIS project, not generic?
- [ ] deny-dangerous.sh: run `--self-test` flag. Does it pass?

---

## What This Intentionally Does Not Include

- **Hooks / automatic interception.** Codex has no hooks system. The
  deny-dangerous script codifies policy for review and CI — it does not
  block commands at runtime. AGENTS.md rules are behavioural guidance,
  not mechanical enforcement. This is the biggest capability gap vs
  Claude Code. Accept it and design around it: strong rules + preflight
  validation + CI checks.
- **Permission profiles.** Codex's sandbox model is different. Scoping is via
  AGENTS.md rules, not JSON profile files.
- **Local AGENTS.md files.** Directory-level auto-loading of instruction
  files has not been confirmed in Codex docs as of March 2026. Treat this
  as an implementation assumption. Put module warnings in docs/footguns.md
  and reference them from AGENTS.md's router table.
- **Slash commands.** Playbook files serve the same purpose — the agent reads
  them when the task matches. Reference them in AGENTS.md's router table.
- **Strict line count.** Codex's context model is per-task, not per-session.
  Keep AGENTS.md concise for clarity, not for a token budget ceiling.
  Expect AGENTS.md to be ~30-40% larger than CLAUDE.md for the same project
  (135 vs 100 lines on the shell script collection) because enforcement
  and skills are inline rather than offloaded to hooks and slash commands.
- **Permissions deny list.** Claude Code's settings.json blocks tool calls
  before execution. Codex has no equivalent. The deny-dangerous script
  plus AGENTS.md Never rules plus CI are the three-layer substitute.
