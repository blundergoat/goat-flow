---
category: auditor
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

## Footgun: Audit passes when configured agent's instruction file is missing

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `audit --agent codex` returns PASS on a project where AGENTS.md doesn't exist. Aggregate `audit .` also passes. The configured agent is invisible to all checks. Dashboard only builds per-agent cards for detected agents, so the missing agent disappears from the UI too.

**Why it happens:** `src/cli/detect/agents.ts:62` only adds agents whose instruction files exist on disk. `orchestrator.ts:29` filters detected agents by `agentFilter` - filtering for a missing agent produces an empty list. `build-checks.ts:229` (`instructionFilesExist`) iterates `ctx.agents` - empty list = vacuous pass. The audit uses instruction-file presence as the source of truth for which agents to check, creating a circular dependency where missing files can't be detected.

**Evidence:**
- `src/cli/detect/agents.ts:62` - existence gate: `if (fs.exists(profile.instructionFile))`
- `src/cli/facts/orchestrator.ts:29` - filter on detected: `agents = agents.filter(a => a.id === options.agentFilter)`
- `src/cli/audit/build-checks.ts:229` - `instructionFilesExist` iterates ctx.agents, never sees the missing agent
- `src/cli/audit/build-checks.ts:99` - agents-supported only validates names against known set, doesn't cross-reference with detected agents
- Reproduced by external critique on temp copy with AGENTS.md deleted: both aggregate and `--agent codex` returned PASS

**Fix:** Cross-reference `config.yaml` configured agents list with detected agents. If a configured agent's instruction file is missing, inject the agent profile anyway so the instruction-files check can report the failure. Design intent: setup should CREATE the instruction file if missing, or EDIT it to add goat-flow sections if it exists.

**Updated:** 2026-04-13
build-checks.ts:173–226 adds configured-agent-present (closes --agent filter vacuous-pass) and agent-artifacts-consistent (closes aggregate vacuous-pass). Repro confirmed failing on both paths 2026-04-13.

---

## Footgun: Audit validates hook file content but not hook runtime behavior

**Status:** open | **Created:** 2026-04-05 | **Evidence:** ACTUAL_MEASURED

The audit checks that hook files exist and pass `bash -n` syntax check, but never verifies hooks actually execute. A hook with correct syntax but wrong permissions, missing dependencies (jq not installed), or broken JSON field paths passes the audit at 100% while providing zero enforcement at runtime.

**Evidence:**
- 4+ sessions across 112 (Claude Insights data) derailed by sub-agent permission failures hitting hooks that the audit had already validated
- `deny-dangerous.sh` sed fallback truncates commands with escaped quotes - audit checks syntax, not correctness

**Impact:** Users trust 100% harness score as "hooks are working" when it means "hooks exist and have valid bash syntax." The gap between file validation and runtime behavior is invisible.

**Prevention:**
1. Add a setup completion smoke test: pipe a known-blocked command through the deny hook and verify exit code 2
2. Audit should verify hook registration matches hook files (file exists → must be registered, registered → file must exist)
3. Consider a `goat-flow verify` command that does runtime checks vs the current `goat-flow audit` which does static checks

---

## Footgun: ask_first structural sync check generates false positives via glob-unaware comparison

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `audit . --quality --agent claude` reports "2 ask_first paths not in instruction file: workflow/setup/\*\*, workflow/skills/\*\*" on this repo's own CLAUDE.md. Both paths ARE in CLAUDE.md - formatted as `workflow/setup/` and `workflow/skills/` (without trailing `/**`). The framework fails its own quality check on its own instruction file.

**Why it happens:** `quality-checks.ts:497-499` uses exact-string `includes()` to check whether instruction file content contains each config path:
```typescript
const notMentioned = configPaths.filter(
  (p) => !lower.includes(p.toLowerCase()),
);
```
`configPaths` comes from `boundaries.map((b) => b.path)` - the raw config.yaml values including `/**` glob syntax. CLAUDE.md writes boundaries as `workflow/setup/` (no glob). `lower.includes("workflow/setup/**")` is false; `lower.includes("workflow/setup/")` would be true. The comparison is glob-unaware, so any project that writes boundaries without `/**` gets a false advisory.

**Evidence:**
- `src/cli/audit/quality-checks.ts:484,497-499` - `configPaths = boundaries.map((b) => b.path)` then `includes(p.toLowerCase())`
- `.goat-flow/config.yaml:57-60` - paths stored as `workflow/setup/**`, `workflow/skills/**`
- `CLAUDE.md` Ask First section - paths written as `workflow/setup/`, `workflow/skills/`
- Observed: `audit . --quality --agent claude` reports false positive on own repo (confirmed 2026-04-13)

**Fix:** `normalizePath()` added at `src/cli/audit/quality-checks.ts:489-504` normalises glob-suffixed paths before comparison. Confirmed: constraints score 100%.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

---

## Footgun: Scanner reports enforcement features it didn't detect (RESOLVED)

**Status:** resolved | **Created:** 2026-03-31 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

The scanner-era hardcoding was removed with the scanner. Current `src/cli/facts/agent/hooks.ts` reads Codex execpolicy via `enrichDenyFromExecpolicy()` from actual file content - no hardcoded assumptions. `denyUsesJq` and `denyHandlesChaining` derive from `analysis.usesJq` / `analysis.handlesChaining` (false by default). The scanner that produced false quality scores was removed in v1.1.0.

---

## Footgun: Scanner gives 100% while generated files are broken (RESOLVED)

**Status:** resolved | **Created:** 2026-04-03 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

The scanner/rubric engine was removed in v1.1.0. The new audit system uses structural build checks (17) plus advisory quality checks (27) - no rubric scoring. The referenced `src/cli/rubric/standard/hooks.ts` no longer exists. The equivalent concern (harness checks passing despite advisory-only hooks) is tracked as a known limitation in docs/audit-and-critique.md.

---

## Footgun: Setup reports scanner metrics as audit results (RESOLVED)

**Status:** resolved | **Created:** 2026-04-13 | **Resolved:** 2026-04-13 | **Evidence:** ACTUAL_MEASURED

The scanner was removed in v1.1.0. `cli.ts` now calls `runAudit()` for setup. `compose-setup.ts` routes by `classifyProjectState()` output, reports actual hook file counts, and uses audit vocabulary throughout. The `scanProject()` function no longer exists. Verified: setup output on clean install shows "7/7 skills", "3 hook scripts", "Audit: all build checks passing" - not scanner counts.
