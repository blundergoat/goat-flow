# Decision Records

This directory now has three layers:

- **Core ADRs**: current architectural decisions that still define the framework.
- **Secondary ADRs**: current but narrower repo, product-surface, or tooling decisions.
- **Historical / debt records**: superseded decisions, merged records kept for stable links, and open decision-debt notes.

`Merged into` means the surviving guidance lives in another ADR, but the old file remains as a short historical stub so existing links do not break.

## Core ADRs

- `ADR-008` - reference-based setup prompts
- `ADR-018` - config + learning-loop storage model
- `ADR-028` - shared skill conventions extraction
- `ADR-029` - instruction budget constraint
- `ADR-030` - skill consolidation and canonical-skill doctrine
- `ADR-031` - setup file ownership
- `ADR-036` - audit as the sole evaluation engine
- `ADR-039` - optional project calibration config
- `ADR-041` - cold-path truth maintenance
- `ADR-043` - active-plan marker
- `ADR-045` - no standalone `goat-verify`
- `ADR-046` - skill naming/routing cleanup

## Secondary ADRs

- `ADR-001` - unified root layout
- `ADR-003` - confusion-log removal
- `ADR-004` - preflight skill replaced by security skill
- `ADR-006` - remove ask-first guard hook
- `ADR-009` - evidence lifecycle convention
- `ADR-012` - canonical skill location / copy model
- `ADR-019` - no implementation skill
- `ADR-022` - autonomous skill mode
- `ADR-027` - Node version source of truth
- `ADR-032` - Prettier formatting
- `ADR-033` - critique as a core feature
- `ADR-034` - quality-check expansion
- `ADR-035` - remove Copilot
- `ADR-037` - skill-integrity public-audit gap
- `ADR-038` - consolidate agent setup checks
- `ADR-040` - remove `stop-lint.sh` from core
- `ADR-042` - remove `RULES.md`
- `ADR-044` - summary-first harness cards

## Historical ADRs

- `ADR-002` - historical scanner-era simplification
- `ADR-005` - historical superseded spec-artifact workflow
- `ADR-010` - merged into `ADR-003`
- `ADR-011` - merged into `ADR-028`
- `ADR-014` - historical scanner-era project-type decision
- `ADR-015` - historical scanner-era heuristic
- `ADR-016` - merged into `ADR-030`
- `ADR-017` - merged into `ADR-030`
- `ADR-021` - merged into `ADR-018`
- `ADR-023` - merged into `ADR-028`
- `ADR-024` - merged into `ADR-028`
- `ADR-026` - merged into `ADR-039`

## Decision Debt

- `2026-04-18-M08-skill-tdd-no-target-repro.md` - consolidated M08 RED-baseline no-repro record
- The three original 2026-04-18 per-skill notes remain as historical stubs that point here.
