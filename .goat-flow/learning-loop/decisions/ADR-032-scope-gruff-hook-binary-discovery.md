# ADR-032: Scope gruff-code-quality hook binary discovery to standard install locations

**Status:** Accepted
**Date:** 2026-06-01
**Author(s):** Matthew Hansen
**Ticket/Context:** 1.8.0 user report - nested or build-output Gruff binaries auto-execute on edit
**Updated:** 2026-09-05 - condensed; a duplicated Context line is removed. Earlier amendments accepted per-language env overrides (2026-06-09), the repo-owned config override (2026-07-03), and one detected venv convention (2026-08-29).

## Context

The `gruff-code-quality` PostToolUse hook runs on every Edit and Write. To find the language analyzer, `discover_binary()` probed `vendor/bin`, `node_modules/.bin`, `bin/`, `.venv/bin`, `*/.venv/bin` (a glob), `target/debug`, `~/.local/bin`, then `PATH`, and executed the first match. A 1.8.0 user report called this RCE-shaped: a name-matched executable in one of those paths runs on the next edit, repo-local paths beat `PATH`, and there is no integrity check.

The marginal risk is low for the package-manager paths. `node_modules/.bin`, `vendor/bin`, and `.venv/bin` are populated by `npm install`, `composer install`, or `pip install`, each of which already runs attacker-controlled lifecycle code before the hook fires. Two entries were the exception: the unanchored `*/.venv/bin` glob walks every top-level subdirectory, and `target/debug` is build output rather than an install location. Both cover the one case the package-manager argument does not, a binary committed directly into a cloned repo where the hook could be its first execution.

## Decision

`discover_binary()` searches only standard per-ecosystem install locations, and any other analyzer location must be named explicitly.

- **Probe order:** `vendor/bin`, `node_modules/.bin`, `bin/`, `.venv/bin`, `~/.local/bin`, `PATH`. The `*/.venv/bin` glob and `target/debug` are removed; repo-local precedence over `PATH` is unchanged. PATH-only scoping is not adopted because `node_modules/.bin` and `vendor/bin` are gruff's primary install targets.
- **Env overrides.** `GRUFF_<LANG>_BIN` (`GRUFF_TS_BIN`, `GRUFF_PY_BIN`, and so on for each supported language suffix) may name an analyzer outside the standard locations. The hook never searches arbitrary subtrees; a user names the exact executable.
- **Config override.** `hooks.gruff-code-quality.binaries.<lang>` in `.goat-flow/config.yaml` is the repo-owned form, so one committed entry covers every agent and session. Values must be repo-relative, resolve inside the repo root, and name an executable regular file; machine-specific absolute or home paths stay env-only. Env wins over config. A set but invalid override resolves to nothing with a specific diagnostic instead of falling back to discovery. Toggle writes preserve the block (`setHookEnabled` spreads the existing entry), and the config reader and writer carry `binaries` through managed-block rewrites.
- **One detected convention.** Approved install and explicit hook enablement may populate the config override when `strands_agents/.venv/bin/gruff-py` already exists, is executable, resolves to a regular file, and stays inside the selected project. An existing `binaries` block is authoritative. This is an exact path check, not a recursive search or a runtime discovery path, and text-preserving insertion targets only the direct hook mapping.

The runtime ships from `workflow/hooks/gruff-code-quality.sh` and installs to `.goat-flow/hooks/gruff-code-quality.sh`. `test/integration/gruff-code-quality-smoke.test.ts` asserts that a binary at `*/.venv/bin` or `target/debug` is neither discovered nor executed, and the hook comment states the exclusions inline so downstream installs carry the rationale.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Keep all probe paths | A glob or build-output binary auto-executes on edit; the reported risk stays | Rejected |
| PATH-only discovery | Breaks the npm and composer install methods | Rejected |
| Explicit per-language env override | Extra configuration; a user can still point at an untrusted binary | Accepted as the monorepo exception |
| Repo-owned config override | Same trust level as the committed hook script it steers; fails loudly when invalid | Accepted |
| Detect one exact convention at install or enablement | The path must exist at configuration time; other layouts configure explicitly | Accepted |
| Drop the glob and `target/debug`, keep ecosystem paths | A binary committed to a remaining standard path still runs, a residual below the npm and cargo baseline | Accepted |

## Reversibility

Two-way. Re-adding either automatic path is a hook edit plus a regression-test change, but it reopens the reported surface. Revisit only if a requirement needs nested-venv or build-output auto-discovery; the mechanism for non-standard locations is the explicit override.

## Consequences

- Projects with a gruff binary under a nested `*/.venv/bin` or in `target/debug` move it to a standard location, put it on `PATH`, or set the matching override.
- Projects using `strands_agents/.venv/bin/gruff-py` receive the config entry during install or enablement when the executable is present; no other nested layout is inferred.
