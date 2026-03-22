import type { ScanReport, AgentReport } from '../types.js';
import type { PromptVariables } from './types.js';

/**
 * Extract template variables from a scan report + agent report.
 * These replace {{variable}} placeholders in fragment instructions.
 */
export function extractVariables(report: ScanReport, agentReport: AgentReport): PromptVariables {
  /** Checks that failed or partially passed */
  const failed = agentReport.checks.filter(c => c.status === 'fail' || c.status === 'partial');
  /** Checks that fully passed */
  const passed = agentReport.checks.filter(c => c.status === 'pass');

  /** File paths specific to the detected agent, with claude as fallback */
  const paths = AGENT_PATHS[agentReport.agent] ?? AGENT_PATHS.claude;

  return {
    agentId: agentReport.agent,
    agentName: agentReport.agentName,
    instructionFile: paths.instructionFile,
    settingsFile: paths.settingsFile,
    skillsDir: paths.skillsDir,
    hooksDir: paths.hooksDir,
    languages: report.stack.languages.join(', ') || 'unknown',
    buildCommand: report.stack.buildCommand ?? '',
    testCommand: report.stack.testCommand ?? '',
    lintCommand: report.stack.lintCommand ?? '',
    formatCommand: report.stack.formatCommand ?? '',
    grade: agentReport.score.grade,
    percentage: String(agentReport.score.percentage),
    failedCount: String(failed.length),
    passedCount: String(passed.length),
    totalCount: String(agentReport.checks.length),
    date: new Date().toISOString().slice(0, 10),
  };
}

/** Per-agent file path defaults for instruction file, settings, skills, and hooks */
const AGENT_PATHS = {
  claude: {
    instructionFile: 'CLAUDE.md',
    settingsFile: '.claude/settings.json',
    skillsDir: '.claude/skills',
    hooksDir: '.claude/hooks',
  },
  codex: {
    instructionFile: 'AGENTS.md',
    settingsFile: '(none)',
    skillsDir: '.agents/skills',
    hooksDir: 'scripts/',
  },
  gemini: {
    instructionFile: 'GEMINI.md',
    settingsFile: '.gemini/settings.json',
    skillsDir: '.agents/skills',
    hooksDir: '.gemini/hooks',
  },
} as const;

/**
 * Replace {{variable}} placeholders in a template string.
 * Leaves unresolved placeholders with an [UNFILLED: name] marker.
 */
export function fillTemplate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    const value = vars[name as keyof PromptVariables];
    if (value !== undefined) return value;
    return `[UNFILLED: ${name}]`;
  });
}
