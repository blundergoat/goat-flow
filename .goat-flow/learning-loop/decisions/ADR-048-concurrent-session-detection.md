# ADR-048: Fence cooperative local-state writes with exclusive claims

**Status:** Accepted
**Date:** 2026-08-23
**Updated:** 2026-09-03 - reconciled shipped claim adoption and replaced dead milestone owners with explicit unplanned follow-up status.
**Ticket/Context:** `.goat-flow/plans/1.17.0/M03-concurrent-session-spike.md`

## Context

Atomic replacement prevents readers from seeing partial bytes, but it does not stop two writers from replacing a file from the same stale snapshot. M02 moved the dashboard's mutable local-state writers onto atomic replacement without making a lost-update claim.

The failure is already present in durable project evidence. `.goat-flow/learning-loop/lessons/verification-environment.md` (search: `Parallel sessions need concurrency-safe file patterns`) records two agents writing the same learning-loop bucket. `.goat-flow/learning-loop/footguns/cleanup-layering.md` (search: `Session-scoped cleanup over a project-scoped resource`) records cross-process duplication and deletion when process-local ownership was applied to a project-scoped resource.

`src/cli/plans-time.ts` (search: `writeMilestoneAtomically`) already compares destination identity and exact content before replacing a milestone. That catches an editor save before its final comparison, but two cooperating processes can both complete the comparison before either rename. The M03 local runner reproduced the same stale-snapshot overwrite for two checklist edits; that gitignored runner is acceptance evidence for the spike, not durable project truth.

The mechanism must work without a daemon or lock service. It can protect only writers that cooperate with it. Direct agent file edits remain outside runtime enforcement unless they are routed through a guarded command.

## Decision

Cooperating runtime writers must use a **path-keyed exclusive claim plus expected content identity** around the complete read, validate, and replace operation.

For each target, the guarded writer must:

1. Resolve and validate the project root and target before creating coordination state.
2. Capture an expected identity as file existence plus a SHA-256 digest of the exact bytes read. A create-only writer captures an expected missing state.
3. Derive a claim key from the normalized project-relative target path.
   Acquire `.goat-flow/write-claims/<key>.claim` with exclusive creation and mode `0o600`.
   Before writing owner bytes, bind the open descriptor to a stable snapshot of that empty path and revalidate the project-local directory chain.
   Claim contention or failed binding stops admission immediately; writers do not wait, steal, or expire another claim.
4. After acquiring the claim, re-read the target and compare its existence and exact-byte digest with the expected identity. A mismatch returns a concurrent-change result without staging or replacing bytes.
5. Stage complete output, flush it, and use the existing atomic replacement or create-only primitive while the claim is held.
6. Release only the exact claim identity acquired by this writer. A missing or changed claim at cleanup is reported rather than deleted by pattern.

For a multi-target operation, canonical target paths are sorted before claims are acquired. Failure to acquire any claim releases only claims already owned by that operation and stops before the first target write. This is whole-batch concurrency admission, not a promise that several filesystem renames form one atomic transaction.

An existing claim fails closed even when its process appears dead. Automated time-based cleanup is rejected because a slow live writer and a crashed writer are not distinguishable from elapsed time alone. Recovery is an explicit operator action after confirming that no writer still owns the target.

The expected identity comparison from `plans time` moves inside this claim instead of being replaced by a second convention. Atomic replacement remains the byte-integrity primitive; the claim and identity comparison provide cooperative lost-update detection.

Node exposes no supported cross-platform descriptor-relative create primitive.
A non-cooperating same-user process can therefore swap a parent for the exclusive pathname open and restore it before validation.

Binding the empty marker before its first write prevents owner bytes from reaching that redirected file.
The external empty allocation may remain when its pathname is no longer reachable through the selected project.
This guarantee does not contain arbitrary local processes.

## Collision surfaces and writer coverage

| Rank | Surface | Actual writer | Coverage decision |
| ---: | --- | --- | --- |
| 1 | Milestone status and checkboxes | Direct agent edit under goat-plan File-Write and milestone delivery doctrine | Doctrine-only unless routed through a guarded command; no runtime claim is made for ordinary editor or agent writes. |
| 1 | Milestone timing receipt and `Actual` | `plans time` through `writeMilestoneAtomically` | Guardable; retain its exact-content comparison inside the path-keyed claim. |
| 2 | `.goat-flow/plans/.active` | Dashboard `POST /api/plans` through `writeActiveTaskPlan` | Guardable when the read response supplies an expected identity that the write returns. Claiming only at POST time without that identity would serialize writes but still allow a stale selection to win. |
| 2 | `.goat-flow/plans/.active` | goat-plan fresh-plan direct edit | Doctrine-only unless routed through a guarded command. |
| 2 | `.goat-flow/plans/.active` | `workflow/install-goat-flow.sh` unambiguous first-marker creation | Already create-only: `commit_staged_payload` uses `mv -n` and refuses a destination that appears during install. It is compatible with the decision and must not be changed into replacement. |
| 3 | `.goat-flow/dashboard-state.json` | Dashboard project-list, archive, and restore routes through `writeDashboardState` | Guardable when each read-modify-write carries the expected state identity into the claim. The current whole-file payload has no revision token. |
| 4 | `.goat-flow/logs/sessions/*.md` | Direct agent writes and `goat-flow redact --output` through `writeOutput` | Prefer unique per-session names and create-only output. The generic output sink currently replaces a named file, while direct edits remain doctrine-only. |

Checkbox and status loss ranks first because it can falsify milestone completion and dependency state. An active-marker swap changes orientation but leaves both plan directories intact. Dashboard-state clobber loses recoverable local metadata such as favorites, titles, and archived rows. Session-log interleave ranks last because logs are optional continuity notes and unique filenames already reduce collision frequency.

## Option evaluation

### Exact content re-read plus diff

An expected byte identity detects that a target changed after the writer read it and is stronger than timestamp evidence. Alone, it leaves a check-to-rename race: two writers can both compare against the same baseline before either replacement. It is accepted only as the inner validation while an exclusive path claim is held.

### Modification time since read

An mtime guard cannot distinguish content-preserving touches from meaningful edits, and timestamp resolution or metadata preservation can leave distinct bytes with the same observed time. It also retains the same check-to-write race. It is rejected as an authority signal, though it may remain diagnostic metadata.

### Per-session marker files

Unique session markers show that more than one session exists but do not bind ownership to a target, prevent two sessions from entering the same write, or distinguish live and abandoned markers. The session-scoped shape is rejected. Its useful primitive is narrowed to one exclusive, path-keyed claim whose owner must match before cleanup.

### Dashboard-owned advisory lock

An in-memory dashboard lock can serialize requests inside one server instance, but a second dashboard process, a CLI command, and a direct agent edit bypass it. Persisting dashboard ownership would also give one interface authority over writers it does not control. It is rejected as the shared mechanism; dashboard routes must use the same filesystem claim as other cooperating writers.

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Content identity without a claim | Both writers can validate before either rename. | Keep only inside the exclusive claim. |
| mtime guard | Equal or misleading timestamps and the check-to-write race permit false confidence. | Rejected. |
| Per-session markers | Session presence is visible, but target ownership and safe cleanup are absent. | Reject the session scope; use a path-keyed exclusive claim. |
| Dashboard-owned lock | Other processes and direct file writers bypass one server's memory. | Rejected. |
| Path-keyed claim plus content identity | A crashed owner can leave availability blocked, and non-cooperating edits remain outside the guarantee. | Accepted because cooperating stale writers fail closed without a daemon. |

## Rollout slice

The reusable claim and identity helper, its cross-process tests, stable diagnostics, sorted multi-target admission, and the managed-install transaction guard have shipped. Writer adoption is partially shipped: `install` claims every previewed destination, including config and managed agent-config paths, and `learn new` claims its target bucket and all four generated indexes.

No current milestone owns the remaining rollout:

- strengthen `plans time` by moving its existing identity comparison inside the claim;
- guard dashboard active-plan writes with a revision returned by the plan read route; and
- cover any cooperating config or managed agent-config writer that operates outside `install`.

These are explicitly unplanned follow-ups until a future roadmap admits them. Dashboard project-state revisioning and session-log output are also unplanned unless an implementing milestone explicitly includes them.

A future guarded writer must retain supported-platform proof for exclusive creation and cleanup before relying on the mechanism. If a supported platform cannot provide that behavior, the dependent implementation stops for a revised decision rather than silently falling back to re-read-only checks.

## Doctrine-only fallback

Until a writer is routed through the guard, goat-plan must re-read the exact milestone or marker immediately before a direct edit, compare it with the snapshot used to prepare the edit, and stop on any sibling change. Session logs use unique names rather than shared date-only names. These steps are advisory and must be described as such; they do not satisfy a guarded-runtime requirement that two cooperating writers cannot silently overwrite each other.

If remaining adoption stalls, retain this doctrine for unguarded writers and the reproduced limitation, but re-sequence dependent runtime work. Do not relabel the doctrine as a lock or accept it as proof for guarded managed state.

## Consequences

- Cooperating writers either hold one target's claim and validate the expected bytes or fail without replacement.
- Claim admission writes owner bytes only after identity checks; a hostile parent swap may leave an empty file elsewhere.
- The mechanism reuses atomic replacement and `plans time` content comparison rather than creating competing write conventions.
- A crashed writer can leave a claim that blocks later writes until reviewed; this trades availability for preservation of ambiguous state.
- Direct agent and editor writes remain capable of bypassing the guard, so user-facing claims must say **cooperative** detection.
- `.goat-flow/write-claims/` is transient gitignored coordination state registered in the local-state architecture and manifest.

## Reversibility

The shipped mechanism remains reversible if every guarded caller returns to its prior write path and dependent work is re-sequenced; the helper and claim directory can then be removed. Revisit the decision if supported-platform proof disproves exclusive creation, stale-claim recovery causes unacceptable blocked writes, or runtime work needs cross-project or network-filesystem coordination. Those cases require a new decision; they must not weaken the claim to an mtime or process-local check.
