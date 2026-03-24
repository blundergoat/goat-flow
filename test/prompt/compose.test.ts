import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scanProject } from '../../src/cli/scanner/scan.js';
import { composeFix } from '../../src/cli/prompt/compose-fix.js';
import { composeSetup, composeInlineSetup } from '../../src/cli/prompt/compose-setup.js';
import type { TemplateRef } from '../../src/cli/prompt/template-refs.js';
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

// ─── compose-fix ────────────────────────────────────────────────────

describe('composeFix', () => {
  it('returns few fragments for a high-scoring project', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    // A well-set-up project may still have some failures due to quality checks on mock content
    const totalFragments = prompt.sections.reduce((sum, s) => sum + s.fragments.length, 0);
    assert.ok(totalFragments <= 35, `Expected ≤35 fragments for full project, got ${totalFragments}`);
  });

  it('returns many fragments for a minimal project', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    const totalFragments = prompt.sections.reduce((sum, s) => sum + s.fragments.length, 0);
    assert.ok(totalFragments > 10, `Expected >10 fragments for minimal project, got ${totalFragments}`);
  });

  it('returns null for nonexistent agent', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeFix(report, 'gemini');
    assert.equal(prompt, null);
  });

  it('sections are ordered: anti-pattern → foundation → standard → full', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
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
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    assert.ok(prompt.preamble.includes('%'), 'Preamble should include percentage');
    assert.ok(/\b[A-F]\b/.test(prompt.preamble), 'Preamble should include grade');
  });

  it('fragments contain filled variables (not raw {{placeholders}})', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
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
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeFix(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.length > 100, 'Rendered output should be substantial');
    assert.ok(output.startsWith('# GOAT Flow Fix'), 'Should start with title');
    assert.ok(output.includes('## Phase'), 'Should have phase sections');
  });
});

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

  it('includes frontend.md for TS/JS projects', () => {
    const fs = buildMinimalProject();
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

  it('ends with goat-flow fix instruction', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('goat-flow fix'), 'Should include fix instruction');
  });

  it('--agent all includes multi-agent sync instruction', () => {
    // This tests the CLI dispatch, not composeSetup directly.
    // composeSetup is called per agent; the sync instruction is added by handlePromptCommand.
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

// ─── compose-audit ──────────────────────────────────────────────────

describe('composeAudit', () => {
  it('returns null for nonexistent agent', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeAudit(report, 'gemini');
    assert.equal(prompt, null);
  });

  it('includes score overview', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('Foundation'), 'Should include tier breakdown');
    assert.ok(output.includes('%'), 'Should include percentages');
  });

  it('includes failed checks section', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    assert.ok(prompt.sections.some(s => s.heading === 'Failed Checks'), 'Should have Failed Checks section');
  });

  it('includes diagnostic questions', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    const output = renderPrompt(prompt);
    assert.ok(output.includes('read-only audit'), 'Should mention read-only');
    assert.ok(output.includes('Do NOT make any changes'), 'Should prohibit changes');
  });

  it('mode is audit', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const prompt = composeAudit(report, 'claude');
    assert.ok(prompt);
    assert.equal(prompt.mode, 'audit');
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
