# Footguns

**Traps in the code itself.** A footgun exists whether or not an agent triggers it — it's a property of how the codebase is structured. Example: "renaming one doc breaks 5 others because of dense cross-referencing." The trap is in the architecture, not in what the agent did.

If the agent did something wrong → `docs/lessons.md` instead.

Every entry MUST include file path evidence. Line numbers are optional historical context — they rot and don't need updating.

## Footgun: Cross-reference fragility across docs

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** A renamed or moved file breaks links in multiple documents. Users following getting-started.md hit dead references.

**Why it happens:** Documentation files reference each other by relative path. The project has 60+ markdown files with dense cross-referencing. Renaming one file can break references in 5-10 others.

**Evidence:**
- `docs/getting-started.md` → referenced stale paths to old workflow directory
- `docs/system/five-layers.md` → referenced `FIVE_LAYER_SYSTEM.md` (old filename)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

## Footgun: Concept duplication across core docs

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** A user reads conflicting descriptions of the same concept in different files. An agent follows a rule from one file that contradicts another.

**Why it happens:** The execution loop, autonomy tiers, anti-pattern table, and other core concepts are described in `docs/system-spec.md`, `docs/system/six-steps.md`, `docs/system/five-layers.md`, `docs/getting-started.md`, and `docs/reference/design-rationale.md`. Updating one without updating the others creates drift.

**Evidence:**
- `docs/system-spec.md` → execution loop definition
- `docs/system/six-steps.md` → execution loop definition (detailed version)
- `docs/getting-started.md` → execution loop summary
- `docs/reference/design-rationale.md` → execution loop rationale with repeated content

**Prevention:** When editing a core concept, grep for the concept name across all docs and update every occurrence. `docs/system-spec.md` is the canonical source of truth.

## Footgun: Line target inconsistency for project shapes (RESOLVED)

**Evidence type:** ACTUAL_MEASURED

**Status:** RESOLVED - unified to 120 lines for all project shapes in v0.1.1. The original 100/120 split was dropped after real implementations showed every project with the 6-step loop, budgets, and all required sections lands in the 100-120 range regardless of shape.

**Prevention:** Line target is 120 for all shapes, stated in `docs/system-spec.md`. If this number appears differently in any other file, the spec is canonical.

## Footgun: Setup instructions contradict spec on execution loop steps

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Agents implementing GOAT Flow produce a CLAUDE.md with the old 5-step loop (READ → CLASSIFY → ACT → VERIFY → LOG), missing SCOPE and complexity budgets. Cascades into missing sections (f)-(g) because agents under line pressure cut what the spec doesn't reinforce.

**Why it happens:** `setup/setup-claude.md` tells agents to "Read docs/system-spec.md" FIRST. If system-spec.md shows a different loop than `setup/shared/execution-loop.md`, agents absorb whichever they read first and can't reconcile the contradiction. This caused 7 of 8 gaps in the sus-form-detector implementation.

**Evidence:**
- `docs/system-spec.md` → loop definition in Layer 1 architecture diagram and execution loop section
- `setup/shared/execution-loop.md` → updated loop definition (authoritative)
- `setup/setup-claude.md` → "Read docs/system-spec.md" as first instruction

**Prevention:** After updating `setup/shared/execution-loop.md`, ALWAYS update the same concept in `docs/system-spec.md`, `docs/system/six-steps.md`, and `docs/system/five-layers.md`. The spec is read first by agents - it must match. This is a specific instance of the "concept duplication" footgun above, but critical enough to track separately because it directly causes broken implementations.

**Created:** 2026-03-20

## Footgun: Stale references from old project structure

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Settings, paths, or documentation reference `ai-workflow-framework` (the old project name) instead of `goat-flow`.

**Why it happens:** The project was renamed from `ai-workflow-framework` to `goat-flow`. Not all references were updated.

**Evidence:**
- `.claude/settings.local.json` → contained absolute paths referencing the old project name (file is gitignored, not tracked)

**Prevention:** After any project-level rename, run `grep -r "old-name" --include="*.md" --include="*.json"` across the entire repo.

## Footgun: Agent rewrites shared docs with agent-specific vocabulary

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Shared documentation files (`docs/`, `workflow/`) contain references to only one agent's hook names, paths, or terminology. Other agents reading these docs get incorrect instructions. Tables lose rows for other agents.

**Why it happens:** When an agent is asked to set up or update its platform support, it replaces existing references wholesale instead of adding multi-agent support. The agent treats the task as find-and-replace: `.claude/` → `.gemini/`, `PreToolUse` → `BeforeTool`, "Every Claude turn" → "Every Gemini turn". It does not distinguish between agent-specific files (`setup/setup-gemini.md`) and shared files (`docs/system-spec.md`).

**Evidence:**
- `docs/system-spec.md` → "Every Gemini turn" replaced "Every Claude turn" (should be agent-neutral)
- `docs/system/five-layers.md` → Claude Code row deleted from skills table, replaced with Gemini CLI only
- `docs/system/six-steps.md` → Claude Code hook example replaced with Gemini, not added alongside
- `workflow/runtime/enforcement.md` → all `.claude/` paths replaced with `.gemini/`, creating hybrid state

**Prevention:**
- Agent-specific files (`setup/setup-*.md`, `.claude/`, `.gemini/`) - edits fine
- Shared docs (`docs/`, `workflow/`) - MUST remain agent-neutral or list all agents
- When adding agent support: ADD to tables and examples, never DELETE or REPLACE existing agent references
- Setup prompts MUST include explicit scope constraints: "Do NOT modify files outside `.gemini/` and `GEMINI.md`"

**Created:** 2026-03-21

## Footgun: Multi-agent setup files share structure but not vocabulary

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Gemini CLI rejects hook event names with "Invalid hook event name" warnings. Hooks silently don't run. Users get a working `.claude/` setup but broken `.gemini/` setup from the same instructions.

**Why it happens:** `setup/setup-gemini.md` was derived from `setup/setup-claude.md` by substituting paths (`.claude/` → `.gemini/`, `CLAUDE.md` → `GEMINI.md`) but CLI-specific vocabulary wasn't translated. Each CLI uses different hook event names:
- Claude Code: `PreToolUse`, `PostToolUse`, `Stop`
- Gemini CLI: `BeforeTool`, `AfterTool`, `AfterAgent`, `SessionEnd`

Hook script comments also carried over Claude-specific language ("runs after every Claude turn").

**Evidence:**
- `setup/setup-gemini.md` → Gemini CLI event reference block (BeforeTool, AfterTool, SessionEnd)
- `.gemini/hooks/deny-dangerous.sh` → updated to "BeforeTool hook"
- `.gemini/settings.json` → updated to `BeforeTool` and `AfterAgent` event names

**Prevention:** When creating or updating a setup file for a new CLI, diff it against the source file and check every CLI-specific term - not just paths. Maintain the event name reference block at the top of each CLI's Phase 1c section.

**Created:** 2026-03-21

## Footgun: mv/cp/Write overwrites existing files without checking

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** A file that existed at the destination path is silently overwritten and its content is permanently lost. Especially dangerous for untracked files that have no git recovery path.

**Why it happens:** `mv src dest` and `cp src dest` overwrite `dest` without warning if it already exists. The Write tool does the same. Agents treat rename/move as a single command without checking the destination. If the user then asks to "undo", the agent moves the overwritten content back to the source path - destroying the original destination content entirely.

**Evidence:**
- `docs/roadmaps/TODO_improvements_v0.4.md` → overwritten by `mv TODO_improvements_v0.3.md TODO_improvements_v0.4.md` (2026-03-21). The file was untracked and unrecoverable through git.

**Prevention:**
- Before ANY `mv`, `cp`, or Write to an existing path: run `ls` on the destination first
- If the destination exists, STOP and ask the user before proceeding
- For `mv`: use `mv -n` (no-clobber) instead of bare `mv`
- This is a Never-tier rule - overwriting a file the user didn't ask to overwrite is data destruction

**Created:** 2026-03-21

## Footgun: Deduplicated multi-agent setup drifts from per-agent setup rules

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** `goat-flow setup . --agent all` emits a single deduplicated setup prompt that looks shorter and cleaner than per-agent setup, but it can direct users to scaffold shared skills in the wrong directory, flatten phase-specific guidance into one generic reference, and skip template validation entirely.

**Why it happens:** `composeMultiAgentSetup()` rebuilds the full-setup output as a separate code path instead of reusing the single-agent phase rendering. Its shared table is derived from the first agent's standard refs, so Claude's `.claude/skills/` path leaks into a multi-agent prompt even though shared multi-agent skills are supposed to canonicalize under `.agents/skills/`.

**Evidence:**
- `src/cli/cli.ts` → routes multi-agent full setup through `composeMultiAgentSetup()`
- `src/cli/prompt/compose-setup.ts` → builds shared refs from the first agent only
- `src/cli/prompt/template-refs.ts` → skill output path is derived from `p.skillsDir`
- `src/cli/detect/agents.ts` → Claude profile sets `skillsDir: '.claude/skills'`
- `setup/shared/docs-seed.md` → multi-agent projects should canonicalize skills in `.agents/skills/`

**Prevention:** When adding a condensed or multi-agent output mode, preserve the same invariants as the single-agent path: canonical shared output paths, per-phase agent-specific guidance, and the same template validation gates. If a new setup mode cannot reuse those invariants directly, treat it as a high-risk integration path and audit its rendered output before release.

**Created:** 2026-03-25

## Footgun: Eval templates, parser, and scanner drift out of contract

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** An eval written exactly from the shipped template can fail the scanner, or a valid eval heading accepted by the parser can still fail the rubric. Users create evals that look correct in markdown but lose points in `goat-flow scan`.

**Why it happens:** Eval structure is defined in three places with different assumptions:
- `workflow/evaluation/evals.md` tells users what to write
- `src/cli/evals/parser.ts` decides which headings are semantically equivalent
- `src/cli/facts/shared.ts` performs strict regex checks for the rubric

When one of those changes without the others, the setup guidance stops matching the scan logic.

**Evidence:**
- `workflow/evaluation/evals.md` → template tells users to create an `## Origin` section
- `src/cli/facts/shared.ts` → scanner only accepts `**Origin:**` labels
- `src/cli/evals/parser.ts` → parser treats `Scenario` as equivalent to `Replay Prompt`

**Prevention:** Treat eval shape as a single contract. Any change to allowed headings, label format, or example structure must be updated in the template, parser, and scanner together. Verify with one round-trip test: write an eval from the template, parse it, then confirm it passes the full-tier scan checks.

**Created:** 2026-03-25

## Footgun: Dispatcher intent mapping has no coverage for analysis/evaluation verbs

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** User asks `/goat analyse this plan` or `/goat evaluate the setup`. Dispatcher auto-routes to goat-review without disambiguating. User expected goat-plan (or wanted to choose). The wrong skill loads and the entire interaction is wasted.

**Why it happens:** The dispatcher's intent mapping table has rows mapping keywords to skills. "Analyse", "evaluate", "critique", "assess", and "deeply review" appear in none of them. When no keyword matches, the agent falls through to the closest semantic match instead of triggering the disambiguation path.

**Evidence:**
- `.claude/skills/goat/SKILL.md` → intent mapping table has no row for analyse/evaluate/critique
- `.claude/skills/goat/SKILL.md` → disambiguation table lacks "analyse a plan" ambiguity
- `workflow/skills/goat.md` → same gap in the template version
- Real incident: `/goat deeply analyse this plan: tasks/roadmaps/0.9.3/tasks.md` routed to goat-review without asking (2026-03-30)

**Prevention:** Add analysis/evaluation verbs to the disambiguation table (NOT the intent mapping table — they are inherently ambiguous). When the target is a planning artifact (path contains `roadmap`, `plan`, `todo`, `milestone`), always present goat-review vs goat-plan as options. The dispatcher's job is to route clearly and ask when unclear — not to guess.

**Created:** 2026-03-30

## Footgun: Setup adds skills but never removes them

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** After upgrading goat-flow (e.g., 0.9.0 → 0.9.3), projects end up with 13 skill directories instead of 6. The scanner scores 100% because it only checks the 6 canonical skills — the 7 stale ones are invisible. The dispatcher routes to old skill names. The router table references skills that should have been merged as modes.

**Why it happens:** The setup prompt (AP15 fragment) says "update outdated skills" but never says "delete skills that no longer exist in the canonical set." The scanner has no check for non-canonical skill directories. The agent does exactly what it's told — updates 6 skills, leaves 7 untouched.

**Evidence:**
- `src/cli/prompt/fragments/anti-patterns.ts` → AP15 fragment only instructs "update," not "remove"
- devgoat-bash-scripts: 13 skills after upgrade (7 stale at v0.9.0)
- blundergoat-platform: 13 skills after upgrade (same pattern)

**Prevention:** Setup must explicitly list old goat-flow skill names to delete during upgrade: goat-investigate, goat-simplify, goat-refactor, goat-audit, goat-onboard, goat-reflect, goat-resume, goat-context. The scanner should warn about non-canonical goat-* directories.

**Created:** 2026-03-31

## Footgun: Scanner reports enforcement features it didn't detect

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Scanner gives Codex full marks for deny hook quality (jq parsing, chaining detection, compaction hook) when the Codex enforcement is actually a Starlark execpolicy file — a completely different format that doesn't use jq or split on &&/||/;.

**Why it happens:** `src/cli/facts/agent.ts` hardcodes `denyUsesJq = true` and `denyHandlesChaining = true` for execpolicy agents, and treats `session_start` hooks as compaction hooks. These are assumptions, not detections. The scanner reports them as facts.

**Evidence:**
- `src/cli/facts/agent.ts` → hardcoded assumptions for Codex enforcement quality
- goat-flow Codex self-review (66/100): "the scanner fakes Codex compaction and deny-hook properties"

**Prevention:** Only report what's actually detected from file content. If a Starlark file exists, report it exists — don't assume it has properties that only apply to bash hooks.

**Created:** 2026-03-31

## Footgun: Workflow skill templates lag behind installed skills

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Consumer projects running `npx goat-flow setup` get templates at v0.9.2 while the package is v0.9.3. The setup agent writes "0.9.2" from the template, the scanner flags it as outdated, and the agent has to do a second pass to fix every skill to "0.9.3."

**Why it happens:** The `workflow/skills/*.md` templates are the source of truth for consumer projects. When goat-flow's own installed skills (`.claude/skills/`) get updated, the templates don't automatically follow. The npm publish script doesn't verify template versions match `RUBRIC_VERSION`.

**Evidence:**
- `workflow/skills/goat-debug.md` → frontmatter version lagging behind `.claude/skills/goat-debug/SKILL.md`
- devgoat-bash-scripts review: "templates ship with 0.9.2 but scanner expects 0.9.3"
- halaxy-cypress review: "skill version mismatch between templates and installed package"

**Prevention:** npm publish script or preflight must verify all `workflow/skills/*.md` files have `goat-flow-skill-version` matching `RUBRIC_VERSION`. Fail the publish if they don't match.

**Created:** 2026-03-31

## Footgun: CI template derives skill names by prefixing instead of listing them

**Evidence type:** ACTUAL_MEASURED

**Symptoms:** Consumer project CI workflow checks for `goat-investigate`, `goat-refactor`, `goat-simplify` (all stale) and misses the `goat` dispatcher entirely. When an agent adapts the pattern to include the dispatcher, it prefixes `goat-` to the name `goat`, producing `goat-goat`. The CI check permanently fails for the dispatcher.

**Why it happens:** `src/cli/prompt/fragments/full.ts` CI template had `for skill in security debug investigate review plan test refactor simplify; do` and constructed `goat-$skill`. This design assumes all skill names follow the `goat-{suffix}` pattern, but the dispatcher is just `goat`. The suffix list was also never updated after the 9→6 consolidation — 3 stale suffixes remained.

**Evidence:**
- `src/cli/prompt/fragments/full.ts` → CI template skill loop with stale suffixes and derivation pattern
- halaxy-agents-lab `.github/workflows/context-validation.yml` → `CANONICAL_SKILLS="goat-debug goat-review goat-plan goat-security goat-test goat-goat"` (permanently broken)

**Prevention:** Always iterate canonical skill names directly (`goat goat-debug goat-plan goat-review goat-security goat-test`), never derive them by prefixing. Import from `SKILL_NAMES` in code, or list literal names in templates. The dispatcher name breaks the `goat-{suffix}` pattern.

**Created:** 2026-04-01

## Footgun: Scanner AP2 penalizes project-specific skills

**Evidence type:** ACTUAL_MEASURED

**Status:** RESOLVED — AP2 removed 2026-04-01.

**Symptoms:** Scanner deducts -3 for any skill directory that doesn't start with `goat-`. Projects with custom skills (`deploy/`, `lint-fix/`, `preflight/`) get penalized and the setup fragment tells the agent to rename them to `goat-deploy/` etc.

**Why it happens:** AP2 assumed all skills in a project should have the `goat-` prefix. The check was dead code (could never trigger because `skills.found` only contains canonical goat-flow names from `SKILL_NAMES`), but the associated fragment `ap-fix-skill-names` contained harmful instructions that would rename project-specific skills.

**Evidence:**
- `src/cli/rubric/anti-patterns.ts` → AP2 check (removed)
- `src/cli/prompt/fragments/anti-patterns.ts` → `ap-fix-skill-names` fragment (removed)
- halaxy-agents-lab had project-specific `preflight/`, `audit/`, `review/` skills that would have been flagged

**Prevention:** Scanner checks should only validate goat-flow's own skills (from `SKILL_NAMES`), never impose naming conventions on project-specific skills. The `goat-` prefix is a goat-flow convention, not a universal rule.

**Created:** 2026-04-01
