/**
 * Builds the install write-set preview users see before installing goat-flow updates.
 *
 * For managed templates it compares the last installed hash, the selected target file, and the current package template without exposing file
 * contents or absolute project paths; for user-owned and generated destinations it reports the seed-or-preserve action instead.
 *
 * Install handlers use the same result to block ambiguous overwrites and record recovery state.
 */
import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, posix } from "node:path";

import { getPackageVersion, getTemplatePath } from "./paths.js";
import { getSkillFiles, loadManifest } from "./manifest/manifest.js";
import {
  canonicalManagedInstallStateBytes,
  createManagedInstallStateRow,
  managedInstallStatePath,
  readManagedInstallStateFacade,
  writeManagedInstallStateV2,
  type ManagedInstallStateFacade,
  type ManagedInstallStateV2,
} from "./managed-setup-state.js";
import {
  collectProjectWriteDefinitions,
  hashFile,
  type ManagedTargetEvidence,
  type ManagedTargetStatus,
  type ProjectWriteDefinition,
  readManagedTargetEvidence,
} from "./managed-setup-write-set.js";
import {
  NO_MANAGED_SETUP_AUTHORITY,
  resolveAuthorityDecision,
  type ManagedSetupAuthority,
  type ManagedSetupAuthorityDecision,
} from "./managed-setup-authority.js";
import type {
  InstallerInvocation,
  InstallerInvocationError,
} from "./install-invocation.js";
import { KNOWN_AGENT_IDS, type AgentId } from "./types.js";

export {
  managedInstallStatePath,
  writeManagedInstallState,
} from "./managed-setup-state.js";

const MANAGED_SETUP_PREVIEW_SCHEMA =
  "goat-flow.managed-setup-preview.v2" as const;
const MANAGED_INSTALL_STATE_V1_CUTOVER_SCHEMA =
  "goat-flow.install-state.v1-cutover" as const;
const BLOCKING_STATES = new Set<ManagedSetupFileState>([
  "both-changed",
  "missing",
  "unmanaged",
]);

const PREVIEW_LIMITS = [
  "Removals - retired templates, deprecated skills, legacy hook copies, and pre-1.9 path migrations - are cleanup rather than writes and are not enumerated here.",
  "Direct workflow/install-goat-flow.sh execution skips CLI admission, post-write verification, and install-state recording.",
] as const;

/**
 * User-visible outcome for one destination.
 *
 * The first nine values are the three-way template comparison; the last three describe destinations with no exact-copy template, where install seeds,
 * preserves, or regenerates rather than matching bytes.
 *
 * `local-preserved` replaced the former `local-edited`: divergent local bytes under a template this package did not change are kept rather than
 * blocked, so no state now describes "the user edited a managed file" without also saying what the package wants.
 */
export type ManagedSetupFileState =
  | "unchanged"
  | "template-changed"
  | "both-changed"
  | "added"
  | "adopted"
  | "removed"
  | "missing"
  | "unmanaged"
  | "local-preserved"
  | "user-seeded"
  | "user-preserved"
  | "user-migrated"
  | "regenerated";

/** Repair-facing direction derived from M02's three-way managed-file state. */
export type ManagedSetupChangeDirection =
  "current" | "behind" | "diverged" | "unclassified";

/** Action shown beside one path so users know what an approved install would do. */
type ManagedSetupAction =
  | "none"
  | "create"
  | "replace"
  | "preserve"
  | "protect"
  | "regenerate"
  | "migrate";

/** Overall preview outcome used by the CLI before it starts the installer. */
type ManagedSetupVerdict = "ready" | "warning" | "blocked";

/** Whether a usable previous-install baseline was available for comparison. */
type ManagedSetupBaselineStatus =
  | "loaded"
  | "missing"
  | "invalid"
  | "malformed-blocking"
  | "conflicting"
  | "cutover-incompatible";

/**
 * Hashless compatibility marker replacing one agent-specific v1 hash store.
 * Invariant: it names only its path-derived known agent and managed.json; it never retains hashes or target bytes.
 */
interface ManagedInstallCutoverMarker {
  schemaVersion: typeof MANAGED_INSTALL_STATE_V1_CUTOVER_SCHEMA;
  agent: AgentId;
  managedState: "managed.json";
  legacyEvidence: "migrated" | "absent";
}

/**
 * Complete marker inspection for one persisted v2 authority.
 * Invariant: every known agent appears exactly once in either migrated, absent, or incompatible evidence.
 */
interface ManagedInstallCutoverEvidence {
  migratedAgents: AgentId[];
  absentAgents: AgentId[];
  incompatibleAgents: AgentId[];
}

/**
 * Build the only accepted bytes for one known-agent cutover marker.
 * Invariant: field order, two-space indentation, and one trailing newline are deterministic for old-reader refusal.
 */
function managedInstallCutoverMarkerBytes(
  agent: AgentId,
  legacyEvidence: ManagedInstallCutoverMarker["legacyEvidence"],
): string {
  const marker: ManagedInstallCutoverMarker = {
    schemaVersion: MANAGED_INSTALL_STATE_V1_CUTOVER_SCHEMA,
    agent,
    managedState: "managed.json",
    legacyEvidence,
  };
  return `${JSON.stringify(marker, null, 2)}\n`;
}

/**
 * Inspect all known marker paths without treating their former v1 hashes as authority.
 * Error behavior: reports marker read failures as repairable incompatible evidence instead of trusting partial bytes.
 */
function readManagedInstallCutoverEvidence(
  projectPath: string,
): ManagedInstallCutoverEvidence {
  const migratedAgents: AgentId[] = [];
  const absentAgents: AgentId[] = [];
  const incompatibleAgents: AgentId[] = [];
  for (const agent of KNOWN_AGENT_IDS) {
    const relativePath = `.goat-flow/install-state/${agent}.json`;
    const target = readManagedTargetEvidence(projectPath, relativePath);
    if (target.status !== "regular") {
      incompatibleAgents.push(agent);
      continue;
    }
    let markerBytes: string;
    try {
      markerBytes = readFileSync(managedInstallStatePath(projectPath, agent), {
        encoding: "utf-8",
        flag: "r",
      });
    } catch {
      incompatibleAgents.push(agent);
      continue;
    }
    if (markerBytes === managedInstallCutoverMarkerBytes(agent, "migrated")) {
      migratedAgents.push(agent);
    } else if (
      markerBytes === managedInstallCutoverMarkerBytes(agent, "absent")
    ) {
      absentAgents.push(agent);
    } else {
      incompatibleAgents.push(agent);
    }
  }
  return { migratedAgents, absentAgents, incompatibleAgents };
}

/** Return every agent named by retained legacy provenance in canonical v2 rows. */
function legacyProvenanceAgents(state: ManagedInstallStateV2): AgentId[] {
  const agents = new Set<AgentId>();
  for (const row of state.files) {
    if (row.provenance.kind !== "legacy-v1-bootstrap") continue;
    for (const observation of row.provenance.observations) {
      agents.add(observation.agent);
    }
  }
  return [...agents];
}

/**
 * Atomically replace one known marker without following a non-regular destination.
 * Side effect: writes one private adjacent filesystem temp file, flushes it, and renames it over the marker.
 * Error behavior: throws on unsafe destinations or failed atomic publication; the prior marker remains authoritative when replacement does not finish.
 */
function writeManagedInstallCutoverMarker(
  projectPath: string,
  agent: AgentId,
  legacyEvidence: ManagedInstallCutoverMarker["legacyEvidence"],
): void {
  const relativePath = `.goat-flow/install-state/${agent}.json`;
  const markerPath = managedInstallStatePath(projectPath, agent);
  const markerBytes = managedInstallCutoverMarkerBytes(agent, legacyEvidence);
  const currentTarget = readManagedTargetEvidence(projectPath, relativePath);
  if (currentTarget.status === "regular") {
    try {
      if (readFileSync(markerPath, "utf-8") === markerBytes) return;
    } catch {
      throw new Error(`Could not read ${relativePath} before cutover.`);
    }
  } else if (currentTarget.status !== "missing") {
    throw new Error(`${relativePath} must be a safe regular file.`);
  }

  const temporaryPath = `${markerPath}.tmp-${process.pid}`;
  mkdirSync(dirname(markerPath), { recursive: true });
  let temporaryDescriptor: number | null = null;
  try {
    rmSync(temporaryPath, { force: true });
    temporaryDescriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(temporaryDescriptor, markerBytes, "utf-8");
    fsyncSync(temporaryDescriptor);
    closeSync(temporaryDescriptor);
    temporaryDescriptor = null;
    renameSync(temporaryPath, markerPath);
  } catch (error) {
    if (temporaryDescriptor !== null) closeSync(temporaryDescriptor);
    try {
      rmSync(temporaryPath, { force: true });
    } catch (cleanupError) {
      // Preserve the publication failure as primary while retaining cleanup evidence for diagnostics.
      if (error instanceof Error && error.cause === undefined) {
        error.cause = cleanupError;
      }
    }
    throw error;
  }
}

/**
 * Recover the set of agents whose predecessor evidence must be labelled migrated.
 * Invariant: persisted v2 rows and exact existing markers outrank former v1 bytes; receipt-free partial bootstrap may use only regular-file presence.
 */
function managedInstallMigratedAgents(
  projectPath: string,
  facade: ManagedInstallStateFacade,
  state: ManagedInstallStateV2,
): Set<AgentId> {
  const migratedAgents = new Set<AgentId>([
    ...facade.legacyAgents,
    ...legacyProvenanceAgents(state),
  ]);
  if (facade.source !== "v2") return migratedAgents;

  const existingEvidence = readManagedInstallCutoverEvidence(projectPath);
  for (const agent of existingEvidence.migratedAgents) {
    migratedAgents.add(agent);
  }
  if (state.receipts.length > 0) return migratedAgents;

  // A receipt-free managed.json can be the recoverable first half of bootstrap;
  // regular incompatible files are labelled migrated without reading their hashes as authority.
  for (const agent of existingEvidence.incompatibleAgents) {
    const target = readManagedTargetEvidence(
      projectPath,
      `.goat-flow/install-state/${agent}.json`,
    );
    if (target.status === "regular") migratedAgents.add(agent);
  }
  return migratedAgents;
}

/**
 * Publish or repair the receipt-free v2 cutover while the caller owns every state claim.
 * The two-phase order exists because any interruption must leave one authoritative v2 baseline before old readers are disabled path by path.
 * Invariant: managed.json is published before every known agent path becomes an exact hashless marker, and no receipt is invented during bootstrap.
 * Side effects: writes managed.json first, then atomically replaces all known v1 paths with hashless markers.
 * Error behavior: throws before Bash can mutate a target; a published receipt-free state remains recoverable when a later marker write fails.
 *
 * @param projectPath - selected target root whose complete state paths are already held by the caller's write claims
 */
export function prepareManagedInstallStateForApply(projectPath: string): void {
  const facade = readManagedInstallStateFacade(projectPath);
  if (
    facade.status === "malformed-blocking" ||
    facade.status === "conflicting"
  ) {
    throw new Error(facade.error ?? "Managed install state blocks cutover.");
  }
  const state: ManagedInstallStateV2 = facade.state ?? {
    schemaVersion: "goat-flow.install-state.v2",
    files: [],
    receipts: [],
  };
  if (facade.source !== "v2") {
    writeManagedInstallStateV2(projectPath, state);
  }

  const migratedAgents = managedInstallMigratedAgents(
    projectPath,
    facade,
    state,
  );
  for (const agent of KNOWN_AGENT_IDS) {
    writeManagedInstallCutoverMarker(
      projectPath,
      agent,
      migratedAgents.has(agent) ? "migrated" : "absent",
    );
  }
}

/** Verified target bytes whose next managed baseline could not be persisted. */
export class ManagedInstallStateRecordError extends Error {
  readonly writeError: unknown;

  /** Preserve the typed failure boundary without exposing filesystem details to CLI users. */
  constructor(writeError: unknown) {
    super("Verified managed files could not be recorded in install state.");
    this.name = "ManagedInstallStateRecordError";
    this.writeError = writeError;
  }
}

/** Update policy for one destination; only system-owned rows carry an exact-copy template. */
type ManagedSetupOwnership = "system-owned" | "user-owned" | "generated";

/** Hash inputs for classifying one path without reading user content. */
export interface ManagedSetupClassificationInput {
  oldExpectedSha256: string | null;
  currentSha256: string | null;
  newExpectedSha256: string | null;
}

/** One path row shown in JSON or plain-English preview output. */
interface ManagedSetupPreviewFile {
  path: string;
  ownership: ManagedSetupOwnership;
  state: ManagedSetupFileState;
  action: ManagedSetupAction;
  reason: string;
  oldExpectedSha256: string | null;
  currentStatus: ManagedTargetStatus;
  currentSha256: string | null;
  newExpectedSha256: string | null;
  authority: ManagedSetupAuthorityDecision;
}

/**
 * Stable, hash-only preview contract used by terminal output and install admission.
 * Files are sorted by relative path so repeated reads stay deterministic for users and scripts.
 */
export interface ManagedSetupPreview {
  schemaVersion: typeof MANAGED_SETUP_PREVIEW_SCHEMA;
  coverage: "install-write-set";
  agent: AgentId;
  goatFlowVersion: string;
  baselineStatus: ManagedSetupBaselineStatus;
  verdict: ManagedSetupVerdict;
  limits: string[];
  files: ManagedSetupPreviewFile[];
}

/**
 * Merge installer launch admission into the managed preview shown to users.
 * Use so dry-run and real install consume the same platform prerequisite result.
 *
 * @param installPreview - current file actions; an empty list still receives a launch blocker
 * @param installerLaunch - selected Bash or actionable error; never null after discovery
 * @returns original ready preview or blocked copy; never null and never mutates the input
 */
export function managedSetupPreviewForInstallerLaunch(
  installPreview: ManagedSetupPreview,
  installerLaunch: InstallerInvocation | InstallerInvocationError,
): ManagedSetupPreview {
  // A runnable Bash leaves the managed-file verdict exactly as the user saw it.
  if (installerLaunch.ok) return installPreview;

  return {
    ...installPreview,
    verdict: "blocked",
    limits: [
      ...installPreview.limits,
      `Install prerequisite failed: ${installerLaunch.error}`,
    ],
  };
}

/** One exact-copy destination and its manifest-controlled package source. */
interface ManagedTemplateDefinition {
  path: string;
  sourcePath: string;
}

/** User-facing action and explanation paired with one deterministic drift state. */
interface ManagedSetupStatePresentation {
  action: ManagedSetupAction;
  reason: string;
}

const STATE_PRESENTATION: Record<
  ManagedSetupFileState,
  ManagedSetupStatePresentation
> = {
  unchanged: {
    action: "none",
    reason: "The installed file already matches this goat-flow package.",
  },
  "local-preserved": {
    action: "none",
    reason:
      "The target changed after the last install, but this goat-flow package did not change the file. Install keeps your local content; an explicit full-file replacement would discard it.",
  },
  "template-changed": {
    action: "replace",
    reason:
      "Only the goat-flow template changed, so the managed refresh is safe.",
  },
  "both-changed": {
    action: "protect",
    reason:
      "The target and goat-flow template both changed since the last install. Automatic replacement is blocked because it would discard current target content.",
  },
  added: {
    action: "create",
    reason: "The current goat-flow package adds this managed file.",
  },
  adopted: {
    action: "replace",
    reason:
      "No previous install baseline exists, so goat-flow refreshes this system-owned file and records a baseline for future drift protection.",
  },
  removed: {
    action: "preserve",
    reason:
      "The previous install managed this path, but the current package no longer does.",
  },
  missing: {
    action: "protect",
    reason:
      "The managed file was removed from the target after the last install.",
  },
  unmanaged: {
    action: "protect",
    reason:
      "The target path cannot be verified safely, so goat-flow will not write it.",
  },
  "user-seeded": {
    action: "create",
    reason: "This user-owned file is absent, so install may seed it once.",
  },
  "user-preserved": {
    action: "preserve",
    reason:
      "This user-owned file already exists, so install keeps your content.",
  },
  "user-migrated": {
    action: "migrate",
    reason:
      "Install edits declared parts of this user-owned file in place and leaves the rest byte-stable.",
  },
  regenerated: {
    action: "regenerate",
    reason: "Install rewrites this generated file from current project state.",
  },
};

/**
 * Convert one canonical managed-file state into the repair direction shared by install, audit, and hook status.
 * This consumes M02's classifier result so downstream surfaces never invent their own old/current/new comparison.
 *
 * @param state - canonical three-way state; non-content states have no proven drift direction
 * @returns current, safely behind, locally diverged, or unclassified repair evidence
 */
export function managedSetupChangeDirection(
  state: ManagedSetupFileState,
): ManagedSetupChangeDirection {
  if (state === "unchanged") return "current";
  if (state === "template-changed") return "behind";
  if (state === "both-changed" || state === "local-preserved") {
    return "diverged";
  }
  return "unclassified";
}

/**
 * Classify one path from old, current, and new hashes.
 * Use this when the UI must explain whether an install is safe or needs user intent.
 *
 * @param input - three-way hashes; null old/current/new means no trusted baseline, target file, or template
 * @returns the state shown for this path; never null because every evidence combination has a safe outcome
 */
export function classifyManagedSetupFile(
  input: ManagedSetupClassificationInput,
): ManagedSetupFileState {
  // An absent current template means goat-flow retired the previously managed path.
  if (input.newExpectedSha256 === null) return "removed";

  // Matching current and new bytes require no write, even when old state is unavailable.
  if (input.currentSha256 === input.newExpectedSha256) return "unchanged";

  // Without an old baseline, a missing destination is created and an existing differing regular file is adopted: pre-install-state targets
  // legitimately hold older-package bytes, and the managed refresh matches what the installer always did for system-owned templates before baselines
  // existed.
  //
  // The verdict stays "warning" so users see every adopted path before Bash runs.
  if (input.oldExpectedSha256 === null) {
    return input.currentSha256 === null ? "added" : "adopted";
  }

  // A deleted destination may represent deliberate user intent, so setup pauses.
  if (input.currentSha256 === null) return "missing";

  // The package has nothing new to deliver here, so the local bytes are simply
  // kept. Blocking would refuse every unrelated write over a file goat-flow does
  // not need to touch, and replacing would destroy content it never authored.
  if (input.newExpectedSha256 === input.oldExpectedSha256) {
    return "local-preserved";
  }

  // When the target stayed stable, only the package template needs refreshing.
  if (input.currentSha256 === input.oldExpectedSha256) {
    return "template-changed";
  }

  return "both-changed";
}

/**
 * Add one exact-copy template while rejecting conflicting manifest destinations.
 * Use while building the path list users inspect before install; it throws on a collision instead of guessing which template wins.
 */
function addManagedTemplate(
  definitions: Map<string, ManagedTemplateDefinition>,
  definition: ManagedTemplateDefinition,
): void {
  const existing = definitions.get(definition.path);
  // One destination cannot safely resolve to two different package sources.
  if (
    existing?.sourcePath !== undefined &&
    existing.sourcePath !== definition.sourcePath
  ) {
    throw new Error(
      `Managed setup path ${definition.path} maps to both ${existing.sourcePath} and ${definition.sourcePath}.`,
    );
  }
  definitions.set(definition.path, definition);
}

/**
 * Build a path-sorted exact-copy contract from manifest ownership and the selected skill mirror.
 * Throws when package metadata cannot map one user-visible destination to one canonical source.
 */
function collectManagedTemplates(agent: AgentId): ManagedTemplateDefinition[] {
  const manifest = loadManifest();
  const agentProfile = manifest.agents[agent];
  // A missing profile would make the preview disagree with installer-supported agents.
  if (!agentProfile) {
    throw new Error(`Manifest has no agent profile for ${agent}.`);
  }

  const definitions = new Map<string, ManagedTemplateDefinition>();
  // Source-backed system files are the shared exact-copy contract established by M07.
  for (const [managedPath, ownership] of Object.entries(
    manifest.file_ownership,
  )) {
    // User-owned, generated, deprecated, and external paths are outside exact-copy coverage.
    if (ownership.ownership !== "system-owned" || !ownership.source) continue;
    addManagedTemplate(definitions, {
      path: managedPath,
      sourcePath: ownership.source,
    });
  }

  // Each selected-agent skill file is copied verbatim from its canonical workflow template.
  for (const skillName of manifest.skills.canonical) {
    // Every declared file in this skill appears as its own path and action in the user's preview.
    for (const relativeSkillPath of getSkillFiles(skillName)) {
      addManagedTemplate(definitions, {
        path: posix.join(agentProfile.skills_dir, skillName, relativeSkillPath),
        sourcePath: posix.join(
          "workflow",
          "skills",
          skillName,
          relativeSkillPath,
        ),
      });
    }
  }

  // Stable path order keeps repeated text and JSON previews easy to diff.
  return [...definitions.values()].sort((left, right) =>
    left.path.localeCompare(right.path),
  );
}

/**
 * Decide whether a loaded baseline leaves an existing, non-package target outside installer ownership.
 * Use to protect developer-owned bytes while still adopting an existing target that matches the package.
 */
function loadedBaselineProtectsExistingDifferentTarget(
  baselineStatus: ManagedSetupBaselineStatus,
  oldExpectedSha256: string | null,
  currentTarget: ManagedTargetEvidence,
  newExpectedSha256: string | null,
): boolean {
  return (
    (baselineStatus === "loaded" ||
      baselineStatus === "cutover-incompatible") &&
    oldExpectedSha256 === null &&
    currentTarget.status === "regular" &&
    newExpectedSha256 !== null &&
    currentTarget.sha256 !== newExpectedSha256
  );
}

/**
 * Turn one hash comparison and baseline status into the concise path row shown to users.
 * Use for every managed destination so text and JSON explain the same action and reason.
 */
function buildPreviewFile(
  managedPath: string,
  oldExpectedSha256: string | null,
  currentTarget: ManagedTargetEvidence,
  newExpectedSha256: string | null,
  baselineStatus: ManagedSetupBaselineStatus,
  authority: ManagedSetupAuthority,
): ManagedSetupPreviewFile {
  const unsafeCurrentTarget =
    newExpectedSha256 !== null &&
    (currentTarget.status === "non-regular" ||
      currentTarget.status === "unreadable");
  const loadedBaselineDoesNotOwnExistingTarget =
    loadedBaselineProtectsExistingDifferentTarget(
      baselineStatus,
      oldExpectedSha256,
      currentTarget,
      newExpectedSha256,
    );
  // Unsafe paths and existing files absent from a loaded baseline stay protected from default writes.
  const state =
    unsafeCurrentTarget || loadedBaselineDoesNotOwnExistingTarget
      ? "unmanaged"
      : classifyManagedSetupFile({
          oldExpectedSha256,
          currentSha256: currentTarget.sha256,
          newExpectedSha256,
        });
  const presentation = STATE_PRESENTATION[state];
  let reason = presentation.reason;
  // Symlinked or non-directory components block with the exact repair clue the user needs.
  if (newExpectedSha256 !== null && currentTarget.status === "non-regular") {
    reason =
      "The target path contains a symlink or non-regular component, so goat-flow will not write through it.";
  }
  // Unreadable target metadata cannot prove overwrite safety, so users must repair access first.
  if (newExpectedSha256 !== null && currentTarget.status === "unreadable") {
    reason =
      "The target path could not be read safely, so goat-flow cannot verify an overwrite.";
  }
  // A loaded baseline proves the prior install never owned this existing destination.
  if (loadedBaselineDoesNotOwnExistingTarget) {
    reason =
      "The loaded install baseline does not own this existing path, so goat-flow will not overwrite it by default.";
  }
  return {
    path: managedPath,
    ownership: "system-owned",
    state,
    action: presentation.action,
    reason,
    oldExpectedSha256,
    currentStatus: currentTarget.status,
    currentSha256: currentTarget.sha256,
    newExpectedSha256,
    authority: resolveAuthorityDecision(
      {
        path: managedPath,
        ownership: "system-owned",
        isConflict: BLOCKING_STATES.has(state),
        isPathUnsafe: unsafeCurrentTarget,
        isReplaceable: true,
      },
      authority,
    ),
  };
}

/**
 * Turn one non-template destination into the row users read beside managed templates.
 * Use for user-owned and generated paths, where install seeds, preserves, or rewrites from project state and there is no package template to compare
 * bytes against.
 */
function buildProjectWriteFile(
  definition: ProjectWriteDefinition,
  currentTarget: ManagedTargetEvidence,
  authority: ManagedSetupAuthority,
  pendingMigrations: ReadonlyMap<string, string>,
): ManagedSetupPreviewFile {
  const unsafeCurrentTarget =
    currentTarget.status === "non-regular" ||
    currentTarget.status === "unreadable";
  // A redirected or unreadable destination is reported and skipped rather than seeded blindly.
  const state: ManagedSetupFileState = unsafeCurrentTarget
    ? "unmanaged"
    : projectWriteState(definition, currentTarget, pendingMigrations);
  const presentation = STATE_PRESENTATION[state];
  return {
    path: definition.path,
    ownership: definition.ownership,
    state,
    action: presentation.action,
    // A migration row names the exact edits; otherwise the definition's reason names the condition.
    reason: migrationRowReason(
      definition,
      state,
      unsafeCurrentTarget,
      presentation.reason,
      pendingMigrations,
    ),
    oldExpectedSha256: null,
    currentStatus: currentTarget.status,
    currentSha256: currentTarget.sha256,
    newExpectedSha256: null,
    authority: resolveAuthorityDecision(
      {
        path: definition.path,
        ownership: definition.ownership,
        // A user-owned row is never a blocking conflict; replacing it is an explicit request.
        isConflict: false,
        isPathUnsafe: unsafeCurrentTarget,
        isReplaceable: definition.replaceable,
      },
      authority,
    ),
  };
}

/**
 * Choose the sentence one non-template row shows.
 * A migration row names the exact edits install will make, because "this file may change" is not something a user can check afterwards, while a named
 * list is.
 */
function migrationRowReason(
  definition: ProjectWriteDefinition,
  state: ManagedSetupFileState,
  isCurrentTargetUnsafe: boolean,
  presentationReason: string,
  pendingMigrations: ReadonlyMap<string, string>,
): string {
  if (isCurrentTargetUnsafe) return presentationReason;
  const migrationSummary = pendingMigrations.get(definition.path);
  // A pending migration always carries its own summary; the fallback keeps the row honest if not.
  if (state === "user-migrated") {
    return migrationSummary ?? presentationReason;
  }
  return definition.reason;
}

/**
 * Select the state for one safe non-template destination from ownership and current evidence.
 * A non-seedable user file stays `user-preserved` while absent, because install never creates it.
 */
function projectWriteState(
  definition: ProjectWriteDefinition,
  currentTarget: ManagedTargetEvidence,
  pendingMigrations: ReadonlyMap<string, string>,
): ManagedSetupFileState {
  // Generated files are rewritten from project state, so presence changes nothing users must decide.
  if (definition.ownership === "generated") return "regenerated";
  if (currentTarget.status === "missing") {
    return definition.seedable ? "user-seeded" : "user-preserved";
  }
  // A declared migration is a real write, so it must not read as an untouched file.
  return pendingMigrations.has(definition.path)
    ? "user-migrated"
    : "user-preserved";
}

/**
 * Report whether one row must stop the installer before any mutation.
 * Only exact-copy templates qualify, so a user-owned or generated path never withholds an unrelated managed refresh.
 *
 * @param file - one previewed destination with its ownership and classified state
 * @returns true when this row needs explicit authority before any install may run
 */
export function isBlockingManagedFile(file: ManagedSetupPreviewFile): boolean {
  return file.ownership === "system-owned" && BLOCKING_STATES.has(file.state);
}

/**
 * Derive the overall verdict from every managed path and baseline health.
 * Use after classification so users receive one ready, warning, or blocked decision.
 */
function previewVerdict(
  files: readonly ManagedSetupPreviewFile[],
  baselineStatus: ManagedSetupBaselineStatus,
): ManagedSetupVerdict {
  // Malformed or contradictory global history cannot authorize an overwrite even when current bytes happen to look safe.
  if (
    baselineStatus === "invalid" ||
    baselineStatus === "malformed-blocking" ||
    baselineStatus === "conflicting"
  ) {
    return "blocked";
  }
  // Every destination belongs to the install write set, so an unsafe path blocks before Bash starts.
  if (
    files.some(
      (file) => isBlockingManagedFile(file) || file.state === "unmanaged",
    )
  )
    return "blocked";
  // Retired paths are preserved and pre-baseline adoptions replace bytes, so
  // both still deserve user attention before the installer runs.
  if (
    files.some((file) => file.state === "removed" || file.state === "adopted")
  ) {
    return "warning";
  }
  return "ready";
}

/**
 * Read one selection-independent baseline and layer marker compatibility over v2 rows.
 * Invariant: selected-agent input never changes the expected hash map or global bootstrap outcome.
 * Error behavior: target-controlled failures remain non-throwing status and safe diagnostic fields.
 *
 * @param projectPath - selected project root whose complete install-state directory supplies evidence
 * @returns canonical facade plus marker compatibility; malformed input remains a blocking result
 */
export function readManagedSetupV2Baseline(projectPath: string): {
  facade: ManagedInstallStateFacade;
  status: ManagedInstallStateFacade["status"] | "cutover-incompatible";
  cutoverEvidence: ManagedInstallCutoverEvidence | null;
  error: string | null;
} {
  const facade = readManagedInstallStateFacade(projectPath);
  if (facade.source !== "v2" || facade.state === null) {
    return {
      facade,
      status: facade.status,
      cutoverEvidence: null,
      error: facade.error,
    };
  }
  const cutoverEvidence = readManagedInstallCutoverEvidence(projectPath);
  if (cutoverEvidence.incompatibleAgents.length === 0) {
    return { facade, status: facade.status, cutoverEvidence, error: null };
  }
  return {
    facade,
    status: "cutover-incompatible",
    cutoverEvidence,
    error: `Managed install cutover markers are incomplete or incompatible for ${cutoverEvidence.incompatibleAgents.join(", ")}.`,
  };
}

/** One receipt mismatch and the path it affects, when the mismatch is path-specific. */
interface ManagedReceiptProblem {
  path: string | null;
  reason: string;
}

/**
 * Check the selected receipt against its exact current path, row, generation, and target-byte set.
 * Invariant: an absent receipt has no problems, while every mismatch in a present receipt stays available for user-facing status evidence.
 *
 * @param state - canonical v2 state containing the receipt and referenced row generations
 * @param files - current selected-agent preview rows used for exact path and target-byte checks
 * @param selectedAgent - agent whose stored receipt is evaluated; absence produces no problems
 * @returns every authority-removing mismatch, including its path when the reason is path-specific
 */
export function selectedManagedReceiptProblems(
  state: ManagedInstallStateV2,
  files: readonly ManagedSetupPreviewFile[],
  selectedAgent: AgentId,
): ManagedReceiptProblem[] {
  const selectedReceipt = state.receipts.find(
    (receipt) => receipt.agent === selectedAgent,
  );
  if (selectedReceipt === undefined) return [];

  const selectedFiles = files.filter(
    (file) =>
      file.ownership === "system-owned" && file.newExpectedSha256 !== null,
  );
  const rows = new Map(state.files.map((row) => [row.path, row]));
  const references = new Map(
    selectedReceipt.files.map((reference) => [reference.path, reference]),
  );
  const selectedPaths = new Set(selectedFiles.map((file) => file.path));
  const problems: ManagedReceiptProblem[] = [];
  for (const reference of selectedReceipt.files) {
    if (!selectedPaths.has(reference.path)) {
      problems.push({
        path: reference.path,
        reason: `Receipt references path ${reference.path}, which is not in the current managed path set for ${selectedAgent}.`,
      });
    }
  }
  for (const file of selectedFiles) {
    const row = rows.get(file.path);
    const reference = references.get(file.path);
    if (reference === undefined) {
      problems.push({
        path: file.path,
        reason: `Receipt does not reference current managed path ${file.path}.`,
      });
      continue;
    }
    if (row === undefined) {
      problems.push({
        path: file.path,
        reason: `Receipt references missing managed-state row ${file.path}.`,
      });
      continue;
    }
    if (reference.generation !== row.generation) {
      problems.push({
        path: file.path,
        reason: `Receipt generation no longer matches managed-state row ${file.path}.`,
      });
    }
    if (file.currentStatus !== "regular") {
      problems.push({
        path: file.path,
        reason: `Managed target ${file.path} is ${file.currentStatus}, not a safe regular file.`,
      });
    } else if (file.currentSha256 !== row.expectedSha256) {
      problems.push({
        path: file.path,
        reason: `Current target bytes no longer match managed-state row ${file.path}.`,
      });
    }
  }
  return problems;
}

/**
 * Derive every stale receipt visible during one selected-agent preview.
 * Invariant: row generations, package version, markers, exact selected path set, and current selected bytes all participate without changing row authority.
 */
function managedInstallStaleReceiptAgents(
  baseline: ReturnType<typeof readManagedSetupV2Baseline>,
  files: readonly ManagedSetupPreviewFile[],
  selectedAgent: AgentId,
  goatFlowVersion: string,
): AgentId[] {
  const state = baseline.facade.state;
  if (state === null) return [];
  const staleAgents = new Set<AgentId>(baseline.facade.staleReceiptAgents);
  for (const receipt of state.receipts) {
    if (receipt.goatFlowVersion !== goatFlowVersion) {
      staleAgents.add(receipt.agent);
    }
  }
  for (const agent of baseline.cutoverEvidence?.incompatibleAgents ?? []) {
    if (state.receipts.some((receipt) => receipt.agent === agent)) {
      staleAgents.add(agent);
    }
  }

  if (selectedManagedReceiptProblems(state, files, selectedAgent).length > 0) {
    staleAgents.add(selectedAgent);
  }
  return KNOWN_AGENT_IDS.filter((agent) => staleAgents.has(agent));
}

/** Add global-state and stale-receipt diagnostics; invariant: limits expose no raw target bytes. */
function appendManagedInstallPreviewLimits(
  limits: string[],
  baseline: ReturnType<typeof readManagedSetupV2Baseline>,
  staleReceiptAgents: readonly AgentId[],
): void {
  if (baseline.error !== null) {
    limits.push(`Install state is ${baseline.status}: ${baseline.error}`);
  }
  if (staleReceiptAgents.length > 0) {
    limits.push(
      `Install receipt evidence is stale for: ${staleReceiptAgents.join(", ")}.`,
    );
  }
}

/**
 * Build a hash-only managed setup preview for one selected project and agent.
 * Use before rendering dry-run output or admitting the existing installer.
 *
 * @param projectPath - selected target root; empty is invalid upstream and produces no useful files
 * @param agent - selected agent whose canonical skill mirror is included; never null after CLI validation
 * @param authority - overwrite permissions the user granted by flag; the default grants none, so conflicts stay blocked
 * @param pendingMigrations - path-to-summary rows naming in-place edits install will make; empty means none
 * @returns deterministic path-sorted preview; files is empty only when no managed templates exist
 */
export function buildManagedSetupPreview(
  projectPath: string,
  agent: AgentId,
  authority: ManagedSetupAuthority = NO_MANAGED_SETUP_AUTHORITY,
  pendingMigrations: ReadonlyMap<string, string> = new Map(),
): ManagedSetupPreview {
  const baseline = readManagedSetupV2Baseline(projectPath);
  const goatFlowVersion = getPackageVersion();
  const currentTemplates = collectManagedTemplates(agent);
  const files: ManagedSetupPreviewFile[] = [];
  const currentTemplatePaths = new Set<string>();

  // Current definitions compare the package template with both target and previous expected bytes.
  for (const template of currentTemplates) {
    currentTemplatePaths.add(template.path);
    // No prior hash means the user sees first-install or unmanaged behavior, never an invented baseline.
    const oldExpectedSha256 =
      baseline.facade.expectedHashes.get(template.path) ?? null;
    files.push(
      buildPreviewFile(
        template.path,
        oldExpectedSha256,
        readManagedTargetEvidence(projectPath, template.path),
        hashFile(getTemplatePath(template.sourcePath)),
        baseline.status,
        authority,
      ),
    );
  }

  // Baseline-only paths remain on disk unless the user later chooses a separate cleanup action.
  for (const [managedPath, expectedSha256] of baseline.facade.expectedHashes) {
    // Current templates were already classified, so only retired baseline paths remain here.
    if (currentTemplatePaths.has(managedPath)) continue;
    files.push(
      buildPreviewFile(
        managedPath,
        expectedSha256,
        readManagedTargetEvidence(projectPath, managedPath),
        null,
        baseline.status,
        authority,
      ),
    );
  }

  // User-owned and generated destinations complete the write set an approved install may touch.
  for (const definition of collectProjectWriteDefinitions(projectPath, agent)) {
    // An exact-copy template already classified this path, so the seed rule must not restate it.
    if (currentTemplatePaths.has(definition.path)) continue;
    files.push(
      buildProjectWriteFile(
        definition,
        readManagedTargetEvidence(projectPath, definition.path),
        authority,
        pendingMigrations,
      ),
    );
  }
  // Path sorting makes preview output deterministic after current and retired rows are combined.
  files.sort((left, right) => left.path.localeCompare(right.path));

  const limits: string[] = [...PREVIEW_LIMITS];
  const staleReceiptAgents = managedInstallStaleReceiptAgents(
    baseline,
    files,
    agent,
    goatFlowVersion,
  );
  appendManagedInstallPreviewLimits(limits, baseline, staleReceiptAgents);
  return {
    schemaVersion: MANAGED_SETUP_PREVIEW_SCHEMA,
    coverage: "install-write-set",
    agent,
    goatFlowVersion,
    baselineStatus: baseline.status,
    verdict: previewVerdict(files, baseline.status),
    limits,
    files,
  };
}

/**
 * Render the preview in plain English for terminal users deciding whether to proceed.
 *
 * @param preview - complete managed report; an empty files list shows only verdict and limits
 * @returns terminal text with one row per file; never empty for a valid preview
 */
export function renderManagedSetupPreviewText(
  preview: ManagedSetupPreview,
): string {
  const lines = [
    `Managed setup preview (${preview.agent})`,
    `Verdict: ${preview.verdict}`,
    `Coverage: ${preview.coverage}`,
    `Baseline: ${preview.baselineStatus}`,
    "",
    "Files install may write:",
  ];
  // Every row stays grep-friendly while explaining the action in user language.
  for (const file of preview.files) {
    lines.push(
      `  ${file.action.padEnd(10)} ${file.ownership.padEnd(12)} ${file.path} [${file.state}] - ${file.reason}`,
    );
  }
  lines.push("", "Limits:");
  // Limits prevent users from mistaking this focused preview for a full migration simulation.
  for (const limit of preview.limits) lines.push(`  - ${limit}`);
  return lines.join("\n");
}
/**
 * Build the one post-verification state candidate without mutating persisted evidence.
 * Invariant: only selected paths whose current bytes equal the incoming hash receive verified provenance, and the selected receipt changes only when
 * every selected exact-copy path is verified. Rows and receipts outside the selected path set remain logically unchanged.
 * Error behavior: throws if verified-path evidence cannot resolve to the row generation required by its receipt reference.
 */
function buildManagedInstallReceiptCandidate(
  state: ManagedInstallStateV2,
  preview: ManagedSetupPreview,
): ManagedInstallStateV2 {
  const selectedFiles = preview.files.filter(
    (file) =>
      file.ownership === "system-owned" && file.newExpectedSha256 !== null,
  );
  const rows = new Map(state.files.map((row) => [row.path, row]));
  for (const file of selectedFiles) {
    if (file.newExpectedSha256 === null) continue;
    if (
      file.currentStatus !== "regular" ||
      file.currentSha256 !== file.newExpectedSha256
    ) {
      continue;
    }
    rows.set(
      file.path,
      createManagedInstallStateRow({
        path: file.path,
        expectedSha256: file.newExpectedSha256,
        provenance: {
          kind: "verified-install",
          goatFlowVersion: preview.goatFlowVersion,
        },
      }),
    );
  }

  const allSelectedPathsVerified = selectedFiles.every(
    (file) =>
      file.currentStatus === "regular" &&
      file.currentSha256 === file.newExpectedSha256,
  );
  const receipts = [...state.receipts];
  if (allSelectedPathsVerified) {
    const selectedReceipt = {
      agent: preview.agent,
      goatFlowVersion: preview.goatFlowVersion,
      files: selectedFiles.map((file) => {
        const row = rows.get(file.path);
        if (row === undefined) {
          throw new Error(
            `Verified managed path ${file.path} has no state row.`,
          );
        }
        return { path: row.path, generation: row.generation };
      }),
    };
    const previousReceiptIndex = receipts.findIndex(
      (receipt) => receipt.agent === preview.agent,
    );
    if (previousReceiptIndex === -1) receipts.push(selectedReceipt);
    else receipts[previousReceiptIndex] = selectedReceipt;
  }
  return {
    schemaVersion: state.schemaVersion,
    files: [...rows.values()],
    receipts,
  };
}

/**
 * Verify the installer wrote every managed template before recording the next baseline.
 *
 * @param projectPath - selected target root; empty is invalid upstream and records nothing
 * @param agent - installed agent mirror to verify; never null after CLI validation
 * @returns mismatching relative paths; empty means hash-only state was safely recorded
 * @throws `ManagedInstallStateRecordError` when verified bytes cannot be persisted; preview failures propagate unchanged
 */
export function recordManagedInstallAfterVerification(
  projectPath: string,
  agent: AgentId,
): string[] {
  const installedPreview = buildManagedSetupPreview(projectPath, agent);
  // Only current package templates are verified; retired paths are preserved and excluded, and user-owned or generated rows legitimately differ from
  // any template.
  //
  // A preserved row is intentionally divergent - the package delivered nothing for it - so demanding a template match there would fail an install
  // that behaved correctly.
  const installationMismatches = installedPreview.files.filter(
    (file) =>
      file.ownership === "system-owned" &&
      file.state !== "local-preserved" &&
      file.newExpectedSha256 !== null &&
      file.currentSha256 !== file.newExpectedSha256,
  );
  // A mismatched byte means users cannot trust a newly recorded baseline yet.
  if (installationMismatches.length > 0) {
    return installationMismatches.map((file) => file.path);
  }
  try {
    const facade = readManagedInstallStateFacade(projectPath);
    if (facade.source !== "v2" || facade.state === null) {
      throw new Error(
        "Project-wide managed install state is unavailable after verification.",
      );
    }
    const cutoverEvidence = readManagedInstallCutoverEvidence(projectPath);
    if (cutoverEvidence.incompatibleAgents.length > 0) {
      throw new Error(
        "Managed install cutover markers changed before receipt publication.",
      );
    }
    const candidate = buildManagedInstallReceiptCandidate(
      facade.state,
      installedPreview,
    );
    if (
      canonicalManagedInstallStateBytes(candidate) !== facade.canonicalBytes
    ) {
      writeManagedInstallStateV2(projectPath, candidate);
    }
  } catch (error) {
    throw new ManagedInstallStateRecordError(error);
  }
  return [];
}
