/**
 * Agent Setup checks for `goat-flow audit --agent <id>`.
 * 4 checks that validate per-agent installation: instruction, skills, settings, deny hook.
 * All checks require --agent and skip in aggregate mode (except orphaned-artifacts detection).
 */
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import type { AuditFailure, BuildCheck, AuditContext } from "./types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION } from "../constants.js";

// === 1. Agent Instruction ===

/** Returns true if agent-specific artifacts (hooks dir or settings file) exist. */
function agentArtifactsExist(
  fs: ReadonlyFS,
  profile: { hooks_dir?: string; settings?: string },
): boolean {
  const hooksDir = profile.hooks_dir?.replace(/\/$/, "");
  if (hooksDir !== undefined && fs.exists(hooksDir)) return true;
  return profile.settings !== undefined && fs.exists(profile.settings);
}

function checkInstructionPresent(ctx: AuditContext): AuditFailure | null {
  const found = ctx.agents.some((af) => af.agent.id === ctx.agentFilter);
  if (found) return null;
  const profile = ctx.structure.agents[ctx.agentFilter!];
  const instructionFile =
    profile?.instruction_file ?? `${ctx.agentFilter} instruction file`;
  return {
    check: "Agent instruction file",
    message: `Missing: ${ctx.agentFilter} (${instructionFile})`,
    howToFix: `Create ${instructionFile} by running \`goat-flow setup --agent ${ctx.agentFilter}\`.`,
  };
}

function checkOrphanedArtifacts(ctx: AuditContext): AuditFailure | null {
  if (!ctx.config.exists) return null;
  const missing: string[] = [];
  for (const [agentId, profile] of Object.entries(ctx.structure.agents)) {
    if (ctx.fs.exists(profile.instruction_file)) continue;
    if (agentArtifactsExist(ctx.fs, profile)) {
      missing.push(`${agentId} (${profile.instruction_file})`);
    }
  }
  if (missing.length === 0) return null;
  const noun = missing.length === 1 ? "file is" : "files are";
  return {
    check: "Agent instruction file",
    message: `Agent artifacts exist but instruction ${noun} missing: ${missing.join(", ")}`,
    howToFix: `Run \`goat-flow setup --agent <id>\` for each listed agent to recreate the instruction file, or remove the stale agent directories.`,
  };
}

const agentInstruction: BuildCheck = {
  id: "agent-instruction",
  name: "Agent instruction file",
  scope: "agent",
  run: (ctx) => {
    if (ctx.agentFilter) return checkInstructionPresent(ctx);
    return checkOrphanedArtifacts(ctx);
  },
};

// === 2. Agent Skills ===

function checkCanonicalSkills(ctx: AuditContext): AuditFailure | null {
  const canonical = ctx.structure.skills.canonical;
  const missing: string[] = [];
  for (const af of ctx.agents) {
    for (const skill of canonical) {
      const skillPath = `${af.agent.skillsDir}/${skill}/SKILL.md`;
      if (!ctx.fs.exists(skillPath)) {
        missing.push(`${af.agent.id}:${skill}`);
      }
    }
  }
  if (missing.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Missing skill files: ${missing.join(", ")}`,
    evidence: missing[0],
    howToFix:
      "Re-install skills from workflow/skills/ by running `goat-flow setup` or copying the skill template into the agent's skills directory.",
  };
}

function checkSkillVersions(ctx: AuditContext): AuditFailure | null {
  const noVersion: string[] = [];
  const mismatch: string[] = [];
  for (const af of ctx.agents) {
    for (const [name, version] of Object.entries(af.skills.versions)) {
      if (version === null) {
        noVersion.push(`${af.agent.id}:${name}`);
      } else if (version !== AUDIT_VERSION) {
        mismatch.push(`${af.agent.id}:${name} (${version})`);
      }
    }
  }
  if (noVersion.length > 0) {
    return {
      check: "Agent skills",
      message: `Missing goat-flow-skill-version: ${noVersion.join(", ")}`,
      evidence: noVersion[0],
      howToFix:
        "Re-install skills from workflow/skills/ by running `goat-flow setup` or copying the skill template into the agent's skills directory.",
    };
  }
  if (mismatch.length > 0) {
    return {
      check: "Agent skills",
      message: `Version mismatch (expected ${AUDIT_VERSION}): ${mismatch.join(", ")}`,
      evidence: mismatch[0],
      howToFix:
        "Re-install skills from workflow/skills/ by running `goat-flow setup` or copying the skill template into the agent's skills directory.",
    };
  }
  return null;
}

function checkDeprecatedSkills(ctx: AuditContext): AuditFailure | null {
  const staleNames = new Set(ctx.structure.skills.stale_names);
  const found: string[] = [];
  for (const af of ctx.agents) {
    for (const dir of af.skills.installedDirs) {
      const name = dir.split("/").pop() ?? "";
      if (staleNames.has(name)) {
        found.push(`${af.agent.id}:${name}`);
      }
    }
  }
  if (found.length === 0) return null;
  const paths = found.map((s) => {
    const [agent, name] = s.split(":");
    const af = ctx.agents.find((a) => a.agent.id === agent);
    return af ? `${af.agent.skillsDir}/${name}` : name;
  });
  return {
    check: "Agent skills",
    message: `Deprecated skill directories found: ${found.join(", ")}`,
    evidence: found[0],
    howToFix: `Remove the deprecated ${found.length === 1 ? "directory" : "directories"}: ${paths.join(", ")}. Delete the SKILL.md inside each, then remove the empty directory.`,
  };
}

const agentSkills: BuildCheck = {
  id: "agent-skills",
  name: "Agent skills",
  scope: "agent",
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    return (
      checkCanonicalSkills(ctx) ??
      checkSkillVersions(ctx) ??
      checkDeprecatedSkills(ctx)
    );
  },
};

// === 3. Agent Settings ===

const agentSettings: BuildCheck = {
  id: "agent-settings",
  name: "Agent settings",
  scope: "agent",
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    const invalid: string[] = [];
    for (const af of ctx.agents) {
      if (af.settings.exists && !af.settings.valid) {
        invalid.push(af.agent.id);
      }
    }
    if (invalid.length === 0) return null;
    return {
      check: "Agent settings",
      message: `Invalid settings for: ${invalid.join(", ")}`,
      howToFix: `Fix the JSON syntax in the settings file for ${invalid.join(", ")}.`,
    };
  },
};

// === 4. Agent Deny Mechanism ===

function checkDenyHookPresent(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (!af.hooks.denyExists && !af.hooks.denyIsConfigBased) {
      return {
        check: "Agent deny mechanism",
        message: `Missing deny mechanism for ${af.agent.id}`,
        howToFix:
          "Create a deny hook file or add deny patterns to the agent's settings file.",
      };
    }
  }
  return null;
}

function checkHookSyntax(ctx: AuditContext): AuditFailure | null {
  const failures: string[] = [];
  for (const af of ctx.agents) {
    if (!af.agent.hooksDir) continue;
    const hooksDir = af.agent.hooksDir;
    let files: string[];
    try {
      files = ctx.fs.listDir(hooksDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".sh")) continue;
      const fullPath = join(ctx.projectPath, hooksDir, file);
      try {
        execFileSync("bash", ["-n", fullPath], {
          stdio: "pipe",
          timeout: 5000,
        });
      } catch {
        failures.push(`${hooksDir}/${file}`);
      }
    }
  }
  if (failures.length === 0) return null;
  return {
    check: "Agent deny mechanism",
    message: `bash -n failed: ${failures.join(", ")}`,
    evidence: failures[0],
    howToFix: `Fix the bash syntax errors in ${failures.join(", ")}. Run \`bash -n <file>\` to see details.`,
  };
}

function checkDenyPatterns(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (!af.settings.hasDenyPatterns && !af.hooks.denyExists) {
      return {
        check: "Agent deny mechanism",
        message: `No deny patterns registered for ${af.agent.id}`,
        howToFix:
          "Register deny patterns in the agent's settings file or create a deny hook script in the agent's hooks directory.",
      };
    }
  }
  return null;
}

const agentDenyMechanism: BuildCheck = {
  id: "agent-deny-dangerous",
  name: "Agent deny mechanism",
  scope: "agent",
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    return (
      checkDenyHookPresent(ctx) ??
      checkHookSyntax(ctx) ??
      checkDenyPatterns(ctx)
    );
  },
};

/** 4 agent setup checks */
export const AGENT_CHECKS: BuildCheck[] = [
  agentInstruction,
  agentSkills,
  agentSettings,
  agentDenyMechanism,
];
