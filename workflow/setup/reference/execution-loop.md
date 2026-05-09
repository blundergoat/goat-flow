# Instruction File Sections

These sections go in the project's instruction file. Target: under 125 lines. Hard limit: 150.

---

## Required Sections

a) Project identity + version header
   - Start with 1-2 lines: project name, domain, core technology, and primary invariant.
   - Include the five-concerns framing when installing goat-flow itself or when the target project needs a concise harness identity: Context, Constraints, Verification, Recovery, Feedback loop.
   - Set the version header to the current goat-flow release version (match installed skill frontmatter).

b) Truth Order
   - User's explicit instruction for this session.
   - This instruction file.
   - Architecture (`.goat-flow/architecture.md`).
   - Skills/templates loaded on demand.

c) Autonomy Tiers
   - Always: read files, run validation, edit within declared scope, and write continuity notes only when useful.
   - Ask First: before touching risky boundaries, state boundary touched, related code read, footgun checked, local instruction checked, and rollback command.
   - Never: freeze writes first if interrupted or told no changes; do not edit secrets; do not push/commit unless asked; do not overwrite without checking destination.
   - Group Ask First boundaries by category: instruction files, workflow/templates, architecture/playbooks, runtime code, agent configs, CI/hooks, add/remove/rename, and 3+ docs/scripts.
   - New Never/Ask First rules must trace to a real incident, current file evidence, or a documented footgun/lesson - not hypothetical best practices.

d) Hard Rules
   - If file exists, modify in place. Never create `_modified`, `_new`, `_backup`, or `_v2` variants.
   - Severity order: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE.
   - Maintain cross-file consistency for the same concept.
   - Preserve file evidence with semantic anchors, not stale line numbers.
   - Use real incidents, never hypothetical examples.
   - Sub-agents get one objective, structured return, and a 5-call budget.
   - No features, abstractions, or error handling beyond what was asked.
   - Ambiguous requirements: present interpretations; do not pick silently.

e) Key Resources
   - **Learning loop** (grep before every change): `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/`.
   - **Tool playbooks**: `.goat-flow/skill-playbooks/browser-use.md`, `.goat-flow/skill-playbooks/page-capture.md` - read BEFORE declaring a tool unavailable.
   - Add only first-action resources here. The Router Table remains exhaustive.

f) Essential Commands
   - Include exact commands for lint, syntax/type checks, tests, release/preflight checks, and agent hook self-tests.
   - Keep common checks in a short code block; route situational checks to one terse line.

g) Execution Loop: READ -> SCOPE -> ACT -> VERIFY
   When a goat-* skill is active, the skill's Step 0 replaces READ and selects the skill's mode/depth. SCOPE still applies before writes: a skill may write when its selected mode permits writes or the user explicitly approves them. `/goat-plan` File-Write may create gitignored milestone files without a separate approval gate; `/goat-debug` D3 still requires approval before fixes. Resume at ACT after Step 0 output or when a blocking gate releases.
   ### READ
   MUST read relevant files before changes. Never fabricate codebase facts. Check browser evidence first for URL, local HTML, localhost, screenshot, rendered UI, or browser-visible behaviour. Use grep-first retrieval across learning-loop dirs; include decisions for architecture, policy, or setup work. Before declaring any tool or capability unavailable, read the matching playbook in `.goat-flow/skill-playbooks/` (e.g. `browser-use.md`, `page-capture.md`) and run that doc's "Availability Check" section verbatim - project-local CLI tools at `~/.local/bin/` are valid; do not conflate "no harness/MCP tool" with "no tool".
   ### SCOPE
   Declare intent, complexity tier, mode, files allowed to change, non-goals, and blast radius. Expanding beyond scope means stop and re-scope.
   ### ACT
   Declare `State: [MODE] | Goal: [one line] | Exit: [condition]`. Mode must be Plan, Implement, Explain, Debug, or Review.
   ### VERIFY
   Run required checks for changed files. Check cross-references after renames. Tick milestone checkboxes immediately. Do not claim checks passed without the literal pass/fail line from this session. Stop the line when tests break, builds fail, or behaviour regresses.
   If VERIFY caught a failure or you corrected course, update the learning loop before DoD.

h) Definition of Done
   MUST confirm all six gates: lint/typecheck passes on changed files; no broken cross-references; no unapproved boundary changes; logs updated if tripped; working notes current; grep old pattern after renames.

i) Artifact Routing
   Map "add a footgun/lesson/decision/pattern" to `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/`, or `.goat-flow/patterns/`. These are documentation artifacts, not runtime code. Read the target directory's `README.md` before editing.

j) Router Table
   MUST be the final section. Include at minimum:
   - Learning loop dirs (`.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/patterns/`, `.goat-flow/decisions/`)
   - Skill reference + tool playbooks (`.goat-flow/skill-reference/`)
   - Orientation docs (`.goat-flow/code-map.md`, `.goat-flow/glossary.md`) when present
   - Architecture doc (`.goat-flow/architecture.md`)
   - Agent skills directory (`.claude/skills/`, `.agents/skills/`, or `.github/skills/`)
   - Workflow/setup source if present
   - Source, scripts, config, docs, and workspace/session paths
   - Peer instruction files present in the project

## Quality Bar

Every line in the hot-path instruction file must be one of: behavioral rule, scope boundary, exact command, verification gate, router pointer, or composition rule. Domain knowledge, project history, API docs, and glossary entries belong in cold-path files. For strict Never/MUST constraints, state whether the constraint is prose-only or mechanically enforced when that distinction matters.

If you must weaken a MUST to meet the line target, the target is wrong - raise it, do not weaken the rule.
