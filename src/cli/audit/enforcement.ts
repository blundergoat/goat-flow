/**
 * Advisory per-agent enforcement capability matrix.
 *
 * This summarizes what goat-flow can prove from local facts. It must not turn
 * structural setup checks into broader runtime-enforcement claims.
 */
import type { AgentFacts } from "../types.js";
import type { AuditScope, CheckResult } from "./types.js";

/** Non-gating strength labels for evidence the local audit can observe about an agent. */
export type EnforcementCapabilityStatus =
  "hard" | "limited" | "soft" | "missing" | "unknown";

/** Evidence origin recorded beside a capability so users can distinguish local proof from declarations. */
export type EnforcementCapabilitySource =
  | "local-settings"
  | "local-hook"
  | "runtime-self-test"
  | "manifest"
  | "provider-docs"
  | "not-observed";

/** User-facing proof class that keeps runtime, static, declared, and absent evidence visibly distinct. */
export type EnforcementCapabilityAssurance =
  | "runtime-local"
  | "static-local"
  | "manifest-declared"
  | "provider-documented"
  | "not-observed";

type EnforcementCapabilityId =
  | "shell-dangerous"
  | "shell-pipe-to-shell"
  | "secret-file-read"
  | "secret-shell-read"
  | "hook-registration"
  | "hook-self-test"
  | "file-read-restrictions"
  | "file-write-restrictions"
  | "provider-native-enforcement";

/** One advisory row describing a single enforcement surface and the evidence behind it. */
interface EnforcementCapability {
  id: EnforcementCapabilityId;
  label: string;
  status: EnforcementCapabilityStatus;
  sources: EnforcementCapabilitySource[];
  assurance: EnforcementCapabilityAssurance;
  summary: string;
  evidence: string[];
}

/** Per-agent enforcement summary attached to audit output without affecting pass/fail status. */
export interface AgentEnforcementCapability {
  agent: string;
  name: string;
  advisory: true;
  capabilities: EnforcementCapability[];
  summary: Record<EnforcementCapabilityStatus, number>;
}

type DenyMechanismEvidenceLevel = "full" | "static" | "present-only";

/** Evidence-mode switches from the audit runner that affect how strongly hook checks can be claimed. */
interface BuildOptions {
  agentScope?: AuditScope;
  denyMechanismEvidenceLevel?: DenyMechanismEvidenceLevel | undefined;
}

const CAPABILITY_LABELS: Record<EnforcementCapabilityId, string> = {
  "shell-dangerous": "Dangerous shell commands",
  "shell-pipe-to-shell": "Pipe-to-shell commands",
  "secret-file-read": "Secret file-read paths",
  "secret-shell-read": "Secret shell-read commands",
  "hook-registration": "Pre-tool hook registration",
  "hook-self-test": "Deny hook self-test",
  "file-read-restrictions": "General file-read restrictions",
  "file-write-restrictions": "General file-write restrictions",
  "provider-native-enforcement": "Provider-native enforcement",
};

/** Classify where a capability's strongest local proof came from for the audit user. */
function classifyEnforcementAssurance(
  sources: readonly EnforcementCapabilitySource[],
): EnforcementCapabilityAssurance {
  // A self-test is the strongest local proof because the audit executed the managed hook surface.
  if (sources.includes("runtime-self-test")) {
    return "runtime-local";
  }
  const includesStaticLocalEvidence =
    sources.includes("local-settings") || sources.includes("local-hook");
  // Local settings or hook facts prove configured structure, not external-agent delivery.
  if (includesStaticLocalEvidence) return "static-local";
  // Provider documentation describes vendor support without proving this checkout's runtime behavior.
  if (sources.includes("provider-docs")) return "provider-documented";
  // Manifest declarations describe goat-flow's expected integration, not a runtime execution result.
  if (sources.includes("manifest")) return "manifest-declared";
  return "not-observed";
}

/** Reject empty or contradictory sources before they become a user-visible capability claim. */
function validateEnforcementSources(
  sources: readonly EnforcementCapabilitySource[],
): void {
  // A capability without a source cannot tell the user why its status was assigned.
  if (sources.length === 0) {
    throw new Error("Enforcement capability evidence requires a source");
  }
  const mixesUnobservedAndConcreteEvidence =
    sources.includes("not-observed") && sources.length > 1;
  // Unobserved evidence cannot be blended with stronger evidence to disguise an unknown result.
  if (mixesUnobservedAndConcreteEvidence) {
    throw new Error("Not-observed enforcement evidence must stand alone");
  }
}

/** Reject a strength badge when its proof class would mislead the user about protection. */
function validateEnforcementStatus(
  status: EnforcementCapabilityStatus,
  assurance: EnforcementCapabilityAssurance,
): void {
  const hasConcreteLocalAssurance =
    assurance === "runtime-local" || assurance === "static-local";

  // A hard badge needs concrete local evidence, never a manifest, provider statement, or absent observation.
  if (status === "hard" && !hasConcreteLocalAssurance) {
    throw new Error(
      "Hard enforcement requires local static or runtime evidence",
    );
  }

  const statusAllowsUnobservedEvidence =
    status === "missing" || status === "unknown";
  // Positive strength labels cannot be built from evidence the audit did not observe.
  if (assurance === "not-observed" && !statusAllowsUnobservedEvidence) {
    throw new Error(
      "Unobserved enforcement evidence requires missing or unknown status",
    );
  }
}

/**
 * Validate and classify one capability's evidence before users compare runner protections.
 * Returns the assurance label rendered beside status, or throws when the evidence would create false parity.
 *
 * @param status - Visible strength or absence; `hard` requires concrete local evidence.
 * @param sources - Non-empty evidence origins; `not-observed` must remain the only source when used.
 * @returns Proof class shown beside the capability, with declarations kept distinct from local execution.
 * @throws When sources are empty, contradictory, or too weak for the requested status.
 */
export function validateEnforcementCapabilityEvidence(
  status: EnforcementCapabilityStatus,
  sources: readonly EnforcementCapabilitySource[],
): EnforcementCapabilityAssurance {
  validateEnforcementSources(sources);
  const assurance = classifyEnforcementAssurance(sources);
  validateEnforcementStatus(status, assurance);

  return assurance;
}

/** Build one validated capability row for terminal, JSON, and dashboard users. */
function capability(
  capabilityId: EnforcementCapabilityId,
  status: EnforcementCapabilityStatus,
  sources: EnforcementCapabilitySource[],
  userSummary: string,
  evidenceAnchors: string[],
): EnforcementCapability {
  return {
    id: capabilityId,
    label: CAPABILITY_LABELS[capabilityId],
    status,
    sources,
    assurance: validateEnforcementCapabilityEvidence(status, sources),
    summary: userSummary,
    evidence: evidenceAnchors,
  };
}

/** Initialize every status counter so dashboard readers never infer missing keys as zero silently. */
function emptySummary(): Record<EnforcementCapabilityStatus, number> {
  return { hard: 0, limited: 0, soft: 0, missing: 0, unknown: 0 };
}

/** Count capability strengths so the dashboard can summarize what the audit observed for a runner. */
function summarize(
  capabilities: EnforcementCapability[],
): Record<EnforcementCapabilityStatus, number> {
  const summary = emptySummary();
  // Each capability contributes exactly once to the runner's visible strength totals.
  for (const enforcementCapability of capabilities) {
    summary[enforcementCapability.status]++;
  }
  return summary;
}

/** Treat settings and registered hooks as active deny mechanisms; a present script alone is not enough. */
function hasActiveMechanicalDeny(agentFacts: AgentFacts): boolean {
  // A configuration-based deny is active without requiring a separate hook file.
  if (agentFacts.hooks.denyIsConfigBased) return true;
  // Settings-backed runners need both matching deny patterns and a compatible deny mechanism.
  if (
    agentFacts.agent.denyMechanism &&
    agentFacts.agent.denyMechanism.type !== "deny-script" &&
    agentFacts.settings.hasDenyPatterns
  ) {
    return true;
  }
  return agentFacts.hooks.denyIsRegistered;
}

/** Describe whether one dangerous shell pattern is mechanically covered for the audited user. */
function shellCapability(
  agentFacts: AgentFacts,
  capabilityId: "shell-dangerous" | "shell-pipe-to-shell",
  dangerousPatternIsCovered: boolean,
  protectedUserSummary: string,
  missingUserSummary: string,
): EnforcementCapability {
  const localDenyMechanismExists =
    agentFacts.hooks.denyExists || agentFacts.hooks.denyIsConfigBased;
  // No local deny surface means the user has no observed protection for this pattern.
  if (!localDenyMechanismExists) {
    return capability(
      capabilityId,
      "missing",
      ["not-observed"],
      missingUserSummary,
      [],
    );
  }
  // A present deny surface still reports missing when its local facts do not cover the pattern.
  if (!dangerousPatternIsCovered) {
    return capability(
      capabilityId,
      "missing",
      ["local-hook"],
      missingUserSummary,
      ["AgentFacts.hooks"],
    );
  }
  // Registered or settings-backed coverage gives the user a hard local protection badge.
  if (hasActiveMechanicalDeny(agentFacts)) {
    return capability(
      capabilityId,
      "hard",
      ["local-hook"],
      protectedUserSummary,
      ["AgentFacts.hooks"],
    );
  }
  return capability(
    capabilityId,
    "limited",
    ["local-hook"],
    `${protectedUserSummary}; hook coverage exists but registration was not proved`,
    ["AgentFacts.hooks.denyIsRegistered"],
  );
}

/** Report file-tool secret protection separately because Bash commands bypass file-read denies. */
function secretFileReadCapability(
  agentFacts: AgentFacts,
): EnforcementCapability {
  // Settings-backed secret-path coverage blocks direct file-tool reads for the user.
  if (agentFacts.hooks.readDenyCoversSecrets) {
    return capability(
      "secret-file-read",
      "hard",
      ["local-settings"],
      "Settings or Codex permission profile deny known secret-bearing file paths",
      ["AgentFacts.hooks.readDenyCoversSecrets"],
    );
  }
  // Script-only runners can cover shell reads but cannot claim the same file-tool protection.
  if (agentFacts.agent.denyMechanism?.type === "deny-script") {
    return capability(
      "secret-file-read",
      "limited",
      ["local-hook"],
      "Script-only deny can block shell reads, but no file-read deny layer is available",
      ["AgentProfile.denyMechanism"],
    );
  }
  return capability(
    "secret-file-read",
    "missing",
    ["not-observed"],
    "No settings or permission-profile secret file-read deny coverage was observed",
    ["AgentFacts.hooks.readDenyCoversSecrets"],
  );
}

/** Report shell secret protection separately because settings-level read denies do not bind Bash. */
function secretShellReadCapability(
  agentFacts: AgentFacts,
): EnforcementCapability {
  // Missing Bash coverage leaves direct terminal reads of known secret paths unprotected.
  if (!agentFacts.hooks.bashDenyCoversSecrets) {
    return capability(
      "secret-shell-read",
      "missing",
      ["local-hook"],
      "Bash deny hook does not prove direct literal secret shell-read blocking",
      ["AgentFacts.hooks.bashDenyCoversSecrets"],
    );
  }
  // Active local coverage gives the user a hard badge for direct literal shell reads.
  if (hasActiveMechanicalDeny(agentFacts)) {
    return capability(
      "secret-shell-read",
      "hard",
      ["local-hook"],
      "Bash deny hook blocks direct literal secret shell-read commands",
      ["AgentFacts.hooks.bashDenyCoversSecrets"],
    );
  }
  return capability(
    "secret-shell-read",
    "limited",
    ["local-hook"],
    "Bash deny hook covers secret shell reads, but hook registration was not proved",
    ["AgentFacts.hooks.denyIsRegistered"],
  );
}

/** Distinguish hook existence from registration so static files are not mistaken for active runtime wiring. */
function hookRegistrationCapability(
  agentFacts: AgentFacts,
): EnforcementCapability {
  // With no settings deny or hook file, the audit has no registration surface to show the user.
  if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsConfigBased) {
    return capability(
      "hook-registration",
      "missing",
      ["not-observed"],
      "No deny mechanism was observed",
      [],
    );
  }
  // Settings-only enforcement is visible but has no shell hook event to register.
  if (agentFacts.hooks.denyIsConfigBased && !agentFacts.hooks.denyExists) {
    return capability(
      "hook-registration",
      "soft",
      ["local-settings"],
      "Settings-based deny exists without a shell hook registration surface",
      ["AgentFacts.hooks.denyIsConfigBased"],
    );
  }
  const preToolEvent = agentFacts.agent.hookEvents?.preTool ?? "pre-tool";
  // A registered pre-tool hook is mechanically wired before the user's command runs.
  if (agentFacts.hooks.denyIsRegistered) {
    return capability(
      "hook-registration",
      "hard",
      ["local-hook"],
      `Deny hook is registered as ${preToolEvent}`,
      ["AgentFacts.hooks.denyIsRegistered"],
    );
  }
  return capability(
    "hook-registration",
    "missing",
    ["local-hook"],
    `Deny hook exists but is not registered as ${preToolEvent}`,
    ["AgentFacts.hooks.denyIsRegistered"],
  );
}

/** Find the guardrail check whose outcome tells users whether the managed self-test ran. */
function denyCheck(
  agentScope: AuditScope | undefined,
): CheckResult | undefined {
  return agentScope?.checks.find((check) => check.id === "agent-guardrails");
}

/** Describe whether this audit executed the managed deny self-test or only inspected static wiring. */
function hookSelfTestCapability(
  agentFacts: AgentFacts,
  options: BuildOptions,
): EnforcementCapability {
  // Without a hook file, there is no managed runtime surface for the audit to exercise.
  if (!agentFacts.hooks.denyExists) {
    return capability(
      "hook-self-test",
      "missing",
      ["not-observed"],
      "No deny hook exists to self-test",
      [],
    );
  }

  const guardrailCheck = denyCheck(options.agentScope);
  // Aggregate or skipped audits must tell the user that no runtime self-test ran.
  if (!guardrailCheck || guardrailCheck.status === "skipped") {
    return capability(
      "hook-self-test",
      "limited",
      ["local-hook"],
      "Deny hook self-test was not run in this aggregate audit context",
      ["agent-guardrails"],
    );
  }
  // A failed guardrail check cannot be presented as usable runtime proof.
  if (guardrailCheck.status === "fail") {
    return capability(
      "hook-self-test",
      "missing",
      ["local-hook"],
      guardrailCheck.failure?.message ??
        "Deny hook self-test or static deny check failed",
      ["agent-guardrails"],
    );
  }
  // Full evidence mode executes the managed self-test and earns runtime-local assurance.
  if (
    options.denyMechanismEvidenceLevel === "full" ||
    options.denyMechanismEvidenceLevel === undefined
  ) {
    return capability(
      "hook-self-test",
      "hard",
      ["runtime-self-test"],
      "Deny hook self-test and runtime-shaped payload smoke passed in this audit run",
      ["agent-guardrails"],
    );
  }
  return capability(
    "hook-self-test",
    "limited",
    ["local-hook"],
    `Deny hook static checks passed, but runtime self-test was skipped in ${options.denyMechanismEvidenceLevel} evidence mode`,
    ["agent-guardrails"],
  );
}

/** Keep provider-native breadth advisory because manifest capability does not prove runtime enforcement. */
function providerNativeCapability(
  agentFacts: AgentFacts,
): EnforcementCapability {
  // A null local mechanism means goat-flow observed no project-local enforcement integration.
  if (agentFacts.agent.denyMechanism === null) {
    return capability(
      "provider-native-enforcement",
      "missing",
      ["manifest"],
      "Manifest records no project-local deny mechanism for this agent",
      ["AgentProfile.denyMechanism"],
    );
  }
  const configuredDenyMechanism = agentFacts.agent.denyMechanism.type;
  // Script-only integration says nothing stronger about the provider's native permissions.
  if (configuredDenyMechanism === "deny-script") {
    return capability(
      "provider-native-enforcement",
      "limited",
      ["manifest"],
      "Manifest records script-only deny; provider-native breadth was not claimed",
      ["AgentProfile.denyMechanism"],
    );
  }
  // Combined local settings and hooks still do not prove provider-native breadth.
  if (configuredDenyMechanism === "both") {
    return capability(
      "provider-native-enforcement",
      "limited",
      ["manifest"],
      "Manifest records settings plus script deny; provider-native breadth was not verified",
      ["AgentProfile.denyMechanism"],
    );
  }
  return capability(
    "provider-native-enforcement",
    "soft",
    ["manifest"],
    "Manifest records settings-based deny; provider-native breadth was not verified",
    ["AgentProfile.denyMechanism"],
  );
}

/** Keep broad filesystem capability unknown until a dedicated local proof observes it. */
function broadFilesystemCapability(
  id: "file-read-restrictions" | "file-write-restrictions",
): EnforcementCapability {
  return capability(
    id,
    "unknown",
    ["not-observed"],
    "Not inferred from secret-path coverage, hook installation, or setup pass",
    [],
  );
}

/**
 * Build the advisory enforcement matrix for one agent.
 *
 * @param agentFacts Extracted local facts for the audited agent.
 * @param options Evidence-mode switches from the current audit run.
 * @returns Non-gating enforcement capability report for audit and dashboard output.
 */
export function buildAgentEnforcementCapability(
  agentFacts: AgentFacts,
  options: BuildOptions = {},
): AgentEnforcementCapability {
  const capabilities: EnforcementCapability[] = [
    shellCapability(
      agentFacts,
      "shell-dangerous",
      agentFacts.hooks.denyBlocksRmRf &&
        agentFacts.hooks.denyBlocksGitPush &&
        agentFacts.hooks.denyBlocksChmod,
      "Deny mechanism blocks broad recursive deletion, git push, and chmod 777 patterns",
      "Deny mechanism does not prove coverage for broad recursive deletion, git push, and chmod 777",
    ),
    shellCapability(
      agentFacts,
      "shell-pipe-to-shell",
      agentFacts.hooks.denyBlocksPipeToShell,
      "Deny mechanism blocks curl|bash and wget|sh style pipe-to-shell patterns",
      "Deny mechanism does not prove pipe-to-shell blocking",
    ),
    secretFileReadCapability(agentFacts),
    secretShellReadCapability(agentFacts),
    hookRegistrationCapability(agentFacts),
    hookSelfTestCapability(agentFacts, options),
    broadFilesystemCapability("file-read-restrictions"),
    broadFilesystemCapability("file-write-restrictions"),
    providerNativeCapability(agentFacts),
  ];

  return {
    agent: agentFacts.agent.id,
    name: agentFacts.agent.name,
    advisory: true,
    capabilities,
    summary: summarize(capabilities),
  };
}

/**
 * Build the advisory enforcement matrix for every audited agent.
 *
 * @param agents Extracted local facts for all agents included in the audit.
 * @param options Evidence-mode switches from the current audit run.
 * @returns Non-gating enforcement reports in the same order as the input agents.
 */
export function buildEnforcementMatrix(
  agents: AgentFacts[],
  options: BuildOptions = {},
): AgentEnforcementCapability[] {
  return agents.map((agent) => buildAgentEnforcementCapability(agent, options));
}
