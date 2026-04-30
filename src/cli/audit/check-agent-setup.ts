/**
 * Agent Setup checks for `goat-flow audit --agent <id>`.
 * 4 checks that validate per-agent installation: instruction, skills, settings, deny hook.
 * All checks require --agent and skip in aggregate mode (except orphaned-artifacts detection).
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuditFailure, BuildCheck, AuditContext } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION } from "../constants.js";
import { getTemplatePath } from "../paths.js";

const VERIFIED_ON = "2026-04-18";

/** Return the spec provenance. */
function specProvenance(paths: string[]): CheckEvidence {
  return {
    source_type: "spec",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "MUST",
    evidence_paths: paths,
  };
}

/** Return the incident provenance. */
function incidentProvenance(paths: string[]): CheckEvidence {
  return {
    source_type: "incident",
    source_urls: [],
    verified_on: VERIFIED_ON,
    normative_level: "MUST",
    evidence_paths: paths,
  };
}

function uniquePaths(paths: string[]): string[] {
  return Array.from(new Set(paths));
}

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

/** Check whether the selected agent has its instruction file installed. */
function checkInstructionPresent(ctx: AuditContext): AuditFailure | null {
  const found = ctx.agents.some((af) => af.agent.id === ctx.agentFilter);
  if (found) return null;
  // In --agent mode we look up the expected instruction path from the detected
  // structure so the failure message stays specific even when the file is absent.
  const profile = ctx.agentFilter
    ? ctx.structure.agents[ctx.agentFilter]
    : undefined;
  const instructionFile =
    profile?.instruction_file ?? `${ctx.agentFilter} instruction file`;
  return {
    check: "Agent instruction file",
    message: `Missing: ${ctx.agentFilter} (${instructionFile})`,
    howToFix: `Create ${instructionFile} by running \`goat-flow setup --agent ${ctx.agentFilter}\`.`,
  };
}

/** Check whether Copilot's required commit instruction bridge is installed. */
function checkCopilotCommitInstructionsPresent(
  ctx: AuditContext,
): AuditFailure | null {
  if (ctx.agentFilter !== null && ctx.agentFilter !== "copilot") return null;
  if (!ctx.fs.exists(".github")) return null;
  const copilotInstruction =
    ctx.structure.agents.copilot?.instruction_file ??
    ".github/copilot-instructions.md";
  if (ctx.agentFilter === null && !ctx.fs.exists(copilotInstruction)) {
    return null;
  }
  if (ctx.fs.exists(".github/git-commit-instructions.md")) return null;
  return {
    check: "Agent instruction file",
    message:
      "Missing: copilot (.github/git-commit-instructions.md required when .github/ exists)",
    evidence: ".github/git-commit-instructions.md",
    howToFix:
      "Create .github/git-commit-instructions.md with the project's commit rules, then rerun `goat-flow audit --agent copilot`.",
  };
}

/** Check for agent artifacts that remain after their instruction file was removed. */
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

/** Return agent-specific provenance for the broad instruction-file check. */
function agentInstructionProvenance(
  ctx: AuditContext,
  failure: AuditFailure | null,
): CheckEvidence {
  const paths = ["workflow/manifest.json", ".goat-flow/architecture.md"];
  const failedAgentId = failure?.message.match(/\b([a-z]+) \([^)]+\)/)?.[1];
  const agentId = ctx.agentFilter ?? failedAgentId;
  const profile = agentId ? ctx.structure.agents[agentId] : undefined;
  if (profile?.instruction_file) paths.push(profile.instruction_file);
  if (
    agentId === "copilot" ||
    failure?.evidence === ".github/git-commit-instructions.md"
  ) {
    paths.push(
      "workflow/setup/agents/copilot.md",
      ".github/copilot-instructions.md",
      ".github/git-commit-instructions.md",
    );
  }
  return specProvenance(uniquePaths(paths));
}

const agentInstruction: BuildCheck = {
  id: "agent-instruction",
  name: "Agent instruction file",
  scope: "agent",
  supportsAggregate: true,
  provenance: specProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  provenanceFor: agentInstructionProvenance,
  /** Run the Agent instruction file check. */
  run: (ctx) => {
    if (ctx.agentFilter) {
      return (
        checkInstructionPresent(ctx) ??
        checkCopilotCommitInstructionsPresent(ctx)
      );
    }
    return (
      checkOrphanedArtifacts(ctx) ?? checkCopilotCommitInstructionsPresent(ctx)
    );
  },
};

// === 2. Agent Skills ===

function checkCanonicalSkills(ctx: AuditContext): AuditFailure | null {
  const canonical = ctx.structure.skills.canonical;
  const missing: string[] = [];
  const references = ctx.structure.skills.references ?? {};
  for (const af of ctx.agents) {
    for (const skill of canonical) {
      const referenceFiles = Array.isArray(references[skill])
        ? references[skill].filter((file) => typeof file === "string")
        : [];
      for (const relativeFile of ["SKILL.md", ...referenceFiles]) {
        const skillPath = `${af.agent.skillsDir}/${skill}/${relativeFile}`;
        if (!ctx.fs.exists(skillPath)) {
          missing.push(`${af.agent.id}:${skill}:${relativeFile}`);
        }
      }
    }
  }
  if (missing.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Missing skill files: ${missing.join(", ")}`,
    evidence: missing[0],
    howToFix:
      "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
  };
}

/** Check whether installed skills declare the current GOAT Flow version. */
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
        "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
    };
  }
  if (mismatch.length > 0) {
    return {
      check: "Agent skills",
      message: `Version mismatch (expected ${AUDIT_VERSION}): ${mismatch.join(", ")}`,
      evidence: mismatch[0],
      howToFix:
        "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
    };
  }
  return null;
}

/** Check for stale skill directories that still use deprecated names. */
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
  // Convert the compact agent:name identifiers back into filesystem paths so the
  // remediation text points to concrete directories the user can remove.
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
  provenance: specProvenance([
    "workflow/manifest.json",
    ".goat-flow/footguns/skills.md",
  ]),
  /** Run the Agent skills check. */
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
  provenance: specProvenance([
    "workflow/manifest.json",
    ".goat-flow/architecture.md",
  ]),
  /** Run the Agent settings check. */
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

/** Check shell syntax for each installed agent hook script. */
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
      // ctx.fs may be backed by an in-memory fixture, but bash -n needs a real workspace path.
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

/** Check whether each agent has deny patterns registered somewhere. */
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

/** Compare installed deny hook content against the canonical template. */
function checkHookVersion(ctx: AuditContext): AuditFailure | null {
  const templatePath = getTemplatePath("workflow/hooks/deny-dangerous.sh");
  if (!existsSync(templatePath)) return null;
  let templateContent: string;
  try {
    templateContent = readFileSync(templatePath, "utf-8");
  } catch {
    return null;
  }
  for (const af of ctx.agents) {
    if (!af.agent.hooksDir) continue;
    const denyRelPath = join(af.agent.hooksDir, "deny-dangerous.sh");
    const installed = ctx.fs.readFile(denyRelPath);
    if (installed === null) continue;
    if (installed.trimEnd() !== templateContent.trimEnd()) {
      return {
        check: "Agent deny mechanism",
        message: `deny-dangerous.sh for ${af.agent.id} differs from the current goat-flow template (v${AUDIT_VERSION})`,
        evidence: denyRelPath,
        howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${af.agent.id}\` to update the hook to the latest version.`,
      };
    }
  }
  return null;
}

/** Run each deny hook self-test when the script is present. */
function checkHookSelfTest(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (!af.agent.hooksDir) continue;
    const denyRelPath = join(af.agent.hooksDir, "deny-dangerous.sh");
    const content = ctx.fs.readFile(denyRelPath);
    // Config-based deny rules satisfy the deny-mechanism requirement, but only an
    // on-disk shell hook can run the registered self-test.
    if (content === null) continue;
    const denyPath = join(ctx.projectPath, denyRelPath);
    try {
      execFileSync("bash", [denyPath, "--self-test"], {
        stdio: "pipe",
        timeout: 30000,
      });
    } catch {
      return {
        check: "Agent deny mechanism",
        message: `deny-dangerous.sh --self-test failed for ${af.agent.id}`,
        evidence: denyRelPath,
        howToFix:
          "Run `bash <hooks-dir>/deny-dangerous.sh --self-test` to see which cases fail.",
      };
    }
  }
  return null;
}

const agentDenyMechanism: BuildCheck = {
  id: "agent-deny-dangerous",
  name: "Agent deny mechanism",
  scope: "agent",
  provenance: incidentProvenance([
    ".goat-flow/footguns/auditor.md",
    ".goat-flow/footguns/hooks.md",
  ]),
  /** Run the Agent deny mechanism check. */
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    if (ctx.denyMechanismEvidenceLevel === "present-only") {
      return checkDenyHookPresent(ctx);
    }
    // Order the checks from cheapest/static to most expensive/runtime so we stop on
    // the clearest failure before attempting shell execution.
    return (
      checkDenyHookPresent(ctx) ??
      checkHookSyntax(ctx) ??
      checkDenyPatterns(ctx) ??
      checkHookVersion(ctx) ??
      checkHookSelfTest(ctx)
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
