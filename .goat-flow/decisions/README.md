# Decision Records

This directory now has two live layers plus a historical summary:

- **Core ADRs**: current architectural decisions that still define the framework.
- **Secondary ADRs**: current but narrower repo, product-surface, or tooling decisions.
- **Deleted historical topics**: superseded, merged, or overly narrow records whose surviving meaning is summarized below and preserved in git history.

## Core ADRs

- `ADR-003` - reference-based setup prompts
- `ADR-004` - config + learning-loop storage model
- `ADR-007` - shared skill conventions extraction
- `ADR-008` - instruction budget constraint
- `ADR-009` - skill consolidation and canonical-skill doctrine
- `ADR-010` - setup file ownership
- `ADR-013` - audit as the sole evaluation engine
- `ADR-014` - optional project calibration config
- `ADR-016` - cold-path truth maintenance
- `ADR-017` - active-plan marker
- `ADR-018` - no standalone `goat-verify`
- `ADR-019` - skill naming/routing cleanup

## Secondary ADRs

- `ADR-001` - confusion-log removal
- `ADR-002` - preflight skill replaced by security skill
- `ADR-005` - no implementation skill
- `ADR-006` - autonomous skill mode
- `ADR-011` - critique as a core feature
- `ADR-012` - quality-check expansion
- `ADR-015` - remove `stop-lint.sh` from core
- `ADR-020` - accepted Copilot CLI first-class support

## Deleted Historical Topics

The following topics were removed as standalone ADR files on 2026-04-18 after their surviving guidance was folded into umbrella records:

- confusion-log disposition now lives in `ADR-001`
- shared-conventions history (keep inline / expand inline / flush-protocol enforcement) now lives in `ADR-007`
- dispatcher counting and the original 9→6 consolidation pass now live in `ADR-009`
- category-bucket learning-loop format now lives in `ADR-004`
- local-only `userRole` config handling now lives in `ADR-014`
- retired scanner-era simplifications and heuristics are preserved in `ADR-013` and git history
- the retired spec-artifact workflow is preserved in git history; the current replacement is milestone files plus goat-review Spec Drift
- evidence lifecycle state markers now live in `ADR-016`
- dispatcher build history now lives in `ADR-009`
- audit-era agent-check regrouping now lives in `ADR-013`
- the shared-preamble pattern from the retired `RULES.md` cleanup now lives in `ADR-018`
- repo-layout history, the ask-first hook lesson, the older skill-copy model, narrow tooling ADRs, and harness-card presentation are preserved in git history rather than the live ADR set
- the deferred public-audit skill-integrity note was removed from the live ADR set; cold-path truth maintenance remains in `ADR-016`
