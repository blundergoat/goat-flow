/**
 * Regression coverage for config parsing and validation.
 * These tests lock down defaults, error reporting, and normalization of `.goat-flow/config.yaml`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import {
  CONFIG_DEFAULTS,
  loadConfig,
  readConfig,
  validateConfig,
} from '../../src/cli/config/index.js';

describe('config reader', () => {
  it('returns defaults when config.yaml is missing', () => {
    const fs = createMockFS({});
    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.exists, false);
    assert.equal(loaded.valid, true);
    assert.deepEqual(loaded.config, CONFIG_DEFAULTS);
    assert.deepEqual(readConfig('/test', fs), CONFIG_DEFAULTS);
  });

  it('merges partial configs with defaults', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': [
        'footguns:',
        '  committed: custom/footguns/',
        'skills:',
        '  install:',
        '    - goat-debug',
        '    - goat-review',
      ].join('\n'),
    });

    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.config.footguns.committed, 'custom/footguns/');
    assert.equal(loaded.config.footguns.local, CONFIG_DEFAULTS.footguns.local);
    assert.deepEqual(loaded.config.skills.install, [
      'goat-debug',
      'goat-review',
    ]);
    assert.equal(loaded.config.tasks.path, CONFIG_DEFAULTS.tasks.path);
  });

  it('preserves explicit null agents override', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'agents: null\n',
    });

    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.config.agents, null);
  });

  it('warns on unknown keys', () => {
    const result = validateConfig({
      version: '1.0.0',
      unknownField: true,
    });

    assert.equal(result.valid, true);
    assert.equal(result.warnings.length, 1);
    assert.equal(result.warnings[0]?.path, 'unknownField');
  });

  it('errors on invalid types', () => {
    const result = validateConfig({
      footguns: { committed: 123 },
      agents: [],
      skills: { install: [] },
    });

    assert.equal(result.valid, false);
    assert.ok(
      result.errors.some((issue) => issue.path === 'footguns.committed'),
    );
    assert.ok(result.errors.some((issue) => issue.path === 'agents'));
    assert.ok(result.errors.some((issue) => issue.path === 'skills.install'));
  });

  it('reports YAML parse errors and falls back to defaults', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'footguns: [unterminated\n',
    });

    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.exists, true);
    assert.equal(loaded.valid, false);
    assert.ok(loaded.parseError);
    assert.deepEqual(loaded.config, CONFIG_DEFAULTS);
  });
});

describe('config userRole parsing', () => {
  it('defaults userRole to developer when not specified', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'version: "1.0.0"\n',
    });
    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.config.userRole, 'developer');
  });

  it('parses userRole: developer from config', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'userRole: developer\n',
    });
    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.config.userRole, 'developer');
  });

  it('parses userRole: investigator from config', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'userRole: investigator\n',
    });
    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.valid, true);
    assert.equal(loaded.config.userRole, 'investigator');
  });

  it('rejects invalid userRole value', () => {
    const result = validateConfig({ userRole: 'admin' });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'userRole'));
  });

  it('rejects non-string userRole', () => {
    const result = validateConfig({ userRole: 42 });
    assert.equal(result.valid, false);
    assert.ok(result.errors.some((e) => e.path === 'userRole'));
  });

  it('ignores invalid userRole and keeps default', () => {
    const fs = createMockFS({
      '.goat-flow/config.yaml': 'userRole: admin\n',
    });
    const loaded = loadConfig('/test', fs);
    assert.equal(loaded.config.userRole, 'developer');
  });

  it('userRole does not warn as unknown key', () => {
    const result = validateConfig({ userRole: 'developer' });
    assert.equal(result.valid, true);
    assert.equal(
      result.warnings.filter((w) => w.path === 'userRole').length,
      0,
    );
  });
});
