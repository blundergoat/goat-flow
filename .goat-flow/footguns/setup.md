---
category: setup
---

## Footgun: Setup instructions contradict spec on execution loop steps

**Status:** active | **Created:** 2026-03-20 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents implementing GOAT Flow produce a CLAUDE.md with the old 5-step loop (READ → CLASSIFY → ACT → VERIFY → LOG), missing SCOPE and complexity budgets. Cascades into missing sections (f)-(g) because agents under line pressure cut what the spec doesn't reinforce.

**Why it happens:** `workflow/setup/agents/claude.md` previously told agents to "Read docs/system-spec.md" FIRST. If system-spec.md showed a different loop than `workflow/setup/reference/execution-loop.md`, agents absorbed whichever they read first and couldn't reconcile the contradiction. This caused 7 of 8 gaps in the sus-form-detector implementation.

**Evidence:**
- `docs/system-spec.md` → loop definition in Layer 1 architecture diagram and execution loop section (file retired in v1.1.0, see `workflow/setup/reference/execution-loop.md`)
- `workflow/setup/reference/execution-loop.md` → updated loop definition (authoritative)
- `workflow/setup/agents/claude.md` → previously "Read docs/system-spec.md" as first instruction (now points to `workflow/setup/01-system-overview.md`)

**Prevention:** `workflow/setup/reference/execution-loop.md` is the single authoritative source for the execution loop. `docs/system-spec.md` and `docs/five-layers.md` have been retired (v1.1.0), eliminating the duplication that caused this footgun. If the loop definition is ever duplicated again, this footgun will recur.

---

## Footgun: Multi-agent setup files share structure but not vocabulary

**Status:** active | **Created:** 2026-03-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Gemini CLI rejects hook event names with "Invalid hook event name" warnings. Hooks silently don't run. Users get a working `.claude/` setup but broken `.gemini/` setup from the same instructions.

**Why it happens:** `workflow/setup/agents/gemini.md` was derived from `workflow/setup/agents/claude.md` by substituting paths (`.claude/` → `.gemini/`, `CLAUDE.md` → `GEMINI.md`) but CLI-specific vocabulary wasn't translated. Each CLI uses different hook event names:
- Claude Code: `PreToolUse`, `PostToolUse`, `Stop`
- Gemini CLI: `BeforeTool`, `AfterTool`, `AfterAgent`, `SessionEnd`

Hook script comments also carried over Claude-specific language ("runs after every Claude turn").

**Evidence:**
- `workflow/setup/agents/gemini.md` → Gemini CLI event reference block (BeforeTool, AfterTool, SessionEnd)
- `.gemini/hooks/deny-dangerous.sh` → updated to "BeforeTool hook"
- `.gemini/settings.json` → updated to `BeforeTool` and `AfterAgent` event names

**Prevention:** When creating or updating a setup file for a new CLI, diff it against the source file and check every CLI-specific term - not just paths. Maintain the event name reference block at the top of each CLI's Phase 1c section.

---

## Footgun: Deduplicated multi-agent setup drifts from per-agent setup rules

**Status:** active | **Created:** 2026-03-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `goat-flow setup . --agent all` emits a single deduplicated setup prompt that looks shorter and cleaner than per-agent setup, but it can direct users to scaffold shared skills in the wrong directory, flatten phase-specific guidance into one generic reference, and skip template validation entirely.

**Why it happens:** `composeMultiAgentSetup()` rebuilds the full-setup output as a separate code path instead of reusing the single-agent phase rendering. Its shared table is derived from the first agent's standard refs, so Claude's `.claude/skills/` path leaks into a multi-agent prompt even though shared multi-agent skills are supposed to canonicalize under `.agents/skills/`.

**Evidence:**
- `src/cli/cli.ts` → routes multi-agent full setup through `composeMultiAgentSetup()`
- `src/cli/prompt/compose-setup.ts` → builds shared refs from the first agent only
- `src/cli/prompt/template-refs.ts` → skill output path is derived from `p.skillsDir`
- `src/cli/detect/agents.ts` → Claude profile sets `skillsDir: '.claude/skills'`
- `setup/shared/docs-seed.md` → multi-agent projects should canonicalize skills in `.agents/skills/`

**Prevention:** When adding a condensed or multi-agent output mode, preserve the same invariants as the single-agent path: canonical shared output paths, per-phase agent-specific guidance, and the same template validation gates. If a new setup mode cannot reuse those invariants directly, treat it as a high-risk integration path and audit its rendered output before release.

---

## Footgun: Setup adds skills but never removes them

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** After upgrading goat-flow (e.g., 0.9.0 → 0.9.3), projects end up with 13 skill directories instead of 6. The scanner scores 100% because it only checks the 6 canonical skills - the 7 stale ones are invisible. The dispatcher routes to old skill names. The router table references skills that should have been merged as modes.

**Why it happens:** The setup prompt (AP15 fragment) says "update outdated skills" but never says "delete skills that no longer exist in the canonical set." The scanner has no check for non-canonical skill directories. The agent does exactly what it's told - updates 6 skills, leaves 7 untouched.

**Evidence:**
- `src/cli/prompt/fragments/anti-patterns.ts` → AP15 fragment only instructs "update," not "remove"
- devgoat-bash-scripts: 13 skills after upgrade (7 stale at v0.9.0)
- blundergoat-platform: 13 skills after upgrade (same pattern)

**Prevention:** Setup must explicitly list old goat-flow skill names to delete during upgrade: goat-investigate, goat-simplify, goat-refactor, goat-audit, goat-onboard, goat-reflect, goat-resume, goat-context. The scanner should warn about non-canonical goat-* directories.

---

## Footgun: Workflow skill templates lag behind installed skills

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Consumer projects running `npx goat-flow setup` get templates at v0.9.2 while the package is v0.9.3. The setup agent writes "0.9.2" from the template, the scanner flags it as outdated, and the agent has to do a second pass to fix every skill to "0.9.3."

**Why it happens:** The `workflow/skills/*.md` templates are the source of truth for consumer projects. When goat-flow's own installed skills (`.claude/skills/`) get updated, the templates don't automatically follow. The npm publish script doesn't verify template versions match `RUBRIC_VERSION`.

**Evidence:**
- `workflow/skills/goat-debug.md` → frontmatter version lagging behind `.claude/skills/goat-debug/SKILL.md`
- devgoat-bash-scripts review: "templates ship with 0.9.2 but scanner expects 0.9.3"
- halaxy-cypress review: "skill version mismatch between templates and installed package"

**Prevention:** npm publish script or preflight must verify all `workflow/skills/*.md` files have `goat-flow-skill-version` matching `RUBRIC_VERSION`. Fail the publish if they don't match.

---

## Footgun: Setup creates parallel surfaces instead of migrating existing ones

**Status:** open | **Created:** 2026-04-03 | **Evidence:** ACTUAL_MEASURED

When a project already has learning-loop artifacts, setup creates NEW parallel surfaces instead of using the existing ones:

- `tasks/` AND `.goat-flow/tasks/` both created
- `docs/footguns.md` (flat) AND `.goat-flow/footguns/` (directory) both created
- `docs/lessons.md` AND `.goat-flow/lessons/` both created
- `ai/instructions/` AND `.goat-flow/coding-standards/` both created with overlapping content

**Evidence:** Found by Codex on ambient-scribe (4 duplicate surfaces), blundergoat-platform (context-validate.sh:105 requires BOTH old and new), healthkit (contradictory paths in CLAUDE.md vs config.yaml vs skills).

**Impact:** Agents receive contradictory instructions about where to write lessons and footguns. The same information ends up in multiple places and drifts. Users can't tell which is canonical.

**Fix:** M19 in `.goat-flow/tasks/0.10.0/M19-setup-reliability.md`. Setup must detect existing artifact locations and use them, not create parallel ones.
