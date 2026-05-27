/**
 * Classify a project's goat-flow adoption state by probing for config files,
 * skill directories, and AI instruction markers. Used by both the dashboard
 * `/api/projects/status` endpoint and the `goat-flow status` CLI command.
 */
import { AUDIT_VERSION, SKILL_NAMES, STALE_SKILL_NAMES } from "./constants.js";
import { getAgentProfiles } from "./agents/registry.js";

/** Minimal filesystem interface needed for project state detection. */
interface StateFS {
  exists(path: string): boolean;
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

const AGENT_PROFILES = getAgentProfiles();
const INSTRUCTION_FILES = AGENT_PROFILES.map(
  (profile) => profile.instructionFile,
);
const SKILL_ROOTS = [
  ...new Set(AGENT_PROFILES.map((profile) => profile.skillsDir)),
];
/** Collect canonical skills found in any supported skill root. */
function collectInstalledSkills(fs: StateFS): string[] {
  return SKILL_NAMES.filter((skill) =>
    SKILL_ROOTS.some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
  );
}

/** Check whether any supported top-level instruction file exists. */
function hasAnyInstructionFile(fs: StateFS): boolean {
  return INSTRUCTION_FILES.some((file) => fs.exists(file));
}

/** Collect deprecated skill directories still present in the project. */
function collectOldSkills(fs: StateFS): string[] {
  return STALE_SKILL_NAMES.filter((skill) =>
    SKILL_ROOTS.some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
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
  const missingSkills = SKILL_NAMES.filter(
    (skill) => !installedSkills.includes(skill),
  );

  if (missingSkills.length > 0) {
    missing.push(`missing skills: ${missingSkills.join(", ")}`);
  }
  if (!hasInstructionFile) {
    missing.push(
      "missing instruction file (CLAUDE.md / AGENTS.md / .github/copilot-instructions.md)",
    );
  }
  if (!hasPreamble) {
    missing.push("missing .goat-flow/skill-reference/skill-preamble.md");
  }
  if (!hasConventions) {
    missing.push("missing .goat-flow/skill-reference/skill-conventions.md");
  }

  return `Config says current goat-flow ${CURRENT_VERSION_FAMILY}.x but install is incomplete: ${missing.join("; ")}`;
}

/** Map from agentId to that agent's instruction file. */
const AGENT_INSTRUCTION_FILE = Object.fromEntries(
  AGENT_PROFILES.map((profile) => [profile.id, profile.instructionFile]),
);

/** Classify a project's GOAT Flow adoption state. */
// eslint-disable-next-line complexity -- intentionally branchy state machine
export function classifyProjectState(
  fs: StateFS,
  agentId?: string,
): ProjectState {
  const hasConfig = fs.exists(".goat-flow/config.yaml");
  const installedSkills = collectInstalledSkills(fs);
  const currentSkillCount = installedSkills.length;
  const oldSkills = collectOldSkills(fs);
  const hasInstructionFile =
    agentId && AGENT_INSTRUCTION_FILE[agentId]
      ? fs.exists(AGENT_INSTRUCTION_FILE[agentId])
      : hasAnyInstructionFile(fs);
  const hasPreamble = fs.exists(".goat-flow/skill-reference/skill-preamble.md");
  const hasConventions = fs.exists(
    ".goat-flow/skill-reference/skill-conventions.md",
  );
  const hasAIInstructions =
    fs.exists(".github/instructions") || hasInstructionFile;

  if (hasConfig) {
    const configContent = fs.readFile(".goat-flow/config.yaml");
    const versionMatch = configContent?.match(
      /version:\s*["']?(\d+\.\d+\.\d+)/,
    );
    const version = versionMatch?.[1];

    if (!version) {
      return {
        state: "error",
        action: "setup",
        details:
          "Config exists but version could not be parsed from .goat-flow/config.yaml. Run setup to regenerate.",
      };
    }

    if (version.startsWith(`${CURRENT_VERSION_FAMILY}.`)) {
      // Skill check is OR-union across roots - fast pre-check only.
      // A "healthy" classification here does not guarantee per-agent audit passes.
      // Run `goat-flow audit` for authoritative validation.
      const isHealthy =
        currentSkillCount === SKILL_NAMES.length &&
        hasInstructionFile &&
        hasPreamble &&
        hasConventions;
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

  if (oldSkills.length > 0) {
    return {
      state: "v0.9",
      action: "migration",
      details: `Old skill names found (${oldSkills.join(", ")})`,
    };
  }
  if (currentSkillCount > 0) {
    return {
      state: "partial",
      action: "setup",
      details: `${currentSkillCount}/${SKILL_NAMES.length} canonical skills found but no .goat-flow/ config - run setup to complete installation`,
    };
  }
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
