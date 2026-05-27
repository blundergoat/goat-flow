/**
 * Agent Setup checks for `goat-flow audit --agent <id>`.
 * 4 checks that validate per-agent installation: instruction, skills, settings, guardrail hooks.
 * All checks require --agent and skip in aggregate mode (except orphaned-artifacts detection).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuditFailure, BuildCheck, AuditContext } from "./types.js";
import type { CheckEvidence } from "./provenance-types.js";
import type { ReadonlyFS } from "../types.js";
import { AUDIT_VERSION, SKILL_NAMES } from "../constants.js";
import { getTemplatePath } from "../paths.js";
import { collectCodexWorkspaceRootEntries } from "../facts/agent/settings.js";

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
    fs.exists(`${hooksDir}/guard-repository-writes.sh`)
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
  const agentFacts = ctx.agents.find((af) => af.agent.id === ctx.agentFilter);
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
    .filter((af) => !af.instruction.exists)
    .map((af) => `${af.agent.id} (${af.agent.instructionFile})`);
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
function checkSelectedInstructionAvailable(
  ctx: AuditContext,
  checkName: string,
): AuditFailure | null {
  if (!ctx.agentFilter) return null;
  const found = ctx.agents.find((af) => af.agent.id === ctx.agentFilter);
  if (found?.instruction.exists) return null;
  const profile = ctx.structure.agents[ctx.agentFilter];
  const instructionFile =
    profile?.instruction_file ?? `${ctx.agentFilter} instruction file`;
  return {
    check: checkName,
    message: `${checkName} blocked: ${ctx.agentFilter} instruction file is missing (${instructionFile})`,
    evidence: instructionFile,
    howToFix: `Create ${instructionFile} by running \`goat-flow setup --agent ${ctx.agentFilter}\`, then rerun the audit.`,
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
      checkAnyAgentConfigured(ctx) ??
      checkSupportedInstructionFilesPresent(ctx) ??
      checkOrphanedArtifacts(ctx) ??
      checkCopilotCommitInstructionsPresent(ctx)
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

  for (const af of ctx.agents) {
    for (const skill of ctx.structure.skills.canonical) {
      const skillRoot = `${af.agent.skillsDir}/${skill}`;
      const referencesDir = `${skillRoot}/references`;
      if (!ctx.fs.exists(referencesDir)) continue;

      const expected = expectedReferenceFiles(ctx, skill);
      for (const path of ctx.fs.glob(`${referencesDir}/**/*.md`)) {
        const prefix = `${skillRoot}/`;
        const relativeFile = path.startsWith(prefix)
          ? path.slice(prefix.length)
          : path;
        if (!expected.has(relativeFile)) {
          unexpected.push(`${af.agent.id}:${skill}:${relativeFile}`);
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

function hasSettingsKey(parsed: unknown, key: string): boolean {
  const settings = settingsObject(parsed);
  return settings ? Object.prototype.hasOwnProperty.call(settings, key) : false;
}

function booleanSetting(parsed: unknown, key: string): boolean | null {
  const settings = settingsObject(parsed);
  if (!settings) return null;
  const value = settings[key];
  return typeof value === "boolean" ? value : null;
}

function checkCodexDeprecatedHooksFlag(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (af.agent.id !== "codex") continue;
    if (!hasSettingsKey(af.settings.parsed, "features.codex_hooks")) continue;
    return {
      check: "Agent settings",
      message:
        "Deprecated Codex feature flag in .codex/config.toml: [features].codex_hooks",
      evidence: af.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Replace `codex_hooks` with `hooks` under `[features]`, or run `goat-flow install . --agent codex` to migrate the setting.",
    };
  }
  return null;
}

function checkCodexHooksEnabled(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (af.agent.id !== "codex") continue;
    if (!af.hooks.denyExists && !af.hooks.denyIsRegistered) continue;
    if (booleanSetting(af.settings.parsed, "features.hooks") === true) {
      continue;
    }
    return {
      check: "Agent settings",
      message:
        "Codex hooks are installed but .codex/config.toml does not enable [features].hooks = true",
      evidence: af.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Add `hooks = true` under `[features]` in .codex/config.toml, or run `goat-flow install . --agent codex` to install the current Codex settings template.",
    };
  }
  return null;
}

function isCodexExactWorkspaceRootPath(pattern: string): boolean {
  return pattern !== "." && !pattern.includes("*") && !pattern.endsWith("/**");
}

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
  for (const af of ctx.agents) {
    if (af.agent.id !== "codex") continue;
    const settings = settingsObject(af.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const { invalidGlobs, legacyAnchors } = collectCodexFilesystemFindings(
      af.settings.parsed,
      defaultPermissions,
    );
    if (invalidGlobs.length === 0 && legacyAnchors.length === 0) continue;
    return {
      check: "Agent settings",
      message: formatCodexWorkspaceRootInvalidGlobMessage(
        invalidGlobs,
        legacyAnchors,
      ),
      evidence: af.agent.settingsFile ?? ".codex/config.toml",
      howToFix:
        "Run `goat-flow install . --agent codex` (without --force) to migrate the .codex/config.toml filesystem block in place. The installer rewrites filename globs to canonical subtree denies (e.g. `secrets/**`, `.ssh/**`). Filename-level protections are covered by .codex/hooks/guard-secret-paths.sh.",
    };
  }
  return null;
}

function checkCodexWorkspaceRootExactPaths(
  ctx: AuditContext,
): AuditFailure | null {
  for (const af of ctx.agents) {
    if (af.agent.id !== "codex") continue;
    const settings = settingsObject(af.settings.parsed);
    const defaultPermissions = settings?.default_permissions;
    if (typeof defaultPermissions !== "string" || defaultPermissions === "") {
      continue;
    }
    const missing = collectCodexWorkspaceRootEntries(
      af.settings.parsed,
      defaultPermissions,
    )
      .filter((entry) => isCodexExactWorkspaceRootPath(entry.pattern))
      .map((entry) => entry.pattern)
      .filter((pattern) => !ctx.fs.exists(pattern));
    if (missing.length === 0) continue;
    return {
      check: "Agent settings",
      message: `Codex permission profile lists exact workspace-root paths that do not exist: ${uniquePaths(missing).join(", ")}`,
      evidence: af.agent.settingsFile ?? ".codex/config.toml",
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
    for (const af of ctx.agents) {
      if (af.settings.exists && !af.settings.valid) {
        invalid.push(af.agent.id);
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

// === 4. Agent Deny Mechanism ===

function checkDenyHookPresent(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    // Capability-limited agents (e.g. Antigravity at v1.0.1) have no documented
    // deny mechanism upstream. The manifest records this as
    // `denyMechanism: null`; skip the check rather than producing a permanent
    // audit failure that downstream projects cannot fix.
    if (af.agent.denyMechanism === null) continue;
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
    // Skip agents with no documented project-local deny mechanism.
    if (af.agent.denyMechanism === null) continue;
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

/**
 * Audit evidence paths are user-visible in text/markdown/JSON output. Force
 * forward slashes so Windows and POSIX agree on the rendered shape.
 */
function evidencePath(relPath: string): string {
  return relPath.replace(/\\/g, "/");
}

/** Compare installed deny hook content against the canonical template. */
function checkHookVersion(ctx: AuditContext): AuditFailure | null {
  const templateFiles = [
    "guard-common.sh",
    "guard-destructive-shell.sh",
    "guard-secret-paths.sh",
    "guard-repository-writes.sh",
    "guardrails-self-test.sh",
  ];
  for (const af of ctx.agents) {
    if (!af.agent.hooksDir) continue;
    const denyRelPath = join(af.agent.hooksDir, "guard-repository-writes.sh");
    if (ctx.fs.readFile(denyRelPath) === null) continue;

    for (const templateFile of templateFiles) {
      const templatePath = getTemplatePath(`workflow/hooks/${templateFile}`);
      if (!existsSync(templatePath)) continue;
      let templateContent: string;
      try {
        templateContent = readFileSync(templatePath, "utf-8");
      } catch {
        continue;
      }
      const installedRelPath = join(af.agent.hooksDir, templateFile);
      const installed = ctx.fs.readFile(installedRelPath);
      if (installed === null) {
        return {
          check: "Agent deny mechanism",
          message: `${templateFile} is missing for ${af.agent.id}`,
          evidence: evidencePath(installedRelPath),
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${af.agent.id}\` to update the hook files.`,
        };
      }
      if (installed.trimEnd() !== templateContent.trimEnd()) {
        return {
          check: "Agent deny mechanism",
          message: `${templateFile} for ${af.agent.id} differs from the current goat-flow template (v${AUDIT_VERSION})`,
          evidence: evidencePath(installedRelPath),
          howToFix: `Re-run \`npx @blundergoat/goat-flow@${AUDIT_VERSION} install . --agent ${af.agent.id}\` to update the hook files.`,
        };
      }
    }
  }
  return null;
}

/** Run each deny hook self-test when the script is present. */
function checkHookSelfTest(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    if (!af.agent.hooksDir) continue;
    const denyRelPath = join(af.agent.hooksDir, "guardrails-self-test.sh");
    const content = ctx.fs.readFile(denyRelPath);
    // Config-based deny rules satisfy the deny-mechanism requirement, but only an
    // on-disk shell hook can run the registered self-test.
    if (content === null) continue;
    const denyPath = join(ctx.projectPath, denyRelPath);
    try {
      execFileSync("bash", [denyPath, "--self-test=smoke"], {
        stdio: "pipe",
        timeout: 30000,
      });
    } catch {
      return {
        check: "Agent deny mechanism",
        message: `guardrails-self-test.sh --self-test=smoke failed for ${af.agent.id}`,
        evidence: evidencePath(denyRelPath),
        howToFix:
          "Run `bash <hooks-dir>/guardrails-self-test.sh --self-test=smoke` to see which cases fail.",
      };
    }
  }
  return null;
}

function runtimeSmokePayload(agentId: string): {
  input: string;
  expectedStatus: number;
  expectedStream: "stdout" | "stderr";
  expectedPattern: RegExp;
} {
  if (agentId === "copilot") {
    return {
      input:
        '{"toolName":"bash","toolArgs":{"command":"git push origin main"}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"permissionDecision"\s*:\s*"deny"/,
    };
  }
  if (agentId === "antigravity") {
    return {
      input:
        '{"hookEventName":"PreToolUse","toolCall":{"name":"run_command","args":{"CommandLine":"git push origin main"}}}',
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /"decision"\s*:\s*"deny"/,
    };
  }
  return {
    input:
      '{"tool_name":"Bash","tool_input":{"command":"git push origin main"}}',
    expectedStatus: 2,
    expectedStream: "stderr",
    expectedPattern: /BLOCKED:/,
  };
}

function runtimeSmokePayloadForScript(
  agentId: string,
  scriptFile: string,
): ReturnType<typeof runtimeSmokePayload> {
  const command =
    scriptFile === "guard-destructive-shell.sh"
      ? "rm -rf /"
      : scriptFile === "guard-secret-paths.sh"
        ? "cat .env"
        : "git push origin main";
  const base = runtimeSmokePayload(agentId);
  if (agentId === "copilot") {
    return {
      ...base,
      input: JSON.stringify({
        toolName: "bash",
        toolArgs: { command },
      }),
    };
  }
  if (agentId === "antigravity") {
    return {
      ...base,
      input: JSON.stringify({
        hookEventName: "PreToolUse",
        toolCall: { name: "run_command", args: { CommandLine: command } },
      }),
    };
  }
  return {
    ...base,
    input: JSON.stringify({
      tool_name: "Bash",
      tool_input: { command },
    }),
  };
}

function registeredDenyRelPath(
  af: AuditContext["agents"][number],
): string | null {
  if (af.hooks.denyRegisteredPath) return af.hooks.denyRegisteredPath;
  if (!af.agent.hooksDir) return null;
  return join(af.agent.hooksDir, "guard-repository-writes.sh");
}

const CONFIGURED_SMOKE_SCRIPTS = [
  "guard-destructive-shell.sh",
  "guard-secret-paths.sh",
  "guard-repository-writes.sh",
] as const;

interface ConfiguredHookCommand {
  command: string;
  scriptFile: string;
  configPath: string;
}

function pushConfiguredCommand(
  commands: ConfiguredHookCommand[],
  command: unknown,
  configPath: string,
): void {
  if (typeof command !== "string" || command.length === 0) return;
  const scriptFile = CONFIGURED_SMOKE_SCRIPTS.find((script) =>
    command.includes(script),
  );
  if (!scriptFile) return;
  commands.push({ command, scriptFile, configPath });
}

function collectNestedCommandValues(
  value: unknown,
  configPath: string,
  commands: ConfiguredHookCommand[],
): void {
  if (Array.isArray(value)) {
    for (const entry of value) {
      collectNestedCommandValues(entry, configPath, commands);
    }
    return;
  }
  if (!value || typeof value !== "object") return;
  const obj = value as Record<string, unknown>;
  pushConfiguredCommand(commands, obj.command, configPath);
  pushConfiguredCommand(commands, obj.bash, configPath);
  for (const child of Object.values(obj)) {
    if (typeof child === "object") {
      collectNestedCommandValues(child, configPath, commands);
    }
  }
}

function configuredGuardCommands(
  ctx: AuditContext,
  af: AuditContext["agents"][number],
): ConfiguredHookCommand[] {
  const configPath = af.agent.hookConfigFile ?? af.agent.settingsFile;
  if (!configPath) return [];
  const rawConfig = ctx.fs.readFile(configPath);
  if (rawConfig === null) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawConfig);
  } catch {
    return [];
  }
  const commands: ConfiguredHookCommand[] = [];
  collectNestedCommandValues(parsed, configPath, commands);
  const seen = new Set<string>();
  return commands.filter((command) => {
    const key = `${command.configPath}\0${command.command}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function runConfiguredCommand(
  ctx: AuditContext,
  command: string,
  input: string,
): ReturnType<typeof spawnSync> {
  if (!/\s/u.test(command) && !command.includes("$(")) {
    return spawnSync(command, [], {
      cwd: ctx.projectPath,
      encoding: "utf8",
      input,
      timeout: 5000,
    });
  }
  return spawnSync("bash", ["-lc", command], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    input,
    timeout: 5000,
  });
}

function runConfiguredHookCommandSmoke(
  ctx: AuditContext,
  af: AuditContext["agents"][number],
  configured: ConfiguredHookCommand,
): { ok: boolean; message: string; evidence: string } {
  const smoke = runtimeSmokePayloadForScript(
    af.agent.id,
    configured.scriptFile,
  );
  const result = runConfiguredCommand(ctx, configured.command, smoke.input);
  const status = result.status ?? (result.error ? -1 : 0);
  if (status === 126 || status === 127) {
    return {
      ok: false,
      message: `${af.agent.id} configured hook command exited ${status}: ${configured.command}`,
      evidence: configured.configPath,
    };
  }
  const stream = String(
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr,
  );
  if (status !== smoke.expectedStatus || !smoke.expectedPattern.test(stream)) {
    return {
      ok: false,
      message: `${af.agent.id} configured hook command did not deny ${configured.scriptFile}: ${configured.command}`,
      evidence: configured.configPath,
    };
  }
  return { ok: true, message: "", evidence: configured.configPath };
}

function runDirectHookRuntimeSmoke(
  ctx: AuditContext,
  af: AuditContext["agents"][number],
  denyRelPath: string,
): boolean {
  const smoke = runtimeSmokePayload(af.agent.id);
  const result = spawnSync("bash", [join(ctx.projectPath, denyRelPath)], {
    cwd: ctx.projectPath,
    encoding: "utf8",
    input: smoke.input,
    timeout: 5000,
  });

  const status = result.status ?? (result.error ? -1 : 0);
  const stream =
    smoke.expectedStream === "stdout" ? result.stdout : result.stderr;
  return status === smoke.expectedStatus && smoke.expectedPattern.test(stream);
}

/** Run a runtime-shaped blocked payload through the installed deny hook. */
function checkHookRuntimeSmoke(ctx: AuditContext): AuditFailure | null {
  for (const af of ctx.agents) {
    const configuredCommands = configuredGuardCommands(ctx, af);
    if (configuredCommands.length > 0) {
      for (const configured of configuredCommands) {
        const result = runConfiguredHookCommandSmoke(ctx, af, configured);
        if (result.ok) continue;
        return {
          check: "Agent deny mechanism",
          message: result.message,
          evidence: evidencePath(result.evidence),
          howToFix:
            "Run the exact hook command string from the agent config with a runtime-shaped payload and confirm it reaches the guard script without exit 126/127.",
        };
      }
      continue;
    }

    const denyRelPath = registeredDenyRelPath(af);
    if (denyRelPath === null) continue;
    const content = ctx.fs.readFile(denyRelPath);
    if (content === null) continue;

    if (runDirectHookRuntimeSmoke(ctx, af, denyRelPath)) continue;

    return {
      check: "Agent deny mechanism",
      message: `registered deny hook runtime smoke failed for ${af.agent.id}`,
      evidence: evidencePath(denyRelPath),
      howToFix:
        "Run the registered deny hook with a runtime-shaped Bash payload and confirm it denies `git push origin main`.",
    };
  }
  return null;
}

const agentDenyMechanism: BuildCheck = {
  id: "agent-guardrails",
  name: "Agent deny mechanism",
  scope: "agent",
  provenance: incidentProvenance([
    ".goat-flow/footguns/auditor.md",
    ".goat-flow/footguns/hooks.md",
  ]),
  /** Run the Agent deny mechanism check. */
  run: (ctx) => {
    if (!ctx.agentFilter) return null;
    const blocked = checkSelectedInstructionAvailable(
      ctx,
      "Agent deny mechanism",
    );
    if (blocked) return blocked;
    if (ctx.denyMechanismEvidenceLevel === "present-only") {
      return checkDenyHookPresent(ctx);
    }
    // Order the checks from cheapest/static to most expensive/runtime so we stop on
    // the clearest failure before attempting shell execution.
    const staticFailure =
      checkDenyHookPresent(ctx) ??
      checkHookSyntax(ctx) ??
      checkDenyPatterns(ctx) ??
      checkHookVersion(ctx);

    if (ctx.denyMechanismEvidenceLevel === "static") {
      return staticFailure;
    }

    return (
      staticFailure ?? checkHookSelfTest(ctx) ?? checkHookRuntimeSmoke(ctx)
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
