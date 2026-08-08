/**
 * Validate agent setup surfaces for `goat-flow audit`.
 * Use when a user wants to know whether an agent has the instruction file, skills, settings, and
 * hook wiring needed to run goat-flow safely in the selected project.
 * Aggregate mode reports missing supported agents and stale artifacts; `--agent <id>` drills into
 * that agent's install details and remediation commands.
 */
import type { AuditFailure, BuildCheck, AuditContext } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION, getSkillNames } from "../constants.js";
import { agentDenyMechanism } from "./check-agent-deny-mechanism.js";
import { agentSettings } from "./check-agent-codex.js";
import {
  checkSelectedInstructionAvailable,
  specProvenance,
  targetUsesNewerGoatFlow,
  uniquePaths,
} from "./check-agent-common.js";

// === 1. Agent Instruction ===

/**
 * Detect whether an agent directory contains goat-flow-owned artifacts.
 * Use when audit finds an agent config directory but must avoid flagging ordinary agent-only config.
 *
 * @param fs - target project filesystem; missing directories mean no goat-flow artifact exists there
 * @param profile - manifest profile for one agent; missing hook dir limits detection to skills
 * @returns whether goat-flow artifacts exist; `false` means the UI can ignore ordinary agent config
 */
function agentArtifactsExist(
  fs: ReadonlyFS,
  profile: { hooks_dir?: string; settings?: string; skills_dir: string },
): boolean {
  const hooksDir = profile.hooks_dir?.replace(/\/$/, "");
  // Guardrail scripts prove goat-flow touched this agent, even if the instruction file is gone.
  if (
    hooksDir !== undefined &&
    (fs.exists(`${hooksDir}/deny-dangerous.sh`) ||
      fs.exists(`${hooksDir}/guard-repository-writes.sh`))
  ) {
    return true;
  }
  const skillsDir = profile.skills_dir.replace(/\/$/, "");
  try {
    const entries = fs.listDir(skillsDir);
    // Any canonical skill folder means the user has a goat-flow skill install for this agent.
    if (entries.some((e) => getSkillNames().includes(e))) return true;
  } catch {
    // Missing skills directories mean there is no skill artifact to report.
  }
  return false;
}

/**
 * Check whether the selected agent has its instruction file installed.
 * Use in `--agent <id>` audits so the first setup failure points at the missing starter file.
 *
 * @param ctx - audit context; missing agent facts mean the selected instruction file was not found
 * @returns audit failure for the missing instruction, or `null` when the selected agent is ready
 */
function checkInstructionPresent(ctx: AuditContext): AuditFailure | null {
  const agentFacts = ctx.agents.find(
    (agentFacts) => agentFacts.agent.id === ctx.agentFilter,
  );
  // Existing instruction facts mean the selected agent can proceed to deeper setup checks.
  if (agentFacts?.instruction.exists) return null;
  // The expected instruction path gives the user a concrete file to create.
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

/**
 * Check which supported agents are missing primary instruction files.
 * Use in aggregate audit so the user sees every agent that still needs setup.
 *
 * @param ctx - audit context; empty agents list is handled by the broader configured-agent check
 * @returns audit failure listing missing instruction files, or `null` when all supported agents are present
 */
function checkSupportedInstructionFilesPresent(
  ctx: AuditContext,
): AuditFailure | null {
  const missing = ctx.agents
    .filter((agentFacts) => !agentFacts.instruction.exists)
    .map(
      (agentFacts) =>
        `${agentFacts.agent.id} (${agentFacts.agent.instructionFile})`,
    );
  // Nothing is missing, so aggregate agent setup can continue to other checks.
  if (missing.length === 0) return null;
  return {
    check: "Agent instruction file",
    message: `Supported agent instruction files missing: ${missing.join(", ")}`,
    howToFix:
      "Run `goat-flow setup --agent <id>` for each missing agent, or use `goat-flow audit . --agent <id>` to scope the audit to one agent.",
  };
}

/**
 * Check that aggregate agent scope has at least one managed agent surface.
 * Use when the user runs an unscoped audit and needs to know whether any agent is configured.
 *
 * @param ctx - audit context; empty `agents` means no supported instruction files were detected
 * @returns audit failure when no agent is configured, or `null` when at least one agent exists
 */
function checkAnyAgentConfigured(ctx: AuditContext): AuditFailure | null {
  // At least one managed agent was found, so the user has a setup surface to audit.
  if (ctx.agents.length > 0) return null;
  return {
    check: "Agent instruction file",
    message: "No supported agent instruction files found",
    howToFix:
      "Run `goat-flow setup --agent <id>` for the agent this repo should manage, then complete the project-specific setup steps.",
  };
}

/**
 * Decide whether Copilot's auto-read instruction file should be checked.
 * Use so Copilot users get commit-guide setup guidance without forcing it on non-Copilot projects.
 *
 * @param ctx - audit context; missing `.github` or non-Copilot filter means the check is skipped
 * @returns whether the Copilot commit-instruction bridge should be validated
 */
function shouldCheckCopilotCommitInstructions(ctx: AuditContext): boolean {
  // Commit guidance has no repository workflow to govern outside a Git checkout.
  if (!ctx.fs.exists(".git")) return false;
  // A different explicit agent should not receive Copilot-specific setup findings.
  if (ctx.agentFilter !== null && ctx.agentFilter !== "copilot") return false;
  // Without `.github`, there is no Copilot auto-read instruction file for the user to fix.
  if (!ctx.fs.exists(".github")) return false;
  // Explicit Copilot audits should validate the Copilot bridge even if other facts are missing.
  if (ctx.agentFilter === "copilot") return true;
  return ctx.structure.agents.copilot !== undefined;
}

/**
 * Check whether the Copilot instruction file bridges to an accepted commit guide.
 *
 * IDEs (VS Code, JetBrains) auto-read .github/copilot-instructions.md but not
 * an accepted docs commit guide, so commit conventions only reach Copilot when the auto-read
 * instruction file references either the preferred git-commit-message.md path or the compatible
 * git-commit.md path. Returns null - no failure - when the .github/ dir is absent, when Copilot is
 * not a configured agent in aggregate mode (a Claude/Codex project that happens to ship GitHub
 * config must not be forced to add it), when the Copilot instruction file itself is missing (the
 * broader instruction-file check owns that failure), or when an accepted reference is present.
 *
 * @param ctx - audit context; absent Copilot setup means the user should not see this specialized finding
 * @returns audit failure when the bridge is missing, or `null` when Copilot does not need this check
 */
function checkCopilotCommitInstructionsPresent(
  ctx: AuditContext,
): AuditFailure | null {
  // Copilot is not in scope, so do not ask the user to edit GitHub instruction files.
  if (!shouldCheckCopilotCommitInstructions(ctx)) return null;
  const copilotInstruction =
    ctx.structure.agents.copilot?.instruction_file ??
    ".github/copilot-instructions.md";
  // The broader instruction check owns missing-file setup guidance.
  if (!ctx.fs.exists(copilotInstruction)) return null;
  const preferredCommitGuide = "docs/coding-standards/git-commit-message.md";
  const acceptedCommitGuides = [
    preferredCommitGuide,
    "docs/coding-standards/git-commit.md",
  ];
  const instructionContent = ctx.fs.readFile(copilotInstruction) ?? "";
  // Copilot already sees an accepted commit guide through its auto-read file.
  if (
    acceptedCommitGuides.some((guide) => instructionContent.includes(guide))
  ) {
    return null;
  }
  return {
    check: "Agent instruction file",
    message: `Missing: copilot (${copilotInstruction} must reference ${preferredCommitGuide})`,
    evidence: copilotInstruction,
    howToFix: `Add a ## Commit Messages section to ${copilotInstruction} that references ${preferredCommitGuide}, then rerun \`goat-flow audit --agent copilot\`.`,
  };
}

/**
 * Collect skills directories for agents whose instruction files are present.
 * Use when detecting stale artifacts so shared skills dirs are not blamed on one missing agent file.
 *
 * @param ctx - audit context; agents without instruction files do not own their skills dirs here
 * @returns skills dirs still backed by instruction files; empty set means no shared dirs are protected
 */
function presentAgentSkillsDirs(ctx: AuditContext): Set<string> {
  const dirs = new Set<string>();
  // Only agents with instruction files can legitimately own their skills directory.
  for (const profile of Object.values(ctx.structure.agents)) {
    // Existing instruction files keep shared skill dirs from being flagged as orphaned.
    if (profile.skills_dir && ctx.fs.exists(profile.instruction_file)) {
      dirs.add(profile.skills_dir.replace(/\/$/, ""));
    }
  }
  return dirs;
}

/**
 * Check for agent artifacts left behind after an instruction file was removed.
 * Use in aggregate audit so stale skill/hook directories do not make setup look partially valid.
 *
 * @param ctx - audit context; missing goat-flow config means the project is not installed enough to judge
 * @returns audit failure listing orphaned agents, or `null` when no stale artifacts remain
 */
function checkOrphanedArtifacts(ctx: AuditContext): AuditFailure | null {
  // Without goat-flow config, the project has no install baseline for orphan checks.
  if (!ctx.config.exists) return null;
  const sharedDirs = presentAgentSkillsDirs(ctx);
  const missing: string[] = [];
  // Inspect every manifest agent so stale directories surface even outside selected-agent mode.
  for (const [agentId, profile] of Object.entries(ctx.structure.agents)) {
    // Instruction files still present mean the artifacts are owned.
    if (ctx.fs.exists(profile.instruction_file)) continue;
    const skillsDir = profile.skills_dir.replace(/\/$/, "");
    // Shared skill dirs are owned by another present agent, so do not report them as orphaned.
    if (skillsDir && sharedDirs.has(skillsDir)) continue;
    // Goat-flow artifacts without an instruction file leave the user with partial setup.
    if (agentArtifactsExist(ctx.fs, profile)) {
      missing.push(`${agentId} (${profile.instruction_file})`);
    }
  }
  // No orphaned artifacts means aggregate setup does not need cleanup guidance.
  if (missing.length === 0) return null;
  const noun = missing.length === 1 ? "file is" : "files are";
  return {
    check: "Agent instruction file",
    message: `Agent artifacts exist but instruction ${noun} missing: ${missing.join(", ")}`,
    howToFix: `Run \`goat-flow setup --agent <id>\` for each listed agent to recreate the instruction file, or remove the stale agent directories.`,
  };
}

/**
 * Build provenance for the instruction-file audit finding.
 * Use so audit output points the user at the manifest, architecture, and specific missing surface.
 *
 * @param ctx - audit context; missing agent filter falls back to the failed message when possible
 * @param failure - audit failure being explained; `null` returns broad instruction provenance
 * @returns evidence paths for the audit result; empty paths are removed by `uniquePaths`
 */
function agentInstructionProvenance(
  ctx: AuditContext,
  failure: AuditFailure | null,
): CheckEvidence {
  const paths = ["workflow/manifest.json", ".goat-flow/architecture.md"];
  const failedAgentId = failure?.message.match(/\b([a-z]+) \([^)]+\)/)?.[1];
  const agentId = ctx.agentFilter ?? failedAgentId;
  const profile = agentId ? ctx.structure.agents[agentId] : undefined;
  // Specific instruction files make the audit finding actionable for one agent.
  if (profile?.instruction_file) paths.push(profile.instruction_file);
  // Copilot commit guidance depends on both the auto-read file and preferred commit guide.
  if (
    agentId === "copilot" ||
    failure?.evidence === ".github/copilot-instructions.md"
  ) {
    paths.push(
      "workflow/setup/agents/copilot.md",
      ".github/copilot-instructions.md",
      "docs/coding-standards/git-commit-message.md",
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
      checkAnyAgentConfigured(ctx) ??
      checkSupportedInstructionFilesPresent(ctx) ??
      checkOrphanedArtifacts(ctx) ??
      checkCopilotCommitInstructionsPresent(ctx)
    );
  },
};

// === 2. Agent Skills ===

/**
 * Check canonical skill files and declared references for every selected agent.
 * Use so users see which skill mirrors need reinstalling before an agent follows stale workflows.
 * The nested walk is required because an agent can load any declared reference independently.
 *
 * @param ctx - audit context; empty agent list produces no missing skill findings here
 * @returns audit failure listing missing skill files, or `null` when mirrors match the manifest
 */
function checkCanonicalSkills(ctx: AuditContext): AuditFailure | null {
  const canonical = ctx.structure.skills.canonical;
  const missing: string[] = [];
  const references = ctx.structure.skills.references ?? {};
  // Inspect each configured agent mirror because users run one agent at a time.
  for (const agentFacts of ctx.agents) {
    // Every canonical skill should have the same installed shape for this agent.
    for (const skill of canonical) {
      const referenceFiles = Array.isArray(references[skill])
        ? references[skill].filter((file) => typeof file === "string")
        : [];
      // Check the skill body plus manifest-declared references the agent will read.
      for (const relativeFile of ["SKILL.md", ...referenceFiles]) {
        const skillPath = `${agentFacts.agent.skillsDir}/${skill}/${relativeFile}`;
        // Missing files mean the agent can load incomplete workflow instructions.
        if (!ctx.fs.exists(skillPath)) {
          missing.push(`${agentFacts.agent.id}:${skill}:${relativeFile}`);
        }
      }
    }
  }
  // Skill mirrors match the manifest, so the user does not need reinstall guidance.
  if (missing.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Missing skill files: ${missing.join(", ")}`,
    evidence: missing[0],
    howToFix:
      "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
  };
}

/**
 * Return manifest-declared reference files for one skill.
 * Use when pruning stale installed references without touching `SKILL.md`.
 *
 * @param ctx - audit context; missing reference map means the skill has no expected reference files
 * @param skill - canonical skill name; empty or unknown names return no expected references
 * @returns expected `references/` files; empty set means any installed reference is stale
 */
function expectedReferenceFiles(ctx: AuditContext, skill: string): Set<string> {
  const references = ctx.structure.skills.references ?? {};
  const referenceFiles = Array.isArray(references[skill])
    ? references[skill].filter(
        (file): file is string =>
          typeof file === "string" && file.startsWith("references/"),
      )
    : [];
  return new Set(referenceFiles);
}

/**
 * Check installed skill references that are no longer declared by the manifest.
 * Use after upgrades so users see stale reference files that could mislead an agent.
 *
 * @param ctx - audit context; empty agent list produces no stale reference findings
 * @returns audit failure listing unexpected references, or `null` when installed references are current
 */
function checkUnexpectedSkillReferences(
  ctx: AuditContext,
): AuditFailure | null {
  const unexpected: string[] = [];

  // Every agent mirror can retain stale files after an upgrade, so inspect each one.
  for (const agentFacts of ctx.agents) {
    // Stale references are scoped per canonical skill directory.
    for (const skill of ctx.structure.skills.canonical) {
      const skillRoot = `${agentFacts.agent.skillsDir}/${skill}`;
      const referencesDir = `${skillRoot}/references`;
      // Skills without a references directory have no stale references to prune.
      if (!ctx.fs.exists(referencesDir)) continue;

      const expected = expectedReferenceFiles(ctx, skill);
      // Glob installed Markdown references so removed files still surface.
      for (const path of ctx.fs.glob(`${referencesDir}/**/*.md`)) {
        const prefix = `${skillRoot}/`;
        const relativeFile = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path;
        // Any manifest-unlisted reference may give the agent outdated workflow guidance.
        if (!expected.has(relativeFile)) {
          unexpected.push(`${agentFacts.agent.id}:${skill}:${relativeFile}`);
        }
      }
    }
  }

  // No stale references means the installed mirror matches manifest ownership.
  if (unexpected.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Unexpected stale skill reference files found: ${unexpected.join(", ")}`,
    evidence: unexpected[0],
    howToFix:
      "Run `goat-flow install . --agent <id>` for the affected agent. The installer prunes manifest-unlisted skill reference files during upgrades.",
  };
}

/**
 * Check installed skill versions against the current goat-flow version.
 * Use so users know when agent skill mirrors need reinstalling after an upgrade.
 * Missing and mismatched versions stay separate because they require different evidence messages.
 *
 * @param ctx - audit context; empty version maps produce no mismatch findings here
 * @returns audit failure for missing/mismatched versions, or `null` when mirrors are current
 */
function checkSkillVersions(ctx: AuditContext): AuditFailure | null {
  const noVersion: string[] = [];
  const mismatch: string[] = [];
  // Every installed skill version is checked because one stale mirror can misroute an agent.
  for (const agentFacts of ctx.agents) {
    // Version metadata is stored per skill folder.
    for (const [name, version] of Object.entries(agentFacts.skills.versions)) {
      // Missing version means the user cannot tell whether this mirror matches the release.
      if (version === null) {
        noVersion.push(`${agentFacts.agent.id}:${name}`);
        // Mismatched version means the installed skill may carry old workflow rules.
      } else if (version !== AUDIT_VERSION) {
        mismatch.push(`${agentFacts.agent.id}:${name} (${version})`);
      }
    }
  }
  // Versionless skills need reinstall guidance before mismatch checks.
  if (noVersion.length > 0) {
    return {
      check: "Agent skills",
      message: `Missing goat-flow-skill-version: ${noVersion.join(", ")}`,
      evidence: noVersion[0],
      howToFix:
        "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
    };
  }
  // Stale skill versions need reinstall guidance with the expected version.
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

/**
 * Check stale skill directories left behind by renamed or removed skills.
 * Use so users remove old routing surfaces that an agent could still discover.
 * Final folder names are compared because each agent owns a different skill-root path.
 *
 * @param ctx - audit context; empty installed dirs produce no stale skill findings
 * @returns audit failure listing deprecated skill dirs, or `null` when no stale names remain
 */
function checkDeprecatedSkills(ctx: AuditContext): AuditFailure | null {
  const staleNames = new Set(ctx.structure.skills.stale_names);
  const found: string[] = [];
  // Inspect every installed skill directory because old names can coexist beside current skills.
  for (const agentFacts of ctx.agents) {
    // Installed dirs are matched by final folder name so agent-specific roots do not matter.
    for (const dir of agentFacts.skills.installedDirs) {
      const name = dir.split("/").pop() ?? "";
      // Stale names mean the user may see duplicate or outdated skill routing.
      if (staleNames.has(name)) {
        found.push(`${agentFacts.agent.id}:${name}`);
      }
    }
  }
  // No deprecated skill dirs means the agent has no stale routing surface to remove.
  if (found.length === 0) return null;
  // Convert compact identifiers back into paths the user can remove.
  const paths = found.map((s) => {
    const [agent, name] = s.split(":");
    const agentFacts = ctx.agents.find((a) => a.agent.id === agent);
    return agentFacts ? `${agentFacts.agent.skillsDir}/${name}` : name;
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
    ".goat-flow/learning-loop/footguns/skills.md",
  ]),
  // A stale CLI's manifest and skill templates cannot identify defects in a newer install.
  skip: targetUsesNewerGoatFlow,
  /** Run the Agent skills check. */
  run: (ctx) => {
    // Aggregate mode gets instruction-level coverage; skill mirrors are checked per selected agent.
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(ctx, "Agent skills");
    // Missing instruction files block deeper skill checks because remediation starts with setup.
    if (blocked) return blocked;
    return (
      checkCanonicalSkills(ctx) ??
      checkUnexpectedSkillReferences(ctx) ??
      checkSkillVersions(ctx) ??
      checkDeprecatedSkills(ctx)
    );
  },
};

// === 3. Agent Settings ===

/** 4 agent setup checks */
export const AGENT_CHECKS: BuildCheck[] = [
  agentInstruction,
  agentSkills,
  agentSettings,
  agentDenyMechanism,
];
