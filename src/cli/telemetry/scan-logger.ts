import { mkdirSync, appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ScanReport, AgentId, Grade } from '../types.js';

/** Flattened per-agent scan entry for the JSONL telemetry log */
export interface ScanHistoryEntry {
  date: string;
  agent: AgentId;
  grade: Grade;
  percentage: number;
  checks: { pass: number; partial: number; fail: number; na: number; total: number };
  deductions: number;
  tiers: {
    foundation: { earned: number; available: number; percentage: number };
    standard: { earned: number; available: number; percentage: number };
    full: { earned: number; available: number; percentage: number };
  };
  packageVersion: string;
  rubricVersion: string;
}

function countChecks(agent: ScanReport['agents'][number]): ScanHistoryEntry['checks'] {
  const checks: ScanHistoryEntry['checks'] = { pass: 0, partial: 0, fail: 0, na: 0, total: agent.checks.length };

  for (const check of agent.checks) {
    if (check.status === 'pass') {
      checks.pass++;
      continue;
    }
    if (check.status === 'partial') {
      checks.partial++;
      continue;
    }
    if (check.status === 'fail') {
      checks.fail++;
      continue;
    }
    checks.na++;
  }

  return checks;
}

function buildScanHistoryEntry(
  report: ScanReport,
  agent: ScanReport['agents'][number],
  date: string,
): ScanHistoryEntry {
  return {
    date,
    agent: agent.agent,
    grade: agent.score.grade,
    percentage: agent.score.percentage,
    checks: countChecks(agent),
    deductions: agent.score.deductions,
    tiers: {
      foundation: {
        earned: agent.score.tiers.foundation.earned,
        available: agent.score.tiers.foundation.available,
        percentage: agent.score.tiers.foundation.percentage,
      },
      standard: {
        earned: agent.score.tiers.standard.earned,
        available: agent.score.tiers.standard.available,
        percentage: agent.score.tiers.standard.percentage,
      },
      full: {
        earned: agent.score.tiers.full.earned,
        available: agent.score.tiers.full.available,
        percentage: agent.score.tiers.full.percentage,
      },
    },
    packageVersion: report.packageVersion,
    rubricVersion: report.rubricVersion,
  };
}

function rotateScanHistory(logPath: string): void {
  try {
    const content = readFileSync(logPath, 'utf-8');
    const allLines = content.trim().split('\n');
    if (allLines.length > 500) {
      writeFileSync(logPath, allLines.slice(-500).join('\n') + '\n');
    }
  } catch {
    // Rotation is best-effort.
  }
}

/**
 * Append scan results to the target project's local telemetry log.
 * Writes one JSONL line per agent to `{projectPath}/.goat-flow/logs/scan-history.jsonl`.
 * Silent on failure - telemetry must never break the scan.
 */
export function appendScanHistory(report: ScanReport, projectPath: string): void {
  try {
    const logsDir = join(projectPath, '.goat-flow', 'logs');
    mkdirSync(logsDir, { recursive: true });

    const now = new Date().toISOString();
    const lines: string[] = [];

    for (const agent of report.agents) {
      lines.push(JSON.stringify(buildScanHistoryEntry(report, agent, now)));
    }

    if (lines.length > 0) {
      const logPath = join(logsDir, 'scan-history.jsonl');
      appendFileSync(logPath, lines.join('\n') + '\n');
      rotateScanHistory(logPath);
    }
  } catch {
    // Silent - telemetry must never break the scan
  }
}
