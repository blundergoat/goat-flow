# ADR-064: Give each managed path one install baseline

**Status:** Accepted
**Date:** 2026-08-27
**Ticket/Context:** M41, goat-flow 1.17.0 managed install-state work
**Updated:** 2026-09-05 - condensed; rollout wording aligned with ADR-048 (remaining writer adoption is unplanned) and reversibility updated because v2 state has shipped. The 2026-08-28 amendment refreshed the preview evidence after admission moved to the v2 facade.

## Context

The predecessor design created disagreement by construction. `src/cli/managed-setup-state.ts` (search: `goat-flow.install-state.v1`) stored every selected preview path in `.goat-flow/install-state/<agent>.json`, and preview read only the selected agent's file although the manifest contributes project-wide paths and Codex and Antigravity share `.agents/skills/`. The RED fixture in `test/integration/setup-install-shared-state.test.ts` (search: `one baseline per managed path`) preserves the reported 1.15.1-to-1.16.0 shared-file cases: a local patch was `local-preserved` under the current Codex baseline and `both-changed` under stale Antigravity state, equal-version and unrankable disagreements stayed hidden when another agent was selected, an unselected malformed state remained `loaded`, and two synchronized public installs both exited zero.

ADR-048 (search: `path-keyed exclusive claim plus expected content identity`) defines the cooperative writer primitive; this decision applies it to the complete install lifecycle rather than creating a second locking convention. Preview now reads the selection-independent v2 boundary (`src/cli/managed-setup-preview.ts`, search: `const baseline = readManagedSetupV2Baseline`).

## Decision

`.goat-flow/install-state/managed.json` is the only authoritative managed-path hash store: one row per safe project-relative path, with hashless agent receipts embedded in the same atomic file.

Agent selection chooses which current skill mirror and receipt an install handles. It never chooses a baseline for a path, and current target bytes, incoming template bytes, directory presence, filename, modification time, and selected-agent order never resolve conflicting history. The ADR-048 helper stays under `src/cli/` for reuse by other writers; no managed-install-only lock is permitted.

### Normative v2 schema

```ts
type ManagedInstallStateV2 = {
  schemaVersion: "goat-flow.install-state.v2";
  files: ManagedPathRow[];
  receipts: ManagedInstallReceipt[];
};

type ManagedPathRow = {
  path: SafeProjectRelativePath;
  expectedSha256: LowercaseSha256;
  generation: LowercaseSha256;
  provenance: VerifiedInstallProvenance | LegacyBootstrapProvenance;
};

type VerifiedInstallProvenance = {
  kind: "verified-install";
  goatFlowVersion: NonEmptyString;
};

type LegacyBootstrapProvenance = {
  kind: "legacy-v1-bootstrap";
  observations: Array<{
    agent: KnownAgentId;
    goatFlowVersion: NonEmptyString;
  }>;
};

type ManagedInstallReceipt = {
  agent: KnownAgentId;
  goatFlowVersion: NonEmptyString;
  files: Array<{
    path: SafeProjectRelativePath;
    generation: LowercaseSha256;
  }>;
};
```

Objects accept exactly the keys shown. Unknown keys, duplicate file-row paths, duplicate receipt agents, duplicate paths within a receipt, unsafe paths, unknown agents, empty versions, invalid hashes or generations, unsorted arrays, and non-canonical bytes are malformed-blocking. A receipt reference to a missing row or a different generation is valid stale evidence, not a parse error, so normal row replacement can stale another agent's receipt without corrupting the file. `expectedSha256` is the package hash from the last verified public install or a clean legacy bootstrap, never computed from current target bytes; receipts carry no content hash.

### Deterministic row generations and canonical bytes

A row generation is lowercase SHA-256 over these UTF-8 bytes, so equivalent final state does not depend on install order:

```text
goat-flow.install-state.row-generation.v1 NUL
path NUL
expectedSha256 NUL
canonical-provenance-json
```

Legacy observations sort by agent then raw version before the generation is computed. Changing the path, expected hash, provenance kind, verified version, or observations changes the generation; re-verifying the same triple preserves it. A monotonic counter is rejected because installing Antigravity then Claude would assign different generations than the reverse order.

Canonical bytes order top-level keys `schemaVersion`, `files`, `receipts`; row keys `path`, `expectedSha256`, `generation`, `provenance`; provenance keys in schema order; receipt keys `agent`, `goatFlowVersion`, `files`; reference keys `path`, `generation`. Rows and references sort by ascending UTF-8 path bytes, receipts by agent, observations by agent then raw version, with two-space indentation and one trailing newline. A reader parses, validates, reserializes, and requires exact byte equality before the state can authorize a replacement.

### Row and receipt transitions

A verified public install writes, for every current system-owned exact-copy path in the selected agent's complete preview, the incoming package hash with `verified-install` provenance for the executing version, recomputes generations (identical rows keep theirs), and leaves rows outside its path set byte-identical, including other agents' unique rows and orphans. After all selected paths pass post-write verification, it replaces the selected agent's receipt with the exact sorted path/generation set just verified, then canonicalizes and atomically replaces `managed.json` once. Repeating a confirmed install produces identical bytes and no replacement.

A stored receipt is `confirmed` only when its package version equals the executing version, its path set equals the current system-owned exact-copy set for that agent, every referenced row exists at the referenced generation, every target is a safe regular file whose hash equals the row's expected hash, and that agent's legacy cutover marker is exact. Any of those failing makes it `stale`, which removes installation-selection authority but keeps the canonical row, because a legitimate local edit still needs the old expected hash to classify as `local-preserved` or `both-changed`. An agent imported from valid v1 state but not yet verified under v2 is `legacy-unconfirmed`. No directory or shared path is evidence that an agent is installed.

### Public status vocabulary

Preview's `baselineStatus` is exactly one of `missing`, `loaded`, `malformed-blocking`, `conflicting`, or `cutover-incompatible`; `invalid` is retired because it blurred repairable shape failures and contradictory valid evidence. `malformed-blocking` and `conflicting` block every selected agent. `cutover-incompatible` names valid v2 state whose legacy marker set is incomplete or was replaced by a v1 writer; its rows remain the baseline, but a public apply repairs all markers under claims before target mutation. Per-agent evidence is `confirmed`, `stale`, `legacy-unconfirmed`, or absent; per-row non-authoritative evidence is `orphan`. Text and JSON output use these tokens with the affected agent or path, the reason, and a non-force recovery. A force flag never changes baseline, bootstrap, receipt, cutover, or orphan evidence.

### Selection-independent v1 bootstrap

When `managed.json` is absent, every known `.goat-flow/install-state/<agent>.json` is inventoried before any selected-agent preview can authorize a write. Each must be a safe regular file passing the complete v1 schema, agent, path, uniqueness, hash, and version checks, and one malformed file, selected or not, makes the global result `malformed-blocking` with nothing written. For each path in a clean inventory: identical hashes are accepted with every agreeing observation recorded; differing hashes require every version to pass the plain `X.Y.Z` comparator in `src/cli/version-compare.ts` (search: `isReleaseVersion`), keep only the highest-precedence observations, and accept them when they agree; an unrankable disagreeing observation or an equal-precedence disagreement returns `conflicting` and blocks the whole bootstrap. Current bytes and templates never invent history, so both selection orders produce identical virtual v2 bytes or the same refusal.

A dry run reports without writing. An applying install acquires the complete ADR-048 claim batch, repeats inventory and resolution, publishes a receipt-free canonical `managed.json`, then replaces or creates every known agent file as a hashless cutover marker:

```ts
type LegacyCutoverMarker = {
  schemaVersion: "goat-flow.install-state.v1-cutover";
  agent: KnownAgentId;
  managedState: "managed.json";
  legacyEvidence: "migrated" | "absent";
};
```

Existing files are replaced in place, never deleted or renamed; imported hashes exist only in `managed.json`. If marker publication fails, no target mutation or confirmed receipt occurs and a later install retries the markers. Once `managed.json` exists, v1 hashes are never read as authority; a newly appearing v1 file is `cutover-incompatible`, stales receipts, and is converted only by a claimed public install.

### Old-reader and direct-installer cutover

The markers deliberately make a v1-only CLI reject every agent's state as an unknown schema. `workflow/install-goat-flow.sh` refuses before staging or mutation when `managed.json` or a marker exists unless the v2-aware CLI supplies `GOAT_FLOW_INSTALL_ADMISSION=v2` after claim acquisition and revalidation. That value is a cooperative compatibility guard, not a security credential. The refusal names `goat-flow install <project-path> --agent <agent>` and never recommends force. Silent fallback to v1 is forbidden.

### Claimed install lifecycle

1. Build the complete preview and capture expected identities for every target the installer may write, `managed.json`, and every legacy marker path.
2. Sort the complete project-relative path set by UTF-8 bytes and acquire all claims. Contention exits non-zero at once with `Managed install is busy: another process owns <relative-path>. No target files were changed.`; owned claims are released and nothing mutates.
3. Re-read every identity, rebuild the preview, and repeat bootstrap or v2 validation under the claims; any change aborts before staging.
4. Complete the receipt-free bootstrap and cutover markers when required.
5. Invoke Bash with v2 admission while holding every claim, apply the targets, and verify every expected system-owned byte.
6. Build and atomically replace the one canonical state candidate containing the selected confirmed receipt.
7. Release only claims whose owner identity still matches.

The claim protects the whole read, admission, mutation, verification, and publication interval; it does not turn several renames into a filesystem transaction or cover non-cooperating manual edits. If staging, flush, or replacement of the state candidate fails after targets verified, the previous `managed.json` stays byte-identical, no receipt appears, and the command exits non-zero printing that managed files were verified but install state was not recorded, with the rerun command as the recovery. Rerunning after repairing write access needs no force.

### Orphans

An orphan is a stored row absent from the manifest-derived managed path union and every stored receipt. It stays visible as `orphan` with no preview, overwrite, installed-agent, audit, or hook authority. Stale receipt references prevent orphan classification until the receipt is replaced. Rows are never deleted during bootstrap or ordinary install; a later explicit cleanup contract may remove proven orphans.

### Deterministic decision table

| Case | Outcome |
| --- | --- |
| Pristine shared hook under stale 1.15.1 and current 1.16.0 agent state | Bootstrap chooses the one highest-precedence agreed row; selection cannot make it `both-changed` |
| Locally patched shared hook | The canonical row keeps the old package hash; an unchanged incoming hash reports `local-preserved` for every agent, and the changed bytes stale receipts without authorizing replacement |
| Shared `.agents/skills/` path | One row; Codex and Antigravity receipts may reference the same generation |
| Unique `.claude/skills/` path | One row that survives other-agent installs; only a Claude receipt references it |
| Antigravity then Claude versus Claude then Antigravity | Byte-identical final `managed.json` |
| Equal-precedence v1 hashes disagree, or unrankable versions disagree | Global `conflicting`; every selection blocks without writes |
| Any v1 file malformed, selected or not | Global `malformed-blocking`; no bootstrap or target write |
| Receipt package, path set, row, generation, target safety, or target bytes change | Receipt `stale`; it cannot select a confirmed installed agent |
| Two public installs overlap | One holds the claim batch; the contender exits non-zero before its first mutation |
| Post-verification state commit fails | Previous state byte-identical, no receipt, exact non-force recovery printed |
| Valid v1 cutover | Receipt-free v2 published, all known v1 paths become markers, then targets may mutate |
| v1-only CLI or direct script after cutover | Old preview rejects the marker; apply refuses before mutation without v2 admission |
| Row absent from manifest and every receipt | Visible `orphan`, no authority, retained |

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| Complete per-agent baselines | Shared hooks and `.agents/skills/` regain several expected hashes and selection-dependent overwrite decisions | Rejected |
| A `shared.json` split by folder | `.agents/skills/` is shared by two agents while other mirrors are unique; folder ownership does not model path identity | Rejected |
| Rewrite every agent baseline after each install | A crash or non-cooperating writer leaves duplicates disagreeing; several files cannot commit one receipt atomically | Rejected |
| Receipts in separate files | Row changes and confirmation cannot publish in one atomic replacement | Rejected |
| Monotonic numeric generations | Equivalent install orders assign different generations | Rejected |
| Resolve migration with current bytes, templates, filenames, mtimes, or selected agent | Ambiguous history becomes false overwrite authority | Rejected |
| Claim only the final state write | Two installers interleave target mutation before either state commit | Rejected |
| Path-keyed state, embedded receipts, full-lifecycle ADR-048 claims | A crashed cooperative writer blocks availability, and manual edits stay outside enforcement | Accepted |

## Consequences

- Preview, post-verification, audit, and hook status consume one strict state facade; the hook-specific `expectedHashSets` reconciliation is obsolete.
- The v2 file and cutover markers are gitignored local evidence and must not contain target bytes, absolute paths, timestamps, process IDs, or secrets.
- A malformed unselected v1 file blocks first bootstrap, trading availability for history that agent choice cannot rewrite; old direct installer use is an explicit refusal after cutover.

## Reversibility

v2 state has shipped in 1.17.0 and consumer projects write it. Changing row-generation inputs, bootstrap precedence, receipt location, or cutover-marker semantics now requires a new schema and migration decision. Returning to per-agent hash ownership is not a safe rollback: any rollback must preserve `managed.json`, keep old and direct writers blocked, and provide an explicit reader or export path for its evidence. Revisit if Linux and Windows cannot pass the identical ADR-048 helper contract, if row generation is not byte-stable across platforms, or if the state-only cutover cannot make every old writer fail before mutation; do not weaken those failures into advisory warnings.
