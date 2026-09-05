# ADR-013: Remove scanner/rubric system, drive setup from audit

**Date:** 2026-04-13
**Status:** Accepted
**Updated:** 2026-09-05 - condensed; the implementation inventory and check counts are dropped now that the removal has shipped. Earlier amendments removed a drift-prone line-count claim (2026-05-18), refreshed handler anchors (2026-08-04), and absorbed the determinism constraint from now-removed ADR-012 (2026-08-15).

## Context

goat-flow ran two evaluation engines. The scanner/rubric system (`src/cli/rubric/`, `src/cli/scanner/`, `src/cli/scoring/`, all now removed) scored 79 rubric checks and 12 anti-patterns with tiers and deductions; after the `scan` command went, `setup`, `info rubrics`, and the dashboard setup endpoint still called it. The audit (`src/cli/audit/`) was the deterministic path users saw in `goat-flow audit`, CI gates, and the dashboard.

A seven-agent critique showed the cost of running both. Setup claimed "All audit checks pass" while running scanner checks, counted hooks by rubric hits rather than files, dropped into scanner vocabulary on broken repos, and sent contributors to `src/cli/rubric/` when they wanted the audit. Docs carried stale rubric counts beside audit counts on the same line.

Scanner-era refinements survive only as history: project-shape scoring was removed for inconsistent results, project type was constrained to detection and guidance, and anti-pattern AP13 learned to distinguish real project paths from deny-list patterns. Audit-era cleanup regrouped nine flat agent checks into four surfaces (`agent-instruction`, `agent-skills`, `agent-settings`, `agent-deny-hook`) and dropped three dead agent checks rather than carrying them forward.

## Decision

Audit is the single evaluation engine for every goat-flow command, including setup; the scanner/rubric system is deleted.

Every audit check is deterministic: no LLM calls, randomness, network I/O, or clock dependence. A check that cannot produce the same verdict from the same filesystem state does not belong in the audit. The scanner-era `feedback-recency` check compared file dates against a 90-day window; nothing under `src/cli/audit/` reads the clock today. Agent judgment lives in the separate `quality` command, which produces a prompt and a saved report, not an audit verdict.

Setup routes on `classifyProjectState()` and validates with `runAudit()`:

```
setup --agent <id>
  -> classifyProjectState(fs, agent)
    -> bare/partial    -> full setup guide (stack from detectStack(), steps from workflow/setup/)
    -> v0.9/outdated   -> upgrade guide
    -> current         -> runAudit(fs, path, { agentFilter: agent })
       -> PASS         -> success with counts from extractProjectFacts()
       -> FAIL         -> failing checks with howToFix + the numbered setup step that addresses each
```

`extractProjectFacts()` (`src/cli/facts/orchestrator.ts`) is shared infrastructure: stack, agents, hooks, skills, and config facts come from it, so setup never needed the scanner for context, only for scoring. Each setup-scope check carries a `howToFix` field (`src/cli/audit/check-agent-setup.ts`, `src/cli/audit/check-goat-flow.ts`) that replaces the scanner's fragment lookups. Call sites: `src/cli/cli-handlers.ts` (search: `const output = composeSetup`) and `src/cli/server/dashboard-audit-routes.ts` (search: `if (url.pathname !== "/api/setup")`).

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep both engines | Two vocabularies and two counts, with a setup that reports one engine while running the other | Rejected |
| Keep the scanner, drop the audit | Loses the deterministic CI gate and the surface users already know | Rejected |
| Audit only, with `howToFix` per check | Coarser repair guidance than 79 rubric points; the six numbered setup steps and specific `howToFix` text carry the detail | Accepted |

## Consequences

- One evaluation model across CLI, dashboard, docs, and setup; no scanner vocabulary on any user-facing surface.
- `info rubrics` and `info anti-patterns` return a removal message, as `scan` did.
- `src/cli/prompt/compose-setup.ts` has three state-based modes instead of five percentage bands with fragment lookups.
