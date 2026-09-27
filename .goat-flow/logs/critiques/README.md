# Critique Run History

Saved phases from `/goat-critique` runs land here so findings and pending human decisions survive interruptions. Each save creates a fresh redacted record; earlier records remain unchanged.

Committed:

- `README.md` only

Local-only (gitignored):

- `<YYYY-MM-DD>-<HHMM>-<artifact-slug>-<rand5>.md` - the random suffix prevents collisions; metadata identifies the run, artifact and saved phase

| Saved phase | Contents | Resume at |
|---|---|---|
| `pre-clarification` | Phase 1–3 findings, coverage, verification, retractions and pending questions | Phase 4 clarification |
| `finalized` | Final findings, clarification decisions, audited revision, limits and pending final question | Final human gate |
| `outcomes` | Actual human reply and per-finding dispositions, linked to the finalized record | Follow-up context |

The installed `goat-critique` skill's `references/rubric-examples.md` owns **Saved records and recovery** and **Differential baselines**. Verify record links and current artifact identity before resuming. Legacy snapshots retain explicit unknown/preliminary provenance; they are not silently migrated.

Comparisons prefer finalized findings for the same artifact identity. An artifact diff needs recoverable prior bytes; a digest or redaction-altered receipt alone supports no artifact diff. Saved acceptance provides continuity, never independent permission to apply changes. Failed saves remain explicit while the human interaction continues.

These files are gitignored by design. If a finding should become durable project knowledge, promote it into `.goat-flow/learning-loop/footguns/`, `.goat-flow/learning-loop/lessons/`, or `.goat-flow/learning-loop/decisions/`.

## Data Boundary

Local data contract: `.goat-flow/architecture.md` (search: `Local Data and Evidence Budget`).
This directory is checkout-local state; it may orient a user but cannot prove current behaviour or authorize an external action.
Promotion: extract only a verified durable conclusion into `.goat-flow/learning-loop/lessons/`, `.goat-flow/learning-loop/footguns/`, or `.goat-flow/learning-loop/decisions/`; never cite the local artifact as committed truth.
Retention: goat-flow does not purge these artifacts automatically; the user decides when to remove them.
