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
import { collectCodexWorkspaceRootEntries } from "../facts/agent/settings.js";
import { agentDenyMechanism } from "./check-agent-deny-mechanism.js";
import {
  checkSelectedInstructionAvailable,
  specProvenance,
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
  // A different explicit agent should not receive Copilot-specific setup findings.
  if (ctx.agentFilter !== null && ctx.agentFilter !== "copilot") return false;
  // Without `.github`, there is no Copilot auto-read instruction file for the user to fix.
  if (!ctx.fs.exists(".github")) return false;
  // Explicit Copilot audits should validate the Copilot bridge even if other facts are missing.
  if (ctx.agentFilter === "copilot") return true;
  return ctx.structure.agents.copilot !== undefined;
}

/**
 * Check whether the Copilot instruction file bridges to the canonical commit guide.
 *
 * IDEs (VS Code, JetBrains) auto-read .github/copilot-instructions.md but not
 * docs/coding-standards/git-commit.md, so commit conventions only reach Copilot when the auto-read
 * instruction file references the canonical doc. Returns null - no failure - when the .github/ dir
 * is absent, when Copilot is not a configured agent in aggregate mode (a Claude/Codex project that
 * happens to ship GitHub config must not be forced to add it), when the Copilot instruction file
 * itself is missing (the broader instruction-file check owns that failure), or when the reference
 * is already present.
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
  const commitGuide = "docs/coding-standards/git-commit.md";
  // Copilot already sees the canonical commit guide through its auto-read file.
  if ((ctx.fs.readFile(copilotInstruction) ?? "").includes(commitGuide)) {
    return null;
  }
  return {
    check: "Agent instruction file",
    message: `Missing: copilot (${copilotInstruction} must reference ${commitGuide})`,
    evidence: copilotInstruction,
    howToFix: `Add a ## Commit Messages section to ${copilotInstruction} that references ${commitGuide}, then rerun \`goat-flow audit --agent copilot\`.`,
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
  // Copilot commit guidance depends on both the auto-read file and canonical commit guide.
  if (
    agentId === "copilot" ||
    failure?.evidence === ".github/copilot-instructions.md"
  ) {
    paths.push(
      "workflow/setup/agents/copilot.md",
      ".github/copilot-instructions.md",
      "docs/coding-standards/git-commit.md",
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

/**
 * Read parsed settings as a flat object.
 * Use before checking agent settings keys that come from JSON/TOML parsers.
 *
 * @param parsed - parsed settings value; `null`, empty, or primitive values mean no settings keys are readable
 * @returns settings object, or `null` when the audit cannot inspect keys safely
 */
function settingsObject(parsed: unknown): Record<string, unknown> | null {
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

/**
 * Check whether parsed settings include one exact key.
 * Use for flattened TOML facts where section keys appear as dotted strings.
 *
 * @param parsed - parsed settings value; `null` means the key is absent for audit purposes
 * @param key - exact flattened key to find; empty means no meaningful setting can match
 * @returns whether the key exists exactly
 */
function hasSettingsKey(parsed: unknown, key: string): boolean {
  const settings = settingsObject(parsed);
  return settings ? Object.prototype.hasOwnProperty.call(settings, key) : false;
}

/**
 * Read an explicit boolean setting.
 * Use when missing and mistyped settings must not be treated as a safe `false`.
 *
 * @param parsed - parsed settings value; `null` means no boolean can be read
 * @param key - exact flattened key to read; empty returns `null` because no setting is identified
 * @returns boolean setting value, or `null` when missing/mistyped so audit can report it clearly
 */
function booleanSetting(parsed: unknown, key: string): boolean | null {
  const settings = settingsObject(parsed);
  // Missing settings mean the audit cannot prove the user enabled the feature.
  if (!settings) return null;
  const value = settings[key];
  return typeof value === "boolean" ? value : null;
}

/**
 * Report the old Codex hooks flag.
 * Use so users migrate from `[features].codex_hooks` to the current `[features].hooks`.
 *
 * @param ctx - audit context; non-Codex agents are ignored
 * @returns audit failure for deprecated Codex settings, or `null` when none are present
 */
function checkCodexDeprecatedHooksFlag(ctx: AuditContext): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns this setting.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use `.codex/config.toml`.
    if (agentFacts.agent.id !== "codex") continue;
    // No deprecated key means the user is not carrying the old Codex hook flag.
    if (!hasSettingsKey(agentFacts.settings.parsed, "features.codex_hooks"))
      continue;
    return {
      check: "Agent settings",
      message:
        "Deprecated Codex feature flag in .codex/config.toml: [features].codex_hooks",
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Replace `codex_hooks` with `hooks` under `[features]`, or run `goat-flow install . --agent codex` to migrate the setting.",
    };
  }
  return null;
}

/**
 * Report Codex hooks installed without the required feature flag.
 * Use so users know why an installed Codex guardrail will not execute.
 *
 * @param ctx - audit context; non-Codex agents and projects without hooks are ignored
 * @returns audit failure when hooks are installed but disabled, or `null` when runnable/not applicable
 */
function checkCodexHooksEnabled(ctx: AuditContext): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns this feature flag.
  for (const agentFacts of ctx.agents) {
    // Other agents do not need Codex hooks enabled.
    if (agentFacts.agent.id !== "codex") continue;
    // No installed/registered hook means there is nothing Codex needs to run yet.
    if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsRegistered)
      continue;
    // The current feature flag is present, so Codex can run registered hooks.
    if (booleanSetting(agentFacts.settings.parsed, "features.hooks") === true) {
      continue;
    }
    return {
      check: "Agent settings",
      message:
        "Codex hooks are installed but .codex/config.toml does not enable [features].hooks = true",
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Add `hooks = true` under `[features]` in .codex/config.toml, or run `goat-flow install . --agent codex` to install the current Codex settings template.",
    };
  }
  return null;
}

/**
 * Detect exact Codex workspace-root deny paths that should exist on disk.
 * Use so audit can report absent exact paths separately from valid subtree globs.
 *
 * @param pattern - Codex filesystem pattern; empty is treated as an exact missing path
 * @returns whether the pattern is exact and should exist in the checkout
 */
function isCodexExactWorkspaceRootPath(pattern: string): boolean {
  return pattern !== "." && !pattern.includes("*") && !pattern.endsWith("/**");
}

/**
 * Detect Codex none-mode globs rejected by newer Codex config grammar.
 * Use so users can rewrite filename globs into trailing `/**` subtree denies.
 *
 * @param pattern - Codex filesystem pattern; empty/non-glob patterns are not invalid globs here
 * @returns whether the glob must be migrated before Codex accepts the profile
 */
function isCodexInvalidNoneGlob(pattern: string): boolean {
  // Exact paths are handled by the missing-path check, not the invalid-glob check.
  if (!pattern.includes("*")) return false;
  return !pattern.endsWith("/**");
}

/**
 * Collect invalid inline filesystem globs from a TOML inline table string.
 * Use when Codex settings store workspace-root permissions in one flattened value.
 *
 * @param rawValue - raw TOML inline table; empty or non-table text contributes no findings
 * @param invalidGlobs - mutable finding list; remains empty when every none-mode glob is valid
 * @returns nothing; invalid patterns are appended for the audit message
 */
function collectInvalidCodexInlineGlobs(
  rawValue: string,
  invalidGlobs: string[],
): void {
  // Each inline table entry can carry a pattern whose invalid shape affects Codex startup.
  for (const [pattern, mode] of parseTomlInlineStringTableForKey(rawValue)) {
    // Only `none` access patterns block workspace reads/writes and need subtree syntax.
    if (mode === "none" && isCodexInvalidNoneGlob(pattern)) {
      invalidGlobs.push(pattern);
    }
  }
}

/**
 * Extract a Codex filesystem pattern from a flattened TOML key.
 * Use for current and legacy workspace-root anchors during migration checks.
 *
 * @param key - flattened settings key; empty means no filesystem pattern can be extracted
 * @param expandedRootPrefix - current workspace-root key prefix; empty would match too broadly
 * @param legacyExpandedRootPrefix - legacy project-root key prefix; empty would match too broadly
 * @returns extracted pattern, or `null` when the key is not a filesystem entry
 */
function codexFilesystemPatternFromKey(
  key: string,
  expandedRootPrefix: string,
  legacyExpandedRootPrefix: string,
): string | null {
  // Current workspace-root keys use Codex 0.131+ terminology.
  if (key.startsWith(expandedRootPrefix)) {
    return key.slice(expandedRootPrefix.length);
  }
  // Legacy project-root keys need migration but can still expose invalid patterns.
  if (key.startsWith(legacyExpandedRootPrefix)) {
    return key.slice(legacyExpandedRootPrefix.length);
  }
  return null;
}

/**
 * Collect invalid Codex filesystem settings from one flattened entry.
 * Use so audit can report both invalid globs and legacy anchors in one user-facing finding.
 *
 * @param key - flattened settings key; empty means this entry is ignored
 * @param value - flattened setting value; non-string values cannot contain inline glob entries
 * @param filesystemPrefix - current permission-profile prefix; empty would match unrelated settings
 * @param legacyAnchor - legacy project-root anchor; empty would match unrelated settings
 * @param invalidGlobs - mutable list of invalid patterns; empty means no glob migration found yet
 * @param legacyAnchors - mutable list of legacy anchors; empty means no anchor migration found yet
 * @returns nothing; findings are appended for the audit message
 */
function collectCodexFilesystemEntryFindings(
  key: string,
  value: unknown,
  filesystemPrefix: string,
  legacyAnchor: string,
  invalidGlobs: string[],
  legacyAnchors: string[],
): void {
  // Non-filesystem settings do not affect Codex workspace-root access.
  if (!key.startsWith(filesystemPrefix)) return;
  // Legacy project-root anchors need migration to the workspace-root name Codex now accepts.
  if (key === legacyAnchor || key.startsWith(`${legacyAnchor}.`)) {
    legacyAnchors.push(":project_roots");
  }
  // Non-string values cannot be parsed for inline permission patterns.
  if (typeof value !== "string") return;

  const isInlineRoot =
    key === `${filesystemPrefix}:workspace_roots` || key === legacyAnchor;
  // Inline root tables may hold several user-denied patterns in one TOML value.
  if (isInlineRoot) {
    collectInvalidCodexInlineGlobs(value, invalidGlobs);
    return;
  }

  const pattern = codexFilesystemPatternFromKey(
    key,
    `${filesystemPrefix}:workspace_roots.`,
    `${legacyAnchor}.`,
  );
  // Non-pattern entries or non-`none` modes do not produce invalid deny-glob findings.
  if (pattern === null || value !== "none") return;
  // Invalid none-mode globs make Codex reject the permission profile.
  if (isCodexInvalidNoneGlob(pattern)) {
    invalidGlobs.push(pattern);
  }
}

/**
 * Collect Codex filesystem-profile findings for one permission profile.
 * Use when audit checks whether Codex config will load in current Codex versions.
 *
 * @param parsed - parsed Codex settings; `null` or non-object values produce no filesystem findings
 * @param profileName - active permissions profile; empty points at no useful profile
 * @returns invalid globs and legacy anchors; empty arrays mean no migration is needed
 */
function collectCodexFilesystemFindings(
  parsed: unknown,
  profileName: string,
): { invalidGlobs: string[]; legacyAnchors: string[] } {
  const invalidGlobs: string[] = [];
  const legacyAnchors: string[] = [];
  // Without a settings object, the audit cannot inspect Codex filesystem entries.
  if (!parsed || typeof parsed !== "object") {
    return { invalidGlobs, legacyAnchors };
  }
  const filesystemPrefix = `permissions.${profileName}.filesystem.`;
  const legacyAnchor = `${filesystemPrefix}:project_roots`;
  // Inspect each flattened TOML key because filesystem entries can be represented several ways.
  for (const [key, value] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    collectCodexFilesystemEntryFindings(
      key,
      value,
      filesystemPrefix,
      legacyAnchor,
      invalidGlobs,
      legacyAnchors,
    );
  }
  return { invalidGlobs, legacyAnchors };
}

/**
 * Parse a TOML inline string table into key/value pairs.
 * Use for Codex filesystem permission tables flattened into a single settings value.
 *
 * @param rawValue - raw inline table text; empty or non-table text produces no entries
 * @returns parsed key/value pairs; empty array means no inline permissions were readable
 */
function parseTomlInlineStringTableForKey(
  rawValue: string,
): Array<[string, string]> {
  const value = rawValue.trim();
  // Only inline table text can carry the compact workspace-root permission shape.
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  const entries: Array<[string, string]> = [];
  const entryPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/gu;
  // Each quoted key/value pair maps a workspace pattern to an access mode.
  for (const match of value.matchAll(entryPattern)) {
    const [, key, mode] = match;
    // Empty keys or modes cannot produce an actionable Codex migration finding.
    if (key && mode) entries.push([key, mode]);
  }
  return entries;
}

/**
 * Build the Codex invalid-workspace-root audit message.
 * Use so invalid globs and legacy anchors appear in one remediation paragraph.
 *
 * @param invalidGlobs - invalid none-mode patterns; empty omits the glob sentence
 * @param legacyAnchors - legacy anchors found in config; empty omits the anchor sentence
 * @returns user-facing audit message; empty inputs still return the shared Codex grammar reminder
 */
function formatCodexWorkspaceRootInvalidGlobMessage(
  invalidGlobs: string[],
  legacyAnchors: string[],
): string {
  const messageParts: string[] = [];
  // Invalid globs are listed so the user knows exactly which patterns to rewrite.
  if (invalidGlobs.length > 0) {
    messageParts.push(
      `Codex permission profile uses filename-glob patterns with "none" access that Codex 0.131+ rejects: ${uniquePaths(invalidGlobs).join(", ")}`,
    );
  }
  // Legacy anchors are called out separately because the fix is a key-name migration.
  if (legacyAnchors.length > 0) {
    messageParts.push(
      `Codex permission profile uses the legacy ":project_roots" anchor (Codex 0.131+ uses ":workspace_roots")`,
    );
  }
  return `${messageParts.join("; ")}. Codex requires exact paths or trailing "/**" subtree patterns for "none" access.`;
}

/**
 * Check Codex workspace-root permission entries for current grammar compatibility.
 * Use so users can fix config that would make dashboard-launched Codex fail before startup.
 *
 * @param ctx - audit context; non-Codex agents or missing profile names are ignored
 * @returns audit failure for invalid globs/anchors, or `null` when no migration is needed
 */
function checkCodexWorkspaceRootInvalidGlobs(
  ctx: AuditContext,
): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns workspace-root profiles.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use Codex filesystem permission grammar.
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    // Without a default profile, there is no active Codex filesystem profile to validate.
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const { invalidGlobs, legacyAnchors } = collectCodexFilesystemFindings(
      agentFacts.settings.parsed,
      defaultPermissions,
    );
    // No invalid globs or legacy anchors means the active profile is grammar-compatible.
    if (invalidGlobs.length === 0 && legacyAnchors.length === 0) continue;
    return {
      check: "Agent settings",
      message: formatCodexWorkspaceRootInvalidGlobMessage(
        invalidGlobs,
        legacyAnchors,
      ),
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Run `goat-flow install . --agent codex` (without --force) to migrate the .codex/config.toml filesystem block in place. The installer rewrites filename globs to canonical subtree denies (e.g. `secrets/**`, `.ssh/**`). Filename-level protections are covered by .goat-flow/hooks/deny-dangerous.sh.",
    };
  }
  return null;
}

/**
 * Check Codex exact workspace-root paths that do not exist.
 * Use so users remove stale exact entries while keeping valid subtree deny patterns.
 *
 * @param ctx - audit context; non-Codex agents or missing profile names are ignored
 * @returns audit failure listing absent exact paths, or `null` when exact entries are valid
 */
function checkCodexWorkspaceRootExactPaths(
  ctx: AuditContext,
): AuditFailure | null {
  // Every selected agent is inspected, but only Codex owns workspace-root profiles.
  for (const agentFacts of ctx.agents) {
    // Other agents do not use Codex filesystem permission grammar.
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    // Without a default profile, there is no active Codex filesystem profile to validate.
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const missing = collectCodexWorkspaceRootEntries(
      agentFacts.settings.parsed,
      defaultPermissions,
    )
      .filter((entry) => isCodexExactWorkspaceRootPath(entry.pattern))
      .map((entry) => entry.pattern)
      .filter((pattern) => !ctx.fs.exists(pattern));
    // All exact paths exist, so the user does not need to edit this profile.
    if (missing.length === 0) continue;
    return {
      check: "Agent settings",
      message: `Codex permission profile lists exact workspace-root paths that do not exist: ${uniquePaths(missing).join(", ")}`,
      evidence: agentFacts.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Remove absent exact entries from .codex/config.toml. Keep trailing `/**` subtree denies, and add exact `none`/`read` entries only for files that exist in this checkout.",
    };
  }
  return null;
}

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
    // Aggregate mode stops at instruction coverage; settings are checked per selected agent.
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(ctx, "Agent settings");
    // Missing instruction files block settings checks because setup must recreate the agent surface first.
    if (blocked) return blocked;
    const invalid: string[] = [];
    // Invalid settings syntax is reported before semantic Codex migration checks.
    for (const agentFacts of ctx.agents) {
      // Settings that exist but failed parsing need syntax repair from the user.
      if (agentFacts.settings.exists && !agentFacts.settings.valid) {
        invalid.push(agentFacts.agent.id);
      }
    }
    // Syntax errors prevent reliable semantic checks, so report them first.
    if (invalid.length > 0) {
      return {
        check: "Agent settings",
        message: `Invalid settings for: ${invalid.join(", ")}`,
        howToFix: `Fix the JSON syntax in the settings file for ${invalid.join(", ")}.`,
      };
    }
    return (
      checkCodexDeprecatedHooksFlag(ctx) ??
      checkCodexHooksEnabled(ctx) ??
      checkCodexWorkspaceRootInvalidGlobs(ctx) ??
      checkCodexWorkspaceRootExactPaths(ctx)
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
