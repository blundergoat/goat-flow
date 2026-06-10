# ADR-032: Scope gruff-code-quality hook binary discovery to standard install locations

**Status:** Accepted
**Date:** 2026-06-01
**Author(s):** Matthew Hansen
**Ticket/Context:** 1.8.0 user report "F7" - gruff hook auto-executes repo-local binaries
**Updated:** 2026-06-09 - explicit per-language analyzer binary overrides accepted for non-standard monorepos

## Context

The `gruff-code-quality` PostToolUse hook runs on every Edit/Write. To find the
language-specific analyzer it calls `discover_binary()`, which probed, in order:

    vendor/bin  node_modules/.bin  bin/  .venv/bin  */.venv/bin (glob)  target/debug  ~/.local/bin  PATH

and executed the first match (`analyse --help`, then `analyse <file>`). A 1.8.0
user (finding "F7") flagged this as RCE-shaped: a name-matched executable sitting
in one of those paths is auto-run on the next edit, repo-local paths take
precedence over PATH, and there is no integrity check.

Assessment: the marginal risk is low. `node_modules/.bin`, `vendor/bin`,
`target/debug`, and `.venv/bin` only get populated by `npm install`,
`composer install`, `cargo build`, or `pip install` - each of which already runs
attacker-controlled lifecycle/build code before the hook ever fires. In those
ecosystems the hook is neither the first nor the weakest execution path, and the
discovery list is otherwise reasonable: each entry is the *standard* install
location for one ecosystem's package manager.

Two entries are the exception - sketchy and low value:

- `*/.venv/bin` is an unanchored glob that walks every top-level subdirectory, so
  it can pick up a binary from an arbitrary subtree the user never installed into.
- `target/debug` is build output, not an install location; it is the path most
  likely to hold an unexpected, non-package-manager binary.

Both are also the one case the package-manager argument does not cover: a binary
committed directly into a cloned repo, where the hook could be its first execution.

## Decision

`discover_binary()` searches only standard per-ecosystem install locations:

    vendor/bin  node_modules/.bin  bin/  .venv/bin  ~/.local/bin  PATH

The `*/.venv/bin` glob and `target/debug` entries are removed. Precedence
(repo-local before PATH) is unchanged. PATH-only scoping is **not** adopted,
because `node_modules/.bin` and `vendor/bin` are the normal install targets for
gruff's npm and composer distributions - forcing PATH-only would break the
primary install method.

Explicit per-language binary overrides are accepted as the narrow monorepo
exception: `GRUFF_TS_BIN`, `GRUFF_PHP_BIN`, `GRUFF_GO_BIN`, `GRUFF_RS_BIN`, and
`GRUFF_PY_BIN` may point at an executable analyzer path outside the standard
locations. This preserves the security property because the hook does not search
arbitrary subtrees; a user or configured environment names the exact executable.

The change applies to all five shipped copies: `workflow/hooks/`, `.claude/hooks/`,
`.github/hooks/`, `.codex/hooks/`, `.agents/hooks/`. It is locked by a regression
test in `test/integration/gruff-code-quality-smoke.test.ts` asserting a binary at
`*/.venv/bin` or `target/debug` is neither discovered nor executed. The hook
comment states the exclusions and reason inline (no repo-internal path reference),
so downstream installs carry the rationale.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep all paths | Glob/build-output binary auto-executed on edit; F7 stands | Rejected - residual surface for no benefit |
| PATH-only by default | Breaks npm (`node_modules/.bin`) and composer (`vendor/bin`) installs - gruff's normal distribution | Rejected - regresses the supported install method |
| Explicit per-language env override | Extra config surface; a user may still point at an untrusted binary | Accepted as a narrow exception - needed for real monorepos with managed subproject venvs, while preserving no arbitrary-subtree auto-discovery |
| Drop `*/.venv/bin` + `target/debug`, keep ecosystem paths | A binary committed directly to a remaining standard path still runs | Accepted - removes the unanchored/low-value entries while preserving normal installs; residual is below the npm/cargo baseline |

## Reversibility

Two-way door. Re-adding either automatic path is a one-line edit per copy plus
removing the regression test, but it would reopen the F7 surface. Revisit only if
a future requirement genuinely needs nested-venv or build-output auto-discovery;
the current mechanism for non-standard locations is explicit per-language env
override, not always-on globbing.

## Consequences

- Closes the unanchored-glob and build-output execution vectors F7 named.
- Projects that placed a gruff binary under a nested `*/.venv/bin` or in
  `target/debug` must move it to a standard location (`.venv/bin`,
  `node_modules/.bin`, `vendor/bin`, `bin/`, `~/.local/bin`), put it on PATH, or
  set the matching explicit override such as `GRUFF_PY_BIN`. Low impact - these
  are non-standard layouts and override use is visible configuration.
- A reply to the F7 reporter should explain the npm/cargo baseline, so the residual
  (a directly-committed binary at a standard path) is understood as accepted, not
  missed.
