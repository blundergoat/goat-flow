/**
 * Builds the managed-install evidence appended to public status output.
 *
 * This module keeps receipt authority, blocking migration evidence, cutover
 * compatibility, and orphan visibility on one text/JSON vocabulary.
 */
import type {
  ManagedInstallStateFacade,
  ManagedInstallStateV2,
} from "./managed-setup-state.js";
import {
  buildManagedSetupPreview,
  readManagedSetupV2Baseline,
  selectedManagedReceiptProblems,
  type ManagedSetupPreview,
} from "./managed-setup-preview.js";
import { getPackageVersion } from "./paths.js";
import { KNOWN_AGENT_IDS, type AgentId } from "./types.js";

const MANAGED_INSTALL_EVIDENCE_SCHEMA =
  "goat-flow.managed-install-evidence.v1" as const;

type ManagedSetupBaseline = ReturnType<typeof readManagedSetupV2Baseline>;
type ManagedReceipt = ManagedInstallStateV2["receipts"][number];
type ManagedReceiptProblem = ReturnType<
  typeof selectedManagedReceiptProblems
>[number];
type AgentPreviewMap = ReadonlyMap<AgentId, ManagedSetupPreview>;

/** Agents and project-relative paths whose local evidence one status entry explains. */
interface ManagedInstallEvidenceSubjects {
  agents: AgentId[];
  paths: string[];
}

/** One authoritative or non-authoritative managed-install condition shown in text and JSON. */
interface ManagedInstallEvidenceEntry {
  status:
    | "confirmed"
    | "stale"
    | "legacy-unconfirmed"
    | "malformed-blocking"
    | "conflicting"
    | "cutover-incompatible"
    | "orphan";
  subjects: ManagedInstallEvidenceSubjects;
  canSelectInstalledAgent: boolean;
  reason: string;
  recovery: string | null;
}

/** Stable managed-install evidence envelope appended to the public status command. */
export interface ManagedInstallEvidenceReport {
  schemaVersion: typeof MANAGED_INSTALL_EVIDENCE_SCHEMA;
  baselineStatus: ManagedInstallStateFacade["status"] | "cutover-incompatible";
  entries: ManagedInstallEvidenceEntry[];
}

/**
 * Quote one normalized project path for the user's current platform shell.
 *
 * @param projectPath - absolute or relative path that must remain one command argument
 * @returns slash-normalized single-quoted syntax for PowerShell on Windows or a POSIX shell elsewhere
 */
export function quoteManagedInstallProjectArgument(
  projectPath: string,
): string {
  const normalizedPath = projectPath.replace(/\\/gu, "/");
  const escapedPath =
    process.platform === "win32"
      ? normalizedPath.replace(/'/gu, "''")
      : normalizedPath.replace(/'/gu, "'\\''");
  return `'${escapedPath}'`;
}

/** Build the public install command that can verify one agent without force. */
function installCommand(projectPath: string, agent: AgentId): string {
  return `goat-flow install ${quoteManagedInstallProjectArgument(projectPath)} --agent ${agent}`;
}

/** Build the read-only recheck command used after repairing blocking global evidence. */
function statusCommand(projectPath: string): string {
  return `goat-flow status ${quoteManagedInstallProjectArgument(projectPath)} --format json`;
}

/** Sort portable paths by their UTF-8 bytes, matching managed-state ordering. */
function comparePaths(left: string, right: string): number {
  return Buffer.compare(
    Buffer.from(left, "utf-8"),
    Buffer.from(right, "utf-8"),
  );
}

/** Return a stable unique list of every path named by receipt problems. */
function receiptProblemPaths(
  problems: readonly ManagedReceiptProblem[],
): string[] {
  return [
    ...new Set(
      problems.flatMap((problem) =>
        problem.path === null ? [] : [problem.path],
      ),
    ),
  ].sort(comparePaths);
}

/**
 * Build one non-authoritative global bootstrap entry and its exact read-only recovery.
 * Invariant: malformed or conflicting evidence never grants selection authority or proposes force.
 */
function blockingEntry(
  projectPath: string,
  baseline: ManagedSetupBaseline,
  status: "malformed-blocking" | "conflicting",
): ManagedInstallEvidenceEntry {
  const affectedPaths = baseline.facade.affectedPaths;
  const subject = affectedPaths.join(", ") || ".goat-flow/install-state";
  const reasonPrefix = baseline.error ?? "Managed install evidence is invalid.";
  if (status === "malformed-blocking") {
    return {
      status,
      subjects: {
        agents: baseline.facade.affectedAgents,
        paths: affectedPaths,
      },
      canSelectInstalledAgent: false,
      reason: `${reasonPrefix} Malformed evidence blocks every agent and cannot select an installed agent.`,
      recovery: `Repair ${subject} as canonical safe install-state JSON, then run: ${statusCommand(projectPath)}. Force cannot repair malformed evidence.`,
    };
  }
  return {
    status,
    subjects: {
      agents: baseline.facade.affectedAgents,
      paths: affectedPaths,
    },
    canSelectInstalledAgent: false,
    reason: `${reasonPrefix} Conflicting legacy history cannot select an installed agent.`,
    recovery: `Reconcile the named legacy baselines for ${subject} to one verified historical hash, then run: ${statusCommand(projectPath)}. Force cannot choose baseline history.`,
  };
}

/** Build all selected-agent previews once so receipt and orphan checks share current path evidence. */
function agentPreviews(projectPath: string): Map<AgentId, ManagedSetupPreview> {
  return new Map(
    KNOWN_AGENT_IDS.map((agent) => [
      agent,
      buildManagedSetupPreview(projectPath, agent),
    ]),
  );
}

/**
 * Derive every reason one stored receipt cannot remain confirmed.
 * Invariant: package, path, generation, target-byte, and cutover checks can remove authority but never replace the baseline.
 */
function receiptProblems(
  baseline: ManagedSetupBaseline,
  state: ManagedInstallStateV2,
  preview: ManagedSetupPreview,
  receipt: ManagedReceipt,
): ManagedReceiptProblem[] {
  const problems = selectedManagedReceiptProblems(
    state,
    preview.files,
    receipt.agent,
  );
  const packageVersion = getPackageVersion();
  if (receipt.goatFlowVersion !== packageVersion) {
    problems.unshift({
      path: null,
      reason: `Receipt package version ${receipt.goatFlowVersion} does not match current goat-flow ${packageVersion}.`,
    });
  }
  if (
    baseline.cutoverEvidence?.incompatibleAgents.includes(receipt.agent) ===
    true
  ) {
    const markerPath = `.goat-flow/install-state/${receipt.agent}.json`;
    problems.push({
      path: markerPath,
      reason: `The cutover marker for ${receipt.agent} is missing or incompatible.`,
    });
  }
  return problems;
}

/** Convert one receipt and its current evidence into confirmed or stale status. */
function receiptEntry(
  projectPath: string,
  receipt: ManagedReceipt,
  problems: readonly ManagedReceiptProblem[],
): ManagedInstallEvidenceEntry {
  const agent = receipt.agent;
  if (problems.length === 0) {
    return {
      status: "confirmed",
      subjects: { agents: [agent], paths: [] },
      canSelectInstalledAgent: true,
      reason: `The ${agent} receipt matches the current package, managed path set, row generations, target bytes, and cutover marker.`,
      recovery: null,
    };
  }
  return {
    status: "stale",
    subjects: { agents: [agent], paths: receiptProblemPaths(problems) },
    canSelectInstalledAgent: false,
    reason: `${problems.map((problem) => problem.reason).join(" ")} Stale receipt evidence cannot select ${agent} as an installed agent.`,
    recovery: `Reconcile the listed receipt and managed target paths with the current package, then run: ${installCommand(projectPath, agent)}. The recovery uses no force flag.`,
  };
}

/** Build receipt entries in stable known-agent order. */
function receiptEntries(
  projectPath: string,
  baseline: ManagedSetupBaseline,
  state: ManagedInstallStateV2,
  previews: AgentPreviewMap,
): ManagedInstallEvidenceEntry[] {
  const receipts = new Map(
    state.receipts.map((receipt) => [receipt.agent, receipt]),
  );
  return KNOWN_AGENT_IDS.flatMap((agent) => {
    const receipt = receipts.get(agent);
    if (receipt === undefined) return [];
    const preview = previews.get(agent);
    const problems: ManagedReceiptProblem[] =
      preview === undefined
        ? [
            {
              path: null,
              reason: `Current managed preview is unavailable for ${agent}.`,
            },
          ]
        : receiptProblems(baseline, state, preview, receipt);
    return [receiptEntry(projectPath, receipt, problems)];
  });
}

/** Return every known agent named by retained legacy provenance. */
function legacyEvidenceAgents(state: ManagedInstallStateV2): Set<AgentId> {
  const agents = new Set<AgentId>();
  for (const row of state.files) {
    if (row.provenance.kind !== "legacy-v1-bootstrap") continue;
    for (const observation of row.provenance.observations) {
      agents.add(observation.agent);
    }
  }
  return agents;
}

/** Return each legacy-provenance path associated with one known agent. */
function legacyEvidencePaths(
  state: ManagedInstallStateV2,
  agent: AgentId,
): string[] {
  return state.files
    .filter(
      (row) =>
        row.provenance.kind === "legacy-v1-bootstrap" &&
        row.provenance.observations.some(
          (observation) => observation.agent === agent,
        ),
    )
    .map((row) => row.path);
}

/**
 * Build legacy-unconfirmed entries for migrated agents that have no v2 receipt.
 * Invariant: retained legacy provenance stays visible but never grants installed-agent selection authority.
 */
function legacyEntries(
  projectPath: string,
  baseline: ManagedSetupBaseline,
  state: ManagedInstallStateV2,
): ManagedInstallEvidenceEntry[] {
  const legacyAgents = legacyEvidenceAgents(state);
  for (const agent of baseline.facade.legacyAgents) legacyAgents.add(agent);
  const receiptAgents = new Set(state.receipts.map((receipt) => receipt.agent));
  return KNOWN_AGENT_IDS.filter(
    (agent) => legacyAgents.has(agent) && !receiptAgents.has(agent),
  ).map((agent) => ({
    status: "legacy-unconfirmed",
    subjects: { agents: [agent], paths: legacyEvidencePaths(state, agent) },
    canSelectInstalledAgent: false,
    reason: `Valid v1 evidence was imported for ${agent}, but no v2 receipt has verified the current package or target bytes, so it cannot select an installed agent.`,
    recovery: `Run: ${installCommand(projectPath, agent)}. The public CLI verifies current target bytes and publishes a confirmed receipt without force.`,
  }));
}

/**
 * Build the combined marker incompatibility entry, or null when every marker is exact.
 * Invariant: one known-agent-ordered entry names every incompatible marker and uses only public non-force repair.
 */
function cutoverEntry(
  projectPath: string,
  baseline: ManagedSetupBaseline,
): ManagedInstallEvidenceEntry | null {
  const agents = KNOWN_AGENT_IDS.filter((agent) =>
    baseline.cutoverEvidence?.incompatibleAgents.includes(agent),
  );
  const repairAgent = agents[0];
  if (repairAgent === undefined) return null;
  return {
    status: "cutover-incompatible",
    subjects: {
      agents,
      paths: agents.map((agent) => `.goat-flow/install-state/${agent}.json`),
    },
    canSelectInstalledAgent: false,
    reason:
      "The named hashless cutover markers are missing or incompatible, so their evidence cannot select an installed agent.",
    recovery: `Run: ${installCommand(projectPath, repairAgent)}. The public CLI repairs every marker under claims before target mutation, without force.`,
  };
}

/** Collect the current manifest-derived exact-copy path union across every agent. */
function currentManagedPaths(previews: AgentPreviewMap): Set<string> {
  const paths = new Set<string>();
  for (const preview of previews.values()) {
    for (const file of preview.files) {
      if (
        file.ownership === "system-owned" &&
        file.newExpectedSha256 !== null
      ) {
        paths.add(file.path);
      }
    }
  }
  return paths;
}

/** Build the combined orphan entry, or null when every stored row still has a consumer. */
function orphanEntry(
  state: ManagedInstallStateV2,
  previews: AgentPreviewMap,
): ManagedInstallEvidenceEntry | null {
  const manifestPaths = currentManagedPaths(previews);
  const receiptPaths = new Set(
    state.receipts.flatMap((receipt) =>
      receipt.files.map((reference) => reference.path),
    ),
  );
  const paths = state.files
    .filter(
      (row) => !manifestPaths.has(row.path) && !receiptPaths.has(row.path),
    )
    .map((row) => row.path);
  if (paths.length === 0) return null;
  return {
    status: "orphan",
    subjects: { agents: [], paths },
    canSelectInstalledAgent: false,
    reason:
      "The stored rows are absent from the current manifest path union and every receipt reference, so they have no preview, overwrite, installed-agent, audit, or hook authority.",
    recovery:
      "Retain these rows until an explicit cleanup contract verifies retirement. Do not delete them by inference or use force; ordinary install intentionally preserves orphan evidence.",
  };
}

/**
 * Build the managed-install evidence consumed by public status text and JSON.
 * The staged branches exist because malformed/conflicting evidence has no safe state to inspect, while loaded evidence must validate every receipt
 * before it can report orphans without accidentally granting authority.
 *
 * @param projectPath - selected project whose local install evidence is inspected without mutation
 * @returns stable baseline status and subject-bearing evidence entries
 */
export function buildManagedInstallEvidenceReport(
  projectPath: string,
): ManagedInstallEvidenceReport {
  const baseline = readManagedSetupV2Baseline(projectPath);
  if (baseline.status === "malformed-blocking") {
    return {
      schemaVersion: MANAGED_INSTALL_EVIDENCE_SCHEMA,
      baselineStatus: baseline.status,
      entries: [blockingEntry(projectPath, baseline, baseline.status)],
    };
  }
  if (baseline.status === "conflicting") {
    return {
      schemaVersion: MANAGED_INSTALL_EVIDENCE_SCHEMA,
      baselineStatus: baseline.status,
      entries: [blockingEntry(projectPath, baseline, baseline.status)],
    };
  }
  const state = baseline.facade.state;
  if (state === null) {
    return {
      schemaVersion: MANAGED_INSTALL_EVIDENCE_SCHEMA,
      baselineStatus: baseline.status,
      entries: [],
    };
  }

  const previews = agentPreviews(projectPath);
  const markerEntry = cutoverEntry(projectPath, baseline);
  const storedOrphanEntry = orphanEntry(state, previews);
  return {
    schemaVersion: MANAGED_INSTALL_EVIDENCE_SCHEMA,
    baselineStatus: baseline.status,
    entries: [
      ...receiptEntries(projectPath, baseline, state, previews),
      ...legacyEntries(projectPath, baseline, state),
      ...(markerEntry === null ? [] : [markerEntry]),
      ...(storedOrphanEntry === null ? [] : [storedOrphanEntry]),
    ],
  };
}

/**
 * Render the exact managed-install evidence vocabulary for terminal status output.
 *
 * @param report - structured report already derived from the selected project
 * @returns deterministic terminal text naming every condition and recovery
 */
export function renderManagedInstallEvidenceText(
  report: ManagedInstallEvidenceReport,
): string {
  if (report.entries.length === 0) {
    return `Managed install evidence: none (baseline=${report.baselineStatus})`;
  }
  const lines = [
    `Managed install evidence: (baseline=${report.baselineStatus})`,
  ];
  for (const entry of report.entries) {
    const subjects: string[] = [];
    if (entry.subjects.agents.length === 1) {
      subjects.push(`agent=${entry.subjects.agents[0]}`);
    } else if (entry.subjects.agents.length > 1) {
      subjects.push(`agents=${entry.subjects.agents.join(",")}`);
    }
    if (entry.subjects.paths.length === 1) {
      subjects.push(`path=${entry.subjects.paths[0]}`);
    } else if (entry.subjects.paths.length > 1) {
      subjects.push(`paths=${entry.subjects.paths.join(",")}`);
    }
    lines.push(
      `  ${entry.status}${subjects.length > 0 ? ` ${subjects.join(" ")}` : ""} can-select-installed-agent=${entry.canSelectInstalledAgent ? "yes" : "no"}`,
      `    Reason: ${entry.reason}`,
      `    Recovery: ${entry.recovery ?? "none"}`,
    );
  }
  return lines.join("\n");
}
