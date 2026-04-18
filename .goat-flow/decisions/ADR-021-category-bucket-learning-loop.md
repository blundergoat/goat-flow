# ADR-021: Category bucket files for lessons and footguns

**Date:** 2026-04-03
**Status:** Historical - merged into ADR-018 on 2026-04-18

## Summary

This file carried the second half of the learning-loop storage evolution:

- monolithic files were replaced by directories
- one-incident-per-file inside those directories proved too noisy
- category bucket files became the current committed format

That full evolution now lives in ADR-018 so the config surface and the on-disk format are documented together.

## Canonical Record

See `ADR-018-config-file-and-directory-learning-loop.md`.
