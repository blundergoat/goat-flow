# ADR-026: Keep workspace boundary audit check path-agnostic

**Status:** accepted
**Date:** 2026-05-01

## Context

The `boundary-guidance-present` harness check (advisory, context concern) verifies that each agent's instruction file contains workspace boundary language - phrases like "controlling workspace", "selected target", or "workspace boundary." The check was added in v1.3.2 to encourage instruction files to distinguish the goat-flow controlling workspace from the selected target project.

In practice, satisfying the check required embedding hardcoded absolute paths in version-controlled instruction files (e.g., `## Workspace Boundary\nThe controlling goat-flow workspace and selected target project are both this checkout: /home/hxdev/projects/feature/healthkit`).

This produced three categories of breakage in the first real-world deployment (Healthkit):

1. **User-specific.** Each developer has a different WSL username and home directory. The path is wrong for every developer except the one who ran setup.
2. **Checkout-specific.** The same repository exists at multiple paths on the same machine (`feature/healthkit`, `deploy/healthkit`, `basedata/healthkit`). The path is wrong for 2 of 3 checkouts.
3. **Redundant.** AI agents already know their working directory at runtime via `pwd` / environment context. Hardcoding it in the instruction file adds no information.

The bug was not the boundary concept itself. The bug was allowing the remedy to become machine-specific content in shared instruction files.

## Decision

Keep the `boundary-guidance-present` check in the harness, but make the expected remediation path-agnostic.

The check requires **every audited agent** to have guidance distinguishing the controlling goat-flow workspace from the selected target project. In aggregate audits, one passing agent does not satisfy the check for other configured agents.

The check and its remediation text must not require hardcoded absolute paths. Suggested wording should describe the relationship between the controlling workspace and selected target project, not a developer's local checkout path.

The "controlling workspace vs. selected target" distinction also remains useful as **runtime context** in quality prompts (`compose-quality.ts`), where current paths are computed dynamically and never committed to shared files.

## Consequences

- Harness check count remains 17; context concern checks remain 5.
- Aggregate `goat-flow audit . --harness` fails the context concern if any audited agent lacks boundary guidance.
- Agent-scoped `goat-flow audit . --harness --agent <id>` evaluates only that agent.
- Existing `## Workspace Boundary` sections remain valid when their content is path-agnostic. Machine-specific absolute paths should be removed by the project maintainer.
- The quality prompt continues to use "controlling workspace" / "selected target" language at runtime.
