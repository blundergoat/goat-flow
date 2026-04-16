# ADR-036: Remove scanner/rubric system, drive setup from audit

**Date:** 2026-04-13
**Status:** Accepted
**Supersedes:** Earlier draft that proposed keeping both systems

## Context

At the time of this decision, goat-flow had two separate evaluation engines:

1. **Scanner/rubric** (`src/cli/rubric/`, `src/cli/scanner/`, `src/cli/scoring/`, now removed) - 79 rubric checks (28 foundation + 51 standard) + 12 anti-patterns. Point-based scoring with tiers, categories, and deductions. Originally the only evaluation system. The `scan` command was removed first, but the engine continued to be called by `setup`, `info rubrics`, `info anti-patterns`, and the dashboard `/api/setup` endpoint.

2. **Audit** (`src/cli/audit/`) - 17 build checks (7 project setup + 10 per-agent, pass/fail) + 27 quality checks (advisory percentage). Deterministic. User-facing via `goat-flow audit`. Powers CI gates, dashboard `/api/audit`, and critique prompt generation.

Seven-agent critique exposed the consequences of running both:
- Setup reported "All audit checks pass" while actually running scanner checks
- Setup reported hook counts by counting scanner rubric category hits, not actual hook files
- On broken repos, setup dropped into scanner vocabulary ("5 checks need attention out of 79 total", "Anti-Pattern Fixes") - different from the audit model users saw everywhere else
- CONTRIBUTING.md sent contributors to `src/cli/rubric/` when they wanted `src/cli/audit/`
- `info rubrics` output 79 checks while `audit` showed 15+25 - no doc bridged these
- architecture.md claimed "~165 rubric checks" (stale count) alongside the audit check counts on the same line

The scanner served its purpose as the original evaluation engine. The audit system replaced it for all public-facing use. The scanner had become dead weight creating confusion.

## Decision

Delete the scanner/rubric system entirely. Make audit the single evaluation engine driving all goat-flow commands including setup.

## Setup Flow After Migration

Setup uses `classifyProjectState()` for routing and `runAudit()` for validation. The scanner's 5-mode percentage routing (100%, 90-99%, 50-89%, <50%) collapses to a simpler model:

```
setup --agent claude
  → classifyProjectState(fs, "claude")
    → bare/partial      → full setup guide (stack from detectStack(), steps from workflow/setup/)
    → v0.9/v1.0         → redirect to upgrade guide
    → v1.1              → runAudit(fs, path, { agentFilter: "claude" })
      → PASS            → success message with real counts from extractProjectFacts()
      → FAIL            → list failing checks with howToFix + reference to relevant setup steps
```

**Key architectural insight:** `extractProjectFacts()` (`src/cli/facts/orchestrator.ts`) is shared infrastructure used by both systems. Stack detection (`detectStack()`), agent enumeration, hook/skill/config facts all come from facts, not from the scanner. Setup can call facts directly for context without `scanProject()`.

**What replaces the scanner's repair guidance:** Each audit build check has a `howToFix` field (defined in `src/cli/audit/agent-setup-checks.ts`). When a check fails, setup renders the check name + howToFix instruction + reference to the numbered setup step that addresses it. This replaces the scanner's 100+ fragment lookup system with direct, per-check guidance.

## Dependency Analysis

**scanProject() call sites (only 2):**
- `src/cli/cli.ts:496` - setup command
- `src/cli/server/dashboard.ts:315` - `/api/setup` endpoint

**RUBRIC_VERSION dependency:** `src/cli/audit/agent-setup-checks.ts:9` imports `RUBRIC_VERSION` from `rubric/version.ts`. This is the only audit→rubric dependency. Fix: derive version from `package.json` (already done at runtime) or move constant to `src/cli/constants.ts`.

**Audit system independence:** `src/cli/audit/` has zero imports from rubric/, scanner/, or scoring/ except the RUBRIC_VERSION constant above. The audit system is ready to be the sole evaluation engine.

**Facts extraction independence:** `src/cli/facts/orchestrator.ts` is consumed by both systems but depends on neither. It provides: `stack` (languages, commands, signals), `agents` (per-agent instruction, settings, skills, hooks), `shared` (footguns, lessons, config, decisions).

## What Gets Removed

**Directories (3):**
- `src/cli/rubric/` - foundation.ts, standard/, anti-patterns.ts, registry.ts, version.ts
- `src/cli/scanner/` - scan.ts, evaluate-check.ts
- `src/cli/scoring/` - calculate.ts, recommendations.ts

**Prompt fragments (3 files):**
- `src/cli/prompt/fragments/foundation.ts` - rubric-tied fix fragments
- `src/cli/prompt/fragments/standard.ts` - rubric-tied fix fragments
- `src/cli/prompt/fragments/anti-patterns.ts` - anti-pattern fix fragments

**CLI commands (2):**
- `info rubrics` (with helpful removal message)
- `info anti-patterns` (with helpful removal message)

**Types from `src/cli/types.ts` (~12 types):**
- CheckDef, AntiPatternDef, CheckResult (scanner version), AntiPatternResult
- TierScore, ScoreSummary, Recommendation, AgentReport, ScanReport
- CheckStatus, Tier, Confidence, Grade (scanner-specific)

**Test files:**
- `test/unit/scanner-foundations.test.ts` - tests rubric registry
- Scanner-related assertions in other test files

**Exports from `src/cli/index.ts`:**
- `getCheck`, `getChecksByTier`, `getChecksByCategory` (rubric registry functions)
- `ScanReport`, `CheckDef`, `AntiPatternDef` type re-exports

## What Gets Rewritten

**`src/cli/prompt/compose-setup.ts`** (largest change):
- Currently 1300+ lines with 5 rendering modes keyed to scanner percentages
- Rewrite to 3 modes: full-setup (bare/partial), upgrade-redirect (v0.9/v1.0), audit-driven (v1.1 pass/fail)
- Success path: real counts from `extractProjectFacts()` (actual hook files, actual skill dirs)
- Failure path: failing audit checks with `howToFix` fields, mapped to setup step numbers
- Stack context: from `detectStack()` directly, not from ScanReport
- Removes: fragment lookups, percentage routing, anti-pattern rendering, recommendation arrays

**`src/cli/prompt/template-filler.ts`:**
- Update to extract variables from facts + audit results instead of ScanReport

**`src/cli/cli.ts`:**
- Setup handler: call `runAudit()` + `extractProjectFacts()` instead of `scanProject()`
- Remove `handleInfoCommand()` and `info` subcommand routing
- Remove `scanProject` import

**`src/cli/server/dashboard.ts`:**
- `/api/setup` endpoint: `runAudit()` + facts instead of `scanProject()`

**`src/cli/constants.ts`:**
- Move `RUBRIC_VERSION` here (or derive from package.json)

## What Stays Unchanged

- `src/cli/audit/` - agent-setup-checks.ts, harness-checks.ts, audit.ts, render.ts, types.ts
- `src/cli/facts/` - orchestrator.ts, fs.ts, agent/, shared/ (shared infrastructure)
- `src/cli/detect/` - agents.ts, project-stack.ts (shared infrastructure)
- `src/cli/config/` - reader.ts, types.ts
- `src/cli/prompt/fragments/full.ts` - promoted fragments (generic instructions, not rubric-tied)
- `src/cli/prompt/registry.ts` - fragment lookup (may need simplification)
- `goat-flow audit`, `goat-flow critique`, `goat-flow status`, `goat-flow dashboard`
- All existing audit and contract tests

## Rationale

- **One truth.** Users, contributors, and agents should see one evaluation model.
- **Setup should speak audit.** When a user runs `audit` and sees 10 setup checks, then runs `setup`, the repair guidance should reference those same 10 checks.
- **The scanner's granularity isn't needed.** Audit's `howToFix` + the 6 numbered setup steps provide the repair guidance. The 25 quality checks provide advisory depth. Between them, they cover what the scanner covered.
- **Facts extraction carries the context.** Stack detection, agent enumeration, and configuration state all come from `extractProjectFacts()` which is independent of both systems. Setup never needed the scanner for context - only for scoring.
- **Massive simplification.** compose-setup.ts collapses from 5 percentage-based modes with 100+ fragment lookups to 3 state-based modes with direct howToFix rendering.

## Risks

- **Setup repair prompts lose granularity.** The scanner's 79 checks gave per-rubric-point instructions. The audit's 15 checks are coarser. Mitigation: audit `howToFix` fields are specific and actionable; the 6 setup steps provide the detailed flow.
- **Breaking change for `info rubrics` consumers.** Mitigation: returns a helpful removal message (same pattern as `scan` removal).
- **Large diff.** Mitigation: scope as a dedicated milestone (M25-H or M26) with its own test gate.

## Consequences

- goat-flow has one evaluation system: audit (build checks + quality checks)
- Setup is driven by audit pass/fail for the specified agent
- compose-setup.ts simplifies from ~1300 lines to the minimum needed for 3 routing modes
- `info rubrics` and `info anti-patterns` are removed
- CONTRIBUTING.md, architecture.md, code-map.md, docs/cli.md all describe one system
- No scanner vocabulary appears in any user-facing surface
