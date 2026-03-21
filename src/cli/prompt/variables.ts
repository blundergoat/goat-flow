import type { ScanReport, AgentReport } from '../types.js';
import type { PromptVariables } from './types.js';

/**
 * Extract template variables from a scan report + agent report.
 * These replace {{variable}} placeholders in fragment instructions.
 */
export function extractVariables(report: ScanReport, agentReport: AgentReport): PromptVariables {
  const failed = agentReport.checks.filter(c => c.status === 'fail' || c.status === 'partial');
  const passed = agentReport.checks.filter(c => c.status === 'pass');

  // Agent-specific paths
  const paths = AGENT_PATHS[agentReport.agent] ?? AGENT_PATHS.claude;

  return {
    agentId: agentReport.agent,
    agentName: agentReport.agentName,
    instructionFile: paths.instructionFile,
    settingsFile: paths.settingsFile,
    skillsDir: paths.skillsDir,
    hooksDir: paths.hooksDir,
    shape: report.shape.value,
    languages: report.stack.languages.join(', ') || 'unknown',
    buildCommand: report.stack.buildCommand ?? 'none',
    testCommand: report.stack.testCommand ?? 'none',
    lintCommand: report.stack.lintCommand ?? 'none',
    formatCommand: report.stack.formatCommand ?? 'none',
    grade: agentReport.score.grade,
    percentage: String(agentReport.score.percentage),
    failedCount: String(failed.length),
    passedCount: String(passed.length),
    totalCount: String(agentReport.checks.length),
    date: new Date().toISOString().slice(0, 10),
  };
}

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
 * Leaves unresolved placeholders as-is with a comment.
 */
export function fillTemplate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => {
    const value = vars[name as keyof PromptVariables];
    if (value !== undefined) return value;
    return match; // leave unresolved
  });
}
