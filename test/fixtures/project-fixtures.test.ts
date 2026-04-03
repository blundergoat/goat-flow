/**
 * Golden-fixture integration tests for real project layouts.
 * Each fixture is scanned end to end and compared against expected grades, checks, and report snippets.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { AgentReport } from '../../src/cli/types.js';
import { renderText } from '../../src/cli/render/text.js';
import { scanFixture } from '../helpers/fixture-scanner.js';

const cleanups: Array<() => void> = [];

afterEach(() => {
  while (cleanups.length > 0) {
    const cleanup = cleanups.pop();
    cleanup?.();
  }
});

/** Look up one agent report from a fixture scan and fail loudly if it is missing. */
function getAgent(
  reportName: string,
  agents: AgentReport[],
  agentId: string,
): AgentReport {
  const agent = agents.find((candidate) => candidate.agent === agentId);
  assert.ok(agent, `${reportName}: missing agent ${agentId}`);
  return agent;
}

describe('project fixture corpus', () => {
  it('passing-minimal scores 100 for Claude', () => {
    const fixture = scanFixture('passing-minimal');
    cleanups.push(fixture.cleanup);

    const claude = getAgent('passing-minimal', fixture.report.agents, 'claude');
    assert.equal(claude.score.percentage, 100);
    assert.equal(claude.score.grade, 'A');
    assert.deepEqual(
      claude.checks
        .filter(
          (check) => check.status === 'fail' || check.status === 'partial',
        )
        .map((check) => check.id),
      [],
    );
    assert.deepEqual(
      claude.antiPatterns
        .filter((pattern) => pattern.triggered)
        .map((pattern) => pattern.id),
      [],
    );
  });

  it('passing-full scores 100 for Claude', () => {
    const fixture = scanFixture('passing-full');
    cleanups.push(fixture.cleanup);

    const claude = getAgent('passing-full', fixture.report.agents, 'claude');
    assert.equal(claude.score.percentage, 100);
    assert.equal(claude.score.grade, 'A');
    assert.deepEqual(
      claude.checks
        .filter(
          (check) => check.status === 'fail' || check.status === 'partial',
        )
        .map((check) => check.id),
      [],
    );
    assert.deepEqual(
      claude.antiPatterns
        .filter((pattern) => pattern.triggered)
        .map((pattern) => pattern.id),
      [],
    );
  });

  it('failing-known exposes the expected scanner regressions', () => {
    const fixture = scanFixture('failing-known');
    cleanups.push(fixture.cleanup);

    const claude = getAgent('failing-known', fixture.report.agents, 'claude');
    assert.ok(
      claude.score.percentage < 100,
      `Expected failing-known < 100, got ${claude.score.percentage}`,
    );

    const failingChecks = new Set(
      claude.checks
        .filter((check) => check.status === 'fail')
        .map((check) => check.id),
    );
    assert.ok(
      failingChecks.has('2.2.3'),
      `Expected 2.2.3 to fail. Saw: ${Array.from(failingChecks).join(', ')}`,
    );
    assert.ok(
      failingChecks.has('2.6.2'),
      `Expected 2.6.2 to fail. Saw: ${Array.from(failingChecks).join(', ')}`,
    );
  });

  it('failing-known text output reports both failures in one pass', () => {
    const fixture = scanFixture('failing-known');
    cleanups.push(fixture.cleanup);

    const output = renderText(fixture.report, false);
    assert.match(
      output,
      /2\.2\.3/,
      'Expected rendered output to include check 2.2.3',
    );
    assert.match(
      output,
      /2\.6\.2/,
      'Expected rendered output to include check 2.6.2',
    );
    assert.match(
      output,
      /Failures: \d+ failed, \d+ partial, \d+ pass/,
      'Expected rendered output to include the failure summary',
    );
  });
});
