/**
 * Describe setup and agent state in the report's short status summaries.
 *
 * CLI renderers and the dashboard display these strings beside the checks that decide pass or fail.
 * Missing agents and unconfigured optional tools receive explicit labels so absence is not mistaken for a complete setup.
 */
import type { AuditContext } from "./types.js";

/**
 * Summarize the least complete skill installation and largest instruction file across the audited agents.
 * An empty agent list receives explicit absence labels so the report does not imply a complete installation.
 *
 * @param ctx - canonical skill names, selected agents' installation facts, and loaded configuration
 * @returns - skills, configuration, and instruction-file display text, including labels when no supported agents exist
 */
export function setupSummary(ctx: AuditContext): Record<string, string> {
  const totalSkills = ctx.structure.skills.canonical.length;
  // With no supported agent installed, show absence explicitly instead of treating zero counts as healthy setup.
  if (ctx.agents.length === 0) {
    return {
      skills: `0/${totalSkills} installed (no supported agents)`,
      // This empty-agent summary reports whether configuration exists; detailed checks own its validity finding.
      config: ctx.config.exists
        ? "valid, no supported agents"
        : "invalid or missing",
      instructionFile: "0 lines (no supported agents)",
    };
  }
  let fewestInstalledSkills = totalSkills;
  let largestInstructionLineCount = 0;
  // Keep the weakest skill coverage and largest instruction file visible instead of averaging them away.
  for (const agentFacts of ctx.agents) {
    fewestInstalledSkills = Math.min(
      fewestInstalledSkills,
      agentFacts.skills.found.length,
    );
    largestInstructionLineCount = Math.max(
      largestInstructionLineCount,
      agentFacts.instruction.lineCount,
    );
  }
  const configValid = ctx.config.exists && ctx.config.valid;
  const configVersion = ctx.config.config.version;

  return {
    skills: `${fewestInstalledSkills}/${totalSkills} installed`,
    config: configValid
      ? `valid, version ${configVersion}`
      : "invalid or missing",
    instructionFile: `${largestInstructionLineCount} lines (max across agents)`,
  };
}

/**
 * Summarize configured verification commands and installed deny mechanisms for the audit report.
 * Missing toolchain commands remain optional; no supported agents is distinct from supported agents without deny protection.
 *
 * @param ctx - configured test, lint, and build commands plus each audited agent's deny-mechanism facts
 * @returns - toolchain and hook display text; empty command lists and missing agents receive explicit absence labels
 */
export function agentSummary(ctx: AuditContext): Record<string, string> {
  const toolchain = ctx.config.config.toolchain;
  const configuredSteps: string[] = [];
  // Configured tests appear as a verification option; an empty list adds no test label.
  if (toolchain.test.length > 0) configuredSteps.push("test");
  // Configured lint commands appear beside the other verification steps available to the user.
  if (toolchain.lint.length > 0) configuredSteps.push("lint");
  // Configured builds complete the summary of verification steps the project can run.
  if (toolchain.build.length > 0) configuredSteps.push("build");

  const hookInfo: string[] = [];
  // Name the agents whose deny mechanism is installed so users can see which setup supplies protection.
  for (const agentFacts of ctx.agents) {
    // Config-based deny mechanisms count as installed even when the agent does not use a shell hook file.
    if (agentFacts.hooks.denyExists || agentFacts.hooks.denyIsConfigBased) {
      hookInfo.push(`${agentFacts.agent.id}:deny installed`);
    }
  }

  return {
    // No configured commands is an optional omission, so the summary does not present it as an audit failure.
    toolchain:
      configuredSteps.length > 0
        ? configuredSteps.join(" + ") + " configured"
        : "not configured (optional)",
    // Distinguish an absent agent setup from installed agents that still have no deny mechanism.
    hooks:
      ctx.agents.length === 0
        ? "not applicable (no supported agents)"
        : hookInfo.length > 0
          ? hookInfo.join(", ")
          : "none installed",
  };
}
