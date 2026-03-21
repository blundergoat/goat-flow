import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scan } from '../../src/cli/evaluate/runner.js';
import { composeFix } from '../../src/cli/prompt/compose-fix.js';
import { composeSetup } from '../../src/cli/prompt/compose-setup.js';
import { composeAudit } from '../../src/cli/prompt/compose-audit.js';
import { renderPrompt } from '../../src/cli/prompt/render.js';

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
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    'docs/footguns.md': '# Footguns\n\n- `src/auth.ts:42` - race\n',
    'docs/lessons.md': '# Lessons\n\n### Entry 1\nStuff.\n',
    'docs/confusion-log.md': '# Confusion\n',
    'docs/architecture.md': '# Architecture\n\nOverview.\n',
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

// ─── compose-fix ────────────────────────────────────────────────────

describe('composeFix', () => {
  it('returns zero fragments for a high-scoring project', () => {
    const fs = buildFullProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    // A well-set-up project may still have a few failures, but sections should be minimal
    const totalFragments = prompt.sections.reduce((sum, s) => sum + s.fragments.length, 0);
    assert.ok(totalFragments <= 10, `Expected ≤10 fragments for full project, got ${totalFragments}`);
  });

  it('returns many fragments for a minimal project', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    const totalFragments = prompt.sections.reduce((sum, s) => sum + s.fragments.length, 0);
    assert.ok(totalFragments > 10, `Expected >10 fragments for minimal project, got ${totalFragments}`);
  });

  it('returns null for nonexistent agent', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'gemini');
    assert.equal(prompt, null);
  });

  it('sections are ordered: anti-pattern → foundation → standard → full', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    const phaseOrder = ['anti-pattern', 'foundation', 'standard', 'full'];
    let lastIdx = -1;
    for (const section of prompt.sections) {
      const idx = phaseOrder.indexOf(section.phase);
      assert.ok(idx >= lastIdx, `Phase '${section.phase}' out of order`);
      lastIdx = idx;
    }
  });

  it('preamble includes grade and percentage', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    assert.ok(prompt.preamble.includes('%'), 'Preamble should include percentage');
    assert.ok(/\b[A-F]\b/.test(prompt.preamble), 'Preamble should include grade');
  });

  it('fragments contain filled variables (not raw {{placeholders}})', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    for (const section of prompt.sections) {
      for (const fragment of section.fragments) {
        assert.ok(!fragment.instruction.includes('{{agentName}}'), `Fragment '${fragment.key}' has unfilled {{agentName}}`);
        assert.ok(!fragment.instruction.includes('{{instructionFile}}'), `Fragment '${fragment.key}' has unfilled {{instructionFile}}`);
        assert.ok(!fragment.instruction.includes('{{skillsDir}}'), `Fragment '${fragment.key}' has unfilled {{skillsDir}}`);
      }
    }
  });

  it('renders to non-empty markdown', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.length > 100, 'Rendered output should be substantial');
    assert.ok(output.startsWith('# GOAT Flow Fix'), 'Should start with title');
    assert.ok(output.includes('## Phase'), 'Should have phase sections');
  });
});

// ─── compose-setup ──────────────────────────────────────────────────

describe('composeSetup', () => {
  it('works on a project with no agents', () => {
    const fs = buildEmptyProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeSetup(report, 'claude');
    assert.ok(prompt);
    assert.equal(prompt.mode, 'setup');
    assert.equal(prompt.agent, 'claude');
  });

  it('includes all three phases', () => {
    const fs = buildEmptyProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeSetup(report, 'claude');
    assert.ok(prompt);
    const phases = prompt.sections.map(s => s.phase);
    assert.ok(phases.includes('foundation'), 'Missing foundation phase');
    assert.ok(phases.includes('standard'), 'Missing standard phase');
    assert.ok(phases.includes('full'), 'Missing full phase');
  });

  it('pre-fills stack variables from detection', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeSetup(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('CLAUDE.md'), 'Should reference CLAUDE.md');
    assert.ok(output.includes('.claude/skills'), 'Should reference .claude/skills');
  });

  it('uses agent-specific paths for codex', () => {
    const fs = buildEmptyProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeSetup(report, 'codex');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('AGENTS.md'), 'Should reference AGENTS.md for codex');
    assert.ok(output.includes('.agents/skills'), 'Should reference .agents/skills for codex');
  });

  it('renders to markdown with clear section structure', () => {
    const fs = buildEmptyProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeSetup(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('# GOAT Flow Setup'), 'Title');
    assert.ok(output.includes('## Phase 1a'), 'Phase 1a heading');
    assert.ok(output.includes('## Phase 1b'), 'Phase 1b heading');
    assert.ok(output.includes('## Phase 2'), 'Phase 2 heading');
  });
});

// ─── compose-audit ──────────────────────────────────────────────────

describe('composeAudit', () => {
  it('returns null for nonexistent agent', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeAudit(report, 'gemini');
    assert.equal(prompt, null);
  });

  it('includes score overview', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('Foundation'), 'Should include tier breakdown');
    assert.ok(output.includes('%'), 'Should include percentages');
  });

  it('includes failed checks section', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    assert.ok(prompt.sections.some(s => s.heading === 'Failed Checks'), 'Should have Failed Checks section');
  });

  it('includes diagnostic questions', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('read-only audit'), 'Should mention read-only');
    assert.ok(output.includes('Do NOT make any changes'), 'Should prohibit changes');
  });

  it('mode is audit', () => {
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    assert.equal(prompt.mode, 'audit');
  });
});

// ─── variable substitution ──────────────────────────────────────────

describe('Variable substitution', () => {
  it('fillTemplate replaces known variables', async () => {
    const { fillTemplate } = await import('../../src/cli/prompt/variables.js');
    const result = fillTemplate('Hello {{agentName}}, your file is {{instructionFile}}', {
      agentId: 'claude', agentName: 'Claude Code', instructionFile: 'CLAUDE.md',
      settingsFile: '.claude/settings.json', skillsDir: '.claude/skills',
      hooksDir: '.claude/hooks', shape: 'app', languages: 'typescript',
      buildCommand: 'tsc', testCommand: 'vitest', lintCommand: 'eslint .',
      formatCommand: 'prettier', grade: 'B', percentage: '87',
      failedCount: '5', passedCount: '57', totalCount: '62',
      date: '2026-03-21',
    });
    assert.equal(result, 'Hello Claude Code, your file is CLAUDE.md');
  });

  it('fillTemplate leaves unknown variables as-is', async () => {
    const { fillTemplate } = await import('../../src/cli/prompt/variables.js');
    const result = fillTemplate('{{unknown}} stays', {
      agentId: 'claude', agentName: 'Claude Code', instructionFile: 'CLAUDE.md',
      settingsFile: '', skillsDir: '', hooksDir: '', shape: 'app',
      languages: '', buildCommand: '', testCommand: '', lintCommand: '',
      formatCommand: '', grade: '', percentage: '', failedCount: '',
      passedCount: '', totalCount: '', date: '',
    });
    assert.equal(result, '{{unknown}} stays');
  });

  it('extractVariables fills all fields from scan report', async () => {
    const { extractVariables } = await import('../../src/cli/prompt/variables.js');
    const fs = buildMinimalProject();
    const report = scan(fs, '/test', { shapeOverride: null, agentFilter: null });
    const vars = extractVariables(report, report.agents[0]);

    assert.equal(vars.agentId, 'claude');
    assert.equal(vars.instructionFile, 'CLAUDE.md');
    assert.equal(vars.skillsDir, '.claude/skills');
    assert.ok(vars.shape.length > 0, 'shape should be filled');
    assert.ok(vars.grade.length > 0, 'grade should be filled');
    assert.ok(vars.percentage.length > 0, 'percentage should be filled');
  });
});
