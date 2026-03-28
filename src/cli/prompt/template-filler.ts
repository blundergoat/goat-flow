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
export function extractTemplateVars(report: ScanReport, agentReport: AgentReport): PromptVariables {
  /** Checks that failed or partially passed */
  const failed = agentReport.checks.filter(c => c.status === 'fail' || c.status === 'partial');
  /** Checks that fully passed */
  const passed = agentReport.checks.filter(c => c.status === 'pass');

  /** File paths specific to the detected agent, derived from PROFILES */
  const paths = getAgentPaths(agentReport.agent);

  // Collect evidence from check results and anti-pattern results
  const evidence: Record<string, string> = {};
  for (const check of agentReport.checks) {
    if (check.evidence && check.recommendationKey) {
      evidence[check.recommendationKey] = check.evidence;
    }
  }
  for (const ap of agentReport.antiPatterns) {
    if (ap.triggered && ap.evidence && ap.recommendationKey) {
      evidence[ap.recommendationKey] = ap.evidence;
    }
    // Also store the AP message as evidence — it often contains actionable detail
    if (ap.triggered && ap.recommendationKey) {
      evidence[`${ap.recommendationKey}.message`] = ap.message;
    }
  }

  // AP evidence flows through the map above (check.evidence + ap.evidence).

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
