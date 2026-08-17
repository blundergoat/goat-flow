/**
 * Human-readable summary strings for the audit report's setup and agent scopes.
 * These feed the one-line status blurbs renderers and the dashboard show per scope; they describe state, never pass/fail, so they stay separate from
 * the check functions that produce findings.
 */
import type { AuditContext } from "./types.js";

/**
 * Build the setup-scope summary lines.
 * Skill and instruction-file figures are reported worst-case across agents (minimum skills installed, maximum instruction-file line count) so the
 * summary reflects the least-complete agent rather than an average.
 *
 * When no supported agents are present, every field returns an explicit "no supported agents" string instead of misleading zeros.
 *
 * @param ctx - audit context; supplies the canonical skill list, per-agent facts, and loaded config
 * @returns map of display keys (`skills`, `config`, `instructionFile`) to human-readable status strings
 */
export function setupSummary(ctx: AuditContext): Record<string, string> {
  const totalSkills = ctx.structure.skills.canonical.length;
  if (ctx.agents.length === 0) {
    return {
      skills: `0/${totalSkills} installed (no supported agents)`,
      config: ctx.config.exists
        ? "valid, no supported agents"
        : "invalid or missing",
      instructionFile: "0 lines (no supported agents)",
    };
  }
  let minSkills = totalSkills;
  let maxLines = 0;
  for (const af of ctx.agents) {
    minSkills = Math.min(minSkills, af.skills.found.length);
    maxLines = Math.max(maxLines, af.instruction.lineCount);
  }
  const configValid = ctx.config.exists && ctx.config.valid;
  const configVersion = ctx.config.config.version;

  return {
    skills: `${minSkills}/${totalSkills} installed`,
    config: configValid
      ? `valid, version ${configVersion}`
      : "invalid or missing",
    instructionFile: `${maxLines} lines (max across agents)`,
  };
}

/**
 * Build the agent-scope summary lines.
 * Toolchain reports which of test/lint/build are configured (an empty toolchain is "not configured (optional)" because the toolchain is not
 * required).
 *
 * Hook status lists each agent whose deny mechanism is installed - whether file-based or config-based - and distinguishes "no supported agents" from
 * "none installed".
 *
 * @param ctx - audit context; supplies the loaded toolchain config and per-agent hook facts
 * @returns map of display keys (`toolchain`, `hooks`) to human-readable status strings for the report
 */
export function agentSummary(ctx: AuditContext): Record<string, string> {
  const tc = ctx.config.config.toolchain;
  const parts: string[] = [];
  if (tc.test.length > 0) parts.push("test");
  if (tc.lint.length > 0) parts.push("lint");
  if (tc.build.length > 0) parts.push("build");

  const hookInfo: string[] = [];
  for (const af of ctx.agents) {
    if (af.hooks.denyExists || af.hooks.denyIsConfigBased) {
      hookInfo.push(`${af.agent.id}:deny installed`);
    }
  }

  return {
    toolchain:
      parts.length > 0
        ? parts.join(" + ") + " configured"
        : "not configured (optional)",
    hooks:
      ctx.agents.length === 0
        ? "not applicable (no supported agents)"
        : hookInfo.length > 0
          ? hookInfo.join(", ")
          : "none installed",
  };
}
