# ADR-040: Remove stop-lint.sh from goat-flow core

**Date:** 2026-04-15
**Status:** Implemented

## Context

goat-flow shipped `stop-lint.sh` as a post-turn hook across all three agents (Claude Stop, Gemini AfterAgent, Codex Stop). The script ran shellcheck on changed `.sh` files and `tsc --noEmit` on changed `.ts` files after every agent turn.

Problems:

1. **Stack guessing is unreliable.** The script hardcodes shellcheck + tsc. Consumer projects using Python, Go, Rust, PHP, or anything else get a hook that does nothing useful - or worse, runs the wrong tool. There's no reliable way to auto-detect the project stack from a shell script without the kind of project calibration that ADR-039 deferred.
2. **Hook enforcement mode was documented three different ways.** The Codex header said "advisory by default", the setup docs said "advisory by default", but the actual code defaulted to enforce (`GOAT_LINT_ENFORCE:-1`). Three critiques independently flagged this contradiction.
3. **The hook is project-specific by nature.** Every project has different linters, configs, and performance constraints. A framework-shipped lint hook is either too generic to be useful or too opinionated to be portable.

## Decision

Remove `stop-lint.sh` from goat-flow core for v1.1.0:

1. Delete all `stop-lint.sh` files (`.claude/hooks/`, `.gemini/hooks/`, `.codex/hooks/`, `scripts/`).
2. Remove Stop/AfterAgent hook registrations from all agent settings files.
3. Remove the "Hook enforcement mode" section from setup docs.
4. Keep the audit's post-turn hook detection code (`check-verification.ts`, `hooks.ts`) - consumer projects may have their own post-turn hooks.
5. Keep the `GOAT_LINT_ENFORCE` advisory in the audit harness - it guides consumer projects that adopted the pattern.

## Consequences

- Harness verification score drops (91 → ~83 for goat-flow's own repo) due to "No post-turn hooks found to evaluate." This is accurate.
- Consumer projects that already have `stop-lint.sh` are unaffected - the audit still detects and evaluates their hooks.
- Post-turn linting will be revisited in a later version, likely calibrated via `config.yaml` toolchain commands (see ADR-039) rather than stack-guessing in a shell script.
