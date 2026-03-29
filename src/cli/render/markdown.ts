import type { ScanReport, AgentReport, CheckStatus } from '../types.js';

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
      lines.push(`| ${agent.agentName} | N/A | Insufficient data | — | — | — |`);
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

/** Render a single agent's failing checks and recommendations */
function renderAgentMarkdown(agent: AgentReport): string[] {
  const lines: string[] = [];
  const failing = agent.checks.filter(c => c.status === 'fail' || c.status === 'partial');

  if (failing.length === 0 && agent.recommendations.length === 0) return lines;

  if (agent.checks.length > 0) {
    lines.push(`<details><summary><strong>${agent.agentName}</strong> — ${failing.length} issue${failing.length !== 1 ? 's' : ''}</summary>`);
    lines.push('');
  }

  if (failing.length > 0) {
    lines.push('| Status | Check | Points | Message |');
    lines.push('|--------|-------|--------|---------|');
    for (const check of failing) {
      lines.push(`| ${statusEmoji(check.status)} | ${check.id} ${check.name} | ${check.points}/${check.maxPoints} | ${check.message} |`);
    }
    lines.push('');
  }

  // Anti-pattern deductions
  const triggered = agent.antiPatterns.filter(ap => ap.triggered);
  if (triggered.length > 0) {
    lines.push('**Anti-pattern deductions:**');
    for (const ap of triggered) {
      lines.push(`- ${ap.id} ${ap.name}: ${ap.deduction} pts — ${ap.message}`);
    }
    lines.push('');
  }

  // Top recommendations
  if (agent.recommendations.length > 0) {
    lines.push('**Top recommendations:**');
    for (const rec of agent.recommendations.slice(0, 5)) {
      const tag = rec.priority === 'critical' ? '🔴' : rec.priority === 'high' ? '🟠' : '🟡';
      lines.push(`- ${tag} \`${rec.checkId}\` ${rec.action}`);
    }
    if (agent.recommendations.length > 5) {
      lines.push(`- ... and ${agent.recommendations.length - 5} more`);
    }
    lines.push('');
  }

  if (agent.checks.length > 0) {
    lines.push('</details>');
  }

  return lines;
}
