/**
 * Classify a project's goat-flow adoption state by probing for config files,
 * skill directories, and AI instruction markers.
 *
 * This is what decides the status badge a user sees next to each project in
 * the dashboard project list, and the state printed by `goat-flow status` -
 * e.g. a user opens the dashboard and asks "which of my repos still need
 * setup or an upgrade?". Used by the dashboard `/api/projects/status`
 * endpoint and the `goat-flow status` CLI command.
 */
import {
  AUDIT_VERSION,
  getSkillNames,
  getStaleSkillNames,
} from "./constants.js";
import { getAgentProfiles } from "./agents/registry.js";
import type { AgentProfile } from "./types.js";

/** Minimal filesystem interface needed for project state detection. */
interface StateFS {
  /** Return true when a project-relative marker path exists. */
  exists(path: string): boolean;
  /** Read a project-relative text file, returning null when unavailable. */
  readFile(path: string): string | null;
}

/** Recognised adoption states for a project. */
type ProjectStateName =
  | "bare"
  | "partial"
  | "v0.9"
  | "outdated"
  | "current"
  | "error";

/** Recommended next action for a given project state. */
type ProjectAction =
  | "setup"
  | "migration"
  | "upgrade"
  | "fix"
  | "audit"
  | "incomplete"
  | "none";

/** Classification result for a single project directory. */
interface ProjectState {
  state: ProjectStateName;
  action: ProjectAction;
  details: string;
  version?: string;
}

const CURRENT_VERSION_FAMILY = AUDIT_VERSION.split(".").slice(0, 2).join(".");

/** Cache for {@link agentProfiles} - manifest-backed and static per process. */
let cachedAgentProfiles: AgentProfile[] | undefined;

/**
 * Agent profiles, read lazily so merely importing this module never touches
 * the manifest. This module sits on the CLI's hot import path: if it read the
 * manifest at import time, a drifted install would crash `goat-flow --help`
 * before the user could see any guidance (the bug M03/1.13.0 fixed).
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
  hasInstructionFile: boolean,
  hasPreamble: boolean,
  hasConventions: boolean,
): string {
  const missing: string[] = [];
  const missingSkills = getSkillNames().filter(
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

  return `Config says current goat-flow ${CURRENT_VERSION_FAMILY}.x but install is incomplete: ${missing.join("; ")}`;
}

/** Map from agentId to that agent's instruction file (lazy - see {@link agentProfiles}). */
function agentInstructionFiles(): Record<string, string> {
  return Object.fromEntries(
    agentProfiles().map((profile) => [profile.id, profile.instructionFile]),
  );
}

/** Classify a project's GOAT Flow adoption state. */
// eslint-disable-next-line complexity -- intentional branchy state machine; each branch maps one adoption state.
export function classifyProjectState(
  fs: StateFS,
  agentId?: string,
): ProjectState {
  const hasConfig = fs.exists(".goat-flow/config.yaml");
  const installedSkills = collectInstalledSkills(fs);
  const currentSkillCount = installedSkills.length;
  const oldSkills = collectOldSkills(fs);
  // A specific agent was requested (e.g. the dashboard filtering by Claude)
  // -> check that agent's instruction file only; otherwise accept any agent's.
  const agentInstructionFile = agentId
    ? agentInstructionFiles()[agentId]
    : undefined;
  const hasInstructionFile = agentInstructionFile
    ? fs.exists(agentInstructionFile)
    : hasAnyInstructionFile(fs);
  const hasPreamble = fs.exists(".goat-flow/skill-docs/skill-preamble.md");
  const hasConventions = fs.exists(
    ".goat-flow/skill-docs/skill-conventions.md",
  );
  const hasAIInstructions =
    fs.exists(".github/instructions") || hasInstructionFile;

  // A .goat-flow/config.yaml exists -> the project was set up at some point;
  // everything in this branch is "installed, but which version / how healthy?".
  if (hasConfig) {
    const configContent = fs.readFile(".goat-flow/config.yaml");
    const versionMatch = configContent?.match(
      /version:\s*["']?(\d+\.\d+\.\d+)/,
    );
    const version = versionMatch?.[1];

    // Config file present but unparseable version -> shown as an error state
    // in the dashboard; setup regenerates a clean config.
    if (!version) {
      return {
        state: "error",
        action: "setup",
        details:
          "Config exists but version could not be parsed from .goat-flow/config.yaml. Run setup to regenerate.",
      };
    }

    // Version matches the current family -> project is up to date; the only
    // remaining question is whether the install is complete.
    if (version.startsWith(`${CURRENT_VERSION_FAMILY}.`)) {
      // Skill check is OR-union across roots - fast pre-check only.
      // A "healthy" classification here does not guarantee per-agent audit passes.
      // Run `goat-flow audit` for authoritative validation.
      const isHealthy =
        currentSkillCount === getSkillNames().length &&
        hasInstructionFile &&
        hasPreamble &&
        hasConventions;
      // Everything present -> dashboard shows "current"; suggest audit as
      // the deeper per-agent check.
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
          installedSkills,
          hasInstructionFile,
          hasPreamble,
          hasConventions,
        ),
        version,
      };
    }

    return {
      state: "outdated",
      action: "upgrade",
      details: `Version ${version} - upgrade available`,
      version,
    };
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
      details: `${currentSkillCount}/${getSkillNames().length} canonical skills found but no .goat-flow/ config - run setup to complete installation`,
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
