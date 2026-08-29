# ADR-032: Scope gruff-code-quality hook binary discovery to standard install locations

**Status:** Accepted
**Date:** 2026-06-01
**Author(s):** Matthew Hansen
**Ticket/Context:** 1.8.0 user report - nested or build-output Gruff binaries auto-execute on edit
**Updated:** 2026-06-09 - explicit per-language analyzer binary overrides accepted for non-standard monorepos
**Updated:** 2026-07-03 - repo-owned config override `hooks.gruff-code-quality.binaries.<lang>` in `.goat-flow/config.yaml` accepted alongside the env override because a repository-local virtual-environment analyzer otherwise required every session to export `GRUFF_PY_BIN`
**Updated:** 2026-08-29 - approved install and explicit hook enablement may detect and persist the exact `strands_agents/.venv/bin/gruff-py` convention

## Context

The `gruff-code-quality` PostToolUse hook runs on every Edit/Write. To find the
language-specific analyzer it calls `discover_binary()`, which probed, in order:

    vendor/bin  node_modules/.bin  bin/  .venv/bin  */.venv/bin (glob)  target/debug  ~/.local/bin  PATH

and executed the first match (`analyse --help`, then `analyse <file>`). A 1.8.0
A 1.8.0 user report flagged this as RCE-shaped: a name-matched executable sitting
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

The repo-owned form of the same exception is
`hooks.gruff-code-quality.binaries.<lang>` in `.goat-flow/config.yaml` (e.g.
`py: strands_agents/.venv/bin/gruff-py`), so one committed entry covers every
agent and session instead of each runtime exporting an env var. The env
override wins over config. Config values must be repo-relative, resolve inside
the repo root, and name an executable regular file - machine-specific absolute
or home paths stay env-only. The trust level is unchanged: a committed config
entry is the same repo-owned surface as the committed hook script it points
the analyzer selection at, and the hook still never searches arbitrary
subtrees. An override that is set but invalid resolves to nothing with a
specific diagnostic instead of falling back to discovery, so a wrong override
fails loudly rather than silently running a different binary. Toggle writes
preserve the block (`setHookEnabled` spreads the existing entry), and the
config reader/writer carry `binaries` through managed-block rewrites.

Approved installation and explicit `gruff-code-quality` enablement may populate
the repo-owned override when `strands_agents/.venv/bin/gruff-py` already exists,
is executable, resolves to a regular file, and remains inside the selected
project. An existing `binaries` block remains authoritative. This is an exact
project convention, not a recursive search or a new runtime discovery path.
Text-preserving insertion targets only the direct hook mapping; same-spelled
text in nested mappings, quoted scalars, or comments is not configuration.

The runtime is shipped from `workflow/hooks/gruff-code-quality.sh` and installed
centrally at `.goat-flow/hooks/gruff-code-quality.sh` for provider registrations.
A regression test in `test/integration/gruff-code-quality-smoke.test.ts` asserts
that a binary at `*/.venv/bin` or `target/debug` is neither discovered nor
executed. The hook comment states the exclusions and reason inline, so downstream
installs carry the rationale.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Keep all paths | Glob/build-output binary auto-executed on edit; the reported risk remains | Rejected - residual surface for no benefit |
| PATH-only by default | Breaks npm (`node_modules/.bin`) and composer (`vendor/bin`) installs - gruff's normal distribution | Rejected - regresses the supported install method |
| Explicit per-language env override | Extra config surface; a user may still point at an untrusted binary | Accepted as a narrow exception - needed for real monorepos with managed subproject venvs, while preserving no arbitrary-subtree auto-discovery |
| Detect one exact convention during install or hook enablement | The path must exist at configuration time; projects using another layout still configure it explicitly | Accepted - persists visible repo-owned intent without making every edit scan arbitrary subtrees |
| Drop `*/.venv/bin` + `target/debug`, keep ecosystem paths | A binary committed directly to a remaining standard path still runs | Accepted - removes the unanchored/low-value entries while preserving normal installs; residual is below the npm/cargo baseline |

## Reversibility

Two-way door. Re-adding either automatic path is a runtime edit plus a
regression-test change, but it would reopen the reported surface. Revisit only if
a future requirement genuinely needs nested-venv or build-output auto-discovery;
the current mechanism for non-standard locations is an explicit env/config
override, optionally populated from the one accepted project convention during
approved configuration, not always-on globbing.

## Consequences

- Closes the reported unanchored-glob and build-output execution vectors.
- Projects that placed a gruff binary under a nested `*/.venv/bin` or in
  `target/debug` must move it to a standard location (`.venv/bin`,
  `node_modules/.bin`, `vendor/bin`, `bin/`, `~/.local/bin`), put it on PATH, or
  set the matching explicit override such as `GRUFF_PY_BIN`. Low impact - these
  are non-standard layouts and override use is visible configuration.
- Projects using `strands_agents/.venv/bin/gruff-py` receive that explicit
  configuration during install or hook enablement when the executable is
  already present; another nested layout is never inferred.
- A reply to the original reporter should explain the npm/cargo baseline, so the residual
  (a directly-committed binary at a standard path) is understood as accepted, not
  missed.
