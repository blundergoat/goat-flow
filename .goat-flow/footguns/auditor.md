---
category: auditor
---

## Footgun: Scanner reports enforcement features it didn't detect

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Scanner gives Codex full marks for deny hook quality (jq parsing, chaining detection, compaction hook) when the Codex enforcement is actually a Starlark execpolicy file - a completely different format that doesn't use jq or split on &&/||/;.

**Why it happens:** `src/cli/facts/agent/hooks.ts` hardcodes `denyUsesJq = true` and `denyHandlesChaining = true` for execpolicy agents, and treats `session_start` hooks as compaction hooks. These are assumptions, not detections. The auditor reports them as facts.

**Evidence:**
- `src/cli/facts/agent/hooks.ts` → hardcoded assumptions for Codex enforcement quality
- goat-flow Codex self-review (66/100): "the auditor fakes Codex compaction and deny-hook properties"

**Prevention:** Only report what's actually detected from file content. If a Starlark file exists, report it exists - don't assume it has properties that only apply to bash hooks.

---

## Footgun: Scanner AP2 penalizes project-specific skills

**Status:** resolved | **Created:** 2026-04-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Scanner deducts -3 for any skill directory that doesn't start with `goat-`. Projects with custom skills (`deploy/`, `lint-fix/`, `preflight/`) get penalized and the setup fragment tells the agent to rename them to `goat-deploy/` etc.

**Why it happens:** AP2 assumed all skills in a project should have the `goat-` prefix. The check was dead code (could never trigger because `skills.found` only contains canonical goat-flow names from `SKILL_NAMES`), but the associated fragment `ap-fix-skill-names` contained harmful instructions that would rename project-specific skills.

**Evidence:**
- `src/cli/rubric/anti-patterns.ts` → AP2 check (removed)
- `src/cli/prompt/fragments/anti-patterns.ts` → `ap-fix-skill-names` fragment (removed)
- halaxy-agents-lab had project-specific `preflight/`, `audit/`, `review/` skills that would have been flagged

**Prevention:** Scanner checks should only validate goat-flow's own skills (from `SKILL_NAMES`), never impose naming conventions on project-specific skills. The `goat-` prefix is a goat-flow convention, not a universal rule.

---

## Footgun: Scanner gives 100% while generated files are broken

**Status:** open | **Created:** 2026-04-03 | **Evidence:** ACTUAL_MEASURED

The scanner awards 100% (A grade) to projects that have:
- `settings.json` missing hook registration that the rubric claims exists (`src/cli/facts/agent/hooks.ts:479`, `src/cli/rubric/standard/hooks.ts:55` check file existence only)
- Skill files that pass structural checks but have stale internal references or missing playbook dependencies
- CI workflow containing literal scanner-bait comments (`.github/workflows/context-validation.yml:40`)

**Evidence:** Found by Codex on blundergoat-platform (100% score, broken goat-plan SKILL.md + unregistered hook), strands-php-client (100% score with structural issues).

**Impact:** The scanner rewards formatting compliance, not functional correctness. Users trust A/100 as "setup is good" when it means "setup matches regex patterns."

**Fix:** Add semantic validation: verify hook registration, validate skill file content.

---

## Footgun: Audit passes when configured agent's instruction file is missing

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `audit --agent codex` returns PASS on a project where AGENTS.md doesn't exist. Aggregate `audit .` also passes. The configured agent is invisible to all checks. Dashboard only builds per-agent cards for detected agents, so the missing agent disappears from the UI too.

**Why it happens:** `detect/agents.ts:62` only adds agents whose instruction files exist on disk. `orchestrator.ts:29` filters detected agents by `agentFilter` — filtering for a missing agent produces an empty list. `build-checks.ts:175` (instruction-files check) iterates `ctx.agents` — empty list = vacuous pass. The audit uses instruction-file presence as the source of truth for which agents to check, creating a circular dependency where missing files can't be detected.

**Evidence:**
- `src/cli/detect/agents.ts:62` — existence gate: `if (fs.exists(profile.instructionFile))`
- `src/cli/facts/orchestrator.ts:29` — filter on detected: `agents = agents.filter(a => a.id === options.agentFilter)`
- `src/cli/audit/build-checks.ts:175` — iterates ctx.agents, never sees the missing agent
- `src/cli/audit/build-checks.ts:99` — agents-supported only validates names against known set, doesn't cross-reference with detected agents
- Reproduced by external critique on temp copy with AGENTS.md deleted: both aggregate and `--agent codex` returned PASS

**Fix:** Cross-reference `config.yaml` configured agents list with detected agents. If a configured agent's instruction file is missing, inject the agent profile anyway so the instruction-files check can report the failure. Design intent: setup should CREATE the instruction file if missing, or EDIT it to add goat-flow sections if it exists.

---

## Footgun: Setup reports scanner metrics as audit results

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `setup --agent claude` says "All audit checks pass" and "14 hooks (deny, post-turn, format)" on a repo with 2 hook files and 3 hook events. The numbers don't match any real count. On broken repos, setup drops into scanner vocabulary ("5 checks need attention out of 79 total", "Critical: Anti-Pattern Fixes") — a completely different model from the documented 10 setup + 5 harness checks.

**Why it happens:** `cli.ts:494` calls `scanProject()` (not `runAudit()`) for the setup command. `compose-setup.ts:172-174` counts passing scanner rubric checks in the "Hooks" category, not actual hook files. The success branch at `compose-setup.ts:153` says "All audit checks pass" but is evaluating scanner results.

**Evidence:**
- `src/cli/cli.ts:494` — setup calls `scanProject()`
- `src/cli/prompt/compose-setup.ts:153` — renderAllPass says "All audit checks pass"
- `src/cli/prompt/compose-setup.ts:172-174` — `checks.filter(c => c.category === "Hooks" && c.status === "pass").length` = 14 (rubric hits, not files)
- Observed setup output: "14 hooks" vs `ls .claude/hooks/` showing 2 files
- On broken repo (config.yaml removed): setup emits "5 checks need attention out of 79 total" — scanner vocabulary, not audit vocabulary

**Fix:** Either migrate setup to use `runAudit()` for its pass/fail decisions, or explicitly label the output as scanner-based. Replace hook count with actual file/event count from facts extraction.

---

## Footgun: Scanner validates hook file content but not hook runtime behavior

**Status:** open | **Created:** 2026-04-05 | **Evidence:** ACTUAL_MEASURED

The scanner checks that hook files exist, contain the right patterns (jq parsing, chaining detection, pipe-to-shell blocking), and are registered in settings.json. But it never verifies the hooks actually execute. A hook with correct content but wrong permissions, missing dependencies (jq not installed), or broken JSON field paths passes the scanner at 100% while providing zero enforcement at runtime.

**Evidence:**
- 4+ sessions across 112 (Claude Insights data) derailed by sub-agent permission failures hitting hooks that the scanner had already validated
- `deny-dangerous.sh` sed fallback truncates commands with escaped quotes - scanner checks for sed fallback existence, not correctness

**Impact:** Users trust 100% scanner score as "setup is working" when it means "setup files look right." The gap between file validation and runtime behavior is invisible.

**Prevention:**
1. Add a setup completion smoke test: pipe a known-blocked command through the deny hook and verify exit code 2
2. Scanner should verify hook registration matches hook files (file exists → must be registered, registered → file must exist)
3. Consider a `goat-flow verify` command that does runtime checks vs the current `goat-flow scan` which does static checks

---

## Footgun: ask_first structural sync check generates false positives via glob-unaware comparison

**Status:** active | **Created:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `audit . --quality --agent claude` reports "2 ask_first paths not in instruction file: workflow/setup/\*\*, workflow/skills/\*\*" on this repo's own CLAUDE.md. Both paths ARE in CLAUDE.md — formatted as `workflow/setup/` and `workflow/skills/` (without trailing `/**`). The framework fails its own quality check on its own instruction file.

**Why it happens:** `quality-checks.ts:497-499` uses exact-string `includes()` to check whether instruction file content contains each config path:
```typescript
const notMentioned = configPaths.filter(
  (p) => !lower.includes(p.toLowerCase()),
);
```
`configPaths` comes from `boundaries.map((b) => b.path)` — the raw config.yaml values including `/**` glob syntax. CLAUDE.md writes boundaries as `workflow/setup/` (no glob). `lower.includes("workflow/setup/**")` is false; `lower.includes("workflow/setup/")` would be true. The comparison is glob-unaware, so any project that writes boundaries without `/**` gets a false advisory.

**Evidence:**
- `src/cli/audit/quality-checks.ts:484,497-499` — `configPaths = boundaries.map((b) => b.path)` then `includes(p.toLowerCase())`
- `.goat-flow/config.yaml:57-60` — paths stored as `workflow/setup/**`, `workflow/skills/**`
- `CLAUDE.md` Ask First section — paths written as `workflow/setup/`, `workflow/skills/`
- Observed: `audit . --quality --agent claude` reports false positive on own repo (confirmed 2026-04-13)

**Fix:** Normalize both sides before comparison. Strip `/**`, `/`, and `*` suffixes from config paths before `includes()` check. Alternatively, check whether the instruction file contains the path as a path prefix (not exact match). The check should pass if any reasonable formatting of the path appears in the instruction file.
