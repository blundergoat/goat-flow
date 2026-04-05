# ADR-027: package.json Is the Source of Truth for Node Version

**Status:** Accepted
**Date:** 2026-04-05

## Context

Three shell scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`)
checked for Node.js v22+ while `package.json` declared `>=20.11.0`. CI used Node 20
(matching `package.json`) and worked correctly. The scripts would have rejected
Node 20 users despite the project supporting that version.

The inconsistency was introduced when the scripts were written with a higher
version check than the canonical requirement.

## Decision

`package.json` `engines.node` is the single source of truth for the minimum
Node.js version. All shell scripts, CI workflows, documentation, and setup
guides must derive their version check from this value.

## Consequences

- Shell scripts updated to check `NODE_VERSION < 20` (matching `>=20.11.0`)
- CI workflow already used Node 20 — no change needed
- README already said "Node.js 20+" — no change needed
- Any future version bump starts in `package.json`; scripts and docs follow
