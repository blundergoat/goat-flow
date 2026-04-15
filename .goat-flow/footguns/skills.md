---
category: skills
---

## Footgun: Workflow template source and installed copy can silently diverge

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents on consumer projects follow a different rule than agents on the goat-flow repo, because the workflow template (install source) says one thing and the installed copy says another. The divergence is invisible — both files exist, both parse correctly, and no automated check compares their content.

**Why it happens:** `workflow/skills/reference/skill-preamble.md` is the template that gets copied to `.goat-flow/skill-preamble.md` during setup. When the installed copy is edited directly (e.g., fixing a bug found by critique), the workflow template doesn't automatically follow. The preflight validates skill template versions but not preamble/conventions content.

**Evidence:**
- `workflow/skills/reference/skill-preamble.md:10` said "Step 0 satisfies SCOPE" while `.goat-flow/skill-preamble.md:10` said "Step 0 satisfies READ/SCOPE" — discovered 2026-04-15 by multi-agent critique. Only 1 of 3 critiques caught it.
- The divergence affected the most important sentence in the preamble: which execution loop phases a skill's Step 0 satisfies. Fresh consumer installs would get the wrong version.

**Prevention:**
1. After editing any installed `.goat-flow/skill-preamble.md` or `.goat-flow/skill-conventions.md`, immediately diff against the workflow template source and sync.
2. Add a preflight check: `diff workflow/skills/reference/skill-preamble.md .goat-flow/skill-preamble.md` and `diff workflow/skills/reference/skill-conventions.md .goat-flow/skill-conventions.md` — fail if they differ.
3. Treat the workflow template as the source of truth. Edit there first, then copy to the installed location.

---

## Footgun: Agent rewrites shared docs with agent-specific vocabulary

**Status:** active | **Created:** 2026-03-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Shared documentation files (`docs/`, `workflow/`) contain references to only one agent's hook names, paths, or terminology. Other agents reading these docs get incorrect instructions. Tables lose rows for other agents.

**Why it happens:** When an agent is asked to set up or update its platform support, it replaces existing references wholesale instead of adding multi-agent support. The agent treats the task as find-and-replace: `.claude/` → `.gemini/`, `PreToolUse` → `BeforeTool`, "Every Claude turn" → "Every Gemini turn". It does not distinguish between agent-specific files (`workflow/setup/agents/gemini.md`) and shared files (e.g. `workflow/setup/shared/`; originally `docs/system-spec.md`, retired in v1.1.0).

**Evidence:**
- `docs/system-spec.md` → "Every Gemini turn" replaced "Every Claude turn" (should be agent-neutral) (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)
- `docs/five-layers.md` → Claude Code row deleted from skills table, replaced with Gemini CLI only (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)
- `docs/system-spec.md` → Claude Code hook example replaced with Gemini, not added alongside (file retired in v1.1.0, see `workflow/setup/01-system-overview.md`)
- `workflow/runtime/enforcement.md` → all `.claude/` paths replaced with `.gemini/`, creating hybrid state (file retired in v1.1.0, see `workflow/hooks/`)

**Prevention:**
- Agent-specific files (`workflow/setup/setup-*.md`, `.claude/`, `.gemini/`) - edits fine
- Shared docs (`docs/`, `workflow/`) - MUST remain agent-neutral or list all agents
- When adding agent support: ADD to tables and examples, never DELETE or REPLACE existing agent references
- Setup prompts MUST include explicit scope constraints: "Do NOT modify files outside `.gemini/` and `GEMINI.md`"

---

## Footgun: mv/cp/Write overwrites existing files without checking

**Status:** active | **Created:** 2026-03-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A file that existed at the destination path is silently overwritten and its content is permanently lost. Especially dangerous for untracked files that have no git recovery path.

**Why it happens:** `mv src dest` and `cp src dest` overwrite `dest` without warning if it already exists. The Write tool does the same. Agents treat rename/move as a single command without checking the destination. If the user then asks to "undo", the agent moves the overwritten content back to the source path - destroying the original destination content entirely.

**Evidence:**
- `docs/roadmaps/TODO_improvements_v0.4.md` → overwritten by `mv TODO_improvements_v0.3.md TODO_improvements_v0.4.md` (2026-03-21). The file was untracked and unrecoverable through git.

**Prevention:**
- Before ANY `mv`, `cp`, or Write to an existing path: run `ls` on the destination first
- If the destination exists, STOP and ask the user before proceeding
- For `mv`: use `mv -n` (no-clobber) instead of bare `mv`
- This is a Never-tier rule - overwriting a file the user didn't ask to overwrite is data destruction

---

## Footgun: Skills have phase gates but no time/call budget for context gathering

**Status:** active | **Created:** 2026-04-05 | **Evidence:** ACTUAL_MEASURED

Skills enforce phase gates (Step 0 must complete before Phase 1, gates pause for human approval) but have no budget for how long Step 0 can take. Claude can spend an entire session reading templates, exploring the codebase, and gathering context without ever producing output or asking a question.

**Evidence:**
- Claude Insights (112 sessions): "Claude spent so long reading templates that the user had to pull the plug before it wrote a single file" - during a healthkit GOAT Flow setup
- Pattern appears across review and setup sessions where Claude reads 20+ files in Step 0 without checkpointing

**Impact:** The user has no signal that the skill is stuck. The session appears active (tool calls are happening) but no output is produced. The only recovery is interrupting and restarting, wasting the entire session's context.

**Prevention:**
1. Add a Step 0 call budget to the shared preamble: "If Step 0 exceeds 5 file reads without producing output or asking a question, stop and present what you know so far"
2. Skills should checkpoint mid-Step-0 for complex projects: "I've read X files. Here's what I understand so far. Should I continue gathering context or start with what I have?"

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Dispatcher intent mapping has no coverage for analysis/evaluation verbs** (resolved 2026-04-14) — Added analysis/evaluation verbs to the dispatcher disambiguation table so ambiguous requests prompt skill selection instead of auto-routing.
- **CI template derives skill names by prefixing instead of listing them** (resolved 2026-04-14) — Removed `src/cli/prompt/fragments/` directory in v1.1.0; CI template generation no longer exists.
