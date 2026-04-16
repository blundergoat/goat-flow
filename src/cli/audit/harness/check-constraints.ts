/**
 * Constraints concern: Do deterministic rules catch failures before the LLM runs?
 * 3 checks: deny-covers-secrets, deny-blocks-dangerous, deny-blocks-pipe-to-shell.
 */
import type { HarnessCheck, AuditContext } from "../types.js";
import { pass, fail } from "./helpers.js";

function classifySecretDeny(ctx: Pick<AuditContext, "agents">) {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const scriptOnly: string[] = [];
  for (const af of ctx.agents) {
    if (af.hooks.readDenyCoversSecrets) {
      covered.push(af.agent.id);
    } else if (af.agent.denyMechanism.type === "deny-script") {
      scriptOnly.push(af.agent.id);
    } else {
      uncovered.push(af.agent.id);
    }
  }
  return { covered, uncovered, scriptOnly };
}

const denyCoversSecrets: HarnessCheck = {
  id: "deny-covers-secrets",
  name: "Deny covers secret files",
  concern: "constraints",
  run: (ctx) => {
    const { covered, uncovered, scriptOnly } = classifySecretDeny(ctx);

    if (covered.length === 0 && uncovered.length === 0) {
      // All agents are script-only - platform limitation, not a failure
      return pass([
        "No agents support settings-based deny patterns",
        ...scriptOnly.map(
          (id) =>
            `${id}: script-based deny only - file-read deny not available`,
        ),
      ]);
    }
    const findings: string[] = [];
    if (covered.length > 0) {
      findings.push(`${covered.join(", ")}: deny patterns cover secrets`);
    }
    if (scriptOnly.length > 0) {
      findings.push(
        `${scriptOnly.join(", ")}: script-based deny only - file-read deny not available`,
      );
    }
    if (uncovered.length > 0) {
      findings.push(
        `${uncovered.join(", ")}: deny patterns missing secret file coverage`,
      );
      return fail(
        findings,
        [
          `Add deny patterns for .env, credentials, and key files to ${uncovered.join(", ")}`,
        ],
        [
          `Add deny patterns for .env, .credentials, *.key, and *.pem files to ${uncovered.join(", ")} agent configuration.`,
        ],
      );
    }
    return pass(findings);
  },
};

const denyBlocksDangerous: HarnessCheck = {
  id: "deny-blocks-dangerous",
  name: "Deny blocks dangerous commands",
  concern: "constraints",
  run: (ctx) => {
    if (ctx.agents.length === 0) {
      return fail(["No agents to check"], ["Configure at least one agent"]);
    }
    const findings: string[] = [];
    const recs: string[] = [];
    const fixes: string[] = [];
    let anyFail = false;
    for (const af of ctx.agents) {
      const { denyBlocksRmRf, denyBlocksForcePush, denyBlocksChmod } = af.hooks;
      if (denyBlocksRmRf && denyBlocksForcePush && denyBlocksChmod) {
        findings.push(`${af.agent.id}: deny blocks rm -rf, force-push, chmod`);
      } else {
        anyFail = true;
        const missing: string[] = [];
        if (!denyBlocksRmRf) missing.push("rm -rf");
        if (!denyBlocksForcePush) missing.push("force-push");
        if (!denyBlocksChmod) missing.push("chmod");
        findings.push(
          `${af.agent.id}: deny missing coverage for ${missing.join(", ")}`,
        );
        recs.push(
          `Add deny patterns for ${missing.join(", ")} to ${af.agent.id}`,
        );
        fixes.push(
          `Add deny patterns for ${missing.join(", ")} in ${af.agent.id} agent configuration.`,
        );
      }
    }
    if (anyFail) return fail(findings, recs, fixes);
    return pass(findings);
  },
};

const denyBlocksPipeToShell: HarnessCheck = {
  id: "deny-blocks-pipe-to-shell",
  name: "Deny blocks pipe-to-shell",
  concern: "constraints",
  run: (ctx) => {
    const covered: string[] = [];
    const uncovered: string[] = [];
    for (const af of ctx.agents) {
      if (af.hooks.denyBlocksPipeToShell) {
        covered.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    }
    if (uncovered.length === 0) {
      return pass([
        `${covered.join(", ")}: deny blocks pipe-to-shell (curl | bash)`,
      ]);
    }
    if (covered.length === 0) {
      return fail(
        ["No agents block pipe-to-shell pattern (curl | bash)"],
        ["Add deny pattern for pipe-to-shell commands"],
        [
          "Add a deny pattern matching curl|bash and wget|sh in agent deny configuration.",
        ],
      );
    }
    return fail(
      [`${uncovered.join(", ")}: pipe-to-shell not blocked`],
      [`Add pipe-to-shell deny pattern to ${uncovered.join(", ")}`],
      [
        `Add deny patterns for curl|bash and wget|sh to ${uncovered.join(", ")} agent configuration.`,
      ],
    );
  },
};

const denyHookRegistered: HarnessCheck = {
  id: "deny-hook-registered",
  name: "Deny hook registered in agent settings",
  concern: "constraints",
  run: (ctx) => {
    const registered: string[] = [];
    const unregistered: string[] = [];
    const noDeny: string[] = [];
    for (const af of ctx.agents) {
      if (!af.hooks.denyExists && !af.hooks.denyIsConfigBased) {
        noDeny.push(af.agent.id);
        continue;
      }
      if (af.hooks.denyIsRegistered) {
        registered.push(af.agent.id);
      } else {
        unregistered.push(af.agent.id);
      }
    }
    if (unregistered.length > 0) {
      return fail(
        [
          ...registered.map(
            (id) =>
              `${id}: deny hook registered as ${ctx.agents.find((a) => a.agent.id === id)?.agent.hookEvents.preTool ?? "pre-tool"} hook`,
          ),
          ...unregistered.map(
            (id) =>
              `${id}: deny hook exists but is NOT registered as a ${ctx.agents.find((a) => a.agent.id === id)?.agent.hookEvents.preTool ?? "pre-tool"} hook`,
          ),
        ],
        [`Register the deny hook in ${unregistered.join(", ")} agent settings`],
        [
          `Add a ${unregistered.map((id) => ctx.agents.find((a) => a.agent.id === id)?.agent.hookEvents.preTool ?? "PreToolUse").join("/")} hook entry in agent settings that runs deny-dangerous.sh.`,
        ],
      );
    }
    const findings = [
      ...registered.map(
        (id) =>
          `${id}: deny hook registered as ${ctx.agents.find((a) => a.agent.id === id)?.agent.hookEvents.preTool ?? "pre-tool"} hook`,
      ),
      ...noDeny.map(
        (id) => `${id}: no deny mechanism (registration check skipped)`,
      ),
    ];
    return pass(
      findings.length > 0 ? findings : ["No agents with deny hooks to check"],
    );
  },
};

export const CONSTRAINTS_CHECKS: HarnessCheck[] = [
  denyCoversSecrets,
  denyBlocksDangerous,
  denyBlocksPipeToShell,
  denyHookRegistered,
];
