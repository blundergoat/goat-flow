import type { AgentProfile, AgentId, ReadonlyFS } from '../types.js';

const PROFILES: Record<AgentId, AgentProfile> = {
  claude: {
    id: 'claude',
    name: 'Claude Code',
    instructionFile: 'CLAUDE.md',
    settingsFile: '.claude/settings.json',
    skillsDir: '.claude/skills',
    hooksDir: '.claude/hooks',
    denyMechanism: { type: 'settings-deny', path: '.claude/settings.json' },
    localPattern: '*/CLAUDE.md',
    hookEvents: { preTool: 'PreToolUse', postTool: 'PostToolUse', postTurn: 'Stop' },
  },
  codex: {
    id: 'codex',
    name: 'Codex',
    instructionFile: 'AGENTS.md',
    settingsFile: '.codex/config.toml',
    skillsDir: '.agents/skills',
    hooksDir: '.codex/hooks',
    denyMechanism: { type: 'deny-script', path: 'scripts/deny-dangerous.sh' },
    localPattern: '.github/instructions/*.md',
    hookEvents: { preTool: '', postTool: 'after_tool_use', postTurn: 'stop' },
  },
  gemini: {
    id: 'gemini',
    name: 'Gemini CLI',
    instructionFile: 'GEMINI.md',
    settingsFile: '.gemini/settings.json',
    skillsDir: '.agents/skills',
    hooksDir: '.gemini/hooks',
    denyMechanism: { type: 'settings-deny', path: '.gemini/settings.json' },
    localPattern: '*/GEMINI.md',
    hookEvents: { preTool: 'BeforeTool', postTool: 'AfterTool', postTurn: 'AfterAgent' },
  },
};

export function getProfile(id: AgentId): AgentProfile {
  return PROFILES[id];
}

export function detectAgents(fs: ReadonlyFS): AgentProfile[] {
  const agents: AgentProfile[] = [];

  for (const id of ['claude', 'codex', 'gemini'] as const) {
    const profile = PROFILES[id];
    if (fs.exists(profile.instructionFile)) {
      agents.push(profile);
    }
  }

  return agents;
}
