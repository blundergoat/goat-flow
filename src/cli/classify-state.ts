/**
 * Classify a project's goat-flow adoption state by probing for config files,
 * skill directories, and AI instruction markers.
 *
 * This is what decides the status badge a user sees next to each project in the dashboard project list, and the state printed by `goat-flow status` -
 * e.g. a user opens the dashboard and asks "which of my repos still need setup or an upgrade?".
 * Used by the dashboard `/api/projects/status` endpoint and the `goat-flow status` CLI command.
 */
import {
  AUDIT_VERSION,
  getSkillNames,
  getStaleSkillNames,
} from "./constants.js";
import { getAgentProfiles } from "./agents/registry.js";
import type { AgentProfile } from "./types.js";
import { load } from "js-yaml";
import { compareVersions, isReleaseVersion } from "./version-compare.js";

/** Minimal filesystem interface needed for project state detection. */
interface StateFS {
  /** Return true when a project-relative marker path exists. */
  exists(path: string): boolean;
  /** Read a project-relative text file, returning null when unavailable. */
  readFile(path: string): string | null;
}

/** Recognised adoption states for a project. */
type ProjectStateName =
  "bare" | "partial" | "v0.9" | "outdated" | "current" | "error";

/** Recommended next action for a given project state. */
type ProjectAction =
  "setup" | "migration" | "upgrade" | "fix" | "audit" | "incomplete" | "none";

/** Classification result for a single project directory. */
interface ProjectState {
  state: ProjectStateName;
  action: ProjectAction;
  details: string;
  version?: string;
}

/** Cache for {@link agentProfiles} - manifest-backed and static per process. */
let cachedAgentProfiles: AgentProfile[] | undefined;

/**
 * Agent profiles, read lazily so merely importing this module never touches the manifest.
 * This module sits on the CLI's hot import path: if it read the manifest at import time, a drifted install would crash `goat-flow --help` before the
 * user could see any guidance (the bug M03/1.13.0 fixed).
 */
function agentProfiles(): AgentProfile[] {
  // First call in this process -> load profiles from the manifest now.
  cachedAgentProfiles ??= getAgentProfiles();
  return cachedAgentProfiles;
}

/** Instruction files (CLAUDE.md, AGENTS.md, ...) across all supported agents. */
function instructionFiles(): string[] {
  return agentProfiles().map((profile) => profile.instructionFile);
}

/** Distinct skill install roots (.claude/skills, .agents/skills, ...) across agents. */
function skillRoots(): string[] {
  return [...new Set(agentProfiles().map((profile) => profile.skillsDir))];
}

/** Collect canonical skills found in any supported skill root. */
function collectInstalledSkills(fs: StateFS): string[] {
  return getSkillNames().filter((skill) =>
    skillRoots().some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
  );
}

/** Check whether any supported top-level instruction file exists. */
function hasAnyInstructionFile(fs: StateFS): boolean {
  return instructionFiles().some((file) => fs.exists(file));
}

/** Collect deprecated skill directories still present in the project. */
function collectOldSkills(fs: StateFS): string[] {
  return getStaleSkillNames().filter((skill) =>
    skillRoots().some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
  );
}

/** Build the detail message for a current-but-incomplete installation. */
function buildIncompleteDetails(
  installedSkills: string[],
  canonicalSkills: readonly string[],
  hasInstructionFile: boolean,
  hasPreamble: boolean,
  hasConventions: boolean,
  version: string,
): string {
  const missing: string[] = [];
  const missingSkills = canonicalSkills.filter(
    (skill) => !installedSkills.includes(skill),
  );

  // Some canonical skills are absent -> name them so the user knows exactly
  // what a re-run of setup will add.
  if (missingSkills.length > 0) {
    missing.push(`missing skills: ${missingSkills.join(", ")}`);
  }
  // No agent instruction file -> agents in this project run without rules.
  if (!hasInstructionFile) {
    missing.push(
      "missing instruction file (CLAUDE.md / AGENTS.md / .github/copilot-instructions.md)",
    );
  }
  // Skill preamble missing -> installed skills can't compose their shared header.
  if (!hasPreamble) {
    missing.push("missing .goat-flow/skill-docs/skill-preamble.md");
  }
  // Skill conventions missing -> same problem for the shared conventions half.
  if (!hasConventions) {
    missing.push("missing .goat-flow/skill-docs/skill-conventions.md");
  }

  return `Config says current goat-flow ${version} but install is incomplete: ${missing.join("; ")}`;
}

/** Map from agentId to that agent's instruction file (lazy - see {@link agentProfiles}). */
function agentInstructionFiles(): Record<string, string> {
  return Object.fromEntries(
    agentProfiles().map((profile) => [profile.id, profile.instructionFile]),
  );
}

/** Convert manifest/probe exceptions into a user-facing project state. */
function buildProbeErrorState(error: unknown): ProjectState {
  const message = error instanceof Error ? error.message : String(error);
  return {
    state: "error",
    action: "fix",
    details: `Could not read goat-flow manifest while classifying project state: ${message}`,
  };
}

/** Classify a project's GOAT Flow adoption state. */

/** What the probe found on disk, gathered once so the installed-project branch can weigh it without re-reading. */
interface InstalledProjectProbe {
  canonicalSkills: readonly string[];
  installedSkills: string[];
  hasInstructionFile: boolean;
  hasPreamble: boolean;
  hasConventions: boolean;
}

/**
 * Read the complete saved YAML scalar; absent/non-string values have no comparable version.
 * Swallows read/parse failures into undefined so status and installation request owner review.
 */
function installedConfigVersion(fs: StateFS): string | undefined {
  try {
    const version = (
      load(fs.readFile(".goat-flow/config.yaml") ?? "") as {
        version?: unknown;
      } | null
    )?.version;
    return typeof version === "string" ? version : undefined;
  } catch {
    // Invalid YAML needs the owner's review; defaults would hide the missing version.
    return undefined;
  }
}

/** Reject prereleases and numbers that would lose precision in the shared release comparison. */
function isComparableRelease(version: string): boolean {
  return (
    isReleaseVersion(version) &&
    version.split(".").every((part) => Number.isSafeInteger(Number(part)))
  );
}

/** Refuse newer releases or version entries the line-based installer cannot safely refresh. */
function installedReleaseBlocker(fs: StateFS, version: string): string | null {
  // The CLI is the stale side; stop rather than replace the newer project's files.
  if (compareVersions(version, AUDIT_VERSION) > 0) {
    return `Project version ${version} is newer than this CLI ${AUDIT_VERSION}. Upgrade the CLI before installing; the project's files must remain unchanged.`;
  }
  // The line-based installer cannot preserve block, flow or aliased version entries.
  const writableVersion =
    /^(?:version|"version"|'version')[ \t]*:[ \t]*(?:&[^\s#]+[ \t]+)?(["']?)\d+\.\d+\.\d+\1[ \t]*(?:#[^\r\n]*)?\r?$/mu;
  if (!writableVersion.test(fs.readFile(".goat-flow/config.yaml") ?? "")) {
    return `Config version ${version} cannot be safely refreshed. Review .goat-flow/config.yaml and put the version on a single top-level line, such as version: "${version}", before installing.`;
  }
  return null;
}

/**
 * Classify a project that already has a `.goat-flow/config.yaml`, so the only questions left are version and completeness.
 *
 * This is what decides the badge a user sees beside an already-installed project: current, incomplete, outdated,
 * or error.
 *
 * @param fs - project filesystem probe used to read the config
 * @param probe - what was already found on disk, so this branch does no second pass
 * @returns the state, the action to offer the user, and the detected version when one could be parsed. The skill
 *   check is an OR-union across roots and a fast pre-check only, so a "current" badge does not promise a per-agent
 *   audit passes; the suggested action points the user at `goat-flow audit` for that.
 */
function classifyInstalledProject(
  fs: StateFS,
  probe: InstalledProjectProbe,
): ProjectState {
  const version = installedConfigVersion(fs);

  // An existing config without a rankable release needs review before any installation changes.
  if (version === undefined || !isComparableRelease(version)) {
    return {
      state: "error",
      action: "none",
      details: `Config version cannot be safely compared with CLI ${AUDIT_VERSION}. Review the saved version in .goat-flow/config.yaml; use a numeric X.Y.Z release before installing.`,
      ...(version === undefined ? {} : { version }),
    };
  }

  const admissionBlocker = installedReleaseBlocker(fs, version);
  if (admissionBlocker !== null) {
    return {
      state: "error",
      action: "none",
      details: admissionBlocker,
      version,
    };
  }
  const direction = compareVersions(version, AUDIT_VERSION);
  // Any older release, including an older patch, offers an upgrade before completeness checks.
  if (direction < 0) {
    return {
      state: "outdated",
      action: "upgrade",
      details: `Version ${version} - upgrade available`,
      version,
    };
  }

  const isHealthy =
    probe.installedSkills.length === probe.canonicalSkills.length &&
    probe.hasInstructionFile &&
    probe.hasPreamble &&
    probe.hasConventions;
  // Everything present, so the deeper per-agent audit is the only thing left worth offering.
  if (isHealthy) {
    return {
      state: "current",
      action: "audit",
      details: `Current version (${version}) - run \`goat-flow audit . --agent <agent>\` for per-agent validation`,
      version,
    };
  }

  return {
    state: "current",
    action: "incomplete",
    details: buildIncompleteDetails(
      probe.installedSkills,
      probe.canonicalSkills,
      probe.hasInstructionFile,
      probe.hasPreamble,
      probe.hasConventions,
      version,
    ),
    version,
  };
}

/**
 * Decide which goat-flow adoption state a project is in, which is the badge and suggested action a user sees beside it.
 *
 * A user hits this by opening the dashboard project list or running `goat-flow status`, asking which repos still
 * need setup, an upgrade, or a finished install. States divide on whether a `.goat-flow/config.yaml` exists:
 * - with a config, the project is installed and only its version and completeness are in question
 * - without one, retired skill names mean a migration, current skills mean an interrupted setup, and neither means a bare project
 *
 * @param fs - project filesystem probe
 * @param agentId - agent the user filtered by; omitted accepts any agent's instruction file as sufficient
 * @returns the state, the action to offer, and the detected version when the project is installed. It throws nothing; a failed probe reports as an
 *   error state carrying the reason, so one unreadable project never blanks the whole list.
 */
export function classifyProjectState(
  fs: StateFS,
  agentId?: string,
): ProjectState {
  const hasConfig = fs.exists(".goat-flow/config.yaml");
  let canonicalSkills: readonly string[];
  let installedSkills: string[];
  let oldSkills: string[];
  let hasInstructionFile: boolean;
  try {
    canonicalSkills = getSkillNames();
    installedSkills = collectInstalledSkills(fs);
    oldSkills = collectOldSkills(fs);
    // A specific agent was requested (e.g. the dashboard filtering by Claude)
    // -> check that agent's instruction file only; otherwise accept any agent's.
    const agentInstructionFile = agentId
      ? agentInstructionFiles()[agentId]
      : undefined;
    hasInstructionFile = agentInstructionFile
      ? fs.exists(agentInstructionFile)
      : hasAnyInstructionFile(fs);
  } catch (error) {
    return buildProbeErrorState(error);
  }
  const currentSkillCount = installedSkills.length;
  const hasPreamble = fs.exists(".goat-flow/skill-docs/skill-preamble.md");
  const hasConventions = fs.exists(
    ".goat-flow/skill-docs/skill-conventions.md",
  );
  const hasAIInstructions =
    fs.exists(".github/instructions") || hasInstructionFile;

  // A .goat-flow/config.yaml exists -> the project was set up at some point;
  // everything in that branch is "installed, but which version and how healthy?".
  if (hasConfig) {
    return classifyInstalledProject(fs, {
      canonicalSkills,
      installedSkills,
      hasInstructionFile,
      hasPreamble,
      hasConventions,
    });
  }

  // No config from here down: the project was never (fully) set up.
  // Retired skill names found -> user is on a pre-1.0 layout; the dashboard
  // offers migration rather than plain setup.
  if (oldSkills.length > 0) {
    return {
      state: "v0.9",
      action: "migration",
      details: `Old skill names found (${oldSkills.join(", ")})`,
    };
  }
  // Some current skills but no config -> a half-finished install (e.g. setup
  // was interrupted); show the found/total count so the user sees progress.
  if (currentSkillCount > 0) {
    return {
      state: "partial",
      action: "setup",
      details: `${currentSkillCount}/${canonicalSkills.length} canonical skills found but no .goat-flow/ config - run setup to complete installation`,
    };
  }
  // Other AI instructions exist (Copilot rules etc.) but no goat-flow at all.
  if (hasAIInstructions) {
    return {
      state: "partial",
      action: "setup",
      details: "AI instructions exist but no goat-flow",
    };
  }
  return {
    state: "bare",
    action: "setup",
    details: "No AI agent configuration found",
  };
}
