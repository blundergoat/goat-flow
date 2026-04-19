/**
 * Constraints concern: Do deterministic rules catch failures before the LLM runs?
 * 4 checks: deny-covers-secrets, deny-blocks-dangerous, deny-blocks-pipe-to-shell,
 * deny-hook-registered.
 */
import type { HarnessCheck, AuditContext } from "../types.js";
import type { CheckEvidence } from "../provenance-types.js";
import { pass, fail } from "./helpers.js";

const VERIFIED_ON = "2026-04-19";

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

/** Classify each agent by whether BOTH its settings.json Read deny rules AND its
 *  Bash deny hook cover secret-bearing files. Settings.json Read() patterns only
 *  bind the Read tool; Bash shell reads (cat/source/base64/etc.) bypass them
 *  entirely, so Bash-side coverage is required for any non-script-only agent. */
function classifySecretDeny(ctx: Pick<AuditContext, "agents">) {
  const covered: string[] = [];
  const uncovered: string[] = [];
  const scriptOnly: string[] = [];
  for (const af of ctx.agents) {
    const bashOk = af.hooks.bashDenyCoversSecrets;
    const readOk = af.hooks.readDenyCoversSecrets;
    const isScriptOnly = af.agent.denyMechanism.type === "deny-script";

    if (isScriptOnly) {
      // Script-only agents (e.g. Copilot) rely entirely on the Bash hook.
      if (bashOk) {
        scriptOnly.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    } else {
      // Settings-based agents need BOTH settings.json Read deny AND Bash hook coverage.
      if (readOk && bashOk) {
        covered.push(af.agent.id);
      } else {
        uncovered.push(af.agent.id);
      }
    }
  }
  return { covered, uncovered, scriptOnly };
}

const denyCoversSecrets: HarnessCheck = {
  id: "deny-covers-secrets",
  name: "Deny covers secret files",
  concern: "constraints",
  type: "integrity",
  provenance: constraintsProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/auditor.md",
  ]),
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
      findings.push(
        `${covered.join(", ")}: settings Read deny + Bash hook both cover secrets`,
      );
    }
    if (scriptOnly.length > 0) {
      findings.push(
        `${scriptOnly.join(", ")}: script-only deny; Bash hook covers secret paths`,
      );
    }
    if (uncovered.length > 0) {
      findings.push(
        `${uncovered.join(", ")}: secret-file coverage incomplete (either settings.json Read deny OR Bash hook pattern is missing)`,
      );
      return fail(
        findings,
        [
          `Add secret-read coverage to ${uncovered.join(", ")}: settings.json Read() patterns for .env / .ssh / .aws / .pem / .key, AND the Bash deny hook must block cat/source/base64/etc. on the same paths.`,
        ],
        [
          `${uncovered.join(", ")}: extend settings.json deny with Read() patterns for .env, .ssh, .aws, credentials, *.key, *.pem AND add an is_secret_path_touch (or equivalent) check in the Bash deny hook. Settings.json Read() deny alone does not bind Bash shell reads.`,
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
  type: "integrity",
  provenance: constraintsProvenance("integrity", [
    "docs/harness-audit.md",
    ".goat-flow/footguns/auditor.md",
    ".goat-flow/footguns/hooks.md",
  ]),
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
  type: "integrity",
  provenance: constraintsProvenance(
    "integrity",
    ["docs/harness-audit.md", ".goat-flow/footguns/auditor.md"],
    "incident",
  ),
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
