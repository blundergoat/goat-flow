import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { detectAgents } from '../../src/cli/detect/agents.js';
import { detectShape } from '../../src/cli/detect/shape.js';
import { detectStack } from '../../src/cli/detect/stack.js';

describe('detectAgents', () => {
  it('finds Claude when CLAUDE.md exists', () => {
    const fs = createMockFS({ 'CLAUDE.md': '# CLAUDE.md' });
    const agents = detectAgents(fs);
    assert.equal(agents.length, 1);
    assert.equal(agents[0].id, 'claude');
  });

  it('finds all three agents', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# Claude',
      'AGENTS.md': '# Agents',
      'GEMINI.md': '# Gemini',
    });
    const agents = detectAgents(fs);
    assert.equal(agents.length, 3);
    assert.deepEqual(agents.map(a => a.id), ['claude', 'codex', 'gemini']);
  });

  it('returns empty when no instruction files', () => {
    const fs = createMockFS({ 'README.md': '# Hello' });
    const agents = detectAgents(fs);
    assert.equal(agents.length, 0);
  });
});

describe('detectShape', () => {
  it('detects library from package.json with exports', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ exports: { '.': './dist/index.js' } }),
    });
    assert.equal(detectShape(fs), 'library');
  });

  it('detects app from package.json with start script', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ scripts: { start: 'node server.js' } }),
    });
    assert.equal(detectShape(fs), 'app');
  });

  it('detects library from composer.json type', () => {
    const fs = createMockFS({
      'composer.json': JSON.stringify({ type: 'library' }),
    });
    assert.equal(detectShape(fs), 'library');
  });

  it('detects library from Cargo.toml [lib]', () => {
    const fs = createMockFS({
      'Cargo.toml': '[package]\nname = "mylib"\n\n[lib]\nname = "mylib"\n',
    });
    assert.equal(detectShape(fs), 'library');
  });

  it('detects app from go.mod', () => {
    const fs = createMockFS({
      'go.mod': 'module github.com/user/app\n\ngo 1.21\n',
    });
    assert.equal(detectShape(fs), 'app');
  });

  it('defaults to app for unknown projects', () => {
    const fs = createMockFS({ 'README.md': '# Hello' });
    assert.equal(detectShape(fs), 'app');
  });
});

describe('detectStack', () => {
  it('detects TypeScript from package.json devDeps', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({
        devDependencies: { typescript: '^5.0.0' },
        scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .' },
      }),
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('typescript'));
    assert.equal(stack.buildCommand, 'tsc');
    assert.equal(stack.testCommand, 'vitest');
    assert.equal(stack.lintCommand, 'eslint .');
  });

  it('detects Rust from Cargo.toml', () => {
    const fs = createMockFS({ 'Cargo.toml': '[package]\nname = "myapp"\n' });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('rust'));
    assert.equal(stack.testCommand, 'cargo test');
  });

  it('detects Go from go.mod', () => {
    const fs = createMockFS({ 'go.mod': 'module foo\n\ngo 1.21\n' });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('go'));
    assert.equal(stack.testCommand, 'go test ./...');
  });

  it('detects markdown-only project', () => {
    const fs = createMockFS({
      'README.md': '# Hello',
      'docs/a.md': 'a',
      'docs/b.md': 'b',
      'docs/c.md': 'c',
      'docs/d.md': 'd',
      'docs/e.md': 'e',
      'docs/f.md': 'f',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('markdown'));
  });
});
