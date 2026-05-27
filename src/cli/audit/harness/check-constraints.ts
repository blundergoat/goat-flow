/**
 * Constraints concern: Do deterministic rules catch failures before the LLM runs?
 * 4 checks: deny-covers-secrets, deny-blocks-dangerous, deny-blocks-pipe-to-shell,
 * deny-hook-registered.
 */
import type {
  AuditContext,
  HarnessCheck,
  HarnessCheckDetails,
} from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-19";

/** Return the constraints provenance. */
function constraintsProvenance(
  type: HarnessCheck["type"],
  paths: string[],
  sourceType: CheckEvidence["source_type"] = "spec",
): CheckEvidence {
  return {
    source_type: sourceType,
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level:
      type === "integrity"
        ? "MUST"
        : type === "advisory"
          ? "SHOULD"
          : "BEST_PRACTICE",
    evidence_paths: paths,
  };
}

/** Classify each agent by whether BOTH its file-read deny rules AND its Bash
 *  deny hook block direct literal secret-path access. Settings/Codex permission
 *  profile file-read rules do not cover Bash shell reads (cat/source/base64/etc.),
 *  so Bash-side direct-path coverage is required for any non-script-only agent.
 *
 *  Uncovered agents are split by deny mechanism so remediation guidance stays
 *  accurate: script-only agents (Copilot etc.) have no file-read deny layer, so
 *  they must be told to extend the Bash hook only. */
function classifySecretDeny(ctx: Pick<AuditContext, "agents">) {
  const covered: string[] = [];
  const scriptOnly: string[] = [];
  const uncoveredSettings: string[] = [];
  const uncoveredScript: string[] = [];
  for (const agentFacts of ctx.agents) {
    // Capability-limited agents (no deny mechanism documented upstream) are
    // skipped from secret-deny classification entirely.
    if (agentFacts.agent.denyMechanism === null) continue;
    const bashOk = agentFacts.hooks.bashDenyCoversSecrets;
    const readOk = agentFacts.hooks.readDenyCoversSecrets;
    const isScriptOnly = agentFacts.agent.denyMechanism.type === "deny-script";

    if (isScriptOnly) {
      // Script-only agents (e.g. Copilot) rely entirely on the Bash hook.
      if (bashOk) {
        scriptOnly.push(agentFacts.agent.id);
      } else {
        uncoveredScript.push(agentFacts.agent.id);
      }
    } else {
      // Settings-based agents need BOTH file-read deny AND Bash hook coverage.
      if (readOk && bashOk) {
        covered.push(agentFacts.agent.id);
      } else {
        uncoveredSettings.push(agentFacts.agent.id);
      }
    }
  }
  return { covered, scriptOnly, uncoveredSettings, uncoveredScript };
}

function secretDenyDetails(
  agents: AuditContext["agents"],
): HarnessCheckDetails {
  return {
    denyMatrix: agents.map((agentFacts) => {
      const missingPatterns: string[] = [];
      const isScriptOnly =
        agentFacts.agent.denyMechanism?.type === "deny-script";
      if (
        agentFacts.agent.denyMechanism !== null &&
        !isScriptOnly &&
        !agentFacts.hooks.readDenyCoversSecrets
      ) {
        missingPatterns.push("file-read-secret-paths");
      }
      if (!agentFacts.hooks.bashDenyCoversSecrets) {
        missingPatterns.push("bash-secret-paths");
      }
      return {
        agent: agentFacts.agent.id,
        missingPatterns,
        extraPatterns: [],
        hookRegistered: agentFacts.hooks.denyIsRegistered,
      };
    }),
  };
}

function pipeToShellDetails(
  agents: AuditContext["agents"],
): HarnessCheckDetails {
  return {
    denyMatrix: agents.map((agentFacts) => ({
      agent: agentFacts.agent.id,
      missingPatterns: agentFacts.hooks.denyBlocksPipeToShell
        ? []
        : ["pipe-to-shell"],
      extraPatterns: [],
      hookRegistered: agentFacts.hooks.denyIsRegistered,
    })),
  };
}

function denyRegistrationDetails(
  agents: AuditContext["agents"],
  unregistered: string[],
  noDeny: string[],
  pathMismatch: string[],
): HarnessCheckDetails {
  return {
    denyMatrix: agents.map((agentFacts) => {
      const missingPatterns: string[] = [];
      if (unregistered.includes(agentFacts.agent.id)) {
        missingPatterns.push("deny-hook-registration");
      }
      if (noDeny.includes(agentFacts.agent.id))
        missingPatterns.push("deny-hook");
      if (pathMismatch.includes(agentFacts.agent.id)) {
        missingPatterns.push("deny-hook-path");
      }
      return {
        agent: agentFacts.agent.id,
        missingPatterns,
        extraPatterns: [],
        hookRegistered: agentFacts.hooks.denyIsRegistered,
      };
    }),
  };
}

const denyCoversSecrets: HarnessCheck = {
  id: "deny-covers-secrets",
  name: "Deny blocks direct literal secret paths",
  concern: "constraints",
  type: "integrity",
  provenance: constraintsProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/auditor.md",
  ]),
  /** Run the Deny blocks direct literal secret paths check. */
  run: (ctx) => {
    const { covered, scriptOnly, uncoveredSettings, uncoveredScript } =
      classifySecretDeny(ctx);
    const details = secretDenyDetails(ctx.agents);

    const anyUncovered =
      uncoveredSettings.length > 0 || uncoveredScript.length > 0;

    if (covered.length === 0 && !anyUncovered) {
      // All agents are script-only and covered - platform limitation, not a failure
      return {
        ...pass(
          [
            "Limited assurance: no agents support file-read deny patterns",
            ...scriptOnly.map(
              (id) =>
                `${id}: limited assurance - script-only deny; Bash hook blocks direct literal secret paths, but file-read deny is unavailable`,
            ),
          ],
          details,
        ),
        displayStatus: "info",
        assurance: "limited",
      };
    }
    const findings: string[] = [];
    if (covered.length > 0) {
      findings.push(
        `${covered.join(", ")}: file-read deny + Bash hook both block direct literal secret paths`,
      );
    }
    if (scriptOnly.length > 0) {
      findings.push(
        ...scriptOnly.map(
          (id) =>
            `${id}: limited assurance - script-only deny; Bash hook blocks direct literal secret paths, but file-read deny is unavailable`,
        ),
      );
    }
    if (!anyUncovered) {
      const result = pass(findings, details);
      if (scriptOnly.length === 0) return result;
      return { ...result, displayStatus: "info", assurance: "limited" };
    }

    const recs: string[] = [];
    const fixes: string[] = [];
    if (uncoveredSettings.length > 0) {
      findings.push(
        `${uncoveredSettings.join(", ")}: direct literal secret-path blocking incomplete (file-read deny and/or Bash hook pattern is missing)`,
      );
      recs.push(
        `Add direct literal secret-path blocking to ${uncoveredSettings.join(", ")}: settings/Codex permission file-read patterns for .env / .ssh / .aws / .pem / .key, AND the Bash deny hook must block cat/source/base64/etc. on the same literal paths.`,
      );
      fixes.push(
        `${uncoveredSettings.join(", ")}: extend the agent file-read deny layer with .env, .ssh, .aws, credentials, *.key, *.pem AND add an is_secret_path_touch (or equivalent) check in the Bash deny hook. File-read deny alone does not bind Bash shell reads.`,
      );
    }
    if (uncoveredScript.length > 0) {
      findings.push(
        `${uncoveredScript.join(", ")}: Bash deny hook does not block direct literal secret paths (script-only agent - no file-read deny layer applies)`,
      );
      recs.push(
        `Add direct literal secret-path blocking to the Bash deny hook for ${uncoveredScript.join(", ")}: block cat/source/base64/etc. on .env, .ssh, .aws, credentials, *.key, *.pem.`,
      );
      fixes.push(
        `${uncoveredScript.join(", ")}: add an is_secret_path_touch (or equivalent) check in the Bash deny hook. Script-only agents have no file-read deny surface; the Bash hook is the only enforcement layer.`,
      );
    }
    return fail(findings, recs, fixes, details);
  },
};

const denyBlocksDangerous: HarnessCheck = {
  id: "deny-blocks-dangerous",
  name: "Deny blocks dangerous commands",
  concern: "constraints",
  type: "integrity",
  provenance: constraintsProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/auditor.md",
    ".goat-flow/footguns/hooks.md",
  ]),
  /** Run the Deny blocks dangerous commands check. */
  run: (ctx) => {
    if (ctx.agents.length === 0) {
      return fail(["No agents to check"], ["Configure at least one agent"]);
    }
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    const denyMatrix: NonNullable<HarnessCheckDetails["denyMatrix"]> = [];
    let hasDangerousDenyGap = false;
    for (const agentFacts of ctx.agents) {
      const { denyBlocksRmRf, denyBlocksGitPush, denyBlocksChmod } =
        agentFacts.hooks;
      const missingPatterns: string[] = [];
      if (!denyBlocksRmRf) missingPatterns.push("broad rm -r");
      if (!denyBlocksGitPush) missingPatterns.push("git-push");
      if (!denyBlocksChmod) missingPatterns.push("chmod");
      denyMatrix.push({
        agent: agentFacts.agent.id,
        missingPatterns,
        extraPatterns: [],
        hookRegistered: agentFacts.hooks.denyIsRegistered,
      });
      if (missingPatterns.length === 0) {
        findings.push(
          `${agentFacts.agent.id}: deny blocks broad rm -r, git-push, chmod`,
        );
      } else {
        hasDangerousDenyGap = true;
        findings.push(
          `${agentFacts.agent.id}: deny missing coverage for ${missingPatterns.join(", ")}`,
        );
        recs.push(
          `Add deny patterns for ${missingPatterns.join(", ")} to ${agentFacts.agent.id}`,
        );
        fixes.push(
          `Add deny patterns for ${missingPatterns.join(", ")} in ${agentFacts.agent.id} agent configuration.`,
        );
      }
    }
    if (hasDangerousDenyGap) return fail(findings, recs, fixes, { denyMatrix });
    return pass(findings, { denyMatrix });
  },
};

const denyBlocksPipeToShell: HarnessCheck = {
  id: "deny-blocks-pipe-to-shell",
  name: "Deny blocks pipe-to-shell",
  concern: "constraints",
  type: "advisory",
  provenance: constraintsProvenance(
    "advisory",
    [
      "docs/harness-audit.md",
      ".goat-flow/footguns/auditor.md",
      ".goat-flow/footguns/hooks.md",
    ],
    "incident",
  ),
  /** Run the Deny blocks pipe-to-shell check. */
  run: (ctx) => {
    const covered: string[] = [];
    const uncovered: string[] = [];
    const details = pipeToShellDetails(ctx.agents);
    for (const agentFacts of ctx.agents) {
      if (agentFacts.hooks.denyBlocksPipeToShell) {
        covered.push(agentFacts.agent.id);
      } else {
        uncovered.push(agentFacts.agent.id);
      }
    }
    if (uncovered.length === 0) {
      return pass(
        [`${covered.join(", ")}: deny blocks pipe-to-shell (curl | bash)`],
        details,
      );
    }
    if (covered.length === 0) {
      return fail(
        ["No agents block pipe-to-shell pattern (curl | bash)"],
        ["Add deny pattern for pipe-to-shell commands"],
        [
          "Add a deny pattern matching curl|bash and wget|sh in agent deny configuration.",
        ],
        details,
      );
    }
    return fail(
      [`${uncovered.join(", ")}: pipe-to-shell not blocked`],
      [`Add pipe-to-shell deny pattern to ${uncovered.join(", ")}`],
      [
        `Add deny patterns for curl|bash and wget|sh to ${uncovered.join(", ")} agent configuration.`,
      ],
      details,
    );
  },
};

function findAgent(
  agents: AuditContext["agents"],
  id: string,
): AuditContext["agents"][number] | undefined {
  return agents.find((agentFacts) => agentFacts.agent.id === id);
}

/**
 * Group deny-hook registration states for remediation.
 *
 * A missing hook, an unregistered hook, and a registered-but-wrong path all need
 * different fix text; keeping these buckets separate avoids telling users to
 * register a hook that does not exist or to recreate one that is only miswired.
 */
function classifyDenyRegistration(agents: AuditContext["agents"]): {
  registered: string[];
  unregistered: string[];
  noDeny: string[];
  pathMismatch: string[];
} {
  const registered: string[] = [];
  const unregistered: string[] = [];
  const noDeny: string[] = [];
  const pathMismatch: string[] = [];
  for (const agentFacts of agents) {
    if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsConfigBased) {
      noDeny.push(agentFacts.agent.id);
      continue;
    }
    if (agentFacts.hooks.denyIsRegistered) {
      registered.push(agentFacts.agent.id);
      const expected = agentFacts.agent.denyHookFile;
      const actual = agentFacts.hooks.denyRegisteredPath;
      if (expected && actual && !actual.endsWith(expected)) {
        pathMismatch.push(agentFacts.agent.id);
      }
    } else {
      unregistered.push(agentFacts.agent.id);
    }
  }
  return { registered, unregistered, noDeny, pathMismatch };
}

function buildDenyRegistrationFailure(
  agents: AuditContext["agents"],
  registered: string[],
  unregistered: string[],
  noDeny: string[],
  pathMismatch: string[],
) {
  const findings = [
    ...registered
      .filter((id) => !pathMismatch.includes(id))
      .map(
        (id) =>
          `${id}: deny hook registered as ${findAgent(agents, id)?.agent.hookEvents?.preTool ?? "pre-tool"} hook`,
      ),
    ...pathMismatch.map((id) => {
      const agentFacts = findAgent(agents, id);
      return `${id}: registered hook path "${agentFacts?.hooks.denyRegisteredPath}" does not match expected deny hook "${agentFacts?.agent.denyHookFile}"`;
    }),
    ...unregistered.map(
      (id) =>
        `${id}: deny hook exists but is NOT registered as a ${findAgent(agents, id)?.agent.hookEvents?.preTool ?? "pre-tool"} hook`,
    ),
  ];
  const actions = [
    ...unregistered.map(
      (id) => `Register the deny hook in ${id} agent settings`,
    ),
    ...pathMismatch.map(
      (id) =>
        `Fix ${id} hook registration to point at the canonical deny hook (${findAgent(agents, id)?.agent.denyHookFile})`,
    ),
  ];
  return fail(
    findings,
    actions,
    [
      ...unregistered.map(
        (id) =>
          `Add a ${findAgent(agents, id)?.agent.hookEvents?.preTool ?? "PreToolUse"} hook entry in ${id} agent settings that runs guard-repository-writes.sh.`,
      ),
      ...pathMismatch.map(
        (id) =>
          `Update the ${findAgent(agents, id)?.agent.hookEvents?.preTool ?? "PreToolUse"} hook in ${id} to reference ${findAgent(agents, id)?.agent.denyHookFile}.`,
      ),
    ],
    denyRegistrationDetails(agents, unregistered, noDeny, pathMismatch),
  );
}

const denyHookRegistered: HarnessCheck = {
  id: "deny-hook-registered",
  name: "Deny hook registered in agent settings",
  concern: "constraints",
  type: "integrity",
  provenance: constraintsProvenance(
    "integrity",
    ["docs/harness-audit.md", ".goat-flow/footguns/auditor.md"],
    "incident",
  ),
  run: (ctx) => {
    const { registered, unregistered, noDeny, pathMismatch } =
      classifyDenyRegistration(ctx.agents);

    if (unregistered.length > 0 || pathMismatch.length > 0) {
      return buildDenyRegistrationFailure(
        ctx.agents,
        registered,
        unregistered,
        noDeny,
        pathMismatch,
      );
    }
    const findings = [
      ...registered.map(
        (id) =>
          `${id}: deny hook registered as ${findAgent(ctx.agents, id)?.agent.hookEvents?.preTool ?? "pre-tool"} hook`,
      ),
      ...noDeny.map(
        (id) => `${id}: no deny mechanism (registration check skipped)`,
      ),
    ];
    return pass(
      findings.length > 0 ? findings : ["No agents with deny hooks to check"],
      denyRegistrationDetails(ctx.agents, unregistered, noDeny, pathMismatch),
    );
  },
};

export const CONSTRAINTS_CHECKS: HarnessCheck[] = [
  denyCoversSecrets,
  denyBlocksDangerous,
  denyBlocksPipeToShell,
  denyHookRegistered,
];
