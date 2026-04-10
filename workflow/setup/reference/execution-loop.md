# Instruction File Sections

These sections go in the project's instruction file. Target: under 120 lines. Hard limit: 150.

---

## Required Sections

a) Version header (v1.0 - YYYY-MM-DD)

b) Default Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG
   When a goat-* skill is active, the skill's Step 0 satisfies READ/CLASSIFY/SCOPE. Resume the loop at ACT.
   - READ: read relevant files first, never fabricate codebase facts
     (include BAD/GOOD example)
     Cross-doc: MUST read .goat-flow/footguns/ before modifying files
     listed in the Ask First boundaries. Known traps prevent repeat mistakes.
   - CLASSIFY: three signals before acting:
     1. Intent: question (answer it) vs directive (act on it)
     2. Complexity tiers: Hotfix (1-2 files) / Small Feature (compressed brief) /
        Standard / System Change / Infrastructure.
        No fixed read/turn caps. If reads exceed 3x your initial estimate,
        re-classify before continuing.
     3. Mode: Plan / Implement / Explain / Debug / Review
   - SCOPE: declare before acting - files allowed to change, non-goals,
     max blast radius. Expanding beyond scope = stop and re-scope
   - ACT: behaviour per mode as a table. State declaration rule.
     Mode-transition rule: "Switching to [NEW STATE] because [reason]."
     Debug mode: "No fixes until human reviews diagnosis."
     Anti-planning-loop rule. Anti-BDUF guard with BAD/GOOD example
   - VERIFY: continuous test loop. Stop-the-line with two-level
     escalation. Revert-and-rescope tactic.
     Before presenting findings, re-read every `file:line` you plan to cite.
     If you cannot re-read it, mark the claim UNVERIFIED.
     **Rename sweep:** after any rename or move, grep for the old name across all files. Zero remaining = pass.
     Plan tracking: if working from a plan/milestone file, tick each
     checkbox (`- [x]`) as the task is completed - not at the end.
     Recovery protocols: include 2-3 common failure patterns with fixes
     (e.g., missing context → read X first, out-of-scope → name boundary
     and redirect, conflicting instructions → flag and ask)
   - LOG: MUST update when tripped (DoD gate #4). Use category bucket
     files - do NOT append to a monolithic log and do NOT create one
     file per incident forever.
     Lessons: `.goat-flow/lessons/` category files.
     Patterns: `.goat-flow/patterns.md`.
     Footguns: `.goat-flow/footguns/` category files.
     Decisions: `.goat-flow/decisions/`.
     When-to-use table. Footgun propagation rule.
     Context-based loading rules.
     MECHANICAL TRIGGER (non-negotiable):
     - VERIFY caught a failure in your code → `.goat-flow/lessons/` entry BEFORE DoD
     - A reusable approach worked well → `.goat-flow/patterns.md` entry before closing
     - Human corrected agent behaviour → `.goat-flow/lessons/` entry IMMEDIATELY
     - Discovered architectural trap with file:line evidence → `.goat-flow/footguns/`
     Skip = DoD gate #4 blocks completion. This is not optional.
     Threshold for trigger #1: log when the failure has a non-obvious root
     cause, the same mistake happened twice, or the impact crossed a boundary.
     Don't log routine type errors, lint fixes, typos, or anything the
     linter/compiler would have caught on the next run anyway.
     Session logs: write a summary to `.goat-flow/logs/sessions/YYYY-MM-DD-slug.md`
     at the end of every significant session. Include: what happened, files changed,
     decisions made, errors, learnings, next steps.
     Dual-agent projects: learning loop files are shared. Read the
     current file before appending to avoid duplicating entries.

c) Autonomy Tiers: Always / Ask First / Never
   - Never tier MUST include:
     1. Overwrite existing files without checking destination (ls before
        mv/cp/Write; use mv -n). Data destruction from blind overwrites
        is unrecoverable for untracked files.
     2. Delete, move, or overwrite 5+ files in one operation without
        first listing targets (ls/find/echo glob) and getting explicit
        confirmation. Bulk deletes are irreversible for untracked files.
   - Adapt Ask First boundaries for THIS project's specific risks
   - Include Ask First checklist. Choose SHORT or FULL form:
     SHORT (2 questions - recommended for most projects):
     1. What else depends on this? [list callers/consumers]
     2. How do I undo this? [exact rollback command]
     FULL (5 items - for high-risk codebases, PHI, or multi-tenant systems):
     1. Boundary touched: [name it]
     2. Related code read: [yes/no]
     3. Footgun entry checked: [relevant entry, or "none"]
     4. Local instruction checked: [local instruction file / .github/instructions/ / none]
     5. Rollback command: [exact command]
   For multi-agent projects, consider extending AGENTS.md with domain
   concepts, key patterns, and deprecation warnings. AGENTS.md can serve
   double duty as execution protocol + domain reference - but watch the
   line budget.

d) Definition of Done: 6 gates
   (1) lint/typecheck passes on changed files
   (2) no broken cross-references introduced
   (3) no unapproved boundary changes
   (4) logs updated if tripped
   (5) current state recorded before stopping incomplete work
   (6) After any rename or move, grep for the old name across ALL files (including .md, .json, .yaml, config). Zero remaining references = pass. This is the most common failure mode — stale cross-references after renames cause more bugs than any other single pattern.

e) Router table: MUST include at minimum:
     - All 6 skill directories (Claude/Gemini/Codex/Copilot: .claude/skills/, .agents/skills/, .github/skills/)
     - Learning loop directories (`.goat-flow/footguns/`, `.goat-flow/lessons/`)
     - Architecture doc (`.goat-flow/architecture.md`)
     - Config (`.goat-flow/config.yaml`)
     - Any playbooks, profiles, or domain docs relevant to project
     Dual-agent projects: router MUST include the other agent's
     instruction file (AGENTS.md or CLAUDE.md).
     (Unrouted files are invisible to the agent - 160x usage uplift
     for referenced tools)

f) Essential commands

If you must weaken a MUST to meet the line target, the target is
wrong - raise it, don't weaken the rule.
Do NOT skip sections (e)-(f) - they are small but required.
