# ADR-026: userRole is local-only config, not committed

**Created:** 2026-04-05
**Status:** Historical - merged into ADR-039 on 2026-04-18

## Summary

This file documented the narrower config-surface rule that `userRole` is a reader-supported preference, not committed project truth.

That distinction now lives in ADR-039 alongside the broader rule that the shipped config should not force setup agents to guess project-local calibration.

## Canonical Record

See `ADR-039-optional-project-calibration-config.md`.
