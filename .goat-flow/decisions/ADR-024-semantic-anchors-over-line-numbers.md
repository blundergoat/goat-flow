# ADR-024: Semantic anchors over line numbers in evidence

**Status:** Accepted
**Date:** 2026-04-24

## Context

Footgun and lesson entries cited code evidence using `file:line` references (e.g. `guardrails-self-test.sh:88-96`). Three independent quality reports in a single session flagged stale line numbers in footgun evidence - references that pointed at the right file but wrong code because line numbers shift on every edit. The framework's own `stats --check` validated that cited lines were in-bounds but could not detect that the content at those lines no longer matched the described evidence.

The maintenance cost was real: 9 active line-number references across 3 footgun files had drifted, and 2 were already confirmed stale by direct file reads. The README already recommended semantic anchors, but entries kept using line numbers because the evaluation templates said "Line numbers are RECOMMENDED."

## Decision

Ban line numbers from footgun and lesson evidence. Use grep-friendly semantic anchors instead: function names, unique strings, section headings, or `(search: "pattern")` markers. Line numbers may appear as approximate convenience but are not considered evidence and are not validated by `stats --check`.

## Consequences

- Footgun/lesson evidence survives refactors without maintenance
- `stats --check` `(search: ...)` anchor validation catches stale evidence that line-number validation could not
- Evaluation templates updated: line numbers changed from RECOMMENDED to DISCOURAGED
- Instruction files updated: footgun evidence guidance says "semantic anchors" not "file:line"
- Existing entries stripped of line numbers and given semantic anchors where needed
