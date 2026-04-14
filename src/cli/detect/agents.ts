/**
 * Detects which agent runtimes are configured in a project.
 * Also defines the canonical per-agent profiles used by setup, fact extraction, and prompt rendering.
 */
import type { AgentProfile, AgentId, ReadonlyFS } from "../types.js";

/** Configuration profiles for all supported AI coding agents */
export const PROFILES: Record<AgentId, AgentProfile> = {
  claude: {
    id: "claude",
    name: "Claude Code",
    instructionFile: "CLAUDE.md",
    settingsFile: ".claude/settings.json",
    skillsDir: ".claude/skills",
    hooksDir: ".claude/hooks",
    denyMechanism: { type: "settings-deny", path: ".claude/settings.json" },
    localPattern: "*/CLAUDE.md",
    hookEvents: {
      preTool: "PreToolUse",
      postTurn: "Stop",
    },
  },
  codex: {
    id: "codex",
    name: "Codex",
    instructionFile: "AGENTS.md",
    settingsFile: ".codex/config.toml",
    skillsDir: ".agents/skills",
    hooksDir: ".codex/hooks",
    denyMechanism: {
      type: "deny-script",
      path: ".codex/hooks/deny-dangerous.sh",
    },
    localPattern: ".github/instructions/*.md",
    hookEvents: { preTool: "PreToolUse", postTurn: "Stop" },
  },
  gemini: {
    id: "gemini",
    name: "Gemini CLI",
    instructionFile: "GEMINI.md",
    settingsFile: ".gemini/settings.json",
    skillsDir: ".agents/skills",
    hooksDir: ".gemini/hooks",
    denyMechanism: { type: "settings-deny", path: ".gemini/settings.json" },
    localPattern: "*/GEMINI.md",
    hookEvents: {
      preTool: "BeforeTool",
      postTurn: "AfterAgent",
    },
  },
};

/** Detect which AI coding agents are configured in the project */
export function detectAgents(fs: ReadonlyFS): AgentProfile[] {
  /** Accumulator for agents whose instruction files exist in the project */
  const agents: AgentProfile[] = [];

  // Iterate over each known agent ID to check for its instruction file
  for (const id of ["claude", "codex", "gemini"] as const) {
    /** Profile configuration for the current agent */
    const profile = PROFILES[id];
    if (fs.exists(profile.instructionFile)) {
      agents.push(profile);
    }
  }

  return agents;
}
