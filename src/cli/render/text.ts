import type { ScanReport, AgentReport, CheckResult, AntiPatternResult } from '../types.js';

function progressBar(percentage: number, width: number = 20): string {
  const filled = Math.round((percentage / 100) * width);
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

function statusIcon(status: string): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'partial': return 'PART';
    case 'fail': return 'FAIL';
    case 'na': return 'N/A ';
    default: return '????';
  }
}

function priorityLabel(priority: string): string {
  switch (priority) {
    case 'critical': return 'CRITICAL';
    case 'high': return 'HIGH    ';
    case 'medium': return 'MEDIUM  ';
    case 'low': return 'LOW     ';
    default: return '        ';
  }
}

export function renderText(report: ScanReport, verbose: boolean): string {
  const lines: string[] = [];

  lines.push(`GOAT Flow Audit: ${report.target}`);
  lines.push(`Shape: ${report.shape.value} (${report.shape.source})`);
  if (report.stack.languages.length > 0) {
    lines.push(`Stack: ${report.stack.languages.join(', ')}`);
  }
  lines.push('');

  if (report.agents.length === 0) {
    lines.push('No GOAT Flow agents detected.');
    lines.push('No CLAUDE.md, AGENTS.md, or GEMINI.md found.');
    lines.push('');
    lines.push('Get started: https://github.com/blundergoat/goat-flow');
    return lines.join('\n');
  }

  for (const agent of report.agents) {
    lines.push(renderAgent(agent, verbose));
    lines.push('');
  }

  lines.push(`Rubric: v${report.rubricVersion} | Checks: ${report.meta.checkCount} | Anti-patterns: ${report.meta.antiPatternCount}`);

  return lines.join('\n');
}

function renderAgent(agent: AgentReport, verbose: boolean): string {
  const lines: string[] = [];
  const { score } = agent;

  lines.push(`--- ${agent.agentName} ---`);
  lines.push('');

  if (score.grade === 'insufficient-data') {
    lines.push('Grade: Insufficient Data (<10% checks applicable)');
    lines.push('');
    return lines.join('\n');
  }

  lines.push(`Grade: ${score.grade} (${score.percentage}%)`);
  lines.push('');

  // Tier breakdown
  const { foundation, standard, full } = score.tiers;
  lines.push(`  Foundation:  ${String(foundation.earned).padStart(3)}/${foundation.available}  ${progressBar(foundation.percentage)}  ${foundation.percentage}%`);
  lines.push(`  Standard:    ${String(standard.earned).padStart(3)}/${standard.available}  ${progressBar(standard.percentage)}  ${standard.percentage}%`);
  lines.push(`  Full:        ${String(full.earned).padStart(3)}/${full.available}  ${progressBar(full.percentage)}  ${full.percentage}%`);

  if (score.deductions < 0) {
    lines.push(`  Deductions:  ${score.deductions}`);
  }

  lines.push('');

  // Recommendations (always show)
  if (agent.recommendations.length > 0) {
    lines.push('Recommendations:');
    for (const rec of agent.recommendations.slice(0, 10)) {
      lines.push(`  [${priorityLabel(rec.priority)}] ${rec.checkId}: ${rec.action}`);
    }
    if (agent.recommendations.length > 10) {
      lines.push(`  ... and ${agent.recommendations.length - 10} more`);
    }
    lines.push('');
  }

  // Verbose: per-check details
  if (verbose) {
    lines.push('Check Details:');
    for (const check of agent.checks) {
      lines.push(renderCheck(check));
    }
    lines.push('');

    if (agent.antiPatterns.some(ap => ap.triggered)) {
      lines.push('Anti-Pattern Deductions:');
      for (const ap of agent.antiPatterns.filter(a => a.triggered)) {
        lines.push(renderAntiPattern(ap));
      }
      lines.push('');
    }
  }

  return lines.join('\n');
}

function renderCheck(check: CheckResult): string {
  const status = statusIcon(check.status);
  const points = check.status === 'na'
    ? 'N/A'
    : `${check.points}/${check.maxPoints}`;
  const evidence = check.evidence ? ` (${check.evidence})` : '';
  return `  [${status}] ${check.id} ${check.name}: ${points}${evidence}`;
}

function renderAntiPattern(ap: AntiPatternResult): string {
  return `  [${ap.id}] ${ap.name}: ${ap.deduction} — ${ap.message}`;
}
