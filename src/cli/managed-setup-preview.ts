/**
 * Builds the install write-set preview users see before installing goat-flow updates.
 * For managed templates it compares the last installed hash, the selected target file,
 * and the current package template without exposing file contents or absolute project paths;
 * for user-owned and generated destinations it reports the seed-or-preserve action instead.
 * Install handlers use the same result to block ambiguous overwrites and record recovery state.
 */
import { posix } from "node:path";

import { getPackageVersion, getTemplatePath } from "./paths.js";
import { getSkillFiles, loadManifest } from "./manifest/manifest.js";
import {
  readManagedInstallBaseline,
  writeManagedInstallState,
} from "./managed-setup-state.js";
import {
  collectProjectWriteDefinitions,
  hashFile,
  type ManagedTargetEvidence,
  type ManagedTargetStatus,
  type ProjectWriteDefinition,
  readManagedTargetEvidence,
} from "./managed-setup-write-set.js";
import type {
  InstallerInvocation,
  InstallerInvocationError,
} from "./install-invocation.js";
import type { AgentId } from "./types.js";

export {
  managedInstallStatePath,
  writeManagedInstallState,
} from "./managed-setup-state.js";

const MANAGED_SETUP_PREVIEW_SCHEMA =
  "goat-flow.managed-setup-preview.v2" as const;
const BLOCKING_STATES = new Set<ManagedSetupFileState>([
  "local-edited",
  "both-changed",
  "missing",
  "unmanaged",
]);

const PREVIEW_LIMITS = [
  "Removals - retired templates, deprecated skills, legacy hook copies, and pre-1.9 path migrations - are cleanup rather than writes and are not enumerated here.",
  "Direct workflow/install-goat-flow.sh execution does not use this CLI admission gate.",
] as const;

/**
 * User-visible outcome for one destination.
 * The first nine values are the three-way template comparison; the last three
 * describe destinations with no exact-copy template, where install seeds, preserves,
 * or regenerates rather than matching bytes.
 */
export type ManagedSetupFileState =
  | "unchanged"
  | "local-edited"
  | "template-changed"
  | "both-changed"
  | "added"
  | "adopted"
  | "removed"
  | "missing"
  | "unmanaged"
  | "user-seeded"
  | "user-preserved"
  | "regenerated";

/** Action shown beside one path so users know what an approved install would do. */
type ManagedSetupAction =
  "none" | "create" | "replace" | "preserve" | "protect" | "regenerate";

/** Overall preview outcome used by the CLI before it starts the installer. */
type ManagedSetupVerdict = "ready" | "warning" | "blocked";

/** Whether a usable previous-install baseline was available for comparison. */
export type ManagedSetupBaselineStatus = "loaded" | "missing" | "invalid";

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
  "local-edited": {
    action: "protect",
    reason:
      "The target changed after the last install, so goat-flow will not overwrite it by default.",
  },
  "template-changed": {
    action: "replace",
    reason:
      "Only the goat-flow template changed, so the managed refresh is safe.",
  },
  "both-changed": {
    action: "protect",
    reason:
      "The target and goat-flow template both changed since the last install.",
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
  regenerated: {
    action: "regenerate",
    reason: "Install rewrites this generated file from current project state.",
  },
};

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

  // Without an old baseline, a missing destination is created and an existing
  // differing regular file is adopted: pre-install-state targets legitimately
  // hold older-package bytes, and the managed refresh matches what the
  // installer always did for system-owned templates before baselines existed.
  // The verdict stays "warning" so users see every adopted path before Bash runs.
  if (input.oldExpectedSha256 === null) {
    return input.currentSha256 === null ? "added" : "adopted";
  }

  // A deleted destination may represent deliberate user intent, so setup pauses.
  if (input.currentSha256 === null) return "missing";

  // When the package stayed stable, the target alone contains the local edit.
  if (input.newExpectedSha256 === input.oldExpectedSha256) {
    return "local-edited";
  }

  // When the target stayed stable, only the package template needs refreshing.
  if (input.currentSha256 === input.oldExpectedSha256) {
    return "template-changed";
  }

  return "both-changed";
}

/**
 * Add one exact-copy template while rejecting conflicting manifest destinations.
 * Use while building the path list users inspect before install; collisions throw instead of guessing.
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
    baselineStatus === "loaded" &&
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
  };
}

/**
 * Report whether one row must stop the installer before any mutation.
 * Only exact-copy templates qualify, so a user-owned or generated path never
 * withholds an unrelated managed refresh.
 */
function isBlockingManagedFile(file: ManagedSetupPreviewFile): boolean {
  return file.ownership === "system-owned" && BLOCKING_STATES.has(file.state);
}

/**
 * Turn one non-template destination into the row users read beside managed templates.
 * Use for user-owned and generated paths, where install seeds, preserves, or rewrites
 * from project state and there is no package template to compare bytes against.
 */
function buildProjectWriteFile(
  definition: ProjectWriteDefinition,
  currentTarget: ManagedTargetEvidence,
): ManagedSetupPreviewFile {
  const unsafeCurrentTarget =
    currentTarget.status === "non-regular" ||
    currentTarget.status === "unreadable";
  // A redirected or unreadable destination is reported and skipped rather than seeded blindly.
  const state: ManagedSetupFileState = unsafeCurrentTarget
    ? "unmanaged"
    : projectWriteState(definition, currentTarget);
  const presentation = STATE_PRESENTATION[state];
  return {
    path: definition.path,
    ownership: definition.ownership,
    state,
    action: presentation.action,
    // The definition's own reason names the condition install applies to this path.
    reason: unsafeCurrentTarget ? presentation.reason : definition.reason,
    oldExpectedSha256: null,
    currentStatus: currentTarget.status,
    currentSha256: currentTarget.sha256,
    newExpectedSha256: null,
  };
}

/**
 * Select the state for one safe non-template destination from ownership and current evidence.
 * A non-seedable user file stays `user-preserved` while absent, because install never creates it.
 */
function projectWriteState(
  definition: ProjectWriteDefinition,
  currentTarget: ManagedTargetEvidence,
): ManagedSetupFileState {
  // Generated files are rewritten from project state, so presence changes nothing users must decide.
  if (definition.ownership === "generated") return "regenerated";
  return currentTarget.status === "missing" && definition.seedable
    ? "user-seeded"
    : "user-preserved";
}

/**
 * Derive the overall verdict from every managed path and baseline health.
 * Use after classification so users receive one ready, warning, or blocked decision.
 */
function previewVerdict(
  files: readonly ManagedSetupPreviewFile[],
  baselineStatus: ManagedSetupBaselineStatus,
): ManagedSetupVerdict {
  // Corrupt baseline data cannot authorize an overwrite even if current bytes happen to look safe.
  if (baselineStatus === "invalid") return "blocked";
  // Only exact-copy templates can block: install never replaces user-owned or generated content,
  // so an unsafe path there is reported without withholding every unrelated managed refresh.
  if (files.some(isBlockingManagedFile)) return "blocked";
  // An unsafe user-owned or generated destination still needs the user's attention before install.
  if (
    files.some(
      (file) => file.ownership !== "system-owned" && file.state === "unmanaged",
    )
  ) {
    return "warning";
  }
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
 * Build a hash-only managed setup preview for one selected project and agent.
 * Use before rendering dry-run output or admitting the existing installer.
 *
 * @param projectPath - selected target root; empty is invalid upstream and produces no useful files
 * @param agent - selected agent whose canonical skill mirror is included; never null after CLI validation
 * @returns deterministic path-sorted preview; files is empty only when no managed templates exist
 */
export function buildManagedSetupPreview(
  projectPath: string,
  agent: AgentId,
): ManagedSetupPreview {
  const baseline = readManagedInstallBaseline(projectPath, agent);
  const currentTemplates = collectManagedTemplates(agent);
  const files: ManagedSetupPreviewFile[] = [];
  const currentTemplatePaths = new Set<string>();

  // Current definitions compare the package template with both target and previous expected bytes.
  for (const template of currentTemplates) {
    currentTemplatePaths.add(template.path);
    // No prior hash means the user sees first-install or unmanaged behavior, never an invented baseline.
    const oldExpectedSha256 =
      baseline.expectedHashes.get(template.path) ?? null;
    files.push(
      buildPreviewFile(
        template.path,
        oldExpectedSha256,
        readManagedTargetEvidence(projectPath, template.path),
        hashFile(getTemplatePath(template.sourcePath)),
        baseline.status,
      ),
    );
  }

  // Baseline-only paths remain on disk unless the user later chooses a separate cleanup action.
  for (const [managedPath, expectedSha256] of baseline.expectedHashes) {
    // Current templates were already classified, so only retired baseline paths remain here.
    if (currentTemplatePaths.has(managedPath)) continue;
    files.push(
      buildPreviewFile(
        managedPath,
        expectedSha256,
        readManagedTargetEvidence(projectPath, managedPath),
        null,
        baseline.status,
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
      ),
    );
  }
  // Path sorting makes preview output deterministic after current and retired rows are combined.
  files.sort((left, right) => left.path.localeCompare(right.path));

  const limits: string[] = [...PREVIEW_LIMITS];
  // Invalid local state is surfaced without leaking its raw body into durable output.
  if (baseline.error !== null) {
    limits.push(`Install state is invalid: ${baseline.error}`);
  }
  return {
    schemaVersion: MANAGED_SETUP_PREVIEW_SCHEMA,
    coverage: "install-write-set",
    agent,
    goatFlowVersion: getPackageVersion(),
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
 * Return concise conflict rows for the normal install error shown before any mutation.
 *
 * @param preview - managed report to summarize; no blocking files yields an empty list
 * @returns user-facing conflict lines; empty means the managed admission gate can proceed
 */
function managedSetupBlockingSummary(preview: ManagedSetupPreview): string[] {
  // Only states requiring user intent belong in the blocking error.
  const blockingFiles = preview.files.filter(isBlockingManagedFile);
  // Each path stays on one line so users can inspect or copy it directly.
  const lines = blockingFiles.map(
    (file) => `${file.path} [${file.state}]: ${file.reason}`,
  );
  // Invalid state may block without producing a path-specific classification row.
  if (preview.baselineStatus === "invalid") {
    lines.push(
      "Install state is invalid; inspect the preview limits for repair evidence.",
    );
  }
  return lines;
}

/**
 * Detect target paths that cannot safely receive any managed write.
 * Use before honoring force so explicit conflict replacement never becomes path redirection.
 */
function hasUnsafeManagedTarget(preview: ManagedSetupPreview): boolean {
  // Only current templates can be written; retired unsafe paths remain preserved without installer access.
  return preview.files.some(
    (file) =>
      file.newExpectedSha256 !== null &&
      (file.currentStatus === "non-regular" ||
        file.currentStatus === "unreadable"),
  );
}

/**
 * Return a complete pre-write error when managed conflicts need explicit force.
 *
 * @param preview - current managed report; a ready or warning report produces null
 * @param shouldForce - explicit broad overwrite choice; false preserves every ambiguous file
 * @returns error text for the CLI, or null when the installer may proceed
 */
export function managedSetupAdmissionFailure(
  preview: ManagedSetupPreview,
  shouldForce: boolean,
): string | null {
  const unsafeManagedTarget =
    preview.baselineStatus === "invalid" || hasUnsafeManagedTarget(preview);
  // A ready or warning preview needs no override and can continue to the installer.
  if (preview.verdict !== "blocked") return null;
  // Force resolves content conflicts, but never symlink redirection or unreadable target evidence.
  if (shouldForce && !unsafeManagedTarget) return null;
  // Every conflict stays on its own bullet so the user can inspect the exact paths first.
  const conflicts = managedSetupBlockingSummary(preview)
    .map((line) => `  - ${line}`)
    .join("\n");
  const nextAction = unsafeManagedTarget
    ? "Repair symlinked, non-regular, or unreadable target paths first; --force cannot bypass path safety."
    : "Use --force only after inspecting these content conflicts.";
  return `Managed setup blocked before changes:\n${conflicts}\nRun with --dry-run for the full report. ${nextAction}`;
}

/**
 * Verify the installer wrote every managed template before recording the next baseline.
 *
 * @param projectPath - selected target root; empty is invalid upstream and records nothing
 * @param agent - installed agent mirror to verify; never null after CLI validation
 * @returns mismatching relative paths; empty means hash-only state was safely recorded
 */
export function recordManagedInstallAfterVerification(
  projectPath: string,
  agent: AgentId,
): string[] {
  const installedPreview = buildManagedSetupPreview(projectPath, agent);
  // Only current package templates are verified; retired paths are preserved and
  // excluded, and user-owned or generated rows legitimately differ from any template.
  const installationMismatches = installedPreview.files.filter(
    (file) =>
      file.ownership === "system-owned" &&
      file.newExpectedSha256 !== null &&
      file.currentSha256 !== file.newExpectedSha256,
  );
  // A mismatched byte means users cannot trust a newly recorded baseline yet.
  if (installationMismatches.length > 0) {
    return installationMismatches.map((file) => file.path);
  }
  writeManagedInstallState(projectPath, installedPreview);
  return [];
}
