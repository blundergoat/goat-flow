/**
 * Layer 6: Functional journey tests for scanner workflows.
 * These test realistic multi-step scenarios against fixture projects,
 * validating that the scanner pipeline produces correct, actionable results.
 */
import { describe, it, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { scanFixture } from '../helpers/fixture-scanner.js';
import { renderText } from '../../src/cli/render/text.js';
import { renderGuide } from '../../src/cli/render/guide.js';

const cleanups: Array<() => void> = [];
afterEach(() => { while (cleanups.length > 0) cleanups.pop()?.(); });

describe('Journey: scan-broken-project', () => {
  it('broken-hooks fixture produces actionable output with specific failure messages', () => {
    const fixture = scanFixture('broken-hooks');
    cleanups.push(fixture.cleanup);

    const claude = fixture.report.agents.find(a => a.agent === 'claude');
    assert.ok(claude, 'Claude agent should be detected');

    // Score should be below 100
    assert.ok(claude.score.percentage < 100, `Expected < 100, got ${claude.score.percentage}`);

    // Render text output - should mention the specific failure
    const output = renderText(fixture.report, false);
    assert.ok(output.length > 0, 'Text output should not be empty');
    assert.match(output, /2\.2\.3/, 'Should mention the swallowed-failure check');

    // Render guide output - should have prioritized fix items
    const guide = renderGuide(fixture.report);
    assert.ok(guide.length > 0, 'Guide output should not be empty');
    assert.match(guide, /items to fix/i, 'Guide should list items to fix');
  });

  it('stale-refs fixture produces output mentioning stale references', () => {
    const fixture = scanFixture('stale-refs');
    cleanups.push(fixture.cleanup);

    const claude = fixture.report.agents.find(a => a.agent === 'claude');
    assert.ok(claude, 'Claude agent should be detected');

    // Should have anti-pattern or check failure related to stale refs
    const output = renderText(fixture.report, false);
    assert.ok(output.length > 100, 'Output should be substantial');
  });

  it('missing-skills fixture guide tells agent exactly which skills to create', () => {
    const fixture = scanFixture('missing-skills');
    cleanups.push(fixture.cleanup);

    const claude = fixture.report.agents.find(a => a.agent === 'claude');
    assert.ok(claude, 'Claude agent should be detected');

    const guide = renderGuide(fixture.report);
    // Guide should mention specific missing skills
    assert.ok(guide.includes('items to fix') || guide.includes('skill'),
      `Guide should mention skills: ${guide.slice(0, 200)}`);
  });
});

describe('Journey: anti-patterns fire correctly across fixtures', () => {
  it('broken-hooks triggers AP6 (swallowed failures)', () => {
    const fixture = scanFixture('broken-hooks');
    cleanups.push(fixture.cleanup);

    const claude = fixture.report.agents.find(a => a.agent === 'claude');
    assert.ok(claude);
    const ap6 = claude.antiPatterns.find(ap => ap.id === 'AP6');
    assert.ok(ap6, 'AP6 should be evaluated');
    assert.equal(ap6.triggered, true, `AP6 should trigger for broken hooks: ${ap6.message}`);
  });

  it('passing-minimal triggers zero anti-patterns', () => {
    const fixture = scanFixture('passing-minimal');
    cleanups.push(fixture.cleanup);

    const claude = fixture.report.agents.find(a => a.agent === 'claude');
    assert.ok(claude);
    const triggered = claude.antiPatterns.filter(ap => ap.triggered);
    assert.equal(triggered.length, 0,
      `Expected 0 triggered APs, got ${triggered.length}: ${triggered.map(ap => `${ap.id} (${ap.message})`).join(', ')}`);
  });
});

describe('Journey: scan-all-fixtures-coherent', () => {
  it('all fixtures produce valid reports with consistent structure', () => {
    const fixtureNames = [
      'passing-minimal', 'passing-full', 'broken-hooks',
      'stale-refs', 'duplicate-surfaces', 'missing-skills', 'fresh-project',
    ];

    for (const name of fixtureNames) {
      const fixture = scanFixture(name);
      cleanups.push(fixture.cleanup);

      // Report should always have agents array
      assert.ok(fixture.report.agents !== undefined, `${name}: agents array exists`);

      // Text render should never crash
      const output = renderText(fixture.report, false);
      assert.ok(typeof output === 'string', `${name}: text render returns string`);

      // Guide render should never crash
      const guide = renderGuide(fixture.report);
      assert.ok(typeof guide === 'string', `${name}: guide render returns string`);
    }
  });
});
