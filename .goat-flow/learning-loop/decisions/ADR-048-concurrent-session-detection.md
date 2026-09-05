# ADR-048: Fence cooperative local-state writes with exclusive claims

**Status:** Accepted
**Date:** 2026-08-23
**Ticket/Context:** `.goat-flow/plans/1.17.0/M03-concurrent-session-spike.md`
**Updated:** 2026-09-05 - condensed; the option evaluation is folded into the comparison table. The 2026-09-03 amendment reconciled shipped claim adoption and marked the remaining rollout unplanned.

## Context

Atomic replacement stops readers seeing partial bytes; it does not stop two writers replacing a file from the same stale snapshot. `.goat-flow/learning-loop/lessons/verification-environment.md` (search: `Parallel sessions need concurrency-safe file patterns`) records two agents writing the same bucket, and `.goat-flow/learning-loop/footguns/cleanup-layering.md` (search: `Session-scoped cleanup over a project-scoped resource`) records cross-process duplication and deletion when process-local ownership was applied to a project-scoped resource. `src/cli/plans-time.ts` (search: `writeMilestoneAtomically`) already compares destination identity and exact content before replacing a milestone, but two cooperating processes can both pass that comparison before either rename; the M03 local runner reproduced the overwrite.

The mechanism must work without a daemon or lock service, and it can protect only writers that cooperate with it.

## Decision

Cooperating runtime writers use a path-keyed exclusive claim plus expected content identity around the complete read, validate, and replace operation.

For each target the guarded writer:

1. resolves and validates the project root and target before creating coordination state;
2. captures an expected identity as file existence plus a SHA-256 of the exact bytes read (a create-only writer expects a missing file);
3. acquires `.goat-flow/write-claims/<key>.claim`, keyed by the normalized project-relative path, with exclusive creation and mode `0o600`; binds the open descriptor to a stable snapshot of that empty path and revalidates the project-local directory chain before writing owner bytes; and stops on contention or failed binding without waiting, stealing, or expiring another claim;
4. re-reads the target under the claim and returns a concurrent-change result on any existence or digest mismatch, without staging or replacing bytes;
5. stages complete output, flushes it, and uses the existing atomic replacement or create-only primitive while the claim is held;
6. releases only the exact claim identity it acquired, reporting rather than deleting a missing or changed claim.

Multi-target operations sort canonical paths before acquiring claims; a failed acquisition releases only claims this operation owns and stops before the first write. That is whole-batch admission, not a promise that several renames form one transaction. An existing claim fails closed even when its process looks dead, because elapsed time cannot separate a slow live writer from a crashed one; recovery is an explicit operator action. Node exposes no cross-platform descriptor-relative create, so a non-cooperating same-user process can swap a parent directory around the exclusive open. Binding the empty marker before its first write keeps owner bytes out of a redirected file, an empty allocation may remain when its pathname leaves the project, and the guarantee does not contain arbitrary local processes.

### Collision surfaces and writer coverage

| Rank | Surface | Actual writer | Coverage |
| ---: | --- | --- | --- |
| 1 | Milestone status and checkboxes | Direct agent edit under goat-plan File-Write | Doctrine-only unless routed through a guarded command |
| 1 | Milestone timing receipt and `Actual` | `plans time` through `writeMilestoneAtomically` | Guardable; its exact-content comparison moves inside the claim |
| 2 | `.goat-flow/plans/.active` | Dashboard `POST /api/plans` through `writeActiveTaskPlan` | Guardable when the read supplies an identity the write returns; a POST-time claim alone would still let a stale selection win |
| 2 | `.goat-flow/plans/.active` | goat-plan fresh-plan direct edit | Doctrine-only |
| 2 | `.goat-flow/plans/.active` | `workflow/install-goat-flow.sh` first-marker creation | Already create-only (`commit_staged_payload` uses `mv -n`); must not become replacement |
| 3 | `.goat-flow/dashboard-state.json` | Dashboard project-list, archive, and restore routes through `writeDashboardState` | Guardable once each read-modify-write carries a state identity; the payload has no revision token today |
| 4 | `.goat-flow/logs/sessions/*.md` | Direct agent writes and `goat-flow redact --output` | Prefer unique per-session names and create-only output |

Checkbox loss ranks first because it can falsify milestone completion and dependency state; session-log interleave ranks last because logs are optional notes with unique names.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Content identity without a claim | Both writers validate before either rename | Kept only inside the exclusive claim |
| mtime guard | Content-preserving touches and timestamp resolution hide distinct bytes; same check-to-write race | Rejected |
| Per-session marker files | Shows that sessions exist but binds no target ownership and cannot distinguish live from abandoned | Rejected; narrowed to one path-keyed claim |
| Dashboard-owned in-memory lock | A second dashboard, a CLI command, and a direct edit all bypass one server's memory | Rejected |
| Path-keyed claim plus content identity | A crashed owner blocks availability, and non-cooperating edits stay outside the guarantee | Accepted; stale cooperating writers fail closed without a daemon |

## Rollout

Shipped: the reusable claim and identity helper (`src/cli/path-write-claim.ts`), cross-process tests, stable diagnostics, sorted multi-target admission, and the managed-install transaction guard. `install` claims every previewed destination including config and managed agent-config paths, `learn new` claims its target bucket and all four generated indexes, and ADR-064 is the first full-lifecycle consumer.

Unplanned until a roadmap admits them: moving the `plans time` identity comparison inside the claim, guarding dashboard active-plan writes with a revision from the plan read route, covering config writers outside `install`, dashboard project-state revisioning, and session-log output. A future guarded writer must retain supported-platform proof for exclusive creation and cleanup; a platform that cannot provide it stops the dependent work for a revised decision rather than falling back to re-read-only checks.

Until a writer is guarded, goat-plan re-reads the exact milestone or marker immediately before a direct edit, compares it with the snapshot used to prepare the edit, and stops on any sibling change. These steps are advisory and must be described as such, never as a lock.

## Consequences

- Cooperating writers either hold one target's claim and validate expected bytes or fail without replacement; user-facing claims say cooperative detection.
- `.goat-flow/write-claims/` is transient gitignored coordination state registered in the local-state architecture and manifest.
- A crashed writer can block later writes until reviewed, trading availability for preservation of ambiguous state.

## Reversibility

Reversible if every guarded caller returns to its prior write path and dependent work is re-sequenced; the helper and claim directory can then go. Revisit if supported-platform proof disproves exclusive creation, stale-claim recovery blocks writes unacceptably, or cross-project or network-filesystem coordination is needed. None of those may weaken the claim to an mtime or process-local check.
