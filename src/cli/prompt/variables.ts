import type { ScanReport, AgentReport, AgentId } from '../types.js';
import type { PromptVariables } from './types.js';
import { PROFILES } from '../detect/agents.js';

/** Derive prompt-facing path variables from the canonical PROFILES.
 *  Settings/hooks may differ from detection paths (e.g. Codex has no JSON settings). */
function getAgentPaths(id: AgentId) {
  const p = PROFILES[id];
  return {
    instructionFile: p.instructionFile,
    settingsFile: p.settingsFile ?? '(none)',
    skillsDir: p.skillsDir,
    hooksDir: p.hooksDir ?? '(none)',
  };
}

/**
 * Extract template variables from a scan report + agent report.
 * These replace {{variable}} placeholders in fragment instructions.
 */
export function extractVariables(report: ScanReport, agentReport: AgentReport): PromptVariables {
  /** Checks that failed or partially passed */
  const failed = agentReport.checks.filter(c => c.status === 'fail' || c.status === 'partial');
  /** Checks that fully passed */
  const passed = agentReport.checks.filter(c => c.status === 'pass');

  /** File paths specific to the detected agent, derived from PROFILES */
  const paths = getAgentPaths(agentReport.agent);

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

/**
 * Replace {{variable}} placeholders in a template string.
 * Leaves unresolved placeholders with an [UNFILLED: name] marker.
 */
export function fillTemplate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (name in vars) return vars[name as keyof PromptVariables];
    return `[UNFILLED: ${name}]`;
  });
}
