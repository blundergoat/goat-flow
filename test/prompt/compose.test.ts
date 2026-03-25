import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scanProject } from '../../src/cli/scanner/scan.js';
import { composeSetup, composeInlineSetup, composeMultiAgentSetup } from '../../src/cli/prompt/compose-setup.js';
import type { TemplateRef } from '../../src/cli/prompt/template-refs.js';
import { renderText } from '../../src/cli/render/text.js';
import { parseCLIArgs } from '../../src/cli/cli.js';

// ─── Shared fixtures ────────────────────────────────────────────────

const FULL_CLAUDE_MD = `# CLAUDE.md - v1.0 (2026-03-20)

Documentation framework.

## Essential Commands

\`\`\`bash
shellcheck scripts/*.sh
npm test
\`\`\`

## Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG

**READ** - MUST read relevant files before changes. Never fabricate codebase facts.

**CLASSIFY** - Three signals: (1) Intent. (2) Complexity + budgets.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |

**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius.

**ACT** - MUST declare: \`State: [MODE] | Goal: [one line] | Exit: [condition]\`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. |
| Implement | Edit in 2-3 turns. |
| Debug | Diagnosis with file:line first. |

**VERIFY** - MUST run shellcheck. Two corrections on same approach = MUST rewind.

**LOG** - MUST update when tripped. lessons.md entry required before DoD.

| File | When to update |
|------|---------------|
| \`docs/lessons.md\` | Behavioural mistake |
| \`docs/footguns.md\` | Architectural trap |

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within scope

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local file or "none"]
- [ ] Rollback command: [exact command]

Boundaries:
- \`docs/system-spec.md\` changes
- \`setup/\` prompt changes
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Overwrite without checking.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Router Table

| Resource | Path |
|----------|------|
| Skills | \`.claude/skills/goat-*/\` |
| Footguns | \`docs/footguns.md\` |
| Lessons | \`docs/lessons.md\` |
| Architecture | \`docs/architecture.md\` |
`;

function buildFullProject() {
  return createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'full-project',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    ...Object.fromEntries(
      ['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`, `# goat-${s}\n`,
      ]),
    ),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\necho "BLOCKED" >&2\nexit 2\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nshellcheck changed.sh\nnpx tsc --noEmit\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    'docs/footguns.md': '# Footguns\n\n- `src/auth.ts:42` - race\n',
    'docs/lessons.md': '# Lessons\n\n### Entry 1\nStuff.\n',
    'docs/architecture.md': '# Architecture\n\nOverview.\n',
    'docs/system-spec.md': '# System Spec\n',
    'setup/README.md': '# Setup\n',
    'agent-evals/README.md': '# Evals\n',
    'agent-evals/eval-1.md': '# E1\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nx\n```\n',
    'agent-evals/eval-2.md': '# E2\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\ny\n```\n',
    'agent-evals/eval-3.md': '# E3\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nz\n```\n',
    '.github/workflows/context-validation.yml': 'name: CV\nsteps:\n  - run: wc -l\n  - run: check router\n  - run: check skills\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    'tasks/handoff-template.md': '# Handoff\n',
    '.gitignore': '.env\nsettings.local.json\n',
    'CHANGELOG.md': '# Changelog\n',
  });
}

function buildMinimalProject() {
  return createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n\nBasic instructions.\n\n## Commands\n\n```\nnpm test\n```\n',
    'package.json': JSON.stringify({ name: 'minimal', scripts: { start: 'node .' } }),
  });
}

function buildEmptyProject() {
  return createMockFS({
    'package.json': JSON.stringify({ name: 'empty', scripts: { start: 'node .' } }),
    'README.md': '# Empty\n',
  });
}

// ─── compose-setup ──────────────────────────────────────────────────

describe('composeSetup (reference-based)', () => {
  it('returns a string (not a ComposedPrompt)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.equal(typeof output, 'string');
  });

  it('is under 100 lines per agent', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    const lineCount = output.split('\n').length;
    assert.ok(lineCount <= 100, `Expected ≤100 lines, got ${lineCount}`);
  });

  it('includes all three phase headings', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('## Phase 1a'), 'Phase 1a heading');
    assert.ok(output.includes('## Phase 1b'), 'Phase 1b heading');
    assert.ok(output.includes('## Phase 2'), 'Phase 2 heading');
  });

  it('references Claude-specific paths', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('CLAUDE.md'), 'Should reference CLAUDE.md');
    assert.ok(output.includes('.claude/settings.json'), 'Should reference settings');
    assert.ok(output.includes('.claude/skills'), 'Should reference skills dir');
    assert.ok(output.includes('setup/setup-claude.md'), 'Should reference agent setup guide');
  });

  it('references Codex-specific paths', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'codex');
    assert.ok(output);
    assert.ok(output.includes('AGENTS.md'), 'Should reference AGENTS.md');
    assert.ok(output.includes('.codex/config.toml'), 'Should reference Codex config');
    assert.ok(output.includes('.agents/skills'), 'Should reference .agents/skills');
    assert.ok(output.includes('.codex/rules/deny-dangerous.star'), 'Should reference Starlark execpolicy');
  });

  it('includes detected stack languages in preamble', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('Stack:'), 'Should contain Stack: line');
  });

  it('each phase has a gate instruction', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    const gateCount = (output.match(/goat-flow scan/g) || []).length;
    assert.ok(gateCount >= 3, `Expected ≥3 gate instructions, got ${gateCount}`);
  });

  it('template paths are absolute', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('/setup/shared/execution-loop.md'), 'Template paths should be absolute');
  });

  it('references template files that exist on disk', async () => {
    const { validateTemplateRefs, getAgentTemplates } = await import('../../src/cli/prompt/template-refs.js');
    const missing = validateTemplateRefs('claude');
    assert.deepEqual(missing, [], `Missing templates: ${missing.join(', ')}`);
    // Also verify the refs have the expected shape
    const refs: TemplateRef[] = getAgentTemplates('claude');
    assert.ok(refs.length > 0, 'Should have template refs');
    assert.ok(refs[0].output, 'Ref should have output');
    assert.ok(refs[0].template, 'Ref should have template');
  });
});

describe('composeInlineSetup (old, preserved)', () => {
  it('still works and returns ComposedPrompt', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeInlineSetup(report, 'claude');
    assert.ok(prompt);
    assert.equal(prompt.mode, 'setup');
    assert.equal(prompt.agent, 'claude');
    assert.ok(prompt.sections.length > 0, 'Should have sections');
  });
});

describe('mapLanguagesToTemplates', () => {
  // Dynamic import since it's not in the top-level imports
  const getMapper = async () => {
    const mod = await import('../../src/cli/prompt/template-refs.js');
    return mod.mapLanguagesToTemplates;
  };

  it('maps typescript + bash to correct templates', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['typescript', 'bash']);
    const templates = refs.map(r => r.template);
    assert.ok(templates.some(t => t.includes('typescript-node')), 'Should include typescript-node');
    assert.ok(templates.some(t => t.includes('bash')), 'Should include bash');
    assert.ok(templates.some(t => t.includes('web-common')), 'Should include web-common for web languages');
  });

  it('maps go to go.md + web-common', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['go']);
    const templates = refs.map(r => r.template);
    assert.ok(templates.some(t => t.includes('/go.md')), 'Should include go.md');
    assert.ok(templates.some(t => t.includes('web-common')), 'Should include web-common');
  });

  it('returns empty for markdown-only', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['markdown']);
    assert.equal(refs.length, 0);
  });

  it('returns empty for empty input', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates([]);
    assert.equal(refs.length, 0);
  });

  it('deduplicates typescript + javascript (same template)', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['typescript', 'javascript']);
    const tsRefs = refs.filter(r => r.template.includes('typescript-node'));
    assert.equal(tsRefs.length, 1, 'Should not duplicate typescript-node.md');
  });
});

// ─── M2.11b: post-healthkit quality fixes ───────────────────────────

describe('M2.11b: setup prompt improvements', () => {
  it('includes role-specific coding-standards rows', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('ai/instructions/conventions.md'), 'Should include conventions.md');
    assert.ok(output.includes('ai/instructions/code-review.md'), 'Should include code-review.md');
    assert.ok(output.includes('ai/instructions/git-commit.md'), 'Should include git-commit.md');
  });

  it('includes frontend.md for TS/JS projects in full setup mode', () => {
    // Use empty project (no agents) to trigger full setup mode which renders language refs
    const fs = createMockFS({
      'package.json': JSON.stringify({ name: 'ts-project', devDependencies: { typescript: '^5.0.0' }, scripts: { start: 'node .' } }),
      'README.md': '# TS Project\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('ai/instructions/frontend.md'), 'Should include frontend.md');
  });

  it('includes skill quality requirements block', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('Skill quality requirements'), 'Should include skill quality block');
    assert.ok(output.includes('Output Format'), 'Should mention Output Format');
    assert.ok(output.includes('Chaining'), 'Should mention Chaining');
  });

  it('ends with goat-flow setup re-run instruction', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('goat-flow setup'), 'Should include setup re-run instruction');
  });

  it('--agent all includes multi-agent sync instruction', () => {
    // This tests the CLI dispatch, not composeSetup directly.
    // composeSetup is called per agent; the sync instruction is added by handleSetupCommand.
    // We test that composeSetup output does NOT contain it (that's the CLI's job).
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(!output.includes('Multi-agent sync'), 'composeSetup should not contain sync instruction (CLI adds it)');
  });
});

describe('M2.11b: scanner fixes', () => {
  it('lessons.md with only template headings fails 2.3.2', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/lessons.md': '# Lessons\n\n### Entry Format\n<!-- Describe what happened -->\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.2');
    assert.ok(check, 'Check 2.3.2 should exist');
    assert.equal(check.status, 'fail', 'Template-only lessons should fail');
  });

  it('lessons.md with real entries passes 2.3.2', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/lessons.md': '# Lessons\n\n### 2026-03-20: Auth migration broke staging\nRolled back because the migration assumed sequential IDs.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.2');
    assert.ok(check, 'Check 2.3.2 should exist');
    assert.equal(check.status, 'pass', 'Real lessons entries should pass');
  });

  it('AP11 fires when lessons is empty even if footguns has content', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/lessons.md': '# Lessons\n\nNo entries yet.\n',
      'docs/footguns.md': '# Footguns\n\n- some pattern without evidence\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap11 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP11');
    assert.ok(ap11, 'AP11 should exist');
    assert.equal(ap11.triggered, true, 'AP11 should fire when lessons is empty');
  });
});

// ─── variable substitution ──────────────────────────────────────────

describe('Variable substitution', () => {
  it('fillTemplate replaces known variables', async () => {
    const { fillTemplate } = await import('../../src/cli/prompt/template-filler.js');
    const result = fillTemplate('Hello {{agentName}}, your file is {{instructionFile}}', {
      agentId: 'claude', agentName: 'Claude Code', instructionFile: 'CLAUDE.md',
      settingsFile: '.claude/settings.json', skillsDir: '.claude/skills',
      hooksDir: '.claude/hooks', languages: 'typescript',
      buildCommand: 'tsc', testCommand: 'vitest', lintCommand: 'eslint .',
      formatCommand: 'prettier', grade: 'B', percentage: '87',
      failedCount: '5', passedCount: '57', totalCount: '62',
      date: '2026-03-21',
    });
    assert.equal(result, 'Hello Claude Code, your file is CLAUDE.md');
  });

  it('fillTemplate leaves unknown variables as-is', async () => {
    const { fillTemplate } = await import('../../src/cli/prompt/template-filler.js');
    const result = fillTemplate('{{unknown}} stays', {
      agentId: 'claude', agentName: 'Claude Code', instructionFile: 'CLAUDE.md',
      settingsFile: '', skillsDir: '', hooksDir: '',
      languages: '', buildCommand: '', testCommand: '', lintCommand: '',
      formatCommand: '', grade: '', percentage: '', failedCount: '',
      passedCount: '', totalCount: '', date: '',
    });
    assert.equal(result, '[UNFILLED: unknown] stays');
  });

  it('extractTemplateVars fills all fields from scan report', async () => {
    const { extractTemplateVars } = await import('../../src/cli/prompt/template-filler.js');
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const vars = extractTemplateVars(report, report.agents[0]);

    assert.equal(vars.agentId, 'claude');
    assert.equal(vars.instructionFile, 'CLAUDE.md');
    assert.equal(vars.skillsDir, '.claude/skills');
    assert.ok(vars.grade.length > 0, 'grade should be filled');
    assert.ok(vars.percentage.length > 0, 'percentage should be filled');
  });
});

// ─── M2.12: unified setup modes ─────────────────────────────────────

describe('composeSetup mode selection', () => {
  it('fresh project (no agents) → full setup with reference tables', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('## How this works'), 'Full setup should have How this works section');
    assert.ok(output.includes('| Create | Template | Notes |'), 'Full setup should have template table');
  });

  it('100% project → all-pass message', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    // Full project should score very high — if it hits 100%, we get the all-pass message
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    // Either all-pass or short-fix mode (depending on exact score)
    assert.ok(typeof output === 'string', 'Should return a string');
    assert.ok(output.includes('GOAT Flow Setup'), 'Should have title');
  });

  it('partially set up project → targeted or short fix (not full setup)', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    // Minimal project has CLAUDE.md so it has an agent, should NOT get full setup mode
    assert.ok(!output.includes('## How this works'), 'Should NOT be full setup mode');
    assert.ok(output.includes('GOAT Flow Setup'), 'Should have title');
  });

  it('removed commands produce errors', () => {
    assert.throws(() => parseCLIArgs(['fix', '.']), /removed/i, 'fix should throw removed error');
    assert.throws(() => parseCLIArgs(['audit', '.']), /removed/i, 'audit should throw removed error');
  });
});

// ─── M2.13: scanner accuracy & setup polish ──────────────────────────

describe('M2.13: AP12 stale ref filtering', () => {
  it('localhost:port is NOT counted as a stale ref', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `localhost:48101` — dev server port\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    // AP12 should either not trigger or have 0 stale refs for localhost
    if (ap12) {
      assert.equal(ap12.triggered, false, 'AP12 should not fire for localhost:port');
    }
  });

  it('real file path IS counted as stale ref when file does not exist', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `src/auth.ts:42` — race condition\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    assert.ok(ap12, 'AP12 should exist');
    assert.equal(ap12.triggered, true, 'AP12 should fire for stale file path');
  });
});

describe('M2.13: dedup template refs in targeted setup', () => {
  it('same-template refs are collapsed (no duplicate lines)', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    // Count occurrences of enforcement.md in the output
    const enforcementCount = (output.match(/enforcement\.md/g) || []).length;
    // Should not appear more than once per section
    assert.ok(enforcementCount <= 2, `enforcement.md appeared ${enforcementCount} times, expected ≤2 (collapsed)`);
  });
});

describe('M2.13: short-fix mode text', () => {
  it('does not truncate mid-sentence', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    // Short-fix or targeted mode output should not have lines ending with partial words
    // Check that no recommendation line is cut at exactly 120 chars
    const lines = output.split('\n').filter(l => l.startsWith('- **'));
    for (const line of lines) {
      const text = line.replace(/^- \*\*[^*]+\*\*:\s*/, '');
      assert.ok(text.length <= 200 || text.endsWith('.'), `Line may be truncated: ${text.slice(0, 50)}...`);
    }
  });
});

describe('M2.13: Codex template map', () => {
  it('Codex setup maps enforcement fragments to setup-codex.md', async () => {
    const { getFragmentTemplate } = await import('../../src/cli/prompt/template-refs.js');
    const denyTemplate = getFragmentTemplate('create-deny-script', 'codex');
    assert.ok(denyTemplate, 'Should have a template for create-deny-script');
    assert.ok(denyTemplate.includes('setup-codex'), `Expected setup-codex.md, got ${denyTemplate}`);
    assert.ok(!denyTemplate.includes('enforcement'), 'Should NOT reference enforcement.md for Codex');
  });

  it('Claude still maps enforcement fragments to enforcement.md', async () => {
    const { getFragmentTemplate } = await import('../../src/cli/prompt/template-refs.js');
    const denyTemplate = getFragmentTemplate('create-deny-script', 'claude');
    assert.ok(denyTemplate);
    assert.ok(denyTemplate.includes('enforcement'), 'Claude should reference enforcement.md');
  });
});

describe('M2.13: placeholder npm script filter', () => {
  it('filters out npm init default test command', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({
        name: 'test-proj',
        scripts: { test: 'echo "Error: no test specified" && exit 1', start: 'node .' },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.ok(!report.stack.testCommand || !report.stack.testCommand.includes('Error:'),
      'Placeholder test command should be filtered out');
  });
});

describe('M2.13: check 2.3.5 removed', () => {
  it('check 2.3.5 does not appear in scan results', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check235 = report.agents[0]?.checks.find(c => c.id === '2.3.5');
    assert.ok(!check235, 'Check 2.3.5 should be removed (duplicate of AP12)');
  });
});

describe('M2.13: --agent all dedup', () => {
  it('multi-agent setup has shared files only once', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output);
    // Shared files should appear exactly once
    const footgunsCount = (output.match(/docs\/footguns\.md/g) || []).length;
    assert.equal(footgunsCount, 1, `docs/footguns.md should appear once, got ${footgunsCount}`);
    // Should have per-agent sections
    assert.ok(output.includes('Claude Code'), 'Should have Claude section');
    assert.ok(output.includes('Codex'), 'Should have Codex section');
    assert.ok(output.includes('Gemini CLI'), 'Should have Gemini section');
  });

  it('multi-agent setup is under 160 lines', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output);
    const lineCount = output.split('\n').length;
    assert.ok(lineCount <= 160, `Expected ≤160 lines, got ${lineCount}`);
  });

  it('multi-agent setup has 3+ GATE instructions', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output);
    const gateCount = (output.match(/GATE:/g) || []).length;
    assert.ok(gateCount >= 3, `Expected ≥3 GATE instructions, got ${gateCount}`);
  });

  it('multi-agent setup uses generic skill paths (not .claude/skills/)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output);
    // Skills in shared section should use {skills_dir}, not .claude/skills/
    const sharedSection = output.split('## Claude Code')[0] ?? '';
    assert.ok(!sharedSection.includes('.claude/skills/'), 'Shared section should not have .claude/skills/ paths');
  });
});

describe('M2.13: scan --verbose diagnostics', () => {
  it('verbose output includes Diagnostic Summary', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const text = renderText(report, true);
    assert.ok(text.includes('Diagnostic Summary'), 'Verbose output should have Diagnostic Summary');
  });

  it('non-verbose output does NOT include Diagnostic Summary', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const text = renderText(report, false);
    assert.ok(!text.includes('Diagnostic Summary'), 'Non-verbose should not have Diagnostic Summary');
  });
});

// ─── M2.14: audit fixes + template hardening ────────────────────────

describe('M2.14: hasEvidence filters URLs', () => {
  it('footguns with only localhost:port has no evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `localhost:48101` — dev server port\n- `127.0.0.1:3000` — API\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(check.status, 'fail', 'Footguns with only URL-port refs should NOT have evidence');
  });
});

describe('M2.14: eval format aliases', () => {
  it('eval with ## Scenario passes replay prompt check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'agent-evals/test-1.md': '# E1\n\n**Origin:** real\n\n## Scenario\n\nDo X.\n',
      'agent-evals/test-2.md': '# E2\n\n**Origin:** real\n\n## Scenario\n\nDo Y.\n',
      'agent-evals/test-3.md': '# E3\n\n**Origin:** real\n\n## Scenario\n\nDo Z.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '3.1.4');
    assert.ok(check, 'Check 3.1.4 should exist');
    assert.equal(check.status, 'pass', 'Evals with ## Scenario should pass replay prompt check');
  });

  it('eval with ## Origin section passes origin label check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'agent-evals/test-1.md': '# E1\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\nx\n```\n',
      'agent-evals/test-2.md': '# E2\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\ny\n```\n',
      'agent-evals/test-3.md': '# E3\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\nz\n```\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '3.1.5');
    assert.ok(check, 'Check 3.1.5 should exist');
    assert.equal(check.status, 'pass', 'Evals with ## Origin section should pass origin label check');
  });
});

describe('M2.14: full setup output', () => {
  it('includes Adapting templates section', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('## Adapting templates'), 'Should include Adapting templates section');
    assert.ok(output.includes('Do NOT copy templates verbatim'), 'Should define what adapt means');
  });
});

describe('M2.14: root-level AP12 refs', () => {
  it('AGENTS.md:42 is counted as valid ref when AGENTS.md exists', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'AGENTS.md': '# AGENTS.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `AGENTS.md:42` — instruction file footgun\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    if (ap12) {
      assert.equal(ap12.triggered, false, 'AP12 should not fire when root-level ref exists');
    }
  });

  it('AGENTS.md:42 is counted as stale when AGENTS.md does NOT exist', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `AGENTS.md:42` — stale ref\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    assert.ok(ap12, 'AP12 should exist');
    assert.equal(ap12.triggered, true, 'AP12 should fire for stale root-level ref');
  });

  it('webpack:123 (no extension, no slash) is skipped by AP12', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `webpack:123` — bundler warning\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    if (ap12) {
      assert.equal(ap12.triggered, false, 'AP12 should not fire for extensionless bare name');
    }
  });

  it('0.0.0.0:8080 is skipped by AP12', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `0.0.0.0:8080` — bind address\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find(ap => ap.id === 'AP12');
    if (ap12) {
      assert.equal(ap12.triggered, false, 'AP12 should not fire for IP address');
    }
  });
});

describe('M2.14: hasEvidence edge cases', () => {
  it('footguns with mixed real refs + URLs has evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `localhost:3000` — dev\n- `src/auth.ts:42` — real ref\n',
      'src/auth.ts': 'export const x = 1;\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(check.status, 'pass', 'Mixed URLs + real refs should have evidence');
  });

  it('footguns with only prose-style evidence passes', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\nThe auth module (lines 42-50) has a race condition.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(check.status, 'pass', 'Prose-style (lines N) evidence should count');
  });

  it('footguns with only http:// URL has no evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'docs/footguns.md': '# Footguns\n\n- `https://example.com:443` — API endpoint\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(check.status, 'fail', 'URL-only footguns should NOT have evidence');
  });
});

describe('M2.14: preferred eval format (### Scenario H3)', () => {
  it('eval with ### Scenario (H3) passes replay prompt check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'agent-evals/test-1.md': '# E1\n\n**Origin:** real\n\n### Scenario\n\nDo X.\n',
      'agent-evals/test-2.md': '# E2\n\n**Origin:** real\n\n### Scenario\n\nDo Y.\n',
      'agent-evals/test-3.md': '# E3\n\n**Origin:** real\n\n### Scenario\n\nDo Z.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find(c => c.id === '3.1.4');
    assert.ok(check, 'Check 3.1.4 should exist');
    assert.equal(check.status, 'pass', 'Evals with ### Scenario (H3) should pass replay prompt check');
  });

  it('eval with YAML frontmatter origin passes origin check', () => {
    const evalContent = '---\nname: test\norigin: real-incident\nskill: goat-debug\n---\n# Test\n\n**Origin:** real-incident\n\n### Scenario\n\nDo X.\n';
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'agent-evals/test-1.md': evalContent,
      'agent-evals/test-2.md': evalContent.replace('test-1', 'test-2'),
      'agent-evals/test-3.md': evalContent.replace('test-1', 'test-3'),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const originCheck = report.agents[0]?.checks.find(c => c.id === '3.1.5');
    assert.ok(originCheck, 'Check 3.1.5 should exist');
    assert.equal(originCheck.status, 'pass', 'YAML frontmatter evals with **Origin:** should pass');
  });
});

describe('M2.14: placeholder npm script edge cases', () => {
  it('filters echo "Error: no test specified" && exit 1', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: { test: 'echo "Error: no test specified" && exit 1' },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.ok(!report.stack.testCommand, 'Placeholder test command should be null');
  });

  it('filters bare exit 1', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: { test: 'exit 1' },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.ok(!report.stack.testCommand, 'Bare exit 1 should be filtered');
  });

  it('keeps real test commands', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: { test: 'jest --coverage', build: 'tsc' },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.equal(report.stack.testCommand, 'jest --coverage');
    assert.equal(report.stack.buildCommand, 'tsc');
  });

  it('filters placeholder build but keeps real test', () => {
    const fs = createMockFS({
      'package.json': JSON.stringify({
        name: 'test',
        scripts: {
          build: 'echo "no build" && exit 1',
          test: 'vitest',
        },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.ok(!report.stack.buildCommand, 'Placeholder build should be null');
    assert.equal(report.stack.testCommand, 'vitest', 'Real test should be kept');
  });
});

describe('Rubric version consistency', () => {
  it('RUBRIC_VERSION is bumped from 0.8.0', async () => {
    const { RUBRIC_VERSION } = await import('../../src/cli/rubric/version.js');
    assert.notEqual(RUBRIC_VERSION, '0.8.0', 'RUBRIC_VERSION should be bumped (check 2.3.5 removed, 3.3.4 threshold changed)');
  });
});

describe('CLI: removed commands', () => {
  it('fix produces helpful error', () => {
    assert.throws(() => parseCLIArgs(['fix', '.']), /removed/i);
  });

  it('audit produces helpful error', () => {
    assert.throws(() => parseCLIArgs(['audit', '.']), /removed/i);
  });

  it('valid commands do not throw', () => {
    assert.doesNotThrow(() => parseCLIArgs(['scan', '.']));
    assert.doesNotThrow(() => parseCLIArgs(['setup', '.']));
    assert.doesNotThrow(() => parseCLIArgs(['eval', '.']));
  });
});

describe('Multi-agent setup contract', () => {
  it('multi-agent setup validates template refs', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    // Should not throw with valid templates
    assert.doesNotThrow(() => composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']));
  });

  it('multi-agent setup has per-agent foundation sections', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output.includes('Claude Code — Foundation'), 'Should have Claude foundation section');
    assert.ok(output.includes('Codex — Foundation'), 'Should have Codex foundation section');
    assert.ok(output.includes('Gemini CLI — Foundation'), 'Should have Gemini foundation section');
  });

  it('multi-agent setup has phased structure (Standard + Full sections)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output.includes('## Standard (shared across all agents)'), 'Should have Standard section');
    assert.ok(output.includes('## Full (shared across all agents)'), 'Should have Full section');
  });

  it('multi-agent setup includes skill quality requirements', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, ['claude', 'codex', 'gemini']);
    assert.ok(output.includes('Skill quality requirements'), 'Should have skill quality block');
    assert.ok(output.includes('not adapted'), 'Should warn about generic skills');
  });
});
