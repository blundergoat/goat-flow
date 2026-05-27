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
  | "hard"
  | "limited"
  | "soft"
  | "missing"
  | "unknown";

type EnforcementCapabilitySource =
  | "local-settings"
  | "local-hook"
  | "runtime-self-test"
  | "manifest"
  | "provider-docs"
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
  denyMechanismEvidenceLevel?: DenyMechanismEvidenceLevel;
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

function capability(
  id: EnforcementCapabilityId,
  status: EnforcementCapabilityStatus,
  sources: EnforcementCapabilitySource[],
  summary: string,
  evidence: string[],
): EnforcementCapability {
  return {
    id,
    label: CAPABILITY_LABELS[id],
    status,
    sources,
    summary,
    evidence,
  };
}

/** Initialize every status counter so dashboard readers never infer missing keys as zero silently. */
function emptySummary(): Record<EnforcementCapabilityStatus, number> {
  return { hard: 0, limited: 0, soft: 0, missing: 0, unknown: 0 };
}

function summarize(
  capabilities: EnforcementCapability[],
): Record<EnforcementCapabilityStatus, number> {
  const summary = emptySummary();
  for (const enforcementCapability of capabilities) {
    summary[enforcementCapability.status]++;
  }
  return summary;
}

/** Treat settings and registered hooks as active deny mechanisms; a present script alone is not enough. */
function hasActiveMechanicalDeny(agentFacts: AgentFacts): boolean {
  if (agentFacts.hooks.denyIsConfigBased) return true;
  if (
    agentFacts.agent.denyMechanism &&
    agentFacts.agent.denyMechanism.type !== "deny-script" &&
    agentFacts.settings.hasDenyPatterns
  ) {
    return true;
  }
  return agentFacts.hooks.denyIsRegistered;
}

function shellCapability(
  agentFacts: AgentFacts,
  id: "shell-dangerous" | "shell-pipe-to-shell",
  covered: boolean,
  coveredSummary: string,
  missingSummary: string,
): EnforcementCapability {
  const denyExists =
    agentFacts.hooks.denyExists || agentFacts.hooks.denyIsConfigBased;
  if (!denyExists) {
    return capability(id, "missing", ["not-observed"], missingSummary, []);
  }
  if (!covered) {
    return capability(id, "missing", ["local-hook"], missingSummary, [
      "AgentFacts.hooks",
    ]);
  }
  if (hasActiveMechanicalDeny(agentFacts)) {
    return capability(id, "hard", ["local-hook"], coveredSummary, [
      "AgentFacts.hooks",
    ]);
  }
  return capability(
    id,
    "limited",
    ["local-hook"],
    `${coveredSummary}; hook coverage exists but registration was not proved`,
    ["AgentFacts.hooks.denyIsRegistered"],
  );
}

/** Report file-tool secret protection separately because Bash commands bypass file-read denies. */
function secretFileReadCapability(
  agentFacts: AgentFacts,
): EnforcementCapability {
  if (agentFacts.hooks.readDenyCoversSecrets) {
    return capability(
      "secret-file-read",
      "hard",
      ["local-settings"],
      "Settings or Codex permission profile deny known secret-bearing file paths",
      ["AgentFacts.hooks.readDenyCoversSecrets"],
    );
  }
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
  if (!agentFacts.hooks.bashDenyCoversSecrets) {
    return capability(
      "secret-shell-read",
      "missing",
      ["local-hook"],
      "Bash deny hook does not prove direct literal secret shell-read blocking",
      ["AgentFacts.hooks.bashDenyCoversSecrets"],
    );
  }
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
  if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsConfigBased) {
    return capability(
      "hook-registration",
      "missing",
      ["not-observed"],
      "No deny mechanism was observed",
      [],
    );
  }
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

function denyCheck(
  agentScope: AuditScope | undefined,
): CheckResult | undefined {
  return agentScope?.checks.find((check) => check.id === "agent-guardrails");
}

function hookSelfTestCapability(
  agentFacts: AgentFacts,
  options: BuildOptions,
): EnforcementCapability {
  if (!agentFacts.hooks.denyExists) {
    return capability(
      "hook-self-test",
      "missing",
      ["not-observed"],
      "No deny hook exists to self-test",
      [],
    );
  }

  const check = denyCheck(options.agentScope);
  if (!check || check.status === "skipped") {
    return capability(
      "hook-self-test",
      "limited",
      ["local-hook"],
      "Deny hook self-test was not run in this aggregate audit context",
      ["agent-guardrails"],
    );
  }
  if (check.status === "fail") {
    return capability(
      "hook-self-test",
      "missing",
      ["local-hook"],
      check.failure?.message ??
        "Deny hook self-test or static deny check failed",
      ["agent-guardrails"],
    );
  }
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
  if (agentFacts.agent.denyMechanism === null) {
    return capability(
      "provider-native-enforcement",
      "missing",
      ["manifest"],
      "Manifest records no project-local deny mechanism for this agent",
      ["AgentProfile.denyMechanism"],
    );
  }
  const mechanism = agentFacts.agent.denyMechanism.type;
  if (mechanism === "deny-script") {
    return capability(
      "provider-native-enforcement",
      "limited",
      ["manifest"],
      "Manifest records script-only deny; provider-native breadth was not claimed",
      ["AgentProfile.denyMechanism"],
    );
  }
  if (mechanism === "both") {
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
