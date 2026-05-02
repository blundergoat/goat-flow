# Instruction File Sections

These sections go in the project's instruction file. Target: under 120 lines. Hard limit: 150.

---

## Required Sections

a) Project identity - 1-2 lines: project name, domain, core technology, primary invariant

b) Version header (v&lt;current-version&gt; - YYYY-MM-DD, matching `package.json` version)

c) Default Execution Loop: READ → SCOPE → ACT → VERIFY
   When a goat-* skill is active, the skill's Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before any file write. Resume at ACT when the skill's first blocking gate releases.
   - READ: gather evidence from relevant files before any claim. Never fabricate codebase facts.
     - For URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour, check browser evidence first: `command -v browser-use && browser-use doctor`; if available use `browser-use open`, `browser-use state`, and `browser-use screenshot`. If missing, ask before installing or use manual fallback.
   - SCOPE: declare intent, complexity tier, mode, files allowed to change, non-goals, and blast radius.
   - Include complexity tier, mode, and intent in this one step.
   - ACT: behavior follows the chosen mode.
     - Mode transitions must be explicit when they happen.
     - Debug mode keeps the D2→D3 human-review gate.
   - VERIFY: continuous test loop with escalation.
     - Before presenting live findings, re-read every `file:line` cited as evidence; durable learning-loop artifacts use semantic anchors, not line numbers.
     - If evidence cannot be re-read, mark it UNVERIFIED.
     - **Rename sweep:** after any rename or move, grep old names across all files. Zero remaining references required.
     - **Loop detection:** If you've edited the same file 5+ times in one session without tests passing, STOP. Present what's failing and ask for a different approach.
     - If a plan/milestone file is active, tick each `- [x]` task immediately as completed.
     - DoD verification triggers are conditional, not a separate execution step:
       - VERIFY caught a failure in your code → `.goat-flow/lessons/` entry
       - Human corrected agent behaviour → `.goat-flow/lessons/` entry immediately
       - Reusable approach worked (twice or crosses boundary) → `.goat-flow/patterns/` entry
       - Architectural trap with semantic-anchor evidence → `.goat-flow/footguns/` entry
       Log only non-obvious root causes, repeated misses, or boundary-crossing impacts.
     - **Artifact routing:** "add a footgun" → `.goat-flow/footguns/`, "add a lesson" → `.goat-flow/lessons/`, "add a decision" → `.goat-flow/decisions/`, "add a pattern" → `.goat-flow/patterns/`. These are documentation artifacts, not runtime code - read the target directory's `README.md` for format.

d) Artifact Routing: map user requests ("add a footgun/lesson/decision/pattern") to the correct `.goat-flow/` directory. These are documentation artifacts, not runtime code.

e) Autonomy Tiers: Always / Ask First / Never
   - Never tier MUST include:
     1. Overwrite existing files without checking destination (ls before
        mv/cp/Write; use mv -n). Data destruction from blind overwrites
        is unrecoverable for untracked files.
     2. Delete, move, or overwrite 5+ files in one operation without
        first listing targets (ls/find/echo glob) and getting explicit
        confirmation. Bulk deletes are irreversible for untracked files.
     3. Continue file edits after the user interrupts or says no changes.
        Freeze writes; run only read-only status/diff checks until the
        user explicitly asks for cleanup, revert, or apply.
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

f) Definition of Done: 6 gates
   (1) lint/typecheck passes on changed files
   (2) no broken cross-references introduced
   (3) no unapproved boundary changes
   (4) logs updated if tripped
   (5) current state recorded before stopping incomplete work
   (6) After any rename or move, grep for the old name across ALL files (including .md, .json, .yaml, config). Zero remaining references = pass. This is the most common failure mode - stale cross-references after renames cause more bugs than any other single pattern.

g) Router table: MUST include at minimum:
     - Skill directories (`.claude/skills/`, `.agents/skills/`, `.github/skills/`)
     - Learning loop directories (`.goat-flow/footguns/`, `.goat-flow/lessons/`)
     - Architecture doc (`.goat-flow/architecture.md`)
     - Config (`.goat-flow/config.yaml`)
     - Any domain docs relevant to project
     Dual-agent projects: router MUST include the other agent's
     instruction file (AGENTS.md or CLAUDE.md).
     (Unrouted files are invisible to the agent - 160x usage uplift
     for referenced tools)

h) Essential commands

i) (Optional) Complexity and read policy:
   - Hotfix, Small Feature, Standard, System, Infrastructure.
   - If reads exceed 3x your initial estimate, re-classify.

j) (Optional) Session continuity:
   - Write session context to `.goat-flow/logs/sessions/` when work spans multiple turns.

If you must weaken a MUST to meet the line target, the target is
wrong - raise it, don't weaken the rule.
Do NOT skip sections (a)-(h) - they are required. Sections (i)-(j) are optional but recommended.
