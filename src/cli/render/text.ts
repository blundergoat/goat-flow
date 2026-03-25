import type { ScanReport, AgentReport, CheckResult, AntiPatternResult, CheckStatus } from '../types.js';

/** Priority levels used by recommendation entries */
type Priority = 'critical' | 'high' | 'medium' | 'low';

/** Render a text-based progress bar using block characters */
function progressBar(percentage: number, width: number = 20): string {
  /** Number of filled blocks proportional to the percentage */
  const filled = Math.round((percentage / 100) * width);
  /** Remaining empty blocks */
  const empty = width - filled;
  return '\u2588'.repeat(filled) + '\u2591'.repeat(empty);
}

/** Map a check status to its 4-character display label */
function statusIcon(status: CheckStatus): string {
  switch (status) {
    case 'pass': return 'PASS';
    case 'partial': return 'PART';
    case 'fail': return 'FAIL';
    case 'na': return 'N/A ';
  }
}

/** Map a priority level to its fixed-width display label */
function priorityLabel(priority: Priority): string {
  switch (priority) {
    case 'critical': return 'CRITICAL';
    case 'high': return 'HIGH    ';
    case 'medium': return 'MEDIUM  ';
    case 'low': return 'LOW     ';
  }
}

/** Render a scan report as human-readable plain text */
export function renderText(report: ScanReport, verbose: boolean): string {
  /** Accumulated output lines joined into the final text */
  const lines: string[] = [];

  lines.push(`GOAT Flow Audit: ${report.target}`);
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

  // Iterate over each detected agent to render its report section
  for (const agent of report.agents) {
    lines.push(renderAgent(agent, verbose));
    lines.push('');
  }

  lines.push(`Rubric: v${report.rubricVersion} | Checks: ${report.meta.checkCount} | Anti-patterns: ${report.meta.antiPatternCount}`);

  return lines.join('\n');
}

/** Render a single agent's report including grade, tiers, and recommendations */
function renderAgent(agent: AgentReport, verbose: boolean): string {
  /** Accumulated output lines for this agent */
  const lines: string[] = [];
  /** Destructured score summary for the agent */
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

  /** Destructured tier scores for foundation, standard, and full */
  const { foundation, standard, full } = score.tiers;
  lines.push(`  Foundation:  ${String(foundation.earned).padStart(3)}/${foundation.available}  ${progressBar(foundation.percentage)}  ${foundation.percentage}%`);
  lines.push(`  Standard:    ${String(standard.earned).padStart(3)}/${standard.available}  ${progressBar(standard.percentage)}  ${standard.percentage}%`);
  lines.push(`  Full:        ${String(full.earned).padStart(3)}/${full.available}  ${progressBar(full.percentage)}  ${full.percentage}%`);

  if (score.deductions < 0) {
    lines.push(`  Deductions:  ${score.deductions}`);
  }

  lines.push('');

  // Recommendations (always shown when present)
  if (agent.recommendations.length > 0) {
    lines.push('Recommendations:');
    // Iterate over the top 10 recommendations to display priority and action
    for (const rec of agent.recommendations.slice(0, 10)) {
      lines.push(`  [${priorityLabel(rec.priority)}] ${rec.checkId}: ${rec.action}`);
    }
    if (agent.recommendations.length > 10) {
      lines.push(`  ... and ${agent.recommendations.length - 10} more`);
    }
    lines.push('');
  }

  // Verbose mode: per-check details
  if (verbose) {
    lines.push('Check Details:');
    // Iterate over every check to render its detailed result
    for (const check of agent.checks) {
      lines.push(renderCheck(check));
    }
    lines.push('');

    if (agent.antiPatterns.some(ap => ap.triggered)) {
      lines.push('Anti-Pattern Deductions:');
      // Iterate over triggered anti-patterns to render their deductions
      for (const ap of agent.antiPatterns.filter(a => a.triggered)) {
        lines.push(renderAntiPattern(ap));
      }
      lines.push('');
    }

    // Diagnostic summary: top improvements ranked by point impact
    const impacts: Array<{ label: string; points: number; priority: string }> = [];

    // Check-based impacts
    for (const rec of agent.recommendations) {
      const check = agent.checks.find(c => c.id === rec.checkId);
      const recoverable = check ? check.maxPoints - check.points : 0;
      if (recoverable > 0) {
        impacts.push({ label: `${rec.checkId}: ${rec.action}`, points: recoverable, priority: rec.priority });
      }
    }

    // Anti-pattern impacts
    for (const ap of agent.antiPatterns.filter(a => a.triggered)) {
      impacts.push({ label: `${ap.id}: ${ap.name}`, points: Math.abs(ap.deduction), priority: 'critical' });
    }

    // Sort by points descending, take top 5
    impacts.sort((a, b) => b.points - a.points);

    if (impacts.length > 0) {
      lines.push('Diagnostic Summary:');
      for (const item of impacts.slice(0, 5)) {
        lines.push(`  ${priorityLabel(item.priority as Priority).trim().padEnd(8)} ${item.label} (${item.points} pts recoverable)`);
      }
      lines.push('');
      const top = impacts[0]!;
      lines.push(`  Highest-impact fix: ${top.label} — recovers ${top.points} points`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/** Format a single check result as a bracketed status line */
function renderCheck(check: CheckResult): string {
  /** 4-character status label */
  const status = statusIcon(check.status);
  /** Points display, or N/A for non-applicable checks */
  const points = check.status === 'na'
    ? 'N/A'
    : `${check.points}/${check.maxPoints}`;
  /** Optional evidence suffix */
  const evidence = check.evidence ? ` (${check.evidence})` : '';
  return `  [${status}] ${check.id} ${check.name}: ${points}${evidence}`;
}

/** Format a single triggered anti-pattern as a bracketed deduction line */
function renderAntiPattern(ap: AntiPatternResult): string {
  return `  [${ap.id}] ${ap.name}: ${ap.deduction} — ${ap.message}`;
}
