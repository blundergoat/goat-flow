# ADR-027: Remove DDT layer reference packs

**Status:** accepted
**Date:** 2026-05-02

## Context

The `ddt-layer/` directory in `.goat-flow/skill-reference/` contained per-language static analysis reference packs (php.md, typescript.md) that goat-plan's testing gates referenced for language-specific linter and type checker instructions.

## Decision

Remove the `ddt-layer/` directory entirely. Replace the goat-plan reference with a generic instruction to detect language from project structure and include appropriate static analysis checks.

## Rationale

- **Doesn't scale.** Every target project has different languages, linters, and static analysis preferences. Shipping per-language reference packs inside goat-flow means maintaining an ever-growing set of files that can't cover arbitrary project toolchains.
- **Wrong layer.** Language-specific linter configuration belongs to the target project (its `package.json`, `composer.json`, CI config, or local instruction file), not to the framework that installs skills.
- **Agents already know this.** Modern coding agents can detect `tsconfig.json` or `composer.json` and infer the right static analysis commands without a reference file telling them what `phpstan` or `tsc --noEmit` does.

## Consequences

- goat-plan testing gates now say "language-appropriate linters, type checkers, and static analysis" without pointing at a specific reference pack.
- Target projects that want specific static analysis instructions should put them in their own instruction file or `.goat-flow/config.yaml`, not in a goat-flow-shipped reference pack.
