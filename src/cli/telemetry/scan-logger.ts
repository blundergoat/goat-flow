import { mkdirSync, appendFileSync } from 'node:fs';
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

/**
 * Append scan results to the target project's local telemetry log.
 * Writes one JSONL line per agent to `{projectPath}/tasks/logs/scan-history.jsonl`.
 * Silent on failure — telemetry must never break the scan.
 */
export function appendScanHistory(report: ScanReport, projectPath: string): void {
  try {
    const logsDir = join(projectPath, 'tasks', 'logs');
    mkdirSync(logsDir, { recursive: true });

    const now = new Date().toISOString();
    const lines: string[] = [];

    for (const agent of report.agents) {
      const checks = { pass: 0, partial: 0, fail: 0, na: 0, total: agent.checks.length };
      for (const c of agent.checks) {
        if (c.status === 'pass') checks.pass++;
        else if (c.status === 'partial') checks.partial++;
        else if (c.status === 'fail') checks.fail++;
        else if (c.status === 'na') checks.na++;
      }

      const entry: ScanHistoryEntry = {
        date: now,
        agent: agent.agent,
        grade: agent.score.grade,
        percentage: agent.score.percentage,
        checks,
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

      lines.push(JSON.stringify(entry));
    }

    if (lines.length > 0) {
      appendFileSync(join(logsDir, 'scan-history.jsonl'), lines.join('\n') + '\n');
    }
  } catch {
    // Silent — telemetry must never break the scan
  }
}
