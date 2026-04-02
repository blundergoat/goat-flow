import type { ScanReport, AgentReport, CheckStatus } from '../types.js';

const RECOMMENDATION_TAGS = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟡',
} as const;

/** Map check status to a markdown-friendly emoji */
function statusEmoji(status: CheckStatus): string {
  switch (status) {
    case 'pass': return ':white_check_mark:';
    case 'partial': return ':yellow_circle:';
    case 'fail': return ':x:';
    case 'na': return ':heavy_minus_sign:';
  }
}

/** Render a scan report as GitHub-flavored markdown suitable for PR comments */
export function renderMarkdown(report: ScanReport): string {
  const lines: string[] = [];

  lines.push('## GOAT Flow Audit');
  lines.push('');
  lines.push(`Learning loop: footguns ${report.meta.learningLoop.footguns.committed} committed / ${report.meta.learningLoop.footguns.local} local; lessons ${report.meta.learningLoop.lessons.committed} committed / ${report.meta.learningLoop.lessons.local} local.`);
  lines.push(`Config: ${report.meta.config.exists ? (report.meta.config.valid ? '`.goat-flow/config.yaml` valid.' : '`.goat-flow/config.yaml` invalid.') : '`.goat-flow/config.yaml` missing; scanner used defaults.'}`);
  lines.push('');

  if (report.agents.length === 0) {
    lines.push('No GOAT Flow agents detected. No `CLAUDE.md`, `AGENTS.md`, or `GEMINI.md` found.');
    return lines.join('\n');
  }

  // Summary table
  lines.push('| Agent | Grade | Score | Foundation | Standard | Full |');
  lines.push('|-------|-------|-------|------------|----------|------|');
  for (const agent of report.agents) {
    const { score } = agent;
    if (score.grade === 'insufficient-data') {
      lines.push(`| ${agent.agentName} | N/A | Insufficient data | - | - | - |`);
      continue;
    }
    const { foundation, standard, full } = score.tiers;
    lines.push(`| ${agent.agentName} | **${score.grade}** | ${score.percentage}% | ${foundation.percentage}% | ${standard.percentage}% | ${full.percentage}% |`);
  }
  lines.push('');

  // Per-agent details
  for (const agent of report.agents) {
    if (agent.score.grade === 'insufficient-data') continue;
    lines.push(...renderAgentMarkdown(agent));
    lines.push('');
  }

  lines.push(`<sub>Rubric v${report.rubricVersion} · ${report.meta.checkCount} checks · ${report.meta.antiPatternCount} anti-patterns</sub>`);

  return lines.join('\n');
}

function appendFailingChecks(lines: string[], failing: AgentReport['checks']): void {
  if (failing.length === 0) return;

  lines.push('| Status | Check | Points | Message |');
  lines.push('|--------|-------|--------|---------|');
  for (const check of failing) {
    lines.push(`| ${statusEmoji(check.status)} | ${check.id} ${check.name} | ${check.points}/${check.maxPoints} | ${check.message} |`);
  }
  lines.push('');
}

function appendTriggeredAntiPatterns(lines: string[], agent: AgentReport): void {
  const triggered = agent.antiPatterns.filter(antiPattern => antiPattern.triggered);
  if (triggered.length === 0) return;

  lines.push('**Anti-pattern deductions:**');
  for (const antiPattern of triggered) {
    lines.push(`- ${antiPattern.id} ${antiPattern.name}: ${antiPattern.deduction} pts - ${antiPattern.message}`);
  }
  lines.push('');
}

function appendRecommendations(lines: string[], agent: AgentReport): void {
  if (agent.recommendations.length === 0) return;

  lines.push('**Top recommendations:**');
  for (const recommendation of agent.recommendations.slice(0, 5)) {
    lines.push(`- ${RECOMMENDATION_TAGS[recommendation.priority]} \`${recommendation.checkId}\` ${recommendation.action}`);
  }
  if (agent.recommendations.length > 5) {
    lines.push(`- ... and ${agent.recommendations.length - 5} more`);
  }
  lines.push('');
}

/** Render a single agent's failing checks and recommendations */
function renderAgentMarkdown(agent: AgentReport): string[] {
  const lines: string[] = [];
  const failing = agent.checks.filter(c => c.status === 'fail' || c.status === 'partial');

  if (failing.length === 0 && agent.recommendations.length === 0) return lines;

  if (agent.checks.length > 0) {
    lines.push(`<details><summary><strong>${agent.agentName}</strong> - ${failing.length} issue${failing.length !== 1 ? 's' : ''}</summary>`);
    lines.push('');
  }
  appendFailingChecks(lines, failing);
  appendTriggeredAntiPatterns(lines, agent);
  appendRecommendations(lines, agent);

  if (agent.checks.length > 0) {
    lines.push('</details>');
  }

  return lines;
}
