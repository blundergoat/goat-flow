/**
 * Agent Setup checks for `goat-flow audit --agent <id>`.
 * 4 checks that validate per-agent installation: instruction, skills, settings, guardrail hooks.
 * All checks require --agent and skip in aggregate mode (except orphaned-artifacts detection).
 */
import type { AuditFailure, BuildCheck, AuditContext } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../constants.js";
import { collectCodexWorkspaceRootEntries } from "../facts/agent/settings.js";
import { agentDenyMechanism } from "./check-agent-deny-mechanism.js";
import {
  checkSelectedInstructionAvailable,
  specProvenance,
  uniquePaths,
} from "./check-agent-common.js";

// === 1. Agent Instruction ===

/** Returns true if goat-flow-specific artifacts exist for an agent.
 *  A bare agent directory (e.g. `.claude/` from Claude Code) with only a
 *  settings file does NOT count - we require goat-flow skill directories
 *  or the guardrail hook scripts to distinguish goat-flow installs from the
 *  agent's own config. */
function agentArtifactsExist(
  fs: ReadonlyFS,
  profile: { hooks_dir?: string; settings?: string; skills_dir: string },
): boolean {
  const hooksDir = profile.hooks_dir?.replace(/\/$/, "");
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
    if (entries.some((e) => SKILL_NAMES.includes(e))) return true;
  } catch {
    // listDir may throw if the directory doesn't exist
  }
  return false;
}

/** Check whether the selected agent has its instruction file installed. */
function checkInstructionPresent(ctx: AuditContext): AuditFailure | null {
  const agentFacts = ctx.agents.find(
    (agentFacts) => agentFacts.agent.id === ctx.agentFilter,
  );
  if (agentFacts?.instruction.exists) return null;
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

/** Check supported managed agents whose primary instruction files are absent. */
function checkSupportedInstructionFilesPresent(
  ctx: AuditContext,
): AuditFailure | null {
  const missing = ctx.agents
    .filter((agentFacts) => !agentFacts.instruction.exists)
    .map(
      (agentFacts) =>
        `${agentFacts.agent.id} (${agentFacts.agent.instructionFile})`,
    );
  if (missing.length === 0) return null;
  return {
    check: "Agent instruction file",
    message: `Supported agent instruction files missing: ${missing.join(", ")}`,
    howToFix:
      "Run `goat-flow setup --agent <id>` for each missing agent, or use `goat-flow audit . --agent <id>` to scope the audit to one agent.",
  };
}

/** Check that aggregate agent scope has at least one managed agent surface. */
function checkAnyAgentConfigured(ctx: AuditContext): AuditFailure | null {
  if (ctx.agents.length > 0) return null;
  return {
    check: "Agent instruction file",
    message: "No supported agent instruction files found",
    howToFix:
      "Run `goat-flow setup --agent <id>` for the agent this repo should manage, then complete the project-specific setup steps.",
  };
}

/** Return a blocking failure for dependent per-agent checks when the primary
 *  instruction file is missing and no agent facts were extracted. */
function shouldCheckCopilotCommitInstructions(ctx: AuditContext): boolean {
  if (ctx.agentFilter !== null && ctx.agentFilter !== "copilot") return false;
  if (!ctx.fs.exists(".github")) return false;
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
 * @param ctx - Audit context exposing the read-only filesystem, agent filter, and resolved structure.
 * @returns An AuditFailure when the instruction file omits the commit-guide reference, otherwise null.
 */
function checkCopilotCommitInstructionsPresent(
  ctx: AuditContext,
): AuditFailure | null {
  if (!shouldCheckCopilotCommitInstructions(ctx)) return null;
  const copilotInstruction =
    ctx.structure.agents.copilot?.instruction_file ??
    ".github/copilot-instructions.md";
  if (!ctx.fs.exists(copilotInstruction)) return null;
  const commitGuide = "docs/coding-standards/git-commit.md";
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

/** Skills dirs owned by agents whose instruction file is present. */
function presentAgentSkillsDirs(ctx: AuditContext): Set<string> {
  const dirs = new Set<string>();
  for (const profile of Object.values(ctx.structure.agents)) {
    if (profile.skills_dir && ctx.fs.exists(profile.instruction_file)) {
      dirs.add(profile.skills_dir.replace(/\/$/, ""));
    }
  }
  return dirs;
}

/** Check for agent artifacts that remain after their instruction file was removed. */
function checkOrphanedArtifacts(ctx: AuditContext): AuditFailure | null {
  if (!ctx.config.exists) return null;
  const sharedDirs = presentAgentSkillsDirs(ctx);
  const missing: string[] = [];
  for (const [agentId, profile] of Object.entries(ctx.structure.agents)) {
    if (ctx.fs.exists(profile.instruction_file)) continue;
    const skillsDir = profile.skills_dir.replace(/\/$/, "");
    if (skillsDir && sharedDirs.has(skillsDir)) continue;
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

/** Check canonical skills and references because every agent mirror must preserve the install contract. */
function checkCanonicalSkills(ctx: AuditContext): AuditFailure | null {
  const canonical = ctx.structure.skills.canonical;
  const missing: string[] = [];
  const references = ctx.structure.skills.references ?? {};
  for (const agentFacts of ctx.agents) {
    for (const skill of canonical) {
      const referenceFiles = Array.isArray(references[skill])
        ? references[skill].filter((file) => typeof file === "string")
        : [];
      for (const relativeFile of ["SKILL.md", ...referenceFiles]) {
        const skillPath = `${agentFacts.agent.skillsDir}/${skill}/${relativeFile}`;
        if (!ctx.fs.exists(skillPath)) {
          missing.push(`${agentFacts.agent.id}:${skill}:${relativeFile}`);
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

/** Return the manifest-declared reference files for one skill, scoped to the references/ subtree. */
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

function checkUnexpectedSkillReferences(
  ctx: AuditContext,
): AuditFailure | null {
  const unexpected: string[] = [];

  for (const agentFacts of ctx.agents) {
    for (const skill of ctx.structure.skills.canonical) {
      const skillRoot = `${agentFacts.agent.skillsDir}/${skill}`;
      const referencesDir = `${skillRoot}/references`;
      if (!ctx.fs.exists(referencesDir)) continue;

      const expected = expectedReferenceFiles(ctx, skill);
      for (const path of ctx.fs.glob(`${referencesDir}/**/*.md`)) {
        const prefix = `${skillRoot}/`;
        const relativeFile = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path;
        if (!expected.has(relativeFile)) {
          unexpected.push(`${agentFacts.agent.id}:${skill}:${relativeFile}`);
        }
      }
    }
  }

  if (unexpected.length === 0) return null;
  return {
    check: "Agent skills",
    message: `Unexpected stale skill reference files found: ${unexpected.join(", ")}`,
    evidence: unexpected[0],
    howToFix:
      "Run `goat-flow install . --agent <id>` for the affected agent. The installer prunes manifest-unlisted skill reference files during upgrades.",
  };
}

/** Check installed skill versions because outdated mirrors can silently use old workflow rules. */
function checkSkillVersions(ctx: AuditContext): AuditFailure | null {
  const noVersion: string[] = [];
  const mismatch: string[] = [];
  for (const agentFacts of ctx.agents) {
    for (const [name, version] of Object.entries(agentFacts.skills.versions)) {
      if (version === null) {
        noVersion.push(`${agentFacts.agent.id}:${name}`);
      } else if (version !== AUDIT_VERSION) {
        mismatch.push(`${agentFacts.agent.id}:${name} (${version})`);
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

/** Check stale skill directories because old names leave duplicate routing surfaces behind. */
function checkDeprecatedSkills(ctx: AuditContext): AuditFailure | null {
  const staleNames = new Set(ctx.structure.skills.stale_names);
  const found: string[] = [];
  for (const agentFacts of ctx.agents) {
    for (const dir of agentFacts.skills.installedDirs) {
      const name = dir.split("/").pop() ?? "";
      if (staleNames.has(name)) {
        found.push(`${agentFacts.agent.id}:${name}`);
      }
    }
  }
  if (found.length === 0) return null;
  // Convert the compact agent:name identifiers back into filesystem paths so the
  // remediation text points to concrete directories the user can remove.
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
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(ctx, "Agent skills");
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

function settingsObject(parsed: unknown): Record<string, unknown> | null {
  return parsed && typeof parsed === "object"
    ? (parsed as Record<string, unknown>)
    : null;
}

/** Check exact parsed settings keys because flattened TOML facts use dotted key names. */
function hasSettingsKey(parsed: unknown, key: string): boolean {
  const settings = settingsObject(parsed);
  return settings ? Object.prototype.hasOwnProperty.call(settings, key) : false;
}

/** Read an explicit boolean setting without treating missing or mistyped values as false. */
function booleanSetting(parsed: unknown, key: string): boolean | null {
  const settings = settingsObject(parsed);
  if (!settings) return null;
  const value = settings[key];
  return typeof value === "boolean" ? value : null;
}

/** Report the old Codex hooks flag so installs migrate to the current feature name. */
function checkCodexDeprecatedHooksFlag(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    if (agentFacts.agent.id !== "codex") continue;
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

/** Report installed Codex hooks that cannot run because the hooks feature flag is absent. */
function checkCodexHooksEnabled(ctx: AuditContext): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    if (agentFacts.agent.id !== "codex") continue;
    if (!agentFacts.hooks.denyExists && !agentFacts.hooks.denyIsRegistered)
      continue;
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

/** Detect literal Codex workspace-root denies that should be expanded to subtree globs. */
function isCodexExactWorkspaceRootPath(pattern: string): boolean {
  return pattern !== "." && !pattern.includes("*") && !pattern.endsWith("/**");
}

/** Detect Codex none-mode globs that do not use the required subtree suffix. */
function isCodexInvalidNoneGlob(pattern: string): boolean {
  if (!pattern.includes("*")) return false;
  return !pattern.endsWith("/**");
}

function collectInvalidCodexInlineGlobs(
  rawValue: string,
  invalidGlobs: string[],
): void {
  for (const [pattern, mode] of parseTomlInlineStringTableForKey(rawValue)) {
    if (mode === "none" && isCodexInvalidNoneGlob(pattern)) {
      invalidGlobs.push(pattern);
    }
  }
}

function codexFilesystemPatternFromKey(
  key: string,
  expandedRootPrefix: string,
  legacyExpandedRootPrefix: string,
): string | null {
  if (key.startsWith(expandedRootPrefix)) {
    return key.slice(expandedRootPrefix.length);
  }
  if (key.startsWith(legacyExpandedRootPrefix)) {
    return key.slice(legacyExpandedRootPrefix.length);
  }
  return null;
}

function collectCodexFilesystemEntryFindings(
  key: string,
  value: unknown,
  filesystemPrefix: string,
  legacyAnchor: string,
  invalidGlobs: string[],
  legacyAnchors: string[],
): void {
  if (!key.startsWith(filesystemPrefix)) return;
  if (key === legacyAnchor || key.startsWith(`${legacyAnchor}.`)) {
    legacyAnchors.push(":project_roots");
  }
  if (typeof value !== "string") return;

  const isInlineRoot =
    key === `${filesystemPrefix}:workspace_roots` || key === legacyAnchor;
  if (isInlineRoot) {
    collectInvalidCodexInlineGlobs(value, invalidGlobs);
    return;
  }

  const pattern = codexFilesystemPatternFromKey(
    key,
    `${filesystemPrefix}:workspace_roots.`,
    `${legacyAnchor}.`,
  );
  if (pattern === null || value !== "none") return;
  if (isCodexInvalidNoneGlob(pattern)) {
    invalidGlobs.push(pattern);
  }
}

function collectCodexFilesystemFindings(
  parsed: unknown,
  profileName: string,
): { invalidGlobs: string[]; legacyAnchors: string[] } {
  const invalidGlobs: string[] = [];
  const legacyAnchors: string[] = [];
  if (!parsed || typeof parsed !== "object") {
    return { invalidGlobs, legacyAnchors };
  }
  const filesystemPrefix = `permissions.${profileName}.filesystem.`;
  const legacyAnchor = `${filesystemPrefix}:project_roots`;
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

function parseTomlInlineStringTableForKey(
  rawValue: string,
): Array<[string, string]> {
  const value = rawValue.trim();
  if (!value.startsWith("{") || !value.endsWith("}")) return [];
  const entries: Array<[string, string]> = [];
  const entryPattern = /"((?:\\.|[^"\\])*)"\s*=\s*"((?:\\.|[^"\\])*)"/gu;
  for (const match of value.matchAll(entryPattern)) {
    const [, key, mode] = match;
    if (key && mode) entries.push([key, mode]);
  }
  return entries;
}

function formatCodexWorkspaceRootInvalidGlobMessage(
  invalidGlobs: string[],
  legacyAnchors: string[],
): string {
  const messageParts: string[] = [];
  if (invalidGlobs.length > 0) {
    messageParts.push(
      `Codex permission profile uses filename-glob patterns with "none" access that Codex 0.131+ rejects: ${uniquePaths(invalidGlobs).join(", ")}`,
    );
  }
  if (legacyAnchors.length > 0) {
    messageParts.push(
      `Codex permission profile uses the legacy ":project_roots" anchor (Codex 0.131+ uses ":workspace_roots")`,
    );
  }
  return `${messageParts.join("; ")}. Codex requires exact paths or trailing "/**" subtree patterns for "none" access.`;
}

function checkCodexWorkspaceRootInvalidGlobs(
  ctx: AuditContext,
): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const { invalidGlobs, legacyAnchors } = collectCodexFilesystemFindings(
      agentFacts.settings.parsed,
      defaultPermissions,
    );
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

function checkCodexWorkspaceRootExactPaths(
  ctx: AuditContext,
): AuditFailure | null {
  for (const agentFacts of ctx.agents) {
    if (agentFacts.agent.id !== "codex") continue;
    const settings = settingsObject(agentFacts.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
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
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(ctx, "Agent settings");
    if (blocked) return blocked;
    const invalid: string[] = [];
    for (const agentFacts of ctx.agents) {
      if (agentFacts.settings.exists && !agentFacts.settings.valid) {
        invalid.push(agentFacts.agent.id);
      }
    }
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
