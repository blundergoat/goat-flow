# ADR-033: Learning-loop layout, config, and generated indexes

**Status:** Accepted
**Date:** 2026-06-07
**Updated:** 2026-08-15 - absorbed ADR-004 (config file and directory-based learning loop), ADR-016 (cold-path truth maintenance), ADR-035 (generated indexes), and ADR-001 (confusion-log removal). All four decide how durable project memory is stored, retrieved, and kept true.
**Supersedes:** ADR-017 path choice for `.goat-flow/tasks/.active`. ADR-017's marker semantics remain in force.
**Ticket/Context:** `.goat-flow/plans/1.10.0/M04-goat-flow-directory-restructure.md`

## Context

The installed `.goat-flow/` layout had grown around historical top-level buckets:
`footguns/`, `lessons/`, `patterns/`, `decisions/`, `skill-reference/`,
`skill-playbooks/`, `hook-lib/`, and `tasks/`. M04 showed that a simple rename
would be unsafe because runtime code, setup templates, manifest checks, dashboard
APIs, hook launchers, skill routing, and local milestone history all reference
these paths.

The user approved the final skill-docs target name and required the `tasks` to
`plans` change to ship as a bundled migration that preserves `.active`, existing
local milestone subdirs, dashboard plan behavior, goat-plan routing, config
defaults, and old local history without overwriting same-named new files.

Three earlier decisions settled adjacent halves of the same question: which buckets exist and where config names them, how a cold agent finds an entry, and how stored content is kept from silently going stale. Splitting them across four files meant a reader changing the layout had to reconstruct the retrieval and truth contracts from elsewhere.

## Decision

### Installed layout

- `.goat-flow/learning-loop/{decisions,footguns,lessons,patterns}/` for durable
  project memory.
- `.goat-flow/skill-docs/` for shared skill doctrine, with standalone playbooks
  under `.goat-flow/skill-docs/playbooks/` and skill-authoring methodology under
  `.goat-flow/skill-docs/skill-quality-testing/`.
- `.goat-flow/hooks/` for central installed hook dispatchers, with deny-dangerous
  policy modules under `.goat-flow/hooks/deny-dangerous/`.
- `.goat-flow/plans/` for local milestone plans and the `.active` marker.

Keep `workflow/` as the package template source. For example,
`workflow/skills/reference/` still sources shared skill doctrine, while the
installed copy lands in `.goat-flow/skill-docs/`.

Installer upgrades must move old directories idempotently with no-overwrite
semantics. When both old and new paths exist, the migration moves only entries
whose destination does not already exist and leaves conflicts in the old path
for human review rather than overwriting local work.

### Config surface

`.goat-flow/config.yaml` names the learning-loop paths rather than hardcoding them: `footguns.path`, `lessons.path`, `decisions.path`, `plans.path`, plus `agents` (detected list or explicit override) and `skills.install` (explicit list or `all`). `config.yaml` is the only machine-readable config surface; the former gitignored local config was removed in M13.

The template `.gitignore` and scaffolding keep per-session artifacts out of version control: `.goat-flow/plans/` and logs.

### Entry format

Within `footguns/` and `lessons/`, entries are **category bucket files**, not one incident per file:

- **Footguns:** `.goat-flow/learning-loop/footguns/<category>.md` such as `hooks.md`, `auditor.md`, `setup.md`
- **Lessons:** `.goat-flow/learning-loop/lessons/<category>.md` such as `verification.md`, `agent-behavior.md`
- Each footgun entry uses `## Footgun: <name>` plus `Status / Created / Evidence`
- Each lesson entry uses `## Lesson: <name>` or `## Pattern: <name>` plus `Created`
- A directory-level `README.md` carries any preamble
- Create a new category only when no existing category fits
- Split a bucket at roughly 200 lines or 10 entries

The two-surface minimum is architectural traps in `footguns/` and behavioural mistakes in `lessons/`. `confusion-log.md` is not a third surface and must not be resurrected as one - structural confusion is addressed by the router table and `.goat-flow/architecture.md`. A project still carrying an old confusion log may keep it as unscored historical material; useful entries merge into `lessons/`.

### Evidence lifecycle

- `ACTIVE` is the default for live warnings and lessons
- `MITIGATED` marks a partial fix and must cite the change that reduced the risk
- `RESOLVED` marks a fully fixed issue and stays in place as historical evidence rather than moving to a separate archive file

Cold-path content requires automated truth-checking, not manual maintenance alone. `stats --check` and the preflight checks own that enforcement; entries carry semantic anchors rather than line numbers (ADR-024).

### Generated indexes

Per-bucket `INDEX.md` files for all four buckets are produced by the `goat-flow index` CLI command (`src/cli/learning-loop-index/`) and committed to version control. One unified row schema applies to every bucket:

```markdown
- [Title](bucket-file.md) (search: "<entry heading line>") - short hook
```

Hooks are extracted mechanically - first sentence after `**Symptoms:**` / `**What happened:**` / `**Context:**`; for ADRs the verbatim `**Status:**` plus `**Date:**` plus the first `## Decision` sentence - never hand-curated. Decisions rows carry status verbatim so retrieval does not follow superseded decisions blind, which makes a wrong `**Status:**` line a retrieval bug rather than a cosmetic one.

Generated output contains nothing clock-derived: `goat-flow stats --check` re-runs the generator in memory and compares content (`index-fresh`), so any time-dependence would read as permanent staleness. A stale index is a blocking `index-stale` finding; a never-generated index is an advisory `index-missing` warning so fresh installs do not false-fail.

The load model is a mandatory Step 0 read, not always-loaded instruction content: `skill-preamble.md` Learning-Loop Retrieval directs every skill's Step 0 to read the relevant `INDEX.md` before grepping individual entries, and requires the `Relevant prior learnings:` emission so skipped retrieval becomes visible.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| Rename directories and chase compile errors | Dashboard APIs, installer upgrades, hook configs, and local `.active` state can split between old and new paths. | Rejected because it loses the upgrade safety contract. |
| Defer `tasks` to `plans` | Leaves the most user-visible rename out of the structural release and keeps ADR-017's old path as live doctrine. | Rejected after explicit user approval for bundled migration. |
| Move workflow template source directories too | Increases package churn and obscures the source/install separation. | Rejected for skill docs; `workflow/skills/reference/` and `workflow/skills/playbooks/` remain source paths. |
| Move installed state with no-overwrite migration | Preserves user-authored local content and lets setup/templates/runtime converge on one new layout. | Accepted. |
| Hand-maintained bucket indexes | Three distinct row shapes drifted from their sources and could not be validated. | Rejected; the generator plus `index-fresh` replaced them. |
| One incident per file | Directory listings grow past the point where a cold agent can scan them. | Rejected in favour of category bucket files with a split threshold. |

## Consequences

All active instructions, setup templates, manifest entries, audit checks,
dashboard plan APIs, config defaults, and goat-* skill routing must use the new
paths. Old path mentions are valid only in migration code, compatibility tests,
changelog/ADR history, or clearly historical learning-loop evidence.

`/goat-plan` continues to own `.active` semantics, but the marker path is now
`.goat-flow/plans/.active`. Missing or stale `.active` remains normal local
churn, not setup failure.

Adding, editing, renaming, or resolving any learning-loop entry requires re-running `goat-flow index`; `stats --check` fails while an index is stale.

## Reversibility

This is reversible only by another coordinated migration release. A rollback
must restore installer migration, manifest, dashboard routes, hook configs,
skill-doc pointers, and goat-plan routing together; reverting only the directory
names would recreate the split-layout failure this ADR prevents.
