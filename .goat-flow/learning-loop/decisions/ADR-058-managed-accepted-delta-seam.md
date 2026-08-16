# ADR-058: Managed accepted deltas are evidence, not overwrite authority

**Status:** Accepted
**Date:** 2026-08-17

## Context

Managed-file tools previously treated every byte mismatch as the same condition. `src/cli/audit/check-drift-hooks.ts` (search: `hookContentMismatchMessage`) could recommend `hooks sync` whether the installed file was an older package copy or carried local content absent from the package. `src/cli/managed-setup-preview.ts` (search: `classifyManagedSetupFile`) now supplies the old/current/new evidence needed to distinguish those cases. `test/integration/managed-divergence-messaging.test.ts` (search: `refuses a destructive hook sync`) preserves the incident: a declared local hook delta must not receive or execute the same repair as a safely behind copy.

The same mismatch has different counting units across tools. `audit --check-drift --agent` checks every declared file for one selected agent, while `skill doctor` checks `SKILL.md` once per selected agent-skill row. `src/cli/skill-doctor.ts` (search: `countScope`) now makes that difference explicit. A durable accepted-delta seam must retain those raw scopes instead of making unlike counts appear interchangeable.

The planned 1.17.0 M20 milestone proposes separating canonical hook bytes, validated policy, and raw divergence for two declared hook needs. M20 is scheduled work, not shipped behaviour. This decision generalises the evidence separation beyond that proposal to arbitrary managed files, including files under `skill-docs/`; it does not claim M20's schema or validation already exists.

ADR-052 remains the hook trust boundary. An explanation for local bytes is not proof that those bytes are current, safe to execute, or equivalent to the registry contract.

## Decision

Goat Flow will add a general per-file accepted-delta declaration as a bounded evidence seam. Each declaration names one safe repository-relative managed file, one grep-friendly semantic anchor expected to resolve uniquely in the installed file, and one non-empty reason explaining why the local delta exists.

The declaration acknowledges intent; it is not an exemption from raw drift and grants no write authority. Consumers must report canonical comparison, raw divergence, declaration validity, and resulting action separately:

- `audit` keeps raw differing-file evidence and reports accepted and unexplained divergence as separate counts.
- Install preview shows the matched declaration beside M02's canonical state. It may preserve content where the existing state model already permits preservation, but a declaration cannot turn `both-changed` into an automatic replacement or merge.
- `skill doctor` reports accepted divergence separately from mirror rows and warning-message totals. It does not silently convert a divergent mirror into a canonical match.

Invalid paths, missing or non-unique anchors, blank reasons, and declarations for files outside the managed write set remain visible validation failures. A stale declaration never becomes a silent no-op.

For executable hooks, an accepted delta cannot satisfy ADR-052's `installed-current`, `trusted`, `observed-running`, `result-delivered`, or `scenario-verified` gates. A later policy-specific validator may establish stronger evidence, but a general prose reason cannot.

The bounded follow-on slice is limited to one declaration schema and parser, one shared projection of declaration evidence, audit/install/doctor rendering, and focused cross-surface tests. It excludes automatic merging, new force semantics, hook-policy validation, and implementation of the separately planned M20 schema.

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Keep one undifferentiated mismatch | Older package bytes and intentional local content receive the same repair, so a repair can delete the reason it was needed. | Rejected. |
| Treat a file, anchor, and reason as permission to overwrite or as proof of canonical equivalence | Human context becomes executable authority, extra changes in the file can be hidden, and ADR-052's trust chain is bypassed. | Rejected. |
| Suppress accepted files from raw audit and doctor counts | Operators cannot reconcile tool scopes or detect new drift around a still-present anchor. | Rejected. |
| Record accepted-delta evidence while preserving raw divergence and existing write gates | Tools can explain intentional local content without claiming it is canonical, trusted, or safe to replace. | Accepted. |
| Wait for M20 and keep the seam hook-specific | `skill-docs/` and other managed files retain the same destructive-repair ambiguity, while a planned milestone is mistaken for shipped infrastructure. | Rejected. |

## Consequences

- Accepted divergence remains visible. It can change explanation and counting, but not the underlying byte evidence.
- The three consumers must share one parser and evidence projection so path, anchor, and reason validation cannot drift.
- Existing M02 classifications remain canonical. The accepted-delta layer annotates them rather than introducing another old/current/new classifier.
- Users must still preserve or port local content before adopting a changed package template.
- Hook status remains conservative even when an operator has documented why local hook bytes differ.

## Reversibility

This is a two-way door because the seam is additive evidence and does not authorize writes. It can be removed by deleting the schema, parser, projections, and declarations while leaving M02 classification and ADR-052 trust gates intact.

Revisit the decision if real declarations cannot distinguish intentional whole-file changes from unrelated drift, if semantic anchors prove unstable across normal edits, or if consumers cannot retain raw counts without confusing users. Any later proposal that lets a declaration satisfy hook trust or authorize replacement must supersede this ADR and re-evaluate ADR-052 explicitly.
