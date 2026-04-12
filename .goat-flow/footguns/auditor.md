---
category: auditor
---

## Footgun: Scanner reports enforcement features it didn't detect

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Scanner gives Codex full marks for deny hook quality (jq parsing, chaining detection, compaction hook) when the Codex enforcement is actually a Starlark execpolicy file - a completely different format that doesn't use jq or split on &&/||/;.

**Why it happens:** `src/cli/facts/agent.ts` hardcodes `denyUsesJq = true` and `denyHandlesChaining = true` for execpolicy agents, and treats `session_start` hooks as compaction hooks. These are assumptions, not detections. The scanner reports them as facts.

**Evidence:**
- `src/cli/facts/agent.ts` → hardcoded assumptions for Codex enforcement quality
- goat-flow Codex self-review (66/100): "the scanner fakes Codex compaction and deny-hook properties"

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
