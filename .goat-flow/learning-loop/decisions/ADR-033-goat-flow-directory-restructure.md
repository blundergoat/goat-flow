# ADR-033: Learning-loop layout, config, and generated indexes

**Status:** Accepted
**Date:** 2026-06-07
**Updated:** 2026-09-05 - condensed; absorbed now-removed ADR-045-index-cost-date-columns.md (content-derived cost and date columns, 2026-08-23), corrected the bucket split rule to the enforced byte gate, and deferred `agents` semantics to ADR-014. The 2026-08-15 amendment absorbed now-removed ADR-004 (config and directory layout), ADR-016 (cold-path truth), ADR-035 (generated indexes), and ADR-001 (confusion-log removal).
**Supersedes:** the ADR-017 marker path `.goat-flow/tasks/.active`; ADR-017's marker semantics remain in force.

## Context

The installed `.goat-flow/` layout had grown around historical top-level buckets: `footguns/`, `lessons/`, `patterns/`, `decisions/`, `skill-reference/`, `skill-playbooks/`, `hook-lib/`, and `tasks/`. A plain rename was unsafe because runtime code, setup templates, manifest checks, dashboard APIs, hook launchers, skill routing, and local milestone history all referenced those paths. The user approved the `skill-docs` name and required the `tasks` to `plans` change to ship as a bundled migration that preserved `.active`, local milestone subdirectories, dashboard plan behaviour, and old history without overwriting same-named new files.

Three earlier decisions had settled adjacent halves of one question: which buckets exist and where config names them, how a cold agent finds an entry, and how stored content is kept true. The original index rows also gave an agent no idea how much text an entry held, and showed dates only for decisions.

## Decision

Durable memory, shared skill doctrine, hooks, and plans live under one `.goat-flow/` hierarchy, retrieved through generated per-bucket indexes, while `workflow/` stays the package source.

### Installed layout

- `.goat-flow/learning-loop/{decisions,footguns,lessons,patterns}/` for durable project memory.
- `.goat-flow/skill-docs/` for shared skill doctrine, with playbooks under `playbooks/` and skill-authoring method under `skill-quality-testing/`.
- `.goat-flow/hooks/` for the central hook dispatchers, with deny-dangerous policy modules under `deny-dangerous/`.
- `.goat-flow/plans/` for local milestone plans and the `.active` marker.

`workflow/` remains the template source; for example `workflow/skills/reference/` sources the doctrine installed to `.goat-flow/skill-docs/`. Installer upgrades move old directories idempotently with no-overwrite semantics: when both paths exist, only entries whose destination is absent move, and conflicts stay in the old path for human review.

### Config surface

`.goat-flow/config.yaml` is the only machine-readable config surface; the former gitignored local config was removed. It names the learning-loop paths (`footguns.path`, `lessons.path`, `decisions.path`, `plans.path`) and the skill list (`skills.install`, an explicit list or `all`). ADR-014 owns the semantics of `agents` and the optional calibration fields. The template `.gitignore` keeps `.goat-flow/plans/` and logs out of version control.

### Entry format

Footguns and lessons are category bucket files, not one incident per file: `footguns/<category>.md` and `lessons/<category>.md`, with `## Footgun: <name>` plus `Status / Created / Evidence`, or `## Lesson: <name>` and `## Pattern: <name>` plus `Created`. A directory `README.md` carries any preamble. Create a new category only when none fits. A bucket over 40,000 bytes is a blocking `stats --check` finding and 39,000 bytes warns, so split into narrower categories before the gate.

The two-surface minimum is architectural traps in `footguns/` and behavioural mistakes in `lessons/`. `confusion-log.md` is not a third surface and must not return; structural confusion is addressed by the router table and `.goat-flow/architecture.md`. A project still carrying one may keep it as unscored history and merge useful entries into `lessons/`.

Evidence lifecycle: `ACTIVE` is the default; `MITIGATED` marks a partial fix and cites the change; `RESOLVED` stays in place as history rather than moving to an archive. Cold-path content needs automated truth-checking: `stats --check` and the preflight checks own it, and entries cite semantic anchors rather than line numbers (ADR-024).

### Generated indexes

`goat-flow index` (`src/cli/learning-loop-index/`) writes a committed `INDEX.md` per bucket with one row schema:

```markdown
- [Title](bucket-file.md) (search: "<entry heading line>") - short hook (YYYY-MM-DD; ~NNN tok)
```

Hooks are extracted mechanically, never hand-curated: the first sentence after `**Symptoms:**`, `**What happened:**`, or `**Context:**`; for footguns and lessons a declared `**Decision changed:**` value replaces that hook, prefixed `Decision:`; for decisions the verbatim `**Status:**` plus the first `## Decision` sentence, so retrieval never follows a superseded decision blind and a wrong status line is a retrieval bug. The complete hook stays within 100 characters, shortened at a word boundary with an ellipsis and backed up before an open code span.

The suffix is content-derived. The token estimate is the entry's UTF-8 byte length divided by four, rounded to the nearest ten: a stable reading-cost comparison, not a model token count. The date appears only when the source declares one (`Created` for footguns, lessons, and patterns; `Date`, or `Superseded` for a superseded status, for decisions). Generation never substitutes the clock or file modification time, so an undated entry shows a token-only suffix such as `(~120 tok)`.

Nothing in generated output is clock-derived. `stats --check` regenerates in memory and compares (`index-fresh`); a stale index is a blocking `index-stale` finding and a never-generated one an advisory `index-missing` warning. Index `sizeBytes` is telemetry only and aggregate size never warns, because Step 0 searches the indexes rather than loading one wholesale. Search output is capped at 13 rows across the four buckets; the thirteenth row is a breadth signal to refine terms, and the agent reads at most 12. `skill-preamble.md` Learning-Loop Retrieval directs every skill's Step 0 to that read and requires the `Relevant prior learnings:` emission so skipped retrieval is visible.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Rename directories and chase compile errors | Dashboard, installer, hook configs, and `.active` split between old and new paths | Rejected |
| Defer `tasks` to `plans` | Leaves the most visible rename out of the structural release | Rejected after explicit approval of the bundled migration |
| Move `workflow/` template sources too | Package churn and a blurred source/install separation | Rejected |
| One incident per file | Listings grow past what a cold agent can scan | Rejected |
| Hand-maintained indexes | Three row shapes drifted from their sources and could not be validated | Rejected |
| Generation time or mtime in rows | Unchanged sources produce different bytes, so `stats --check` reports permanent staleness | Rejected |
| Exact model tokenizer | A model-specific dependency with false precision across runtimes | Rejected |
| Warn on aggregate index bytes | Prescribes retiring live evidence although bounded search prevents a whole-file read | Rejected |
| No-overwrite migration, bucket files with a byte gate, deterministic rows with a content-derived suffix | Editing an entry changes its estimate and makes the index stale until regeneration | Accepted |

## Consequences

- Active instructions, templates, manifest entries, audit checks, dashboard APIs, config defaults, and skill routing use the new paths; old paths appear only in migration code, compatibility tests, and history.
- Adding, editing, renaming, or resolving any entry requires `goat-flow index`; `stats --check` fails while an index is stale. All four `INDEX.md` files regenerate together.

## Reversibility

Reversible only by another coordinated migration release that restores installer migration, manifest, dashboard routes, hook configs, skill-doc pointers, and goat-plan routing together. Removing the row suffix is a two-way change to the parser, formatter, and all four indexes in one commit.
