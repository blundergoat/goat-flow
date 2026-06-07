# Decisions

Architectural Decision Records (ADRs) capture durable decisions that constrain future work. They are not task notes, TODO lists, bug reports, benchmark dumps, or confirmations that nothing changed.

> If the choice does not outlast the feature branch, it is not an ADR.

## Automatic Capture Policy

Manual edits are normal: an explicit request to add or update a durable learning-loop entry means edit the Markdown in the correct directory. Programmatic automatic capture from terminal sessions, quality reports, PR reviews, or agent output is disabled unless `.goat-flow/config.yaml` explicitly sets `learning-loop.auto-capture.enabled: true` and a CLI-owned writer for that target exists. Prompts may suggest an ADR candidate, but automatic durable writes belong to CLI-owned code after opt-in.

Auto-capture candidates must follow Extract / Consolidate / Skip:

- Extract only when the item changes a future READ/SCOPE/ACT/VERIFY decision.
- Consolidate into an existing ADR when the same durable decision already exists.
- Skip raw tool output, successful smoke runs, UI/deploy churn, chain-of-thought, screenshots, raw JSON/HTML, duplicate dumps, and "I read the docs" summaries.

## When To Write An ADR

Write an ADR when the decision:

- changes the system structure, public contract, deployment model, data model, security model, or long-term workflow;
- constrains future implementation choices in a way another maintainer will need to understand;
- reverses, supersedes, or materially narrows an earlier decision;
- resolves a non-obvious trade-off with real evidence; or
- documents a durable exception that future agents might otherwise "fix" incorrectly.

Do not write an ADR for routine implementation details, temporary workarounds, benchmark traces, local debugging notes, or "we kept the existing behavior" confirmations.

## Wrong Home -> Right Home

| Note type | Correct home |
| --- | --- |
| Implementation TODO, checklist, milestone, or scoped plan | `.goat-flow/plans/` or the issue tracker |
| Reproducible hazard, trap, or recurring failure with measured evidence | `.goat-flow/learning-loop/footguns/` |
| Reusable takeaway from a completed fix or verification failure | `.goat-flow/learning-loop/lessons/` |
| Temporary scratch note, benchmark trace, raw command output, or local hypothesis | `.goat-flow/scratchpad/` |
| Backlog request, product question, or work that needs prioritisation | Linear/GitHub issue |
| Durable architecture, policy, contract, or trade-off decision | `.goat-flow/learning-loop/decisions/ADR-NNN-kebab-case-title.md` |

## Naming

ADR files must be named `ADR-NNN-kebab-case-title.md`, for example `ADR-001-cache-signature-policy.md`.

Allowed non-ADR files: `README.md` and `INDEX.md`.

Everything else in this directory is a stats failure. If a note cannot earn an ADR filename, route it using the table above.

## Required Structure

Every ADR must include:

```markdown
# ADR-NNN: Title

**Status:** Accepted
**Date:** YYYY-MM-DD

## Decision

What was decided. Be specific enough that someone can verify whether the codebase conforms.

## Context

Why this decision exists. Cite real incidents, constraints, measurements, or prior decisions.

## Failure Mode Comparison

| Option | What fails | Why rejected or accepted |
| --- | --- | --- |
| ... | ... | ... |

## Reversibility

Whether this is a one-way or two-way door, plus rollback or revisit triggers.
```

`## Context` may appear before `## Decision` if that reads better. Section order is not enforced.

At least one trade-off section is required:

- `## Consequences`
- `## Failure Mode Comparison`
- `## Reversibility`

Recommended metadata:

- `**Author(s):**`
- `**Ticket/Context:**`
- `**Updated:** YYYY-MM-DD` when amending an accepted ADR

## Status Values

- `Proposed` - under discussion, not yet binding
- `Accepted` - decision made, implementation may still be underway
- `Implemented` - decision is reflected in the codebase
- `Superseded by ADR-NNN` - replaced by a later decision

## Anti-Patterns

Do not create ADRs for:

- no-op confirmations, such as "we kept the existing threshold";
- TODOs disguised as decisions;
- workaround notes for a missing implementation;
- scoping notes that belong in a milestone file;
- benchmark traces without a durable decision;
- files missing the `ADR-NNN-...` filename, `**Status:**`, `**Date:**`, `## Context`, `## Decision`, or a trade-off section.

## Before Writing

Check all five before creating a file here:

- The decision will still matter after the current task closes.
- The decision constrains future choices or explains a non-obvious trade-off.
- The evidence is real and cited in the ADR.
- The file can honestly use an `ADR-NNN-kebab-case-title.md` name.
- The note does not belong in tasks, footguns, lessons, scratchpad, or the issue tracker.

If any check fails, do not write an ADR. Route the note to the correct home. If you are an AI agent and cannot decide, ask a human before creating a file in this directory.
