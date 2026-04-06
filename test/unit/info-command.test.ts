/**
 * Unit tests for the info command: validates that the rubric registry
 * exports well-formed check and anti-pattern definitions.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allChecks, allAntiPatterns } from '../../src/cli/rubric/registry.js';

describe('info rubrics: allChecks registry', () => {
  it('is non-empty', () => {
    assert.ok(allChecks.length > 0, 'allChecks should contain at least one check');
  });

  for (const check of allChecks) {
    it(`${check.id} has required fields (id, name, tier)`, () => {
      assert.ok(typeof check.id === 'string' && check.id.length > 0, 'id must be a non-empty string');
      assert.ok(typeof check.name === 'string' && check.name.length > 0, 'name must be a non-empty string');
      assert.ok(
        ['foundation', 'standard', 'full'].includes(check.tier),
        `tier must be foundation, standard, or full — got "${check.tier}"`,
      );
    });
  }
});

describe('info anti-patterns: allAntiPatterns registry', () => {
  it('is non-empty', () => {
    assert.ok(allAntiPatterns.length > 0, 'allAntiPatterns should contain at least one entry');
  });

  for (const ap of allAntiPatterns) {
    it(`${ap.id} has required fields (id, name, deduction)`, () => {
      assert.ok(typeof ap.id === 'string' && ap.id.length > 0, 'id must be a non-empty string');
      assert.ok(typeof ap.name === 'string' && ap.name.length > 0, 'name must be a non-empty string');
      assert.ok(typeof ap.deduction === 'number', 'deduction must be a number');
      assert.ok(ap.deduction <= 0, `deduction should be non-positive — got ${ap.deduction}`);
    });
  }
});
