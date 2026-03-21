import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getAllFragments, getFragment, hasFragment, getFragmentKeys } from '../../src/cli/prompt/registry.js';
import { allChecks, allAntiPatterns } from '../../src/cli/rubric/registry.js';

describe('Fragment registry', () => {
  it('has fragments for all check recommendationKeys', () => {
    const missing: string[] = [];
    for (const check of allChecks) {
      if (!hasFragment(check.recommendationKey)) {
        missing.push(`${check.id}: ${check.recommendationKey}`);
      }
    }
    assert.equal(missing.length, 0, `Missing fragments for checks:\n  ${missing.join('\n  ')}`);
  });

  it('has fragments for all anti-pattern recommendationKeys', () => {
    const missing: string[] = [];
    for (const ap of allAntiPatterns) {
      if (!hasFragment(ap.recommendationKey)) {
        missing.push(`${ap.id}: ${ap.recommendationKey}`);
      }
    }
    assert.equal(missing.length, 0, `Missing fragments for anti-patterns:\n  ${missing.join('\n  ')}`);
  });

  it('has no duplicate fragment keys', () => {
    const keys = getFragmentKeys();
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const key of keys) {
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    assert.equal(dupes.length, 0, `Duplicate fragment keys: ${dupes.join(', ')}`);
  });

  it('every fragment has non-empty instruction', () => {
    for (const fragment of getAllFragments()) {
      assert.ok(fragment.instruction.trim().length > 0, `Fragment '${fragment.key}' has empty instruction`);
    }
  });

  it('every fragment has a valid phase', () => {
    const validPhases = ['foundation', 'standard', 'full', 'anti-pattern'];
    for (const fragment of getAllFragments()) {
      assert.ok(validPhases.includes(fragment.phase), `Fragment '${fragment.key}' has invalid phase '${fragment.phase}'`);
    }
  });

  it('every fragment has a category', () => {
    for (const fragment of getAllFragments()) {
      assert.ok(fragment.category.length > 0, `Fragment '${fragment.key}' has no category`);
    }
  });

  it('every fragment has a valid kind', () => {
    for (const fragment of getAllFragments()) {
      assert.ok(
        fragment.kind === 'create' || fragment.kind === 'fix',
        `Fragment '${fragment.key}' has invalid kind '${fragment.kind}'`,
      );
    }
  });

  it('getFragment returns correct fragment', () => {
    const f = getFragment('create-instruction-file');
    assert.ok(f);
    assert.equal(f.key, 'create-instruction-file');
    assert.equal(f.phase, 'foundation');
  });

  it('getFragment returns undefined for unknown key', () => {
    assert.equal(getFragment('nonexistent-key'), undefined);
  });
});
