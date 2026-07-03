# Loops in goat-flow

goat-flow is a harness, and a harness compounds only through its loops: cycles where a trigger starts work, something checks the result, and the outcome feeds the next cycle. This file inventories every loop in this repository - what triggers it, what closes it, and where it runs.

The doctrine behind the inventory lives in [docs/harness-engineering.md](docs/harness-engineering.md): a prevention mechanism buried in a file nobody reads "is not a prevention mechanism - it's a diary". Every loop below is judged by three questions:

1. **Trigger** - what starts it? A tool-call lifecycle event, a pull request, or a gate script is structural. "Someone remembers" is not.
2. **Work** - what runs?
3. **Closure** - what consumes the output so the next cycle starts better? Output nothing consumes is noise.

The loops map onto the five harness concerns (Context, Constraints, Verification, Recovery, Feedback) - each concern's definition and failure modes are in [docs/harness-engineering.md](docs/harness-engineering.md), and the audit checks per concern are in [docs/harness-audit.md](docs/harness-audit.md).

## Per-turn and per-task loops

| Loop            | Trigger                                  | Work                                                                                                                                                              | Closure                                                                                                                       |
| --------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Execution loop  | Every task                               | READ → SCOPE → ACT → VERIFY, defined in `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`                                                              | Hallucination red-flags forbid unverified completion claims; VERIFY failures feed the learning loop                             |
| Constraint loop | Every tool call, every turn              | `.goat-flow/hooks/deny-dangerous.sh` blocks destructive commands at PreToolUse; `.goat-flow/hooks/post-turn-safety.sh` scans changed content on supported Stop agents | A blocked action never executes; each discovered bypass becomes a policy module under `.goat-flow/hooks/deny-dangerous/` with a self-test |
| Retrieval loop  | Step 0 of every goat-\* skill invocation | INDEX-first read of `.goat-flow/learning-loop/{footguns,lessons,patterns,decisions}/INDEX.md`, one reword on zero hits                                             | The required `Relevant prior learnings:` emission makes a skipped retrieval visible; misses are recorded instead of broad-loading buckets |
| Recovery loop   | Task work; compaction or session loss    | Milestone files with ticked checkboxes under `.goat-flow/plans/`; optional session logs under `.goat-flow/logs/sessions/`                                          | A resuming agent reconstructs state from the files, not from the lost conversation                                              |

## Gate loops

| Loop               | Trigger                                        | Work                                                                                                                                                             | Closure                                          |
| ------------------ | ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Local gate         | `bash scripts/preflight-checks.sh` before risky edits or releases | Build, tests, lint, format, `goat-flow audit`, content drift, doc/code drift, and the Learning-Loop Schema section (`stats --check`)                              | Non-zero exit blocks any "done" claim; recurring gate failures become lessons |
| CI gate            | Every pull request                             | `.github/workflows/ci.yml`: build, full tests, eslint, format check, `goat-flow audit .`, `goat-flow stats . --check`, shellcheck, version consistency             | A red pull request cannot merge                  |
| Context validation | Pull requests touching instruction, docs, skill, or learning-loop paths | `.github/workflows/context-validation.yml`: instruction-file line budgets, expected skills present, unreviewed AI-generated learning-loop entries, markdown links | Same                                             |

## The learning loop

The feedback loop is the one that makes the others compound. It has four stages, each with its own closure:

1. **Capture** - when VERIFY catches a failure or course-corrects, the incident becomes an entry: behavioural mistakes in `.goat-flow/learning-loop/lessons/`, architectural traps in `.goat-flow/learning-loop/footguns/` (with semantic-anchor evidence per ADR-024), significant choices in `.goat-flow/learning-loop/decisions/` (ADRs), reusable approaches in `.goat-flow/learning-loop/patterns/`.
2. **Retrieval** - generated per-bucket `INDEX.md` files (`goat-flow index`, ADR-035) are read at every skill Step 0, so entries are found by cold agents instead of rotting.
3. **Hygiene** - `goat-flow stats --check` fails on stale evidence refs, stale generated indexes, oversized buckets, missing or outdated `last_reviewed` frontmatter, and malformed ADRs. It runs in the local preflight gate and in CI, so decay is caught structurally.
4. **Graduation** - when a recorded mistake happens again, the entry gets a line-start `**Recurrence update` marker. `goat-flow stats` lists active entries with such markers as **graduation candidates**, with per-entry recurrence counts. The migration path for each candidate: promote the prevention to a structural gate (preflight check, CI step, deny pattern) or resolve the entry. Candidates are report-only - never a `--check` failure - so the signal cannot decay into ignorable warning noise.

Stage 4 is deliberately the only human-paced stage: the tooling names the candidates, and deciding what graduates is judgment work.

## Slow loops

| Loop               | Trigger                                     | Work                                                                                                                       | Closure                                                                     |
| ------------------ | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Drift loop         | Audit runs (preflight, CI, dashboard)       | Template-vs-installed skill drift, factual-claim drift, and cold-path content lint in `src/cli/audit/`                       | Findings carry remediation; docs get corrected or advisory checks acknowledged |
| Quality loop       | `goat-flow quality` runs                    | Agent-written quality reports saved under `.goat-flow/logs/quality/`                                                         | `goat-flow quality history` and `quality diff` compare runs over time         |
| Skill quality loop | Authoring or editing a skill                | RED-GREEN-REFACTOR pressure testing per `.goat-flow/skill-docs/skill-quality-testing/`, plus `goat-flow quality` skill scoring | A skill ships only after failing, then passing, its pressure test             |
| Upgrade loop       | `goat-flow setup` / install on a consumer project | `workflow/install-goat-flow.sh` driven by `workflow/manifest.json` installs current files and prunes renamed or orphaned artifacts | `workflow/manifest-snapshots/` pin upgrade and pruning behaviour in tests     |

## What is intentionally not a loop

- **No scheduled or cron jobs.** Every automated loop is event-triggered: a tool call, a turn ending, a pull request, an explicit gate run. At this repository's cadence, a nightly run would mostly produce unread reports - the diary failure mode with a timestamp.
- **No effectiveness telemetry.** Hook-fire counters and retrieval-rate metrics were considered and deferred: a metrics surface with no consumer is noise, not a loop.
- **Removed loop machinery stays removed.** The confusion log (ADR-001), the scanner/rubric system (ADR-013), and the plan checkbox guard (ADR-039) were each cut because nothing consumed their output. That is the bar a new loop must clear before it ships.
