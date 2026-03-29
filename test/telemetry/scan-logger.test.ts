import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { appendScanHistory } from '../../src/cli/telemetry/scan-logger.js';
import type { ScanReport, AgentReport } from '../../src/cli/types.js';

function makeTierScore(earned: number, available: number) {
  return { tier: 'foundation' as const, earned, available, percentage: available > 0 ? Math.round((earned / available) * 100) : 0 };
}

function makeAgentReport(agent: 'claude' | 'codex' | 'gemini', percentage: number): AgentReport {
  return {
    agent,
    agentName: agent,
    score: {
      earned: percentage,
      available: 100,
      deductions: 0,
      percentage,
      grade: percentage >= 90 ? 'A' : percentage >= 75 ? 'B' : 'C',
      tiers: {
        foundation: makeTierScore(40, 43),
        standard: makeTierScore(55, 62),
        full: makeTierScore(15, 17),
      },
    },
    checks: [
      { id: '1.1', name: 'test', tier: 'foundation', category: 'Test', status: 'pass', points: 5, maxPoints: 5, confidence: 'high', message: 'ok' },
      { id: '1.2', name: 'test2', tier: 'foundation', category: 'Test', status: 'fail', points: 0, maxPoints: 3, confidence: 'high', message: 'missing' },
      { id: '1.3', name: 'test3', tier: 'standard', category: 'Test', status: 'na', points: 0, maxPoints: 0, confidence: 'medium', message: 'n/a' },
    ],
    antiPatterns: [],
    recommendations: [],
  };
}

function makeReport(agents: AgentReport[]): ScanReport {
  return {
    schemaVersion: '2',
    packageVersion: '0.9.0',
    rubricVersion: '0.9.0',
    target: '/test',
    stack: { languages: ['typescript'], buildCommand: 'tsc', testCommand: 'vitest', lintCommand: 'eslint', formatCommand: 'prettier', signals: { codeGenTools: [], deployPlatforms: [], llmIntegration: false, staticAnalysis: [], complianceSignals: false, formatterGaps: [] } },
    agents,
    meta: { checkCount: 98, antiPatternCount: 14 },
  };
}

describe('appendScanHistory', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'goat-telemetry-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates tasks/logs/ and writes JSONL', () => {
    const report = makeReport([makeAgentReport('claude', 95)]);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    assert.ok(existsSync(logPath), 'scan-history.jsonl should exist');

    const content = readFileSync(logPath, 'utf-8').trim();
    const entry = JSON.parse(content);
    assert.equal(entry.agent, 'claude');
    assert.equal(entry.percentage, 95);
    assert.equal(entry.grade, 'A');
    assert.equal(entry.checks.pass, 1);
    assert.equal(entry.checks.fail, 1);
    assert.equal(entry.checks.na, 1);
    assert.equal(entry.checks.total, 3);
    assert.equal(entry.packageVersion, '0.9.0');
  });

  it('writes one line per agent', () => {
    const report = makeReport([
      makeAgentReport('claude', 95),
      makeAgentReport('codex', 80),
      makeAgentReport('gemini', 85),
    ]);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 3);

    const agents = lines.map(l => JSON.parse(l).agent);
    assert.deepEqual(agents, ['claude', 'codex', 'gemini']);
  });

  it('appends on repeated calls (not overwrite)', () => {
    const report = makeReport([makeAgentReport('claude', 90)]);
    appendScanHistory(report, tmpDir);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    assert.equal(lines.length, 2, 'Should have 2 lines after 2 appends');
  });

  it('each line is valid JSON', () => {
    const report = makeReport([makeAgentReport('claude', 95), makeAgentReport('codex', 80)]);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    const lines = readFileSync(logPath, 'utf-8').trim().split('\n');
    for (const line of lines) {
      assert.doesNotThrow(() => JSON.parse(line), `Line should be valid JSON: ${line}`);
    }
  });

  it('includes tier breakdown', () => {
    const report = makeReport([makeAgentReport('claude', 95)]);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    const entry = JSON.parse(readFileSync(logPath, 'utf-8').trim());
    assert.ok(entry.tiers.foundation);
    assert.ok(entry.tiers.standard);
    assert.ok(entry.tiers.full);
    assert.equal(entry.tiers.foundation.earned, 40);
    assert.equal(entry.tiers.foundation.available, 43);
  });

  it('does not throw on read-only or missing path', () => {
    // Pass a path that can't be created (nested under a file)
    assert.doesNotThrow(() => {
      appendScanHistory(makeReport([makeAgentReport('claude', 90)]), '/dev/null/impossible');
    });
  });

  it('does nothing for empty agents array', () => {
    const report = makeReport([]);
    appendScanHistory(report, tmpDir);

    const logPath = join(tmpDir, 'tasks', 'logs', 'scan-history.jsonl');
    assert.ok(!existsSync(logPath), 'Should not create file for empty report');
  });
});
