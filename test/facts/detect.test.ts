import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { detectAgents } from '../../src/cli/detect/agents.js';
import { detectStack } from '../../src/cli/detect/stack.js';
import { mapLanguagesToTemplates } from '../../src/cli/prompt/template-refs.js';

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

  // --- Frontend framework detection ---

  it('detects React from package.json deps', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ dependencies: { react: '^18.0.0' }, scripts: { test: 'vitest' } }),
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('react'));
  });

  it('detects Vue from package.json deps', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ dependencies: { vue: '^3.0.0' }, scripts: { test: 'vitest' } }),
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('vue'));
  });

  it('detects Angular from package.json deps', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ dependencies: { '@angular/core': '^17.0.0' }, scripts: { test: 'ng test' } }),
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('angular'));
  });

  it('detects Svelte from package.json deps', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({ devDependencies: { svelte: '^4.0.0' }, scripts: { test: 'vitest' } }),
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('svelte'));
  });

  it('detects Blade from .blade.php files', () => {
    const fs = createMockFS({
      'composer.json': JSON.stringify({ require: { 'laravel/framework': '^11.0' } }),
      'resources/views/welcome.blade.php': '<h1>Hello</h1>',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('blade'));
  });

  it('detects Twig from .twig files', () => {
    const fs = createMockFS({
      'composer.json': JSON.stringify({ require: { 'symfony/framework-bundle': '^7.0' } }),
      'templates/base.html.twig': '{% block body %}{% endblock %}',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('twig'));
  });

  it('detects ERB from .erb files', () => {
    const fs = createMockFS({
      'app/views/users/index.html.erb': '<%= @users.each do |u| %>',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('erb'));
  });

  it('detects Swift/iOS from Package.swift', () => {
    const fs = createMockFS({
      'Package.swift': '// swift-tools-version: 5.9',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('swift'));
  });

  it('detects Blazor from .razor files', () => {
    const fs = createMockFS({
      'Components/Pages/Home.razor': '<h1>Hello</h1>',
    });
    const stack = detectStack(fs);
    assert.ok(stack.languages.includes('blazor'));
  });
});

describe('mapLanguagesToTemplates — frontend routing', () => {
  it('routes React to react.md', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'react']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/react.md'));
  });

  it('routes Vue to vue.md', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'vue']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/vue.md'));
  });

  it('routes Angular to angular.md', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'angular']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/angular.md'));
  });

  it('routes Blade to php-blade.md', () => {
    const refs = mapLanguagesToTemplates(['php', 'blade']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/php-blade.md'));
  });

  it('routes Twig to php-twig.md', () => {
    const refs = mapLanguagesToTemplates(['php', 'twig']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/php-twig.md'));
  });

  it('routes ERB to ruby-erb.md', () => {
    const refs = mapLanguagesToTemplates(['erb']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/ruby-erb.md'));
  });

  it('routes Jinja to python-jinja.md', () => {
    const refs = mapLanguagesToTemplates(['python', 'jinja']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/python-jinja.md'));
  });

  it('routes Blazor to dotnet-blazor.md', () => {
    const refs = mapLanguagesToTemplates(['blazor']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/dotnet-blazor.md'));
  });

  it('routes Swift to swift-ios.md', () => {
    const refs = mapLanguagesToTemplates(['swift']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/swift-ios.md'));
  });

  it('falls back to typescript.md for TS without framework', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'typescript']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/typescript.md'));
  });

  it('framework takes priority over TS fallback', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'typescript', 'react']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.ok(frontend, 'Expected frontend.md ref');
    assert.ok(frontend.template.endsWith('/react.md'), `Got ${frontend.template}`);
  });

  it('first detected framework wins', () => {
    const refs = mapLanguagesToTemplates(['javascript', 'react', 'vue']);
    const frontendRefs = refs.filter(r => r.output === 'ai/instructions/frontend.md');
    assert.equal(frontendRefs.length, 1, 'Should produce exactly one frontend ref');
    assert.ok(frontendRefs[0].template.endsWith('/react.md'));
  });

  it('no frontend ref for Go-only project', () => {
    const refs = mapLanguagesToTemplates(['go']);
    const frontend = refs.find(r => r.output === 'ai/instructions/frontend.md');
    assert.equal(frontend, undefined, 'Go-only should not get frontend.md');
  });
});
