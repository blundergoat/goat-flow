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

function countCheckStatuses(agentReport: AgentReport): { failed: number; passed: number } {
  let failed = 0;
  let passed = 0;

  for (const check of agentReport.checks) {
    if (check.status === 'pass') {
      passed++;
      continue;
    }
    if (check.status === 'fail' || check.status === 'partial') failed++;
  }

  return { failed, passed };
}

function collectCheckEvidence(agentReport: AgentReport, evidence: Record<string, string>): void {
  for (const check of agentReport.checks) {
    if (check.evidence && check.recommendationKey) {
      evidence[check.recommendationKey] = check.evidence;
    }
  }
}

function collectAntiPatternEvidence(agentReport: AgentReport, evidence: Record<string, string>): void {
  for (const antiPattern of agentReport.antiPatterns) {
    if (antiPattern.triggered && antiPattern.evidence && antiPattern.recommendationKey) {
      evidence[antiPattern.recommendationKey] = antiPattern.evidence;
    }
    if (antiPattern.triggered && antiPattern.recommendationKey) {
      evidence[`${antiPattern.recommendationKey}.message`] = antiPattern.message;
    }
  }
}

function collectEvidence(agentReport: AgentReport): Record<string, string> {
  const evidence: Record<string, string> = {};
  collectCheckEvidence(agentReport, evidence);
  collectAntiPatternEvidence(agentReport, evidence);
  return evidence;
}

/**
 * Extract template variables from a scan report + agent report.
 * These replace {{variable}} placeholders in fragment instructions.
 */
export function extractTemplateVars(report: ScanReport, agentReport: AgentReport): PromptVariables {
  /** File paths specific to the detected agent, derived from PROFILES */
  const paths = getAgentPaths(agentReport.agent);
  const checkCounts = countCheckStatuses(agentReport);
  const evidence = collectEvidence(agentReport);

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
    failedCount: String(checkCounts.failed),
    passedCount: String(checkCounts.passed),
    totalCount: String(agentReport.checks.length),
    date: new Date().toISOString().slice(0, 10),
    evidence,
  };
}

/**
 * Replace {{variable}} placeholders in a template string.
 * Supports dotted access for evidence: {{evidence.ap-fix-stale-references}}
 * Leaves unresolved placeholders with an [UNFILLED: name] marker.
 */
export function fillTemplate(template: string, vars: PromptVariables): string {
  return template.replace(/\{\{([\w.:-]+)\}\}/g, (_match, name: string) => {
    // Dotted access: {{evidence.some-key}}
    if (name.startsWith('evidence.')) {
      const evidenceKey = name.slice('evidence.'.length);
      return vars.evidence[evidenceKey] ?? '';
    }
    if (name in vars) {
      const val = vars[name as keyof PromptVariables];
      return typeof val === 'string' ? val : '';
    }
    return `[UNFILLED: ${name}]`;
  });
}
