# ADR-014: Treat `toolchain` and `ask_first` as optional project calibration

**Date:** 2026-04-15
**Status:** Implemented
**Updated:** 2026-09-05 - condensed; this record owns the `agents` field semantics that ADR-033 defers to. Earlier amendments (2026-05-18, 2026-05-19) marked `agents:` legacy.

## Context

`toolchain` and `ask_first` lived in `.goat-flow/config.yaml`, the parser, setup docs, prompts, and harness checks. They forced setup agents to guess project commands and high-risk boundaries during base install, which made 1.1.0 heavier and let machine-readable config drift from the human-reviewed instruction files. `userRole` had a narrower version of the same defect: contract tests asserted a per-user preference in committed project config.

## Decision

`toolchain`, `ask_first`, and `userRole` are optional calibration that the config reader accepts and that setup and audit never require.

1. The shipped scaffold and base setup flow omit `toolchain` and `ask_first`. Parser support stays so existing projects keep working and the fields can return without a schema break.
2. Harness and quality surfaces treat the fields as optional input, not as missing setup. `audit --harness` must not penalise their absence.
3. `userRole` defaults to `developer` when absent; committed config does not store personal preferences.
4. `agents:` is a legacy field: the reader ignores it and the installer removes it. Agent detection comes from the filesystem and the ADR-020 roster.

## Consequences

- A minimal config carries `version`, `skills`, `telemetry`, and `line-limits`. The reader also accepts `learning-loop`, `hooks`, `terminal`, `harness`, and per-bucket `path` overrides; none is required. A project may add `toolchain` for explicit verification gates, as this repository does.
- `workflow/install-goat-flow.sh` and setup docs stop asking agents to invent commands and boundary lists.
- Contract tests distinguish "the reader supports this field" from "the committed config contains this field".
- Personal preferences stay out of committed config unless a later ADR promotes them to shared project truth.
