# ADR-058: Managed accepted deltas are evidence, not overwrite authority

**Status:** Proposed
**Date:** 2026-08-17
**Updated:** 2026-09-05 - status changed from Accepted to Proposed: no accepted-delta schema, parser, or projection exists in the codebase and no milestone owns the slice.

## Context

Managed-file tools once treated every byte mismatch as one condition. `src/cli/audit/check-drift-hooks.ts` (search: `hookContentMismatchMessage`) could recommend `hooks sync` whether the installed file was an older package copy or carried local content absent from the package. `src/cli/managed-setup-preview.ts` (search: `classifyManagedSetupFile`) now supplies the old/current/new evidence that separates those cases, and `test/integration/managed-divergence-messaging.test.ts` (search: `refuses a destructive hook sync`) preserves the incident: a declared local hook delta must not receive the same repair as a safely behind copy.

The same mismatch counts differently across tools. `audit --check-drift --agent` checks every declared file for one agent while `skill doctor` checks `SKILL.md` once per agent-skill row (`src/cli/skill-doctor.ts`, search: `countScope`), and a durable seam must keep those raw scopes. A separate, unscheduled proposal for declarative local hook policy would separate canonical hook bytes, validated policy, and raw divergence for two declared hook needs; this record generalises the evidence separation to any managed file, including `skill-docs/`, without claiming that policy schema exists. ADR-052 remains the hook trust boundary: an explanation for local bytes is not proof that they are current, safe to execute, or equivalent to the registry contract.

## Decision

A per-file accepted-delta declaration is a bounded evidence seam: it explains intentional local divergence and grants no write authority.

Each declaration names one safe repository-relative managed file, one grep-friendly semantic anchor expected to resolve uniquely in the installed file, and one non-empty reason. Consumers report canonical comparison, raw divergence, declaration validity, and resulting action separately:

- `audit` keeps raw differing-file evidence and reports accepted and unexplained divergence as separate counts.
- Install preview shows the matched declaration beside the canonical state. It may preserve content where the state model already permits preservation, but a declaration cannot turn `both-changed` into an automatic replacement or merge.
- `skill doctor` reports accepted divergence separately from mirror rows and warning totals; it never converts a divergent mirror into a canonical match.

Invalid paths, missing or non-unique anchors, blank reasons, and declarations for files outside the managed write set are visible validation failures; a stale declaration never becomes a silent no-op. For executable hooks, an accepted delta cannot satisfy ADR-052's `installed-current`, `trusted`, `observed-running`, `result-delivered`, or `scenario-verified` gates. The bounded slice is one schema and parser, one shared projection, audit/install/doctor rendering, and cross-surface tests; it excludes automatic merging, new force semantics, hook-policy validation, and the local-policy schema.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| One undifferentiated mismatch | Older package bytes and intentional local content receive the same repair, which can delete the reason the repair was needed | Rejected |
| Treat file, anchor, and reason as overwrite permission or canonical equivalence | Human context becomes executable authority and bypasses ADR-052's chain | Rejected |
| Suppress accepted files from raw counts | Operators cannot reconcile tool scopes or detect new drift around a present anchor | Rejected |
| Wait for the local-policy plan and keep the seam hook-specific | `skill-docs/` and other managed files keep the destructive-repair ambiguity | Rejected |
| Record accepted-delta evidence while preserving raw divergence and existing write gates | Tools explain intentional content without claiming it is canonical, trusted, or safe to replace | Accepted as the design |

## Consequences

- Nothing is implemented as of 2026-09-05; when it is, the three consumers must share one parser and projection.
- Existing preview classifications stay canonical; the seam annotates them.
- Users still preserve or port local content before adopting a changed template, and hook status stays conservative even with a documented reason.

## Reversibility

Two-way: the seam is additive evidence and can be removed by deleting schema, parser, projections, and declarations while preview classification and ADR-052 gates stay intact. Any proposal that lets a declaration satisfy hook trust or authorize replacement must supersede this record and re-evaluate ADR-052.
