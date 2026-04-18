# ADR-001: Remove confusion-log.md from the workflow

**Date:** 2026-03-21
**Status:** Accepted
**Updated:** 2026-04-18 - absorbs the disposition guidance that previously lived in ADR-010.

## Context

The GOAT Flow spec defined three learning loop files:
- `.goat-flow/lessons/` - agent behavioral mistakes
- `.goat-flow/footguns/` - architectural traps with file:line evidence
- `docs/confusion-log.md` - structural navigation confusion

The confusion log was designated create-on-first-use: it would materialise when an agent first experienced genuine structural confusion. After 7+ real implementations across apps, libraries, and script collections, the file was never created on any project. The "first use" never came.

The failure mode it was designed to catch (agent can't find where something lives) is already addressed by:
- The router table - maps every resource to its path
- `.goat-flow/architecture.md` - system orientation for agents

Meanwhile, the scanner penalized every project 1 point for the missing file (check 2.3.5) plus 2 points for the cascading router failure (check 2.4.2 - the router referenced confusion-log.md which didn't exist). That's 3 points lost on every scan for a feature that serves no purpose.

## Decision

Remove `confusion-log.md` from the workflow entirely and do not resurrect it as a first-class learning-loop surface.

- Remove rubric check 2.3.5
- Remove from all router tables (CLAUDE.md, AGENTS.md, GEMINI.md)
- Remove from spec docs, setup prompts, fragment registry, shared facts
- Remove `workflow/evaluation/confusion-log.md` template
- Remove from CI allowed-missing paths
- Projects that still carry an old confusion log may keep it as unscored historical material
- Any useful surviving entries from older confusion logs should be merged into `.goat-flow/lessons/` with a note that they originated as navigation confusion

Structural confusion is addressed by the router table and `.goat-flow/architecture.md`. The practical minimum learning loop is two surfaces: architectural traps in `footguns/` and behavioural mistakes in `lessons/`.

## Consequences

- Every project gains ~3 points on self-scan (1 pt check + 2 pt router cascade)
- goat-flow repo went from B (87%) to A (92%) for Claude
- One fewer create-on-first-use artifact to explain to new users
- If structural confusion turns out to be a real problem in the future, `lessons/` can capture it - no need for a separate file
- 47 references removed across 25 files
- Existing projects with stale confusion-log content have a merge path instead of a resurrection path
- If a genuinely new learning-loop category emerges in future, it needs a new ADR rather than reviving `confusion-log.md`
