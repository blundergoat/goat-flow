/**
 * Contract tests for setup's "migrate, not duplicate" principle.
 * These verify what setup SHOULD do when existing artifacts exist.
 * They test the contract by scanning fixture projects that simulate migration scenarios.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');

// ---------------------------------------------------------------
// 1. Canonical path contract: one surface per artifact type
// ---------------------------------------------------------------
describe('Canonical path contract: no duplicate surfaces in goat-flow itself', () => {
  it('does not have both docs/footguns.md (flat) and ai-docs/footguns/ (directory)', () => {
    const flatFile = existsSync(join(ROOT, 'docs/footguns.md'));
    const dirExists = existsSync(join(ROOT, 'docs/footguns'));
    if (flatFile && dirExists) {
      assert.fail(
        'Both docs/footguns.md and ai-docs/footguns/ exist. ' +
          'Setup should use one canonical surface, not both.',
      );
    }
  });

  it('does not have both docs/lessons.md (flat) and ai-docs/lessons/ (directory)', () => {
    const flatFile = existsSync(join(ROOT, 'docs/lessons.md'));
    const dirExists = existsSync(join(ROOT, 'ai-docs/lessons'));
    if (flatFile && dirExists) {
      assert.fail(
        'Both docs/lessons.md and ai-docs/lessons/ exist. ' +
          'Setup should use one canonical surface, not both.',
      );
    }
  });

  it('does not have both agent-evals/ and ai-docs/evals/', () => {
    const legacyDir = existsSync(join(ROOT, 'agent-evals'));
    const canonicalDir = existsSync(join(ROOT, 'ai-docs/evals'));
    if (legacyDir && canonicalDir) {
      assert.fail(
        'Both agent-evals/ and ai-docs/evals/ exist. ' +
          'Setup should migrate to one canonical surface.',
      );
    }
  });

  it('does not have both codex-evals/ and ai-docs/evals/', () => {
    const legacyDir = existsSync(join(ROOT, 'codex-evals'));
    const canonicalDir = existsSync(join(ROOT, 'ai-docs/evals'));
    if (legacyDir && canonicalDir) {
      assert.fail(
        'Both codex-evals/ and ai-docs/evals/ exist. ' +
          'Setup should migrate to one canonical surface.',
      );
    }
  });
});

// ---------------------------------------------------------------
// 2. Config.yaml paths match what actually exists
// ---------------------------------------------------------------
describe('Config.yaml paths match filesystem reality', () => {
  const configPath = join(ROOT, '.goat-flow/config.yaml');

  it('.goat-flow/config.yaml exists', () => {
    assert.ok(existsSync(configPath), 'Missing .goat-flow/config.yaml');
  });

  it('configured footguns path exists', () => {
    const config = readFileSync(configPath, 'utf-8');
    const match = config.match(/^\s+committed:\s*(.+)$/m);
    if (match) {
      const committedPath = match[1].trim();
      assert.ok(
        existsSync(join(ROOT, committedPath)),
        `Config footguns.committed path ${committedPath} does not exist on disk`,
      );
    }
  });

  it('configured lessons path exists', () => {
    const config = readFileSync(configPath, 'utf-8');
    // Find lessons section
    const lessonsMatch = config.match(
      /lessons:\s*\n\s+committed:\s*(.+)/m,
    );
    if (lessonsMatch) {
      const committedPath = lessonsMatch[1].trim();
      assert.ok(
        existsSync(join(ROOT, committedPath)),
        `Config lessons.committed path ${committedPath} does not exist on disk`,
      );
    }
  });
});

// ---------------------------------------------------------------
// 3. Setup templates describe migration, not duplication
// ---------------------------------------------------------------
describe('Setup templates mention migration behavior', () => {
  const setupSharedDir = join(ROOT, 'workflow/setup/shared');

  it('workflow/setup/shared directory exists', () => {
    assert.ok(existsSync(setupSharedDir));
  });

  it('setup templates do not hardcode both old and new eval paths', () => {
    const sharedFiles = readdirSync(setupSharedDir).filter((f) =>
      f.endsWith('.md'),
    );
    for (const file of sharedFiles) {
      const content = readFileSync(join(setupSharedDir, file), 'utf-8');
      const hasAgentEvals = content.includes('agent-evals/');
      const hasAiEvals = content.includes('ai-docs/evals/');
      if (hasAgentEvals && hasAiEvals) {
        assert.fail(
          `${file} references both agent-evals/ and ai-docs/evals/. ` +
            'Templates should use the canonical path from config.',
        );
      }
    }
  });

  it('setup templates do not hardcode both flat footguns and directory footguns', () => {
    const sharedFiles = readdirSync(setupSharedDir).filter((f) =>
      f.endsWith('.md'),
    );
    for (const file of sharedFiles) {
      const content = readFileSync(join(setupSharedDir, file), 'utf-8');
      // Check for the flat file reference alongside directory reference
      const hasFlatFootguns = /docs\/footguns\.md(?!\/)/.test(content);
      const hasDirFootguns = content.includes('ai-docs/footguns/');
      if (hasFlatFootguns && hasDirFootguns) {
        assert.fail(
          `${file} references both docs/footguns.md and ai-docs/footguns/. ` +
            'Templates should use the canonical directory path.',
        );
      }
    }
  });
});

// ---------------------------------------------------------------
// 4. Fixture contract: passing-minimal uses canonical paths only
// ---------------------------------------------------------------
describe('Fixture passing-minimal uses canonical paths only', () => {
  const fixtureDir = join(ROOT, 'test/fixtures/projects/passing-minimal');

  it('does not have duplicate lesson surfaces', () => {
    const flatFile = existsSync(join(fixtureDir, 'docs/lessons.md'));
    assert.ok(
      !flatFile,
      'passing-minimal should not have docs/lessons.md (flat file) - use ai-docs/lessons/ only',
    );
  });

  it('does not have legacy eval path', () => {
    const legacyDir = existsSync(join(fixtureDir, 'agent-evals'));
    assert.ok(
      !legacyDir,
      'passing-minimal should not have agent-evals/ - use ai-docs/evals/ only',
    );
  });

  it('does not have duplicate footgun surfaces', () => {
    const flatFile = existsSync(join(fixtureDir, 'docs/footguns.md'));
    assert.ok(
      !flatFile,
      'passing-minimal should not have docs/footguns.md (flat file) - use ai-docs/footguns/ (dir) only',
    );
  });
});
