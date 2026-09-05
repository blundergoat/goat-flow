/**
 * Report the selected project's agent installation gaps through goat-flow audit.
 *
 * Aggregate checks explain missing instruction files and orphaned installation artifacts across managed agents.
 * A selected-agent audit also checks that agent's skills, settings, and deny mechanism, with repair guidance for the first failing prerequisite.
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
 * Identify known goat-flow hooks or canonical skill folders before reporting an orphaned agent installation.
 * An unreadable skills directory reports no skill evidence, so ordinary agent settings alone never trigger cleanup guidance.
 *
 * @param fs - target filesystem used to find known installed hook files or skill folders
 * @param profile - manifest paths for one agent; an omitted hooks directory limits the evidence search to its skills
 * @returns - true when known goat-flow artifacts are found; false means this helper found no evidence of an orphaned installation
 */
function agentArtifactsExist(
  fs: ReadonlyFS,
  profile: { hooks_dir?: string; settings?: string; skills_dir: string },
): boolean {
  // A profile without a hook directory can establish an installed artifact only through its canonical skill folders.
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
    if (entries.some((skillName) => getSkillNames().includes(skillName)))
      return true;
  } catch {
    // A caller's filesystem adapter may reject a removed skills directory; ignore it as evidence for orphaned-install cleanup.
  }
  return false;
}

/**
 * Check whether the selected agent has its instruction file installed.
 * Use in `--agent <id>` audits so the first setup failure points at the missing starter file.
 *
 * @param ctx - audit context; missing agent facts mean the selected instruction file was not found
 * @returns - missing-instruction failure, or null when the selected instruction file exists
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
  // If no profile supplies the filename, still identify the selected agent in the setup repair message.
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
 * @param ctx - target facts; an empty agents list means no managed agent was included in this audit
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
 * Check an existing Copilot instruction file for a reference to an accepted project commit guide.
 * Use in scoped Git-checkout audits; missing instruction files remain the broader setup check's responsibility.
 *
 * @param ctx - target facts and filesystem; an out-of-scope or absent Copilot instruction file receives no specialized finding
 * @returns - missing-guide-reference failure, or null when an accepted reference exists or this check does not apply
 */
function checkCopilotCommitInstructionsPresent(
  ctx: AuditContext,
): AuditFailure | null {
  // Copilot is not in scope, so do not ask the user to edit GitHub instruction files.
  if (!shouldCheckCopilotCommitInstructions(ctx)) return null;
  // Use the manifest's Copilot instruction path when available, with the standard location as the fallback.
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
  // An unreadable instruction file cannot prove that Copilot will receive the project's commit guide.
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
  const presentSkillsDirectories = new Set<string>();
  // Only agents with instruction files can legitimately own their skills directory.
  for (const profile of Object.values(ctx.structure.agents)) {
    // Existing instruction files keep shared skill dirs from being flagged as orphaned.
    if (profile.skills_dir && ctx.fs.exists(profile.instruction_file)) {
      presentSkillsDirectories.add(profile.skills_dir.replace(/\/$/, ""));
    }
  }
  return presentSkillsDirectories;
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
  const sharedSkillsDirectories = presentAgentSkillsDirs(ctx);
  const missing: string[] = [];
  // Inspect every manifest agent so stale directories surface even outside selected-agent mode.
  for (const [agentId, profile] of Object.entries(ctx.structure.agents)) {
    // Instruction files still present mean the artifacts are owned.
    if (ctx.fs.exists(profile.instruction_file)) continue;
    const skillsDir = profile.skills_dir.replace(/\/$/, "");
    // Shared skill dirs are owned by another present agent, so do not report them as orphaned.
    if (skillsDir && sharedSkillsDirectories.has(skillsDir)) continue;
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
 * @param failure - finding to explain; null omits failure-derived paths while still honoring an explicit agent selection
 * @returns - evidence for the audit result with duplicate paths removed and relevant instruction or commit-guide paths included
 */
function agentInstructionProvenance(
  ctx: AuditContext,
  failure: AuditFailure | null,
): CheckEvidence {
  const paths = ["workflow/manifest.json", ".goat-flow/architecture.md"];
  // With no failed message or recognizable agent name, only an explicit agent selection can narrow this evidence.
  const failedAgentId = failure?.message.match(/\b([a-z]+) \([^)]+\)/)?.[1];
  const agentId = ctx.agentFilter ?? failedAgentId;
  // No selected or failure-derived agent means the finding keeps framework-wide instruction evidence.
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
  // Report the first instruction prerequisite for the selected agent, or aggregate installation coverage when no agent is selected.
  run: (ctx) => {
    // A selected-agent request needs that agent's starter file and any applicable commit-guide reference.
    if (ctx.agentFilter) {
      return (
        checkInstructionPresent(ctx) ??
        checkCopilotCommitInstructionsPresent(ctx)
      );
    }
    // Aggregate setup first needs a managed agent, then complete instruction coverage, then orphan and commit-guide checks.
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
 *
 * Use so users see which skill mirrors need reinstalling before an agent follows stale workflows.
 * The nested walk is required because an agent can load any declared reference independently.
 *
 * @param ctx - audit context; empty agent list produces no missing skill findings here
 * @returns - missing required skill paths, or null when no required path was found missing
 */
function checkCanonicalSkills(ctx: AuditContext): AuditFailure | null {
  const canonical = ctx.structure.skills.canonical;
  const missing: string[] = [];
  // An absent reference map adds no extra required files beyond each canonical skill's SKILL.md.
  const references = ctx.structure.skills.references ?? {};
  // Inspect each configured agent mirror because users run one agent at a time.
  for (const agentFacts of ctx.agents) {
    // Every canonical skill should have the same installed shape for this agent.
    for (const skill of canonical) {
      // Only declared string paths add reference requirements; absent or unusable declarations leave just the skill body.
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
  // No required path was reported missing; separate checks still assess stale references and version metadata.
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
 * Identify the reference paths the manifest still permits so stale-file findings do not target the skill body.
 *
 * @param ctx - manifest structure; an absent reference map approves no extra reference paths
 * @param skill - canonical skill whose reference declaration is being inspected
 * @returns - declared references/ paths; an empty set approves none of the caller's installed reference candidates
 */
function expectedReferenceFiles(ctx: AuditContext, skill: string): Set<string> {
  // Missing reference metadata leaves the caller with no approved reference candidates for this skill.
  const references = ctx.structure.skills.references ?? {};
  // Only an array of reference paths can establish which installed files the manifest still owns.
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
 * Use after upgrades, because a reference file left behind by a rename still looks authoritative to an agent reading it.
 *
 * @param ctx - audit context; empty agent list produces no stale reference findings
 * @returns - unexpected scanned references, or null when no scanned reference falls outside the manifest's declared set
 */
function checkUnexpectedSkillReferences(
  ctx: AuditContext,
): AuditFailure | null {
  const unexpectedSkillReferences: string[] = [];

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
        // Compare installed files with the manifest's skill-relative paths; unfamiliar prefixes remain intact for that comparison.
        const relativeFile = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path;
        // Any manifest-unlisted reference may give the agent outdated workflow guidance.
        if (!expected.has(relativeFile)) {
          unexpectedSkillReferences.push(
            `${agentFacts.agent.id}:${skill}:${relativeFile}`,
          );
        }
      }
    }
  }

  // No stale references means the installed mirror matches manifest ownership.
  if (unexpectedSkillReferences.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Unexpected stale skill reference files found: ${unexpectedSkillReferences.join(", ")}`,
    evidence: unexpectedSkillReferences[0],
    howToFix:
      "Run `goat-flow install . --agent <id>` for the affected agent. The installer prunes manifest-unlisted skill reference files during upgrades.",
  };
}

/**
 * Check installed skill versions against the current goat-flow version.
 *
 * Use so users know when agent skill mirrors need reinstalling after an upgrade.
 * Missing and mismatched versions stay separate because they require different evidence messages.
 *
 * @param ctx - audit context; empty version maps produce no mismatch findings here
 * @returns - missing or mismatched version finding, or null when inspected version entries require no repair
 */
function checkSkillVersions(ctx: AuditContext): AuditFailure | null {
  const skillsWithoutVersion: string[] = [];
  const skillsWithVersionMismatch: string[] = [];
  // Every installed skill version is checked because one stale mirror can misroute an agent.
  for (const agentFacts of ctx.agents) {
    // Version metadata is stored per skill folder.
    for (const [name, version] of Object.entries(agentFacts.skills.versions)) {
      // Missing version means the user cannot tell whether this mirror matches the release.
      if (version === null) {
        skillsWithoutVersion.push(`${agentFacts.agent.id}:${name}`);
        // Mismatched version means the installed skill may carry old workflow rules.
      } else if (version !== AUDIT_VERSION) {
        skillsWithVersionMismatch.push(
          `${agentFacts.agent.id}:${name} (${version})`,
        );
      }
    }
  }
  // Versionless skills need reinstall guidance before mismatch checks.
  if (skillsWithoutVersion.length > 0) {
    return {
      check: "Agent skills",
      message: `Missing goat-flow-skill-version: ${skillsWithoutVersion.join(", ")}`,
      evidence: skillsWithoutVersion[0],
      howToFix:
        "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
    };
  }
  // Stale skill versions need reinstall guidance with the expected version.
  if (skillsWithVersionMismatch.length > 0) {
    return {
      check: "Agent skills",
      message: `Version mismatch (expected ${AUDIT_VERSION}): ${skillsWithVersionMismatch.join(", ")}`,
      evidence: skillsWithVersionMismatch[0],
      howToFix:
        "Re-install skills by running `goat-flow install . --agent <id>` for the affected agent.",
    };
  }
  return null;
}

/**
 * Check stale skill directories left behind by renamed or removed skills.
 *
 * Use so users remove old routing surfaces that an agent could still discover.
 * Final folder names are compared because each agent owns a different skill-root path.
 *
 * @param ctx - audit context; empty installed dirs produce no stale skill findings
 * @returns audit failure listing deprecated skill dirs, or `null` when no stale names remain
 */
function checkDeprecatedSkills(ctx: AuditContext): AuditFailure | null {
  const staleNames = new Set(ctx.structure.skills.stale_names);
  const deprecatedSkills: string[] = [];
  // Inspect every installed skill directory because old names can coexist beside current skills.
  for (const agentFacts of ctx.agents) {
    // Installed dirs are matched by final folder name so agent-specific roots do not matter.
    for (const installedSkillDirectory of agentFacts.skills.installedDirs) {
      // Without a final folder name, this installed path supplies no deprecated skill name to report.
      const name = installedSkillDirectory.split("/").pop() ?? "";
      // Stale names mean the user may see duplicate or outdated skill routing.
      if (staleNames.has(name)) {
        deprecatedSkills.push(`${agentFacts.agent.id}:${name}`);
      }
    }
  }
  // No deprecated skill dirs means the agent has no stale routing surface to remove.
  if (deprecatedSkills.length === 0) return null;
  // Convert compact identifiers back into paths the user can remove.
  const paths = deprecatedSkills.map((deprecatedSkill) => {
    const [agent, name] = deprecatedSkill.split(":");
    const agentFacts = ctx.agents.find(
      (candidateAgentFacts) => candidateAgentFacts.agent.id === agent,
    );
    // A known agent supplies the removable directory path; otherwise keep the identified stale skill name in the guidance.
    return agentFacts ? `${agentFacts.agent.skillsDir}/${name}` : name;
  });
  return {
    check: "Agent skills",
    message: `Deprecated skill directories found: ${deprecatedSkills.join(", ")}`,
    evidence: deprecatedSkills[0],
    howToFix: `Remove the deprecated ${deprecatedSkills.length === 1 ? "directory" : "directories"}: ${paths.join(", ")}. Delete the SKILL.md inside each, then remove the empty directory.`,
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
  // Report the first missing, stale, or wrongly versioned skill artifact after the selected agent's instruction file is available.
  run: (ctx) => {
    // Aggregate mode gets instruction-level coverage; skill mirrors are checked per selected agent.
    if (!ctx.agentFilter) return null;
    const instructionFailure = checkSelectedInstructionAvailable(
      ctx,
      "Agent skills",
    );
    // Missing instruction files block deeper skill checks because remediation starts with setup.
    if (instructionFailure) return instructionFailure;
    // Missing files take priority; once restored, the next audit can identify stale references, versions, or retired skill names.
    return (
      checkCanonicalSkills(ctx) ??
      checkUnexpectedSkillReferences(ctx) ??
      checkSkillVersions(ctx) ??
      checkDeprecatedSkills(ctx)
    );
  },
};

// === 3. Agent Settings ===

// 4 agent setup checks
export const AGENT_CHECKS: BuildCheck[] = [
  agentInstruction,
  agentSkills,
  agentSettings,
  agentDenyMechanism,
];
