/**
 * Operator summary for an install preview, so the first lines are enough to approve or refuse the install.
 *
 * It names the rows another agent's install owns, counts rows per action, lists the user-owned and peer-agent files the install
 * writes, names the provider configs that stay on the retired hooks, reports `pass` when nothing is left to do, and renders the
 * text preview with that summary after the verdict.
 */
import { posix } from "node:path";
import { getAgentProfile, getAgentProfiles } from "./agents/registry.js";
import { retiredRuntimeReferences } from "./installer/retired-runtime.js";
import { getSkillFiles, loadManifest } from "./manifest/manifest.js";
import type {
  ManagedSetupAction,
  ManagedSetupPreview,
  ManagedSetupPreviewFile,
} from "./managed-setup-preview.js";
import type { ManagedInstallStateFacade } from "./managed-setup-state.js";
import type { AgentId } from "./types.js";

/** One file named beside the agent whose install owns it. */
export interface ManagedSetupAgentPath {
  agent: AgentId;
  path: string;
}

/** Counts and notices an operator reads before approving the install. */
export interface ManagedSetupPreviewSummary {
  actions: Record<ManagedSetupAction, number>;
  userOwnedWrites: string[];
  peerAgentWrites: ManagedSetupAgentPath[];
  pendingRuntimeCleanup: ManagedSetupAgentPath[];
}

// Actions that change a file on disk; `none`, `preserve` and `protect` leave the bytes as they are.
const WRITING_ACTIONS = new Set<ManagedSetupAction>([
  "create",
  "replace",
  "regenerate",
  "migrate",
  "remove",
]);

/**
 * Start a summary with every action at zero and nothing listed; `settleManagedSetupPreview` fills it from the rows.
 *
 * @returns a fresh summary object the caller may change
 */
export function emptyManagedSetupPreviewSummary(): ManagedSetupPreviewSummary {
  return {
    actions: {
      none: 0,
      create: 0,
      replace: 0,
      preserve: 0,
      protect: 0,
      regenerate: 0,
      migrate: 0,
      remove: 0,
    },
    userOwnedWrites: [],
    peerAgentWrites: [],
    pendingRuntimeCleanup: [],
  };
}

/**
 * List every skill file the package ships into one agent's skills folder.
 *
 * @param skillsDir - the agent's skills folder from the registry
 * @returns repository-relative paths, one per canonical skill file
 */
function shippedSkillPaths(skillsDir: string): string[] {
  return loadManifest().skills.canonical.flatMap((skillName) =>
    getSkillFiles(skillName).map((relativeSkillPath) =>
      posix.join(skillsDir, skillName, relativeSkillPath),
    ),
  );
}

/**
 * Name the agents the shared install record knows: receipt holders and agents with an older per-agent record.
 *
 * @param installRecord - shared install record
 * @returns recorded agents; empty when the project has no install record
 */
function recordedAgents(
  installRecord: ManagedInstallStateFacade,
): Set<AgentId> {
  return new Set<AgentId>([
    ...(installRecord.state?.receipts.map((receipt) => receipt.agent) ?? []),
    ...installRecord.legacyAgents,
  ]);
}

/**
 * Map each skill file another agent's install ships to the agents that ship it, so the selected agent's preview can label those
 * recorded paths as that install's files rather than as retired ones.
 *
 * @param agent - selected agent; it and any agent sharing its skills folder are left out, because its own rows already cover them
 * @param installRecord - shared install record; where a shared folder has several shipping agents, only agents it records are named
 * @returns path to shipping agents in registry order; a path absent from the map is not shipped by any peer
 */
export function peerSkillOwners(
  agent: AgentId,
  installRecord: ManagedInstallStateFacade,
): Map<string, AgentId[]> {
  const installedAgents = recordedAgents(installRecord);
  const ownSkillsDir = getAgentProfile(agent).skillsDir;
  const owners = new Map<string, AgentId[]>();
  // The selected agent, and an agent sharing its skills folder, ship nothing this install does not already list.
  for (const profile of getAgentProfiles().filter(
    (peer) => peer.skillsDir !== ownSkillsDir,
  ))
    for (const path of shippedSkillPaths(profile.skillsDir))
      owners.set(path, [...(owners.get(path) ?? []), profile.id]);
  // Codex and Antigravity share one folder, so prefer the installs that actually recorded it.
  for (const [path, shippingAgents] of owners) {
    const installed = shippingAgents.filter((owner) =>
      installedAgents.has(owner),
    );
    if (installed.length > 0) owners.set(path, installed);
  }
  return owners;
}

/**
 * Relabel a recorded path the selected package no longer ships as another agent's file, which this install leaves alone.
 *
 * @param row - preview row first classified as removed; changed in place
 * @param owners - peer agents whose install ships the path; never empty
 */
export function labelPeerManagedRow(
  row: ManagedSetupPreviewFile,
  owners: readonly AgentId[],
): void {
  row.state = "peer-managed";
  row.action = "none";
  // Codex and Antigravity share a skills folder, so one path can name two installs.
  const installs = owners.length > 1 ? "installs manage" : "install manages";
  row.reason = `The ${owners.join(" and ")} ${installs} this path; this install leaves it unchanged.`;
}

/**
 * Report whether one row is finished: install writes nothing there except a rebuilt generated record, and no local edit waits to be reconciled.
 *
 * @param file - one preview row
 * @returns true when the row needs nothing from this install or the user
 */
function isSettledRow(file: ManagedSetupPreviewFile): boolean {
  // A kept local edit still needs the user to reconcile it, so the install never reads as finished.
  if (file.state === "local-preserved") return false;
  // Generated indexes and install records are rebuilt from current state on every run, so rebuilding them is not pending work.
  if (file.ownership === "generated") return true;
  return !WRITING_ACTIONS.has(file.action) && file.action !== "protect";
}

/**
 * Fill the preview summary and move a clean verdict between `ready` (writes are waiting) and `pass` (nothing is left to do).
 * Call it again after adding rows, so the summary and verdict always describe every row; `warning` and `blocked` never change here.
 *
 * @param projectPath - previewed project; its provider configs are read to predict pending runtime cleanup
 * @param preview - preview whose summary and verdict are replaced in place
 * @param mayPass - false when the caller already knows this install is unfinished, such as a stale receipt for the selected agent or a
 *   preview that was not `pass` before more rows were added
 * @param peerAgentWrites - other agents' configs this install edits; empty when it edits none
 */
export function settleManagedSetupPreview(
  projectPath: string,
  preview: ManagedSetupPreview,
  mayPass: boolean,
  peerAgentWrites: readonly ManagedSetupAgentPath[] = [],
): void {
  const peerPaths = new Set(peerAgentWrites.map((write) => write.path));
  const { actions } = emptyManagedSetupPreviewSummary();
  for (const file of preview.files) actions[file.action] += 1;
  preview.summary = {
    actions,
    userOwnedWrites: preview.files
      .filter(
        (file) =>
          file.ownership === "user-owned" &&
          WRITING_ACTIONS.has(file.action) &&
          !peerPaths.has(file.path),
      )
      .map((file) => file.path),
    peerAgentWrites: [...peerAgentWrites],
    // This install moves its own config off the retired hooks; every other config still on them keeps the old files in place.
    pendingRuntimeCleanup: retiredRuntimeReferences(projectPath).filter(
      (reference) => reference.agent !== preview.agent,
    ),
  };
  // Warning and blocked verdicts already name what needs a decision, so only the two clean verdicts move.
  if (preview.verdict !== "ready" && preview.verdict !== "pass") return;
  const isFinished =
    mayPass &&
    preview.baselineStatus === "loaded" &&
    preview.summary.pendingRuntimeCleanup.length === 0 &&
    preview.files.every(isSettledRow);
  preview.verdict = isFinished ? "pass" : "ready";
}

/**
 * Join agent-owned paths as `path (agent)` for one header line.
 *
 * @param entries - files to list
 * @returns the joined list, or `none` when empty
 */
function agentPathList(entries: readonly ManagedSetupAgentPath[]): string {
  return entries.length === 0
    ? "none"
    : entries.map((entry) => `${entry.path} (${entry.agent})`).join(", ");
}

/**
 * Render the summary as the header lines that follow the verdict in the text preview.
 *
 * @param summary - settled preview summary
 * @returns three lines, plus a fourth naming pending runtime cleanup when any config still runs the retired hooks
 */
function summaryLines(summary: ManagedSetupPreviewSummary): string[] {
  const counts = Object.entries(summary.actions)
    .filter(([, count]) => count > 0)
    .map(([action, count]) => `${count} ${action}`);
  const lines = [
    `Actions: ${counts.length > 0 ? counts.join(", ") : "no rows"}`,
    `User-owned files this install writes: ${summary.userOwnedWrites.length > 0 ? summary.userOwnedWrites.join(", ") : "none"}`,
    `Peer-agent files this install writes: ${agentPathList(summary.peerAgentWrites)}`,
  ];
  // Retired hook files stay on disk while any provider still runs them, so name each config whose install finishes the cleanup.
  if (summary.pendingRuntimeCleanup.length > 0)
    lines.push(
      `Runtime cleanup pending after this install: ${agentPathList(summary.pendingRuntimeCleanup)}. The retired hook files stay until each of these agents is installed with this release.`,
    );
  return lines;
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
    ...summaryLines(preview.summary),
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
