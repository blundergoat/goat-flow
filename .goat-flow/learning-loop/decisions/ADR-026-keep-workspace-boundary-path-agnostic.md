# ADR-026: Keep workspace boundary audit check path-agnostic

**Status:** Accepted
**Date:** 2026-05-01
**Updated:** 2026-09-05 - condensed; the harness check count is dropped because it drifts on every check addition.

## Context

The `boundary-guidance-present` harness check (advisory, context concern; `src/cli/audit/harness/check-context.ts`) verifies that each agent's instruction file distinguishes the goat-flow controlling workspace from the selected target project. It was added in v1.3.2. In the first real deployment, satisfying it meant embedding an absolute checkout path in a version-controlled instruction file. That path was wrong for every other developer's home directory, wrong for two of the three checkouts of the same repository on one machine, and redundant because agents already know their working directory at runtime.

The bug was not the boundary concept. It was letting the remedy become machine-specific content in a shared file.

## Decision

The check stays, and its remediation must be path-agnostic.

- Every audited agent needs guidance describing the relationship between the controlling workspace and the selected target. In an aggregate audit, one passing agent does not satisfy the check for the others; `--agent <id>` evaluates one agent.
- Neither the check nor its remediation text may require an absolute path. Suggested wording describes the relationship, not a developer's checkout.
- Runtime quality prompts (`src/cli/prompt/compose-quality.ts`) keep using the controlling-workspace and selected-target language with paths computed at run time and never committed.

## Consequences

- Existing `## Workspace Boundary` sections stay valid when path-agnostic; maintainers remove machine-specific paths.
- Aggregate `goat-flow audit . --harness` fails the context concern if any audited agent lacks boundary guidance.
