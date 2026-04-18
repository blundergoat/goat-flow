# ADR-014: Treat `toolchain` and `ask_first` as optional project calibration

**Date:** 2026-04-15
**Status:** Implemented
**Updated:** 2026-04-18 - absorbs the local-preference boundary previously split into ADR-026.

## Context

`toolchain` and `ask_first` existed in `.goat-flow/config.yaml`, parser types, setup docs, prompts, and harness quality checks. In practice they required setup agents to guess project-specific commands and high-risk boundaries during base install. That made 1.1.0 heavier and created drift between human-reviewed instruction files and machine-readable config.

`userRole` created a related but narrower failure class: contract tests asserted that the committed project config contained a per-user preference (`developer`) even though that value is not durable project truth.

## Decision

For 1.1.0:

1. Remove `toolchain` and `ask_first` from the shipped config scaffold and base setup flow.
2. Keep parser support so existing projects do not break and the concept can be revisited later without a schema break.
3. Treat the fields as optional project-calibration inputs in harness and critique surfaces, not missing setup.
4. Defer any reintroduction to a dedicated 1.2.0 task file.
5. Treat `userRole` as reader-supported but optional. When absent, the config reader defaults to `developer`; committed config does not need to store personal preferences.

## Consequences

- `.goat-flow/config.yaml` stays minimal: version, agents, skills, telemetry, line-limits
- `workflow/install-goat-flow.sh` and setup docs stop asking agents to invent project commands and boundary lists
- `audit --harness` must not penalize the absence of these fields
- Contract tests must distinguish between "the reader supports this field" and "the committed project config contains this field"
- Personal preferences stay out of the committed config surface unless a future ADR promotes them to shared project truth
- Future work is tracked in `.goat-flow/tasks/1.4.0/M04-calibration-config-decisions.md`
