/**
 * Builds the static agent/tool threat artifact shown in terminals, JSON, PRs, and releases.
 * Use this report when a reviewer needs one evidence-backed view of local shell, network,
 * file-write, push, secret-path, and audit-log posture before trusting an agent setup.
 * Collection reuses local facts and present-only audit evidence; it never executes target code.
 */
import type {
  AgentEnforcementCapability,
  EnforcementCapabilityAssurance,
} from "../audit/enforcement.js";
import { runAudit } from "../audit/audit.js";
import { loadConfig } from "../config/reader.js";
import { createFS } from "../facts/fs.js";
import { extractProjectFacts } from "../facts/orchestrator.js";
import type { AgentFacts, AgentId } from "../types.js";

/** Copy-paste route shared by readiness and support output without invoking this collector. */
export const THREAT_MODEL_DIAGNOSTIC_COMMAND =
  "goat-flow diagnostics threat-model [path] [--agent <id>]";

const THREAT_MODEL_SCHEMA = "goat-flow.threat-model.v1";
const THREAT_SEVERITIES_BY_PRIORITY = [
  "SECURITY",
  "CORRECTNESS",
  "INTEGRATION",
  "PERFORMANCE",
  "STYLE",
] as const;

type ThreatSeverity = (typeof THREAT_SEVERITIES_BY_PRIORITY)[number];
type ThreatSurfaceId =
  "shell" | "network" | "file-write" | "push" | "secret-path" | "audit-log";
type ThreatSurfaceStatus =
  "restricted" | "permissive" | "unknown" | "unsupported" | "not-configured";
type ThreatVerdict =
  | "restricted"
  | "attention-required"
  | "evidence-incomplete"
  | "not-configured";
type EnforcementCapability = AgentEnforcementCapability["capabilities"][number];

/** Stable user-facing metadata for one threat surface. */
interface ThreatSurfaceMetadata {
  label: string;
  severity: ThreatSeverity;
}

/** One classified surface with proof strength and grep-friendly evidence anchors. */
interface ThreatSurface {
  id: ThreatSurfaceId;
  label: string;
  severity: ThreatSeverity;
  status: ThreatSurfaceStatus;
  evidenceClass: EnforcementCapabilityAssurance;
  summary: string;
  evidence: string[];
}

/** One configured or absent agent row a reviewer can compare without assuming parity. */
interface AgentThreatModel {
  agent: string;
  name: string;
  isConfigured: boolean;
  verdict: ThreatVerdict;
  summary: Record<ThreatSurfaceStatus, number>;
  surfaces: ThreatSurface[];
}

/** Stable report contract consumed by text, JSON, and future dashboard readers. */
export interface ThreatModelReport {
  schema: typeof THREAT_MODEL_SCHEMA;
  projectPath: string;
  advisory: true;
  execution: {
    evidenceSource: "static-local-files";
    targetCodeExecuted: false;
    targetHooksExecuted: false;
    projectCommandsExecuted: false;
    secretContentsRead: false;
  };
  severityOrder: readonly ThreatSeverity[];
  summary: {
    configuredAgents: number;
    notConfiguredAgents: number;
    attentionRequiredAgents: number;
    incompleteEvidenceAgents: number;
    restrictedAgents: number;
    surfaces: Record<ThreatSurfaceStatus, number>;
  };
  agents: AgentThreatModel[];
  relatedDiagnostics: {
    readiness: string;
    supportBundle: string;
  };
}

/** Pure inputs let focused fixtures classify posture without touching a filesystem. */
export interface BuildThreatModelReportInput {
  projectPath: string;
  agentFacts: AgentFacts[];
  enforcement: AgentEnforcementCapability[];
}

const SURFACE_METADATA: Record<ThreatSurfaceId, ThreatSurfaceMetadata> = {
  shell: { label: "Dangerous shell execution", severity: "SECURITY" },
  network: { label: "Network access", severity: "SECURITY" },
  "file-write": { label: "Broad file writes", severity: "CORRECTNESS" },
  push: { label: "Remote repository push", severity: "INTEGRATION" },
  "secret-path": { label: "Secret-bearing paths", severity: "SECURITY" },
  "audit-log": { label: "Tool-call audit log", severity: "INTEGRATION" },
};

/** Return explicit zeroes so renderers never mistake a missing status key for zero. */
function emptyStatusSummary(): Record<ThreatSurfaceStatus, number> {
  return {
    restricted: 0,
    permissive: 0,
    unknown: 0,
    unsupported: 0,
    "not-configured": 0,
  };
}

/** Build one semantic manifest anchor that remains stable when line numbers move. */
function manifestAnchor(agentId: string): string {
  return `workflow/manifest.json (search: \"${agentId}\")`;
}

/** Keep only usable file/semantic anchors and remove duplicates before JSON reaches users. */
function evidenceAnchors(...candidateAnchors: Array<string | null>): string[] {
  return [
    ...new Set(
      candidateAnchors.filter((anchor): anchor is string => anchor !== null),
    ),
  ];
}

/** Return whether any local setup surface makes this agent relevant to the selected project. */
function agentIsConfigured(agentFacts: AgentFacts): boolean {
  return [
    agentFacts.instruction.exists,
    agentFacts.settings.exists,
    agentFacts.skills.found.length > 0,
    agentFacts.skills.installedDirs.length > 0,
    agentFacts.hooks.denyExists,
    agentFacts.hooks.denyIsRegistered,
  ].some(Boolean);
}

/** Return whether the observed deny configuration is wired where a user's action can reach it. */
function activeDenyMechanism(agentFacts: AgentFacts): boolean {
  return (
    agentFacts.hooks.denyIsConfigBased || agentFacts.hooks.denyIsRegistered
  );
}

/** Find one existing audit capability instead of reimplementing its evidence classifier. */
function enforcementCapability(
  enforcement: AgentEnforcementCapability,
  capabilityId: string,
): EnforcementCapability | null {
  return (
    enforcement.capabilities.find(
      (capability) => capability.id === capabilityId,
    ) ?? null
  );
}

/** Construct one surface while keeping its label and severity canonical. */
function threatSurface(
  id: ThreatSurfaceId,
  status: ThreatSurfaceStatus,
  evidenceClass: EnforcementCapabilityAssurance,
  summary: string,
  evidence: string[],
): ThreatSurface {
  return {
    id,
    ...SURFACE_METADATA[id],
    status,
    evidenceClass,
    summary,
    evidence,
  };
}

/** Return the same explicit empty-state surface when an agent has no local setup. */
function notConfiguredSurface(
  id: ThreatSurfaceId,
  agentFacts: AgentFacts,
): ThreatSurface {
  return threatSurface(
    id,
    "not-configured",
    "static-local",
    "No local instruction, settings, skills, or deny-hook surface was observed for this agent",
    evidenceAnchors(
      manifestAnchor(agentFacts.agent.id),
      agentFacts.agent.instructionFile,
      agentFacts.agent.settingsFile,
      agentFacts.agent.hookConfigFile,
    ),
  );
}

/** Classify dangerous and pipe-to-shell execution from the shared enforcement matrix. */
function shellSurface(
  agentFacts: AgentFacts,
  enforcement: AgentEnforcementCapability,
): ThreatSurface {
  const evidence = evidenceAnchors(
    manifestAnchor(agentFacts.agent.id),
    agentFacts.agent.denyHookFile,
    agentFacts.agent.hookConfigFile,
    'AuditReport.enforcement (search: "shell-dangerous")',
    'AuditReport.enforcement (search: "shell-pipe-to-shell")',
  );
  // A runtime with no manifest-backed local deny integration cannot inherit another agent's protection.
  if (agentFacts.agent.denyMechanism === null) {
    return threatSurface(
      "shell",
      "unsupported",
      "manifest-declared",
      "The manifest defines no project-local shell deny mechanism for this agent",
      evidence,
    );
  }
  const dangerousShell = enforcementCapability(enforcement, "shell-dangerous");
  const pipeToShell = enforcementCapability(enforcement, "shell-pipe-to-shell");
  const shellCapabilities = [dangerousShell, pipeToShell].filter(
    (capability): capability is EnforcementCapability => capability !== null,
  );
  // Any observed missing shell control leaves a known path permissive for the user.
  if (shellCapabilities.some((capability) => capability.status === "missing")) {
    return threatSurface(
      "shell",
      "permissive",
      "static-local",
      "At least one dangerous-shell or pipe-to-shell control is missing",
      evidence,
    );
  }
  // Both hard controls give the user a restricted static posture without claiming agent-event delivery.
  if (
    shellCapabilities.length === 2 &&
    shellCapabilities.every((capability) => capability.status === "hard")
  ) {
    return threatSurface(
      "shell",
      "restricted",
      "static-local",
      "Local deny facts cover dangerous shell and pipe-to-shell command shapes",
      evidence,
    );
  }
  return threatSurface(
    "shell",
    "unknown",
    shellCapabilities[0]?.assurance ?? "not-observed",
    "Local shell protection is partial or lacks enough evidence for a restricted verdict",
    evidence,
  );
}

/** Preserve network posture as unknown until a dedicated local collector observes it. */
function networkSurface(agentFacts: AgentFacts): ThreatSurface {
  return threatSurface(
    "network",
    "unknown",
    "not-observed",
    "Manifest and audit facts do not currently observe broad network grants or restrictions",
    evidenceAnchors(manifestAnchor(agentFacts.agent.id)),
  );
}

/** Reuse the broad file-write capability that M18 intentionally refuses to infer. */
function fileWriteSurface(
  agentFacts: AgentFacts,
  enforcement: AgentEnforcementCapability,
): ThreatSurface {
  const capability = enforcementCapability(
    enforcement,
    "file-write-restrictions",
  );
  const evidence = evidenceAnchors(
    manifestAnchor(agentFacts.agent.id),
    'AuditReport.enforcement (search: "file-write-restrictions")',
  );
  // A hard future capability can tighten this surface without changing the report schema.
  if (capability?.status === "hard") {
    return threatSurface(
      "file-write",
      "restricted",
      capability.assurance,
      capability.summary,
      evidence,
    );
  }
  // A missing capability is known absent rather than merely unmeasured.
  if (capability?.status === "missing") {
    return threatSurface(
      "file-write",
      "permissive",
      capability.assurance,
      capability.summary,
      evidence,
    );
  }
  return threatSurface(
    "file-write",
    "unknown",
    capability?.assurance ?? "not-observed",
    capability?.summary ?? "Broad file-write enforcement was not observed",
    evidence,
  );
}

/** Classify push separately because project policy reserves every push for the user. */
function pushSurface(agentFacts: AgentFacts): ThreatSurface {
  const evidence = evidenceAnchors(
    manifestAnchor(agentFacts.agent.id),
    agentFacts.agent.settingsFile,
    agentFacts.agent.denyHookFile,
    'AgentFacts.hooks (search: "denyBlocksGitPush")',
  );
  // Without a local deny integration, goat-flow cannot claim this agent enforces the project policy.
  if (agentFacts.agent.denyMechanism === null) {
    return threatSurface(
      "push",
      "unsupported",
      "manifest-declared",
      "The manifest defines no project-local push deny mechanism for this agent",
      evidence,
    );
  }
  // No observed push block means the shared-system action remains permissive.
  if (!agentFacts.hooks.denyBlocksGitPush) {
    return threatSurface(
      "push",
      "permissive",
      "static-local",
      "No local settings or deny-script pattern blocks git push",
      evidence,
    );
  }
  // A wired deny mechanism turns the observed pattern into a restricted local posture.
  if (activeDenyMechanism(agentFacts)) {
    return threatSurface(
      "push",
      "restricted",
      "static-local",
      "A configured local deny mechanism blocks git push for this agent",
      evidence,
    );
  }
  return threatSurface(
    "push",
    "unknown",
    "static-local",
    "A push-block pattern exists, but active registration was not observed",
    evidence,
  );
}

/** Combine file-tool and shell secret-path facts without reading any protected file. */
function secretPathSurface(agentFacts: AgentFacts): ThreatSurface {
  const evidence = evidenceAnchors(
    manifestAnchor(agentFacts.agent.id),
    agentFacts.agent.settingsFile,
    agentFacts.agent.denyHookFile,
    'AgentFacts.hooks (search: "readDenyCoversSecrets")',
    'AgentFacts.hooks (search: "bashDenyCoversSecrets")',
  );
  // A runtime with no local deny mechanism cannot claim secret-path protection from goat-flow.
  if (agentFacts.agent.denyMechanism === null) {
    return threatSurface(
      "secret-path",
      "unsupported",
      "manifest-declared",
      "The manifest defines no project-local secret-path deny mechanism for this agent",
      evidence,
    );
  }
  const fileReadsRestricted = agentFacts.hooks.readDenyCoversSecrets;
  const shellReadsRestricted = agentFacts.hooks.bashDenyCoversSecrets;
  // Both missing layers create an observed permissive path to known secret-bearing locations.
  if (!fileReadsRestricted && !shellReadsRestricted) {
    return threatSurface(
      "secret-path",
      "permissive",
      "static-local",
      "Neither file-tool nor shell secret-path blocking was observed",
      evidence,
    );
  }
  // Both layers plus active wiring give the user the strongest static restriction this report can claim.
  if (
    fileReadsRestricted &&
    shellReadsRestricted &&
    activeDenyMechanism(agentFacts)
  ) {
    return threatSurface(
      "secret-path",
      "restricted",
      "static-local",
      "File-tool and shell facts both cover known secret-bearing paths",
      evidence,
    );
  }
  return threatSurface(
    "secret-path",
    "unknown",
    "static-local",
    "Secret-path coverage is partial or its active registration was not observed",
    evidence,
  );
}

/** Keep tool-call logging unknown because event storage is not proof that every call is captured. */
function auditLogSurface(agentFacts: AgentFacts): ThreatSurface {
  return threatSurface(
    "audit-log",
    "unknown",
    "not-observed",
    "Local event storage does not prove complete per-tool audit logging for this agent",
    evidenceAnchors(manifestAnchor(agentFacts.agent.id)),
  );
}

/** Convert six surface states into the single review verdict shown beside one agent. */
function agentVerdict(surfaces: ThreatSurface[]): ThreatVerdict {
  // Any known permissive path gives the reviewer a concrete action before trusting the setup.
  if (surfaces.some((surface) => surface.status === "permissive")) {
    return "attention-required";
  }
  // Unknown or unsupported surfaces keep incomplete evidence visible instead of creating a clean badge.
  if (
    surfaces.some(
      (surface) =>
        surface.status === "unknown" || surface.status === "unsupported",
    )
  ) {
    return "evidence-incomplete";
  }
  return "restricted";
}

/** Count one agent's surface statuses for compact terminal and dashboard summaries. */
function summarizeSurfaces(
  surfaces: ThreatSurface[],
): Record<ThreatSurfaceStatus, number> {
  const summary = emptyStatusSummary();
  // Each visible surface contributes once so summary totals always equal six.
  for (const surface of surfaces) summary[surface.status] += 1;
  return summary;
}

/** Build one agent row from manifest-backed facts and shared audit capability evidence. */
function buildAgentThreatModel(
  agentFacts: AgentFacts,
  enforcement: AgentEnforcementCapability,
): AgentThreatModel {
  const isConfigured = agentIsConfigured(agentFacts);
  // An absent local setup receives one consistent empty-state row for every surface.
  if (!isConfigured) {
    const surfaces = (Object.keys(SURFACE_METADATA) as ThreatSurfaceId[]).map(
      (surfaceId) => notConfiguredSurface(surfaceId, agentFacts),
    );
    return {
      agent: agentFacts.agent.id,
      name: agentFacts.agent.name,
      isConfigured,
      verdict: "not-configured",
      summary: summarizeSurfaces(surfaces),
      surfaces,
    };
  }
  const surfaces = [
    shellSurface(agentFacts, enforcement),
    networkSurface(agentFacts),
    fileWriteSurface(agentFacts, enforcement),
    pushSurface(agentFacts),
    secretPathSurface(agentFacts),
    auditLogSurface(agentFacts),
  ];
  return {
    agent: agentFacts.agent.id,
    name: agentFacts.agent.name,
    isConfigured,
    verdict: agentVerdict(surfaces),
    summary: summarizeSurfaces(surfaces),
    surfaces,
  };
}

/** Find the audit matrix row for one agent without borrowing another runner's evidence. */
function matchingEnforcement(
  agentFacts: AgentFacts,
  enforcement: AgentEnforcementCapability[],
): AgentEnforcementCapability {
  const matchingReport = enforcement.find(
    (candidate) => candidate.agent === agentFacts.agent.id,
  );
  // Missing audit evidence is represented by a minimal empty matrix, never a borrowed result.
  if (matchingReport === undefined) {
    return {
      agent: agentFacts.agent.id,
      name: agentFacts.agent.name,
      advisory: true,
      capabilities: [],
      summary: { hard: 0, limited: 0, soft: 0, missing: 0, unknown: 0 },
    };
  }
  return matchingReport;
}

/** Aggregate agent verdicts and surface states without weighted risk pseudo-precision. */
function summarizeReport(
  agents: AgentThreatModel[],
): ThreatModelReport["summary"] {
  const surfaces = emptyStatusSummary();
  // Every agent contributes its six status counts to the project-level summary.
  for (const agent of agents) {
    // Each named status remains explicit for stable JSON consumers.
    for (const status of Object.keys(surfaces) as ThreatSurfaceStatus[]) {
      surfaces[status] += agent.summary[status];
    }
  }
  return {
    configuredAgents: agents.filter((agent) => agent.isConfigured).length,
    notConfiguredAgents: agents.filter((agent) => !agent.isConfigured).length,
    attentionRequiredAgents: agents.filter(
      (agent) => agent.verdict === "attention-required",
    ).length,
    incompleteEvidenceAgents: agents.filter(
      (agent) => agent.verdict === "evidence-incomplete",
    ).length,
    restrictedAgents: agents.filter((agent) => agent.verdict === "restricted")
      .length,
    surfaces,
  };
}

/**
 * Build the stable timestamp-free artifact used by all threat-model renderers.
 * @param input - static agent facts and enforcement rows; empty arrays mean no agent surface was observed
 * @returns review artifact with explicit empty states, evidence classes, and no runtime claims
 */
export function buildThreatModelReport(
  input: BuildThreatModelReportInput,
): ThreatModelReport {
  const agents = input.agentFacts.map((agentFacts) =>
    buildAgentThreatModel(
      agentFacts,
      matchingEnforcement(agentFacts, input.enforcement),
    ),
  );
  return {
    schema: THREAT_MODEL_SCHEMA,
    projectPath: input.projectPath,
    advisory: true,
    execution: {
      evidenceSource: "static-local-files",
      targetCodeExecuted: false,
      targetHooksExecuted: false,
      projectCommandsExecuted: false,
      secretContentsRead: false,
    },
    severityOrder: THREAT_SEVERITIES_BY_PRIORITY,
    summary: summarizeReport(agents),
    agents,
    relatedDiagnostics: {
      readiness: "goat-flow diagnostics readiness [path] [--agent <id>]",
      supportBundle: "goat-flow diagnostics bundle [path] [--agent <id>]",
    },
  };
}

/**
 * Collect static target facts and present-only audit evidence without running configured hooks.
 * @param projectPath - selected project root; empty input is resolved by the CLI before collection
 * @param selectedAgent - one agent to inspect, or null to include every manifest-backed agent
 * @returns local posture report; absent setup surfaces remain `not-configured`
 */
export function collectThreatModelReport(
  projectPath: string,
  selectedAgent: AgentId | null,
): ThreatModelReport {
  const projectFiles = createFS(projectPath);
  const configState = loadConfig(projectPath, projectFiles);
  const facts = extractProjectFacts(projectFiles, {
    agentFilter: selectedAgent,
    projectPath,
    configState,
    includeStack: false,
  });
  const audit = runAudit(projectFiles, projectPath, {
    agentFilter: selectedAgent,
    harness: true,
    checkDrift: false,
    checkContent: false,
    denyMechanismEvidenceLevel: "present-only",
    shouldRunAutoDrift: false,
  });
  return buildThreatModelReport({
    projectPath,
    agentFacts: facts.agents,
    enforcement: audit.enforcement,
  });
}

/**
 * Render one parseable document for CI, dashboard readers, or review attachments.
 * @param report - complete static artifact; an empty agent list stays explicit in JSON
 * @returns indented JSON with no target file bodies or runtime output
 */
export function renderThreatModelJson(report: ThreatModelReport): string {
  return JSON.stringify(report, null, 2);
}

/**
 * Render concise posture and evidence classes for a reviewer scanning a terminal or PR.
 * @param report - complete static artifact; empty agents produce a clear terminal state
 * @returns plain-English rows with severity, status, and evidence class
 */
export function renderThreatModelText(report: ThreatModelReport): string {
  const lines = [
    "Agent/tool threat model",
    `Path: ${report.projectPath}`,
    "Static posture only; target hooks and project commands were not executed, and secret contents were not read.",
  ];
  // An empty agent list remains explicit instead of implying a restricted project.
  if (report.agents.length === 0) {
    lines.push("", "Agents: none observed.");
    return lines.join("\n");
  }
  // Each agent keeps its own verdict so different runtimes never inherit false parity.
  for (const agent of report.agents) {
    lines.push("", `${agent.name} (${agent.agent}): ${agent.verdict}`);
    // Surface rows carry severity and evidence class beside the status a reviewer acts on.
    for (const surface of agent.surfaces) {
      lines.push(
        `  - [${surface.severity}] ${surface.label}: ${surface.status} [${surface.evidenceClass}] - ${surface.summary}`,
      );
    }
  }
  lines.push(
    "",
    `Related: ${report.relatedDiagnostics.readiness}`,
    `Support: ${report.relatedDiagnostics.supportBundle}`,
  );
  return lines.join("\n");
}
