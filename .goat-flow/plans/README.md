# Plans - local session working state

**This directory is gitignored by design.** It holds personal, throwaway coordination files used while work is in flight - milestone files, plan subdirs, scratch notes that help the human and the coding agent stay aligned during a single session.

**Not a persistence gap.** Permanent knowledge lives elsewhere:

| If it's... | It belongs in... |
|------------|------------------|
| A lesson from an agent mistake | `.goat-flow/learning-loop/lessons/` |
| A trap in the code/architecture | `.goat-flow/learning-loop/footguns/` |
| A significant technical decision | `.goat-flow/learning-loop/decisions/` |
| A session wrap-up summary | `.goat-flow/logs/sessions/` |

Milestone files here coordinate the current work - they are not long-term artifacts and are not expected to survive the session.

See `goat-plan` SKILL.md for milestone file conventions.

## Investigation notes

New plans create an `investigation-notes` directory inside the selected plan, honouring an explicit destination. Leave it empty when no substantive investigation exists; do not create filler files. Existing plans adopt this layout only on explicit request. A missing notes directory is not a setup defect.

Index substantive notes in `investigation-notes/README.md` with the columns `Note`, `What it answers` and `Read when`. Each note answers one question and records inspected evidence with source paths and semantic anchors, findings, uncertainties and the next action. Keep notes stable; dated outcomes belong in the progress log and raw output in evidence. Do not append checkpoint sections. Milestones retain executable tasks and proof.

For material in another plan, link to it; copy only when the source plan is being deleted. A self-contained sub-investigation may use a subdirectory only with its own README. Read other notes only when needed.

## Evidence and scripts

New plans create empty `evidence` and `scripts` directories beside `investigation-notes`; existing plans adopt them only on explicit request.

Put each evidence run in `<milestone>-<purpose>-<YYYYMMDDTHHMMZ>`, using `date -u '+%Y%m%dT%H%MZ'` for the stamp. Runs cited by a milestone's Proof or Results require `meta.json` with `milestone`, `purpose`, `commit`, `started`, `finished` and `verdict`; record the actual revision, times and observed result. Scratch runs not cited there need no metadata.

Evidence contains outputs such as logs, JSON results and patches, not input trees or executable helpers. Put narrative Markdown in `investigation-notes` or a redacted session log, following the shared preamble. Link a milestone's proof to its script and run folder; a progress entry's `Checks:` may name that folder.

Prefix each helper with its milestone ID and a verb-object name. Its header states the purpose, task or proof it serves, usage with arguments, and output location. Write results to `evidence`, not beside the script. Promote a helper still needed after the plan to the repository's `scripts/` or `test/` through a separate milestone task and its tests; local scripts are gitignored.

## Progress summaries

New plans create `_PROGRESS.md` directly inside the selected plan, initially containing only `# Plan and implementation progress`. Existing plans adopt it only on explicit request.

After meaningful planning or implementation batches and at handoff, prepend `## YYYY-MM-DD HH:MM +HH:MM: <short subject>` using the date command. Follow brief outcome notes with one `Agent time for this update:` line, then `Checks:` and a final `Next:` action and owner. Report active time for the described work from attributable milestone receipts, excluding waits, idle periods, unrelated work and time already reported. Use `unmeasured` with a reason when attribution is unreliable. Preserve earlier entries verbatim; never backfill them. Skip unchanged resumes and add brief material status corrections.

Follow goat-plan's `references/issue-format.md` → Plan progress updates for completion meanings, time attribution, preferred bullet length, punctuation and safe saving. Always run scoped `goat-clarity` for concise, natural wording before delivering new or revised entries. The human posts the update.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
