/**
 * Builds the managed-template preview users see before installing goat-flow updates.
 * It compares the last installed hash, the selected target file, and the current
 * package template without exposing file contents or absolute project paths.
 * Install handlers use the same result to block ambiguous overwrites and record recovery state.
 */
import { createHash } from "node:crypto";
import { lstatSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";

import { getPackageVersion, getTemplatePath } from "./paths.js";
import { getSkillFiles, loadManifest } from "./manifest/manifest.js";
import {
  readManagedInstallBaseline,
  writeManagedInstallState,
} from "./managed-setup-state.js";
import type { AgentId } from "./types.js";

export {
  managedInstallStatePath,
  writeManagedInstallState,
} from "./managed-setup-state.js";

const MANAGED_SETUP_PREVIEW_SCHEMA =
  "goat-flow.managed-setup-preview.v1" as const;
const BLOCKING_STATES = new Set<ManagedSetupFileState>([
  "local-edited",
  "both-changed",
  "missing",
  "unmanaged",
]);

const PREVIEW_LIMITS = [
  "Config migrations, deprecated cleanup, commit-guidance generation, and index generation are outside this managed-template preview.",
  "Direct workflow/install-goat-flow.sh execution does not use this CLI admission gate.",
] as const;

/** User-visible three-way comparison outcomes for one managed template. */
export type ManagedSetupFileState =
  | "unchanged"
  | "local-edited"
  | "template-changed"
  | "both-changed"
  | "added"
  | "removed"
  | "missing"
  | "unmanaged";

/** Action shown beside one path so users know what an approved install would do. */
type ManagedSetupAction =
  "none" | "create" | "replace" | "preserve" | "protect";

/** Overall preview outcome used by the CLI before it starts the installer. */
type ManagedSetupVerdict = "ready" | "warning" | "blocked";

/** Whether a usable previous-install baseline was available for comparison. */
export type ManagedSetupBaselineStatus = "loaded" | "missing" | "invalid";

/** Filesystem evidence shown for a managed destination without following target symlinks. */
type ManagedTargetStatus = "regular" | "missing" | "non-regular" | "unreadable";

/** Hash inputs for classifying one path without reading user content. */
export interface ManagedSetupClassificationInput {
  oldExpectedSha256: string | null;
  currentSha256: string | null;
  newExpectedSha256: string | null;
}

/** One path row shown in JSON or plain-English preview output. */
interface ManagedSetupPreviewFile {
  path: string;
  ownership: "system-owned";
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
  coverage: "managed-template-files";
  agent: AgentId;
  goatFlowVersion: string;
  baselineStatus: ManagedSetupBaselineStatus;
  verdict: ManagedSetupVerdict;
  limits: string[];
  files: ManagedSetupPreviewFile[];
}

/** One exact-copy destination and its manifest-controlled package source. */
interface ManagedTemplateDefinition {
  path: string;
  sourcePath: string;
}

/** One target path's safe status and optional regular-file hash for three-way comparison. */
interface ManagedTargetEvidence {
  status: ManagedTargetStatus;
  sha256: string | null;
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
      "The target file differs and no trusted previous-install hash exists.",
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

  // Without an old baseline, only a missing destination is safe to create.
  if (input.oldExpectedSha256 === null) {
    return input.currentSha256 === null ? "added" : "unmanaged";
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
 * Hash one package or target file for the managed comparison.
 * Use when users need byte-level evidence without storing or displaying file contents.
 *
 * @param filePath - package or target file to hash; empty is invalid upstream and cannot be read
 * @returns lowercase SHA-256 text; never null or empty after a successful read
 */
function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

/**
 * Inspect one managed target without following symlinked path components.
 * Use before preview or install so users never authorize writes redirected outside their project.
 *
 * @param projectPath - selected project root; empty is invalid upstream and cannot contain a target
 * @param managedPath - safe manifest or baseline-relative path; empty is rejected before this helper
 * @returns target status and hash; null hash means missing, non-regular, or unreadable bytes
 */
function readManagedTargetEvidence(
  projectPath: string,
  managedPath: string,
): ManagedTargetEvidence {
  const pathSegments = managedPath.split("/");
  let inspectedPath = projectPath;
  // Every parent must remain a real directory so setup cannot escape through a nested symlink.
  for (const directorySegment of pathSegments.slice(0, -1)) {
    inspectedPath = join(inspectedPath, directorySegment);
    try {
      const parentStats = lstatSync(inspectedPath);
      // A symlink or file parent redirects or blocks the managed destination, so install must pause.
      if (!parentStats.isDirectory()) {
        return { status: "non-regular", sha256: null };
      }
    } catch (error) {
      // For example, a first install has no `.goat-flow` parent yet, so the destination is simply missing.
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing", sha256: null };
      }
      return { status: "unreadable", sha256: null };
    }
  }

  const targetFilePath = join(projectPath, managedPath);
  try {
    const targetStats = lstatSync(targetFilePath);
    // Symlinks and directories must never look equal to a regular managed template.
    if (!targetStats.isFile()) {
      return { status: "non-regular", sha256: null };
    }
    return { status: "regular", sha256: hashFile(targetFilePath) };
  } catch (error) {
    // For example, a user deleted this managed file; absence is evidence and unreadable bytes stay blocked.
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { status: "missing", sha256: null };
    }
    return { status: "unreadable", sha256: null };
  }
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
 * Turn one hash comparison into the concise path row shown to users.
 * Use for every managed destination so text and JSON explain the same action and reason.
 */
function buildPreviewFile(
  managedPath: string,
  oldExpectedSha256: string | null,
  currentTarget: ManagedTargetEvidence,
  newExpectedSha256: string | null,
): ManagedSetupPreviewFile {
  const unsafeCurrentTarget =
    newExpectedSha256 !== null &&
    (currentTarget.status === "non-regular" ||
      currentTarget.status === "unreadable");
  // A path that could redirect or hide an install is always unmanaged and blocked while still managed.
  const state = unsafeCurrentTarget
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
 * Derive the overall verdict from every managed path and baseline health.
 * Use after classification so users receive one ready, warning, or blocked decision.
 */
function previewVerdict(
  files: readonly ManagedSetupPreviewFile[],
  baselineStatus: ManagedSetupBaselineStatus,
): ManagedSetupVerdict {
  // Corrupt baseline data cannot authorize an overwrite even if current bytes happen to look safe.
  if (baselineStatus === "invalid") return "blocked";
  // Any ambiguous target state pauses the installer until the user supplies explicit force.
  if (files.some((file) => BLOCKING_STATES.has(file.state))) return "blocked";
  // Retired paths are preserved but still deserve user attention.
  if (files.some((file) => file.state === "removed")) return "warning";
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
    coverage: "managed-template-files",
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
    "Managed files:",
  ];
  // Every row stays grep-friendly while explaining the action in user language.
  for (const file of preview.files) {
    lines.push(
      `  ${file.action.padEnd(8)} ${file.path} [${file.state}] - ${file.reason}`,
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
  const blockingFiles = preview.files.filter((file) =>
    BLOCKING_STATES.has(file.state),
  );
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
  const unsafeManagedTarget = hasUnsafeManagedTarget(preview);
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
  // Only current package templates are verified; retired paths are preserved and excluded.
  const installationMismatches = installedPreview.files.filter(
    (file) =>
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
