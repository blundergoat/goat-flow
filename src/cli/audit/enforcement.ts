/**
 * Advisory per-agent enforcement capability matrix.
 *
 * This summarizes what goat-flow can prove from local facts. It must not turn
 * structural setup checks into broader runtime-enforcement claims.
 */
import type { AgentFacts } from "../types.js";
import type { AuditScope, CheckResult } from "./types.js";

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

interface EnforcementCapability {
  id: EnforcementCapabilityId;
  label: string;
  status: EnforcementCapabilityStatus;
  sources: EnforcementCapabilitySource[];
  summary: string;
  evidence: string[];
}

export interface AgentEnforcementCapability {
  agent: string;
  name: string;
  advisory: true;
  capabilities: EnforcementCapability[];
  summary: Record<EnforcementCapabilityStatus, number>;
}

type DenyMechanismEvidenceLevel = "full" | "static" | "present-only";

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

function emptySummary(): Record<EnforcementCapabilityStatus, number> {
  return { hard: 0, limited: 0, soft: 0, missing: 0, unknown: 0 };
}

function summarize(
  capabilities: EnforcementCapability[],
): Record<EnforcementCapabilityStatus, number> {
  const summary = emptySummary();
  for (const item of capabilities) {
    summary[item.status]++;
  }
  return summary;
}

function hasActiveMechanicalDeny(af: AgentFacts): boolean {
  if (af.hooks.denyIsConfigBased) return true;
  if (
    af.agent.denyMechanism.type !== "deny-script" &&
    af.settings.hasDenyPatterns
  ) {
    return true;
  }
  return af.hooks.denyIsRegistered;
}

function shellCapability(
  af: AgentFacts,
  id: "shell-dangerous" | "shell-pipe-to-shell",
  covered: boolean,
  coveredSummary: string,
  missingSummary: string,
): EnforcementCapability {
  const denyExists = af.hooks.denyExists || af.hooks.denyIsConfigBased;
  if (!denyExists) {
    return capability(id, "missing", ["not-observed"], missingSummary, []);
  }
  if (!covered) {
    return capability(id, "missing", ["local-hook"], missingSummary, [
      "AgentFacts.hooks",
    ]);
  }
  if (hasActiveMechanicalDeny(af)) {
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

function secretFileReadCapability(af: AgentFacts): EnforcementCapability {
  if (af.hooks.readDenyCoversSecrets) {
    return capability(
      "secret-file-read",
      "hard",
      ["local-settings"],
      "Settings or Codex permission profile deny known secret-bearing file paths",
      ["AgentFacts.hooks.readDenyCoversSecrets"],
    );
  }
  if (af.agent.denyMechanism.type === "deny-script") {
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

function secretShellReadCapability(af: AgentFacts): EnforcementCapability {
  if (!af.hooks.bashDenyCoversSecrets) {
    return capability(
      "secret-shell-read",
      "missing",
      ["local-hook"],
      "Bash deny hook does not prove direct literal secret shell-read blocking",
      ["AgentFacts.hooks.bashDenyCoversSecrets"],
    );
  }
  if (hasActiveMechanicalDeny(af)) {
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

function hookRegistrationCapability(af: AgentFacts): EnforcementCapability {
  if (!af.hooks.denyExists && !af.hooks.denyIsConfigBased) {
    return capability(
      "hook-registration",
      "missing",
      ["not-observed"],
      "No deny mechanism was observed",
      [],
    );
  }
  if (af.hooks.denyIsConfigBased && !af.hooks.denyExists) {
    return capability(
      "hook-registration",
      "soft",
      ["local-settings"],
      "Settings-based deny exists without a shell hook registration surface",
      ["AgentFacts.hooks.denyIsConfigBased"],
    );
  }
  if (af.hooks.denyIsRegistered) {
    return capability(
      "hook-registration",
      "hard",
      ["local-hook"],
      `Deny hook is registered as ${af.agent.hookEvents.preTool}`,
      ["AgentFacts.hooks.denyIsRegistered"],
    );
  }
  return capability(
    "hook-registration",
    "missing",
    ["local-hook"],
    `Deny hook exists but is not registered as ${af.agent.hookEvents.preTool}`,
    ["AgentFacts.hooks.denyIsRegistered"],
  );
}

function denyCheck(
  agentScope: AuditScope | undefined,
): CheckResult | undefined {
  return agentScope?.checks.find(
    (check) => check.id === "agent-deny-dangerous",
  );
}

function hookSelfTestCapability(
  af: AgentFacts,
  options: BuildOptions,
): EnforcementCapability {
  if (!af.hooks.denyExists) {
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
      ["agent-deny-dangerous"],
    );
  }
  if (check.status === "fail") {
    return capability(
      "hook-self-test",
      "missing",
      ["local-hook"],
      check.failure?.message ??
        "Deny hook self-test or static deny check failed",
      ["agent-deny-dangerous"],
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
      "Deny hook smoke self-test passed in this audit run",
      ["agent-deny-dangerous"],
    );
  }
  return capability(
    "hook-self-test",
    "limited",
    ["local-hook"],
    `Deny hook static checks passed, but runtime self-test was skipped in ${options.denyMechanismEvidenceLevel} evidence mode`,
    ["agent-deny-dangerous"],
  );
}

function providerNativeCapability(af: AgentFacts): EnforcementCapability {
  const mechanism = af.agent.denyMechanism.type;
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

/** Build the advisory enforcement matrix for one agent. */
export function buildAgentEnforcementCapability(
  af: AgentFacts,
  options: BuildOptions = {},
): AgentEnforcementCapability {
  const capabilities: EnforcementCapability[] = [
    shellCapability(
      af,
      "shell-dangerous",
      af.hooks.denyBlocksRmRf &&
        af.hooks.denyBlocksGitPush &&
        af.hooks.denyBlocksChmod,
      "Deny mechanism blocks broad recursive deletion, git push, and chmod 777 patterns",
      "Deny mechanism does not prove coverage for broad recursive deletion, git push, and chmod 777",
    ),
    shellCapability(
      af,
      "shell-pipe-to-shell",
      af.hooks.denyBlocksPipeToShell,
      "Deny mechanism blocks curl|bash and wget|sh style pipe-to-shell patterns",
      "Deny mechanism does not prove pipe-to-shell blocking",
    ),
    secretFileReadCapability(af),
    secretShellReadCapability(af),
    hookRegistrationCapability(af),
    hookSelfTestCapability(af, options),
    broadFilesystemCapability("file-read-restrictions"),
    broadFilesystemCapability("file-write-restrictions"),
    providerNativeCapability(af),
  ];

  return {
    agent: af.agent.id,
    name: af.agent.name,
    advisory: true,
    capabilities,
    summary: summarize(capabilities),
  };
}

/** Build the advisory enforcement matrix for every audited agent. */
export function buildEnforcementMatrix(
  agents: AgentFacts[],
  options: BuildOptions = {},
): AgentEnforcementCapability[] {
  return agents.map((agent) => buildAgentEnforcementCapability(agent, options));
}
