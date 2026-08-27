# ADR-064: Give each managed path one install baseline

**Status:** Accepted
**Date:** 2026-08-27
**Updated:** 2026-08-28 - refreshed the preview evidence after Task 6 moved admission to the v2 facade.
**Ticket/Context:** M41, goat-flow 1.17.0 managed install-state work

## Context

The predecessor design created that disagreement by construction. `src/cli/managed-setup-state.ts` (search: `goat-flow.install-state.v1`) stored every selected preview path in `.goat-flow/install-state/<agent>.json`, and preview read only the selected agent's file although the manifest contributes project-wide paths and Codex and Antigravity share `.agents/skills/`. The migrated preview now calls the selection-independent v2 boundary in `src/cli/managed-setup-preview.ts` (search: `const baseline = readManagedSetupV2Baseline`).

The RED fixture in `test/integration/setup-install-shared-state.test.ts` (search: `one baseline per managed path`) preserves the reported 1.15.1-to-1.16.0 shared-file cases as inputs and reproduces the remaining structural failure with the current public CLI. Without running hook payloads, a local patch was `local-preserved` under the current Codex baseline and `both-changed` under stale Antigravity state. Equal-version and unrankable legacy disagreements remained hidden when another agent was selected. An unselected malformed state remained `loaded`, no project-wide state existed, and two synchronized public installs both exited zero.

ADR-048 (`.goat-flow/learning-loop/decisions/ADR-048-concurrent-session-detection.md`, search: `path-keyed exclusive claim plus expected content identity`) already defines the cooperative writer primitive. This decision applies that primitive to the complete install lifecycle; it does not create a second locking convention.

## Decision

`.goat-flow/install-state/managed.json` is the only authoritative managed-path hash store. Its schema is `goat-flow.install-state.v2`. It contains one row per safe project-relative managed path and embeds hashless agent receipts in the same atomic state file.

Agent selection chooses which current skill mirror and receipt an install handles. It never chooses a baseline for a path. Current target bytes, incoming template bytes, directory presence, filename, modification time, and selected-agent order never resolve conflicting history.

M41 is the first runtime consumer of ADR-048's reusable claim and expected-identity helper. The helper remains under `src/cli/` and is reusable by the later M11 writer rollout; no managed-install-only lock is permitted.

## Normative v2 schema

The persisted shape is:

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

Objects accept exactly the keys shown. Unknown keys, duplicate file-row paths, duplicate receipt agents, duplicate paths within a receipt, unsafe paths, unknown agents, empty versions, invalid hashes or generations, unsorted arrays, and non-canonical bytes are malformed-blocking. A receipt reference to a missing row or a different row generation is syntactically valid stale evidence, not a parse error; normal row replacement must be able to stale another agent's receipt without corrupting the state file.

`expectedSha256` is the package hash supplied by the last verified public install or selected by a clean legacy bootstrap. It is never computed from arbitrary current target bytes. Receipts contain no expected or current content hash.

## Deterministic row generations

A row generation is content-derived so equivalent final state does not depend on install order. It is lowercase SHA-256 over these UTF-8 bytes, in order:

```text
goat-flow.install-state.row-generation.v1 NUL
path NUL
expectedSha256 NUL
canonical-provenance-json
```

`canonical-provenance-json` uses the key order shown in the schema. Legacy observations are sorted by agent and then by the raw version string before generation is computed.

Changing the path, expected hash, provenance kind, verified package version, or selected legacy observations changes the generation. Re-verifying the same path, hash, and package version preserves it. A monotonic transaction counter is rejected because installing Antigravity then Claude would assign different generations to unique rows than installing Claude then Antigravity.

## Canonical serialization

Canonical v2 bytes use this order:

1. top-level keys: `schemaVersion`, `files`, `receipts`;
2. file-row keys: `path`, `expectedSha256`, `generation`, `provenance`;
3. provenance keys in the schema order;
4. receipt keys: `agent`, `goatFlowVersion`, `files`;
5. receipt-reference keys: `path`, `generation`.

File rows and receipt references sort by ascending UTF-8 path bytes. Receipts sort by agent, and legacy observations sort by agent then raw version bytes. Serialization uses two-space indentation and one trailing newline. A reader parses, validates, reserializes, and requires exact byte equality before the state can authorize a replacement. This also rejects duplicate-key or formatting ambiguity that ordinary `JSON.parse` would otherwise erase.

## Row and receipt transitions

A verified public install starts from the current row map. For every current system-owned exact-copy path in the selected agent's complete preview, it writes the incoming package hash with `verified-install` provenance for the executing package version and recomputes the deterministic generation. Identical logical rows retain their generation. Rows outside that install's path set remain byte-identical, including another agent's unique rows and orphans.

After all selected paths pass post-write verification, the writer replaces the selected agent's receipt with the exact sorted path/generation set just verified. Other receipts remain stored and may become stale. The writer then canonicalizes and atomically replaces `managed.json` once. Repeating an already confirmed install produces identical state bytes and performs no state replacement.

A stored receipt is `confirmed` only when all of these remain true:

- its package version equals the executing package version;
- its path set exactly equals the current system-owned exact-copy set for that agent;
- every referenced row exists and has the referenced generation;
- every referenced target is a safe regular file whose current hash equals the row's expected hash; and
- that agent's legacy cutover marker is exact.

A package-version change, path-set change, missing row, generation change, missing or non-regular target, current-byte change, failed verification, or cutover-marker mismatch makes the receipt `stale`. Staleness removes installation-selection authority but does not discard the canonical row: a legitimate local edit still needs the old expected hash to classify as `local-preserved` or a real `both-changed` conflict.

An agent imported from valid v1 state but not yet verified under v2 is `legacy-unconfirmed`. No directory or shared path is evidence that an agent is installed.

## Public status vocabulary

Preview's `baselineStatus` is exactly one of `missing`, `loaded`, `malformed-blocking`, `conflicting`, or `cutover-incompatible`. `invalid` is retired because it does not distinguish repairable syntax or shape failures from contradictory valid evidence. Both `malformed-blocking` and `conflicting` force a blocked verdict for every selected agent. `cutover-incompatible` names valid v2 state whose known legacy marker set is incomplete or was replaced by a v1 writer; its rows remain the only baseline authority, but a public apply must repair all markers under claims before target mutation.

Per-agent evidence is exactly `confirmed`, `stale`, `legacy-unconfirmed`, or absent. Per-row non-authoritative evidence uses `orphan`. Text and JSON output use these same tokens and identify the affected agent or path, the reason, and a non-force recovery. A force flag never changes baseline, bootstrap, receipt, cutover, or orphan evidence.

## Selection-independent v1 bootstrap

When `managed.json` is absent, every known `.goat-flow/install-state/<agent>.json` is inventoried before any selected-agent preview can authorize a write. Each present file must be a safe regular file and pass the complete v1 schema, agent, path, uniqueness, hash, and version checks. One malformed selected or unselected file makes the global result `malformed-blocking`; no v2 file or target byte is written.

For each path in a clean inventory:

1. If every observation has the same expected hash, accept that hash. Its legacy provenance contains every agreeing observation in canonical order, including unrankable version strings.
2. If hashes differ, every version must pass the existing plain `X.Y.Z` release comparator in `src/cli/version-compare.ts` (search: `isReleaseVersion`). Prerelease, build, shortened, prefixed, and hand-edited values are unrankable.
3. Keep only observations at the highest precedence. If they agree on one hash, accept it and record those winning observations.
4. If a disagreeing observation is unrankable, or equal highest-precedence observations disagree, return `conflicting` and block the entire bootstrap.

This rule never consults current bytes or the incoming template to invent history. Both agent-selection orders therefore produce identical virtual v2 bytes or the same refusal.

A dry-run reports the virtual result without writing. An applying install acquires the complete ADR-048 claim batch, repeats the inventory and resolution, and first publishes a canonical bootstrap `managed.json` with no receipts. Only then does it replace or create the known agent files as canonical hashless cutover markers:

```ts
type LegacyCutoverMarker = {
  schemaVersion: "goat-flow.install-state.v1-cutover";
  agent: KnownAgentId;
  managedState: "managed.json";
  legacyEvidence: "migrated" | "absent";
};
```

All known agents receive a marker. `migrated` means a valid v1 file contributed to bootstrap; `absent` means no v1 file existed. Existing files are replaced in place, never deleted or renamed, and the imported hashes exist only in `managed.json`. If marker publication fails, no target mutation or confirmed receipt occurs. The valid receipt-free v2 bootstrap remains recoverable, and a later public install retries the markers under the same claims.

Once `managed.json` exists, v1 hashes are never read as authority. A newly appearing v1 schema file is `cutover-incompatible`, stales receipts, and is converted only by a claimed public install after target bytes are reclassified from v2.

## Old-reader and direct-installer cutover

The cutover markers deliberately make a v1-only CLI reject every selected agent's state as an unknown schema. During a partially completed marker transition, `managed.json` still activates the direct-script guard, so an older CLI cannot reach target mutation even if its preview read an unconverted v1 file.

`workflow/install-goat-flow.sh` must refuse before staging or mutation when `managed.json` or a cutover marker exists unless the v2-aware CLI supplies its internal `GOAT_FLOW_INSTALL_ADMISSION=v2` environment value after claim acquisition and revalidation. The environment value is a cooperative compatibility guard, not a security credential. The refusal names the public `goat-flow install <project-path> --agent <agent>` command and never recommends force.

This makes old previews fail visibly after marker completion and makes every old-CLI or direct-script apply fail before mutation throughout cutover. Silent fallback to v1 is forbidden.

## Claimed install lifecycle

An applying public install follows one lifecycle while holding ADR-048 claims:

1. Build the complete preview and capture expected identities for every target the installer may write, `managed.json`, and every known legacy marker path.
2. Sort the complete project-relative path set by UTF-8 bytes and acquire all claims. Contention exits non-zero immediately; already acquired claims are owner-released, and no state or target mutation occurs.
3. Re-read every identity, rebuild the complete preview, and repeat bootstrap or v2 validation under the claims. Any change aborts before staging.
4. Complete the receipt-free v2 bootstrap and cutover markers when required.
5. Invoke Bash with v2 admission while retaining every claim, apply the targets, and verify every expected system-owned byte.
6. Build and atomically replace the one canonical state candidate containing the selected confirmed receipt.
7. Release only claims whose owner identity still matches.

The contention diagnostic is `Managed install is busy: another process owns <relative-path>. No target files were changed.` Claims are never waited on, stolen, expired, or removed from process-liveness or elapsed-time guesses. Explicit abandoned-claim recovery remains the ADR-048 operator workflow.

Atomic replacement protects the bytes of one state file; the claim protects the full read, admission, target mutation, verification, and state publication interval. The claim does not turn several target renames into a filesystem transaction and does not cover non-cooperating manual edits.

## Installed bytes without recorded state

The final state candidate is staged beside `managed.json`, flushed, and replaced only after target verification. Any staging, flush, or replacement failure leaves the previous `managed.json` byte-identical. No new receipt becomes visible.

The command exits non-zero and prints:

```text
Managed files were verified, but install state was not recorded. The previous managed baseline is intact and no confirmed receipt was written. Repair write access to .goat-flow/install-state/, then rerun: goat-flow install <project-path> --agent <agent>
```

Rerunning the same public command after repairing state access is the recovery. It needs no force: matching current and incoming bytes verify cleanly, and the retained baseline still supplies drift history.

## Orphans

An orphan is a stored path row absent from both the current manifest-derived managed path union and every stored receipt reference. It remains visible with status `orphan` but supplies no preview, overwrite, installed-agent, audit, or hook authority. Stale receipt references still prevent orphan classification until that receipt is replaced, because automatic history pruning is outside this decision.

Rows are never deleted during bootstrap or ordinary install. A later explicit cleanup contract may remove proven orphans; M41 does not infer deletion from directory absence, agent selection, or package age.

## Deterministic decision table

| Case | Outcome |
| --- | --- |
| Reported pristine shared hook under stale 1.15.1 and current 1.16.0 agent state | Global bootstrap chooses the one highest-precedence agreed row. Selection cannot turn that path into `both-changed`; ordinary current/new comparison decides `unchanged` or `template-changed`. |
| Locally patched shared hook | The canonical row remains the old expected package hash. If the incoming hash is unchanged, every agent reports `local-preserved`; the changed current bytes make receipts stale without authorizing replacement. |
| Shared `.agents/skills/` path | One row exists. Codex and Antigravity receipts may reference the same generation. |
| Unique `.claude/skills/` path | One row exists and survives other-agent installs. Only a Claude receipt references it. |
| Antigravity then Claude versus Claude then Antigravity | Deterministic generations, sorting, and receipts produce byte-identical final `managed.json`. |
| Equal-precedence v1 hashes disagree | Global status is `conflicting`; every agent selection blocks without writes. |
| Unrankable v1 versions disagree | Global status is `conflicting`; filenames, times, current bytes, and selection do not break the tie. |
| Selected v1 is malformed | Global status is `malformed-blocking`; no bootstrap or target write occurs. |
| Unselected v1 is malformed | Same `malformed-blocking` result for every selection. |
| Receipt package, path set, row presence, generation, target safety, or target bytes change | Receipt is `stale`; it cannot select a confirmed installed agent. |
| Two public installs overlap | One holds the complete claim batch. The contender exits non-zero before its first mutation. |
| Post-verification state commit fails | Previous state remains byte-identical, no new receipt exists, and the exact non-force recovery is printed. |
| Valid v1 cutover | Receipt-free v2 state is published, all known v1 paths become hashless cutover markers, then target mutation may begin. |
| v1-only CLI or direct script after cutover | Old preview rejects the marker; apply refuses before mutation without v2 CLI admission. |
| Row is absent from manifest and every stored receipt | Row is visible as `orphan` and has no authority; ordinary install retains it. |

## Failure Mode Comparison

| Option | What fails | Decision |
| --- | --- | --- |
| Keep complete per-agent baselines | Shared hooks and `.agents/skills/` regain several expected hashes and selection-dependent overwrite decisions. | Rejected. |
| Split only a `shared.json` by folder | `.agents/skills/` is shared by two agents while other mirrors are unique; folder ownership does not model path identity. | Rejected. |
| Rewrite every agent baseline after each install | A crash or non-cooperating writer can leave duplicates disagreeing, and several files cannot provide one atomic receipt commit. | Rejected. |
| Store receipts in separate files | Hash ownership stays singular, but row changes and confirmation cannot publish in one atomic replacement. | Rejected; embed hashless receipts in `managed.json`. |
| Use monotonic numeric generations | Equivalent agent orders assign different generations to unique paths and receipts. | Rejected; derive generation from canonical row identity. |
| Resolve migration with current bytes, templates, filenames, mtimes, or selected agent | Ambiguous history is converted into false overwrite authority. | Rejected; conflict blocks globally. |
| Acquire a claim only for final state write | Two installers can interleave target mutation before either state commit. | Rejected; hold the complete sorted claim batch through apply and commit. |
| Path-keyed state with embedded receipts and full-lifecycle ADR-048 claims | A crashed cooperative writer can block availability, and manual edits remain outside enforcement. | Accepted because baseline authority, confirmation, and cooperative mutation have one fail-closed owner. |

## Consequences

- Preview, post-verification, audit, and hook status must consume one strict state facade; the hook-specific `expectedHashSets` reconciliation becomes obsolete.
- Local edits can stale a receipt while the canonical row still preserves the three-way comparison needed to protect those edits.
- The v2 file and cutover markers are local evidence. They stay gitignored and must not contain target bytes, absolute paths, timestamps, process IDs, or secrets.
- `.goat-flow/write-claims/` becomes transient coordination state under ADR-048 and must be registered consistently before the v2 writer ships.
- A malformed unselected v1 file blocks first bootstrap. This costs availability but prevents agent choice from changing history.
- Old direct installer use becomes an explicit refusal after cutover instead of an unrecorded mutation path.

## Reversibility

This is a two-way decision before v2 state ships. M41 can remove the proposed schema and RED fixture while v1 remains authoritative.

After consumer projects write v2, changing row-generation inputs, bootstrap precedence, receipt location, or cutover-marker semantics requires a new schema and migration decision. Returning to per-agent hash ownership is not a safe rollback. A rollback must preserve `managed.json`, keep old/direct writers blocked, and provide an explicit reader or export path for its evidence.

Revisit this decision if Linux and Windows cannot pass the identical ADR-048 helper contract, if canonical row generation is not byte-stable across supported platforms, or if the state-only cutover cannot make every known old writer fail before target mutation. Do not weaken those failures into advisory warnings.
