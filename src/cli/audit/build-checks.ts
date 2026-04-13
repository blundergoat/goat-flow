/**
 * Build checks for `goat-flow audit`.
 * Each check returns null on pass or an AuditFailure on fail.
 * Checks are grouped by scope: setup, harness.
 */
import { execSync } from "node:child_process";
import { join } from "node:path";
import type { BuildCheck } from "./types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION } from "../constants.js";

// === Setup scope checks ===

const requiredFilesExist: BuildCheck = {
  id: "required-files",
  name: "Required files",
  scope: "setup",
  run: (ctx) => {
    const missing = ctx.structure.required_files.filter(
      (f) => !ctx.fs.exists(f),
    );
    if (missing.length === 0) return null;
    return {
      check: "Required files",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix: `Create ${missing.join(", ")} by running \`goat-flow setup\` or creating them manually.`,
    };
  },
};

const requiredDirsExist: BuildCheck = {
  id: "required-dirs",
  name: "Required directories",
  scope: "setup",
  run: (ctx) => {
    const missing = ctx.structure.required_dirs.filter((d) => {
      const trimmed = d.endsWith("/") ? d.slice(0, -1) : d;
      return ctx.fs.listDir(trimmed).length === 0 && !ctx.fs.exists(trimmed);
    });
    if (missing.length === 0) return null;
    return {
      check: "Required directories",
      message: `Missing: ${missing.join(", ")}`,
      evidence: missing[0],
      howToFix: `Create the missing ${missing.length === 1 ? "directory" : "directories"}: ${missing.map((d) => `\`mkdir -p ${d}\``).join(", ")}.`,
    };
  },
};

const configExistsAndParses: BuildCheck = {
  id: "config-parses",
  name: "Config file",
  scope: "setup",
  run: (ctx) => {
    if (!ctx.config.exists) {
      return {
        check: "Config file",
        message: ".goat-flow/config.yaml does not exist",
        howToFix: "Create .goat-flow/config.yaml by running `goat-flow setup`.",
      };
    }
    if (ctx.config.parseError) {
      return {
        check: "Config file",
        message: `Parse error: ${ctx.config.parseError}`,
        evidence: ".goat-flow/config.yaml",
        howToFix: "Fix the YAML syntax error in .goat-flow/config.yaml.",
      };
    }
    return null;
  },
};

const configVersionCurrent: BuildCheck = {
  id: "config-version",
  name: "Config version",
  scope: "setup",
  run: (ctx) => {
    if (!ctx.config.exists) return null;
    const version = ctx.config.config.version;
    if (!version) {
      return {
        check: "Config version",
        message: "version field missing from config.yaml",
        howToFix: `Add \`version: "${AUDIT_VERSION}"\` to .goat-flow/config.yaml.`,
      };
    }
    if (version !== AUDIT_VERSION) {
      return {
        check: "Config version",
        message: `Config version ${version} does not match current ${AUDIT_VERSION}`,
        howToFix: `Update the version field in .goat-flow/config.yaml to "${AUDIT_VERSION}".`,
      };
    }
    return null;
  },
};

const agentsSupportedValues: BuildCheck = {
  id: "agents-supported",
  name: "Configured agents",
  scope: "setup",
  run: (ctx) => {
    const configAgents = ctx.config.config.agents;
    if (!configAgents) return null;
    const known = new Set(["claude", "codex", "gemini"]);
    const unknown = configAgents.filter((a) => !known.has(a));
    if (unknown.length === 0) return null;
    return {
      check: "Configured agents",
      message: `Unsupported agent values: ${unknown.join(", ")}`,
      howToFix:
        "Remove unsupported values from the agents list in .goat-flow/config.yaml. Supported: claude, codex, gemini.",
    };
  },
};

const canonicalSkillsExist: BuildCheck = {
  id: "canonical-skills",
  name: "Canonical skills",
  scope: "setup",
  run: (ctx) => {
    const canonical = ctx.structure.skills.canonical;
    const missingByAgent: string[] = [];
    for (const af of ctx.agents) {
      const skillsDir = af.agent.skillsDir;
      for (const skill of canonical) {
        const skillPath = `${skillsDir}/${skill}/SKILL.md`;
        if (!ctx.fs.exists(skillPath)) {
          missingByAgent.push(`${af.agent.id}:${skill}`);
        }
      }
    }
    if (missingByAgent.length === 0) return null;
    return {
      check: "Canonical skills",
      message: `Missing skill files: ${missingByAgent.join(", ")}`,
      evidence: missingByAgent[0],
      howToFix:
        "Install missing skills by running `goat-flow setup` or creating the SKILL.md files in the agent's skills directory.",
    };
  },
};

const skillVersionsPresent: BuildCheck = {
  id: "skill-versions",
  name: "Skill versions",
  scope: "setup",
  run: (ctx) => {
    const noVersion: string[] = [];
    for (const af of ctx.agents) {
      for (const [name, version] of Object.entries(af.skills.versions)) {
        if (version === null) {
          noVersion.push(`${af.agent.id}:${name}`);
        }
      }
    }
    if (noVersion.length === 0) return null;
    return {
      check: "Skill versions",
      message: `Missing goat-flow-skill-version: ${noVersion.join(", ")}`,
      evidence: noVersion[0],
      howToFix:
        "Add a `goat-flow-skill-version: X.Y.Z` header to each SKILL.md that is missing one.",
    };
  },
};

/** Fails when --agent filter targets an agent whose instruction file is absent.
 *  Without this check, detectAgents() silently omits missing agents and all
 *  per-agent checks vacuously pass (empty ctx.agents → 0 failures). */
const requestedAgentPresent: BuildCheck = {
  id: "configured-agent-present",
  name: "Requested agent configured",
  scope: "setup",
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    const found = ctx.agents.some((af) => af.agent.id === ctx.agentFilter);
    if (found) return null;
    const profile = ctx.structure.agents[ctx.agentFilter];
    const instructionFile =
      profile?.instruction_file ?? `${ctx.agentFilter} instruction file`;
    return {
      check: "Requested agent configured",
      message: `Missing: ${ctx.agentFilter} (${instructionFile})`,
      howToFix: `Create ${instructionFile} by running \`goat-flow setup --agent ${ctx.agentFilter}\`.`,
    };
  },
};

/** Returns true if agent-specific artifacts (hooks dir or settings file) exist. */
function agentArtifactsExist(
  fs: ReadonlyFS,
  profile: { hooks_dir?: string; settings?: string },
): boolean {
  const hooksDir = profile.hooks_dir?.replace(/\/$/, "");
  if (hooksDir !== undefined && fs.exists(hooksDir)) return true;
  return profile.settings !== undefined && fs.exists(profile.settings);
}

/** Fails in aggregate audit when an agent's hooks or settings exist but its instruction file
 *  is missing. Closes the vacuous-pass gap: detectAgents() skips agents without instruction
 *  files, so all per-agent harness checks silently pass on incomplete installs. */
const agentArtifactsWithoutInstructionFile: BuildCheck = {
  id: "agent-artifacts-consistent",
  name: "Agent artifacts consistent",
  scope: "setup",
  run: (ctx) => {
    if (ctx.agentFilter) return null; // requestedAgentPresent handles --agent case
    if (!ctx.config.exists) return null; // not initialized, nothing to check
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
      check: "Agent artifacts consistent",
      message: `Agent artifacts exist but instruction ${noun} missing: ${missing.join(", ")}`,
      howToFix: `Run \`goat-flow setup --agent <id>\` for each listed agent to recreate the instruction file, or remove the stale agent directories.`,
    };
  },
};

const instructionFilesExist: BuildCheck = {
  id: "instruction-files",
  name: "Instruction files",
  scope: "setup",
  run: (ctx) => {
    const missing: string[] = [];
    for (const af of ctx.agents) {
      if (!af.instruction.exists) {
        missing.push(`${af.agent.id} (${af.agent.instructionFile})`);
      }
    }
    if (missing.length === 0) return null;
    return {
      check: "Instruction files",
      message: `Missing: ${missing.join(", ")}`,
      howToFix:
        "Create the instruction file by running `goat-flow setup` or creating it manually.",
    };
  },
};

const noStaleSkillDirs: BuildCheck = {
  id: "stale-skill-dirs",
  name: "No stale skill directories",
  scope: "setup",
  run: (ctx) => {
    const staleNames = new Set([
      ...ctx.structure.skills.stale_names,
      ...ctx.structure.skills.stale_generic,
    ]);
    const staleFound: string[] = [];
    for (const af of ctx.agents) {
      for (const dir of af.skills.installedDirs) {
        const name = dir.split("/").pop() ?? "";
        if (staleNames.has(name)) {
          staleFound.push(`${af.agent.id}:${name}`);
        }
      }
    }
    if (staleFound.length === 0) return null;
    const stalePaths = staleFound.map((s) => {
      const [agent, name] = s.split(":");
      const af = ctx.agents.find((a) => a.agent.id === agent);
      return af ? `${af.agent.skillsDir}/${name}` : name;
    });
    return {
      check: "Stale skill directories",
      message: `Found stale directories: ${staleFound.join(", ")}`,
      evidence: staleFound[0],
      howToFix: `Remove the stale ${staleFound.length === 1 ? "directory" : "directories"}: ${stalePaths.map((p) => `\`rm -rf ${p}\``).join(", ")}.`,
    };
  },
};

const noWorkflowPathLeaks: BuildCheck = {
  id: "workflow-path-leaks",
  name: "Path integrity",
  scope: "setup",
  run: (ctx) => {
    const leaks: string[] = [];
    for (const af of ctx.agents) {
      const skillsDir = af.agent.skillsDir;
      for (const skill of af.skills.found) {
        const skillFile = `${skillsDir}/${skill}/SKILL.md`;
        const content = ctx.fs.readFile(skillFile);
        if (content && /workflow\//.test(content)) {
          leaks.push(`${af.agent.id}:${skill}`);
        }
      }
    }
    if (leaks.length === 0) return null;
    return {
      check: "Path integrity",
      message: `Skills containing workflow/ paths: ${leaks.join(", ")}`,
      evidence: leaks[0],
      howToFix:
        "Replace workflow/ paths in skill files with .goat-flow/ paths. Workflow paths are framework-internal and don't exist in target projects.",
    };
  },
};

// === Harness scope checks ===

const toolchainPresent: BuildCheck = {
  id: "toolchain-commands",
  name: "Toolchain commands",
  scope: "harness",
  run: (ctx) => {
    const tc = ctx.config.config.toolchain;
    const missing: string[] = [];
    if (tc.test.length === 0) missing.push("test");
    if (tc.lint.length === 0) missing.push("lint");
    if (tc.build.length === 0) missing.push("build");
    if (missing.length === 0) return null;
    return {
      check: "Toolchain commands",
      message: `Missing toolchain commands: ${missing.join(", ")}`,
      howToFix: `Add the missing ${missing.join(", ")} ${missing.length === 1 ? "command" : "commands"} to the toolchain section of .goat-flow/config.yaml.`,
    };
  },
};

const agentSettingsParse: BuildCheck = {
  id: "agent-settings-parse",
  name: "Agent settings",
  scope: "harness",
  run: (ctx) => {
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

const hookFilesExist: BuildCheck = {
  id: "hook-files-exist",
  name: "Hook files",
  scope: "harness",
  run: (ctx) => {
    const missing: string[] = [];
    for (const af of ctx.agents) {
      if (!af.hooks.denyExists && !af.hooks.denyIsConfigBased) {
        missing.push(`${af.agent.id}:deny`);
      }
    }
    if (missing.length === 0) return null;
    return {
      check: "Hook files",
      message: `Missing hook files: ${missing.join(", ")}`,
      howToFix:
        "Create a deny hook file or add deny patterns to the agent's settings file.",
    };
  },
};

const hookScriptsSyntaxValid: BuildCheck = {
  id: "hook-syntax",
  name: "Hook syntax",
  scope: "harness",
  run: (ctx) => {
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
          execSync(`bash -n "${fullPath}"`, {
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
      check: "Hook syntax",
      message: `bash -n failed: ${failures.join(", ")}`,
      evidence: failures[0],
      howToFix: `Fix the bash syntax errors in ${failures.join(", ")}. Run \`bash -n <file>\` to see details.`,
    };
  },
};

const denyPatternsRegistered: BuildCheck = {
  id: "deny-patterns",
  name: "Deny patterns",
  scope: "harness",
  run: (ctx) => {
    const noDeny: string[] = [];
    for (const af of ctx.agents) {
      if (!af.settings.hasDenyPatterns && !af.hooks.denyExists) {
        noDeny.push(af.agent.id);
      }
    }
    if (noDeny.length === 0) return null;
    return {
      check: "Deny patterns",
      message: `No deny patterns registered for: ${noDeny.join(", ")}`,
      howToFix:
        "Register deny patterns in the agent's settings file or create a deny hook script in the agent's hooks directory.",
    };
  },
};

/** All build checks in scope order */
export const BUILD_CHECKS: BuildCheck[] = [
  // setup
  requiredFilesExist,
  requiredDirsExist,
  configExistsAndParses,
  configVersionCurrent,
  agentsSupportedValues,
  canonicalSkillsExist,
  skillVersionsPresent,
  requestedAgentPresent,
  agentArtifactsWithoutInstructionFile,
  instructionFilesExist,
  noStaleSkillDirs,
  noWorkflowPathLeaks,
  // harness
  toolchainPresent,
  agentSettingsParse,
  hookFilesExist,
  hookScriptsSyntaxValid,
  denyPatternsRegistered,
];
