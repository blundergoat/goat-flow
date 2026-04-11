/**
 * Classify a project's goat-flow adoption state by probing for config files,
 * skill directories, and AI instruction markers. Used by both the dashboard
 * `/api/projects/status` endpoint and the `goat-flow status` CLI command.
 */
import { SKILL_NAMES } from "./constants.js";

/** Minimal filesystem interface needed for project state detection. */
interface StateFS {
  exists(path: string): boolean;
  readFile(path: string): string | null;
}

/** Recognised adoption states for a project. */
type ProjectStateName = "bare" | "partial" | "v0.9" | "v1.0" | "v1.1" | "error";

/** Recommended next action for a given project state. */
type ProjectAction =
  | "setup"
  | "migration"
  | "upgrade"
  | "fix"
  | "healthy"
  | "incomplete"
  | "none";

/** Classification result for a single project directory. */
interface ProjectState {
  state: ProjectStateName;
  action: ProjectAction;
  details: string;
}

const INSTRUCTION_FILES = ["CLAUDE.md", "AGENTS.md", "GEMINI.md"] as const;
const SKILL_ROOTS = [
  ".claude/skills",
  ".agents/skills",
  ".github/skills",
] as const;
const OLD_SKILLS = [
  "goat-audit",
  "goat-investigate",
  "goat-refactor",
  "goat-simplify",
  "goat-context",
  "goat-onboard",
  "goat-reflect",
  "goat-resume",
] as const;

function collectInstalledSkills(fs: StateFS): string[] {
  return SKILL_NAMES.filter((skill) =>
    SKILL_ROOTS.some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
  );
}

function hasAnyInstructionFile(fs: StateFS): boolean {
  return INSTRUCTION_FILES.some((file) => fs.exists(file));
}

function collectOldSkills(fs: StateFS): string[] {
  return OLD_SKILLS.filter((skill) =>
    SKILL_ROOTS.some((root) => fs.exists(`${root}/${skill}/SKILL.md`)),
  );
}

function buildIncompleteDetails(
  installedSkills: string[],
  hasInstructionFile: boolean,
  hasPreamble: boolean,
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
      "missing instruction file (CLAUDE.md / AGENTS.md / GEMINI.md)",
    );
  }
  if (!hasPreamble) {
    missing.push("missing .goat-flow/skill-preamble.md");
  }

  return `Config says v1.1.x but install is incomplete: ${missing.join("; ")}`;
}

/** Detect which adoption stage a project is at based on its on-disk artifacts. */
// eslint-disable-next-line complexity -- intentionally branchy state machine
export function classifyProjectState(fs: StateFS): ProjectState {
  const hasConfig = fs.exists(".goat-flow/config.yaml");
  const installedSkills = collectInstalledSkills(fs);
  const currentSkillCount = installedSkills.length;
  const oldSkills = collectOldSkills(fs);
  const hasInstructionFile = hasAnyInstructionFile(fs);
  const hasPreamble = fs.exists(".goat-flow/skill-preamble.md");
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
        state: "error" as ProjectStateName,
        action: "fix" as ProjectAction,
        details:
          "Config exists but version could not be parsed from .goat-flow/config.yaml",
      };
    }

    if (version.startsWith("1.1.")) {
      const isHealthy =
        currentSkillCount === SKILL_NAMES.length &&
        hasInstructionFile &&
        hasPreamble;
      if (isHealthy) {
        return {
          state: "v1.1",
          action: "healthy",
          details: "Current version with canonical skill set installed",
        };
      }

      return {
        state: "v1.1",
        action: "incomplete",
        details: buildIncompleteDetails(
          installedSkills,
          hasInstructionFile,
          hasPreamble,
        ),
      };
    }

    return {
      state: "v1.0",
      action: "upgrade",
      details: `Version ${version} — upgrade available`,
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
      state: "v1.0",
      action: "upgrade",
      details: `${currentSkillCount}/${SKILL_NAMES.length} canonical skills found but no .goat-flow/ config`,
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
