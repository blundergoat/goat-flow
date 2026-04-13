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

## Footgun: Setup adds skills but never removes them

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** After upgrading goat-flow (0.9.x → 1.1.0), projects end up with stale skill directories alongside the 7 canonical ones. Old skill names are invisible to the audit if left in place.

**Why it happens:** Setup instructions tell agents to install the 7 canonical skills, but don't always say to delete old ones. Agents do what they're told - install 7, leave stale ones untouched.

**Evidence:**
- `src/cli/classify-state.ts:36-47` - `OLD_SKILLS` list: goat-audit, goat-investigate, goat-refactor, goat-simplify, goat-context, goat-onboard, goat-reflect, goat-resume, goat-preflight, goat-research
- `src/cli/audit/agent-setup-checks.ts` - `stale-skill-dirs` check catches this in audit
- devgoat-bash-scripts: 13 skills after upgrade (7 stale at v0.9.0)
- blundergoat-platform: 13 skills after upgrade (same pattern)

**Prevention:** Upgrade docs (`workflow/setup/upgrade-from-0.9.x.md`) include explicit skill deletion. The migration script handles this automatically. The `stale-skill-dirs` build check will catch remaining stale directories and fail audit.

---

## Footgun: Workflow skill templates lag behind installed skills

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Consumer projects running `npx goat-flow setup` get templates at an old version while the package has advanced. The setup agent writes the old version, the audit flags it as outdated, and a second pass is needed to fix every skill.

**Why it happens:** The `workflow/skills/*.md` templates are the source of truth for consumer projects. When goat-flow's own installed skills (`.claude/skills/`) get updated, the templates don't automatically follow. The npm publish script doesn't verify template versions match `AUDIT_VERSION`.

**Evidence:**
- `workflow/skills/goat-debug.md` → frontmatter version lagging behind `.claude/skills/goat-debug/SKILL.md`
- devgoat-bash-scripts review: "templates ship with 0.9.2 but scanner expects 0.9.3"
- halaxy-cypress review: "skill version mismatch between templates and installed package"

**Prevention:** `scripts/preflight-checks.sh` verifies all `workflow/skills/*.md` files have `goat-flow-skill-version` matching `AUDIT_VERSION`. Fail the publish if they don't match (`prepublishOnly` runs preflight).

---

## Footgun: Ask First config/instruction sync is documented as blocking but not validated

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Step 06 marks Ask First sync between config.yaml and instruction files as "blocking" with config as canonical. The repo's own instruction files diverge from config.yaml and no validator catches it. Users who correctly follow setup don't know their instruction files don't match config.

**Why it happens:** `ask-first-boundaries` validates count > 0 only. `ask-first-structural-sync` does compare config paths against instruction file content, but uses glob-unaware exact `includes()` - so `workflow/setup/**` (config) doesn't match `workflow/setup/` (instruction file). The comparison check exists but generates false positives on any project that writes boundaries without `/**` glob syntax. Step 06 calls sync "blocking" but quality checks are advisory and never affect exit code.

**Evidence:**
- `.goat-flow/config.yaml:52-64` - 6 entries with `/**` glob syntax (workflow/setup/\*\*, etc.)
- CLAUDE.md Ask First - paths written without glob (`workflow/setup/`, `workflow/skills/`)
- `src/cli/audit/harness-checks.ts:497-499` - `includes(p.toLowerCase())` with raw config path including `/**`
- `workflow/setup/06-final-verification.md` - calls sync "blocking", says config is canonical; audit never blocks on this

**Fix:** `normalizePath()` added at `src/cli/audit/harness-checks.ts:489-504` normalises glob-suffixed paths before comparison. Step 06 "BLOCKING" language downgraded to advisory (M30 A6). Confirmed: constraints score 100%.

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

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

---

## Footgun: Deduplicated multi-agent setup drifts from per-agent setup rules (RESOLVED)

**Status:** resolved | **Created:** 2026-03-25 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

`--agent all` and `composeMultiAgentSetup()` were both removed. `compose-setup.ts` no longer has a multi-agent path; setup now requires an explicit `--agent` flag and routes per-agent only. Verified: `grep composeMultiAgentSetup src/cli/prompt/compose-setup.ts` returns no results.
