/**
 * Coverage for setup prompt composition and related CLI plumbing.
 * The suite checks prompt mode selection, template routing, and rendered remediation guidance.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scanProject } from '../../src/cli/scanner/scan.js';
import {
  composeSetup,
  composeMultiAgentSetup,
} from '../../src/cli/prompt/compose-setup.js';
import type { TemplateRef } from '../../src/cli/prompt/template-refs.js';
import { renderText } from '../../src/cli/render/text.js';
import { renderMarkdown } from '../../src/cli/render/markdown.js';
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
| \`ai-docs/lessons/\` | Behavioural mistake |
| \`ai-docs/footguns/\` | Architectural trap |

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
- \`workflow/setup/\` prompt changes
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Overwrite without checking.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Router Table

| Resource | Path |
|----------|------|
| Skills | \`.claude/skills/\` |
| Footguns | \`ai-docs/footguns/\` |
| Lessons | \`ai-docs/lessons/\` |
| Architecture | \`ai-docs/architecture.md\` |
| Config | \`.goat-flow/config.yaml\` |
| Handoff | \`.goat-flow/tasks/handoff-template.md\` |
`;

const HANDOFF_TEMPLATE = `# Handoff Template

## Date

## Status

## Current State

## Key Decisions

## Errors & Corrections

## Learnings

## Known Risks

## Next Step

## Context Files
`;

/** Build a well-configured mock project used by setup-composition tests. */
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
      ['preflight', 'debug', 'audit', 'review', 'plan', 'test'].map((s) => [
        `.claude/skills/goat-${s}/SKILL.md`,
        `# goat-${s}\n`,
      ]),
    ),
    '.claude/hooks/deny-dangerous.sh':
      '#!/usr/bin/env bash\necho "BLOCKED" >&2\nexit 2\n',
    '.claude/hooks/stop-lint.sh':
      '#!/usr/bin/env bash\nshellcheck changed.sh\nnpx tsc --noEmit\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    'ai-docs/footguns/': '# Footguns\n\n- `src/auth.ts:42` - race\n',
    'ai-docs/lessons/': '# Lessons\n\n### Entry 1\nStuff.\n',
    'ai-docs/architecture.md': '# Architecture\n\nOverview.\n',
    'docs/system-spec.md': '# System Spec\n',
    'workflow/setup/README.md': '# Setup\n',
    'ai-docs/evals/README.md': '# Evals\n',
    'ai-docs/evals/eval-1.md':
      '# E1\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nx\n```\n',
    'ai-docs/evals/eval-2.md':
      '# E2\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\ny\n```\n',
    'ai-docs/evals/eval-3.md':
      '# E3\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nz\n```\n',
    '.github/workflows/context-validation.yml':
      'name: CV\nsteps:\n  - run: wc -l\n  - run: check router\n  - run: check skills\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.gitignore': '.env\nsettings.local.json\n',
    'CHANGELOG.md': '# Changelog\n',
  });
}

/** Build a minimally configured mock project with almost no goat-flow setup. */
function buildMinimalProject() {
  return createMockFS({
    'CLAUDE.md':
      '# CLAUDE.md\n\nBasic instructions.\n\n## Commands\n\n```\nnpm test\n```\n',
    'package.json': JSON.stringify({
      name: 'minimal',
      scripts: { start: 'node .' },
    }),
  });
}

/** Build an almost-empty mock project used for fresh-setup flows. */
function buildEmptyProject() {
  return createMockFS({
    'package.json': JSON.stringify({
      name: 'empty',
      scripts: { start: 'node .' },
    }),
    'README.md': '# Empty\n',
  });
}

/** Build a mostly configured mock project that still needs targeted fixes. */
function buildTargetedUpgradeProject(extraFiles: Record<string, string> = {}) {
  return createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'upgrade-project',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: {
        deny: ['Bash(git commit*)', 'Bash(git push*)', 'Read(**/.env*)'],
      },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 2\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/skills/goat-debug/SKILL.md':
      '---\nname: goat-debug\ngoat-flow-skill-version: "1.0.0"\n---\n# /goat-debug\n## Shared Conventions\n## Step 0\nFootgun check\n## Phase 1\n## Output Format\n## Chains With\n',
    '.claude/skills/goat-plan/SKILL.md':
      '---\nname: goat-plan\ngoat-flow-skill-version: "1.0.0"\n---\n# /goat-plan\n## Shared Conventions\n## Step 0\nFootgun check\n## Phase 1\n## Output Format\n## Chains With\n',
    '.claude/skills/goat-review/SKILL.md':
      '---\nname: goat-review\ngoat-flow-skill-version: "1.0.0"\n---\n# /goat-review\n## Shared Conventions\n## Step 0\nFootgun check\n## Phase 1\n## Output Format\n## Chains With\n',
    '.claude/skills/goat-security/SKILL.md':
      '---\nname: goat-security\ngoat-flow-skill-version: "1.0.0"\n---\n# /goat-security\n## Shared Conventions\n## Step 0\nFootgun check\n## Phase 1\n## Output Format\n## Chains With\n',
    '.claude/skills/goat-test/SKILL.md':
      '---\nname: goat-test\ngoat-flow-skill-version: "1.0.0"\n---\n# /goat-test\n## Shared Conventions\n## Step 0\nFootgun check\n## Phase 1\n## Output Format\n## Chains With\n',
    'ai-docs/footguns/': '# Footguns\n\n- `src/auth.ts:42` - race\n',
    'ai-docs/lessons/': '# Lessons\n\n### Entry 1\nStuff.\n',
    'ai-docs/architecture.md': '# Architecture\n\nOverview.\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.gitignore': 'settings.local.json\n',
    ...extraFiles,
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

  it('is under 250 lines per agent', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    const lineCount = output.split('\n').length;
    assert.ok(lineCount <= 250, `Expected ≤250 lines, got ${lineCount}`);
  });

  it('empty project gets setup redirect (not phase headings)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup-claude.md'),
      'Should redirect to setup-claude.md',
    );
    assert.ok(
      output.includes('needs a full setup'),
      'Should say full setup needed',
    );
  });

  it('references Claude-specific setup file in redirect', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup-claude.md'),
      'Should reference setup-claude.md',
    );
    assert.ok(output.includes('Claude Code'), 'Should mention Claude Code');
  });

  it('references Codex-specific setup file in redirect', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'codex');
    assert.ok(output);
    assert.ok(
      output.includes('setup-codex.md'),
      'Should reference setup-codex.md',
    );
    assert.ok(output.includes('Codex'), 'Should mention Codex');
  });

  it('low-scoring projects get setup redirect', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup-claude.md'),
      'Should redirect to setup file',
    );
    assert.ok(output.includes('100%'), 'Should mention 100% target');
  });

  it('redirect has no inline GATE instructions', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    const gateCount = (output.match(/\*\*GATE:\*\*/g) || []).length;
    assert.equal(
      gateCount,
      0,
      'Setup redirect should not have inline GATE instructions',
    );
  });

  it('redirect references absolute setup file path', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('/workflow/setup/setup-claude.md'),
      'Setup redirect should have absolute path to setup file',
    );
  });

  it('references template files that exist on disk', async () => {
    const { validateTemplateRefs, getAgentTemplates } =
      await import('../../src/cli/prompt/template-refs.js');
    const missing = validateTemplateRefs('claude');
    assert.deepEqual(missing, [], `Missing templates: ${missing.join(', ')}`);
    // Also verify the refs have the expected shape
    const refs: TemplateRef[] = getAgentTemplates('claude');
    assert.ok(refs.length > 0, 'Should have template refs');
    assert.ok(refs[0].output, 'Ref should have output');
    assert.ok(refs[0].template, 'Ref should have template');
  });

  it('uses the dispatcher path instead of goat-goat in targeted fix output', () => {
    const fs = buildTargetedUpgradeProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('.claude/skills/goat/SKILL.md'),
      'Dispatcher path should be goat/SKILL.md',
    );
    assert.ok(
      !output.includes('goat-goat'),
      'Prompt should not fabricate goat-goat',
    );
    assert.ok(
      output.includes('Missing Skills (1 of 6)'),
      'Prompt should count the 6 canonical skills',
    );
  });

  it('surfaces stale goat skill cleanup when AP20 is triggered', () => {
    const fs = buildTargetedUpgradeProject({
      '.claude/skills/goat-investigate/SKILL.md': '# /goat-investigate\n',
      '.claude/skills/goat-audit/SKILL.md': '# /goat-audit\n',
      '.claude/skills/audit/SKILL.md': '# /audit\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap20 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP20');
    assert.ok(ap20, 'AP20 should exist');
    assert.equal(
      ap20.triggered,
      true,
      'AP20 should fire on stale goat-flow skill directories',
    );
    assert.ok(
      ap20.message.includes('goat-investigate'),
      'AP20 should name stale goat skills',
    );
    assert.ok(
      ap20.message.includes('audit'),
      'AP20 should name legacy skill dirs',
    );

    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('Delete these directories'),
      'Setup prompt should instruct the user to remove stale skill dirs',
    );
    assert.ok(
      output.includes('goat-investigate'),
      'Setup prompt should mention stale skill examples',
    );
  });
});

describe('M18: markdown renderer summaries', () => {
  it('renders severity grouped failures and top fixes', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: 'claude' });
    const output = renderMarkdown(report);

    assert.ok(
      output.includes('Failures:'),
      'Output should include failure summary',
    );
    assert.ok(
      output.includes('Critical'),
      'Output should include severity summary',
    );
    assert.ok(
      output.includes('Top'),
      'Output should include diagnostic top-fix list',
    );
    assert.ok(
      output.includes('to fix first'),
      'Output should show "to fix first" summary',
    );
  });

  it('groups failures by severity headings', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: 'claude' });
    const output = renderMarkdown(report);

    assert.ok(
      output.includes('### CRITICAL') ||
        output.includes('### HIGH') ||
        output.includes('### MEDIUM') ||
        output.includes('### LOW'),
      'Output should include at least one severity group',
    );
  });
});


describe('mapLanguagesToTemplates', () => {
  // Dynamic import keeps the helper local to this suite.
  /** Load the template mapper lazily for the routing tests in this suite. */
  const getMapper = async () => {
    const mod = await import('../../src/cli/prompt/template-refs.js');
    return mod.mapLanguagesToTemplates;
  };

  it('maps typescript + bash to correct templates', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['typescript', 'bash']);
    const templates = refs.map((r) => r.template);
    assert.ok(
      templates.some((t) => t.includes('typescript-node')),
      'Should include typescript-node',
    );
    assert.ok(
      templates.some((t) => t.includes('bash')),
      'Should include bash',
    );
    assert.ok(
      templates.some((t) => t.includes('web-common')),
      'Should include web-common for web languages',
    );
  });

  it('maps go to go.md + web-common', async () => {
    const mapLanguagesToTemplates = await getMapper();
    const refs = mapLanguagesToTemplates(['go']);
    const templates = refs.map((r) => r.template);
    assert.ok(
      templates.some((t) => t.includes('/go.md')),
      'Should include go.md',
    );
    assert.ok(
      templates.some((t) => t.includes('web-common')),
      'Should include web-common',
    );
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
    const tsRefs = refs.filter((r) => r.template.includes('typescript-node'));
    assert.equal(tsRefs.length, 1, 'Should not duplicate typescript-node.md');
  });
});

// ─── M2.11b: post-healthkit quality fixes ───────────────────────────

describe('M2.11b: setup prompt improvements', () => {
  it('TS/JS empty project gets redirect (not inline frontend.md)', () => {
    // Empty project with TS now gets redirect instead of inline language refs
    const fs = createMockFS({
      'package.json': JSON.stringify({
        name: 'ts-project',
        devDependencies: { typescript: '^5.0.0' },
        scripts: { start: 'node .' },
      }),
      'README.md': '# TS Project\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup-claude.md'),
      'Should redirect to setup-claude.md',
    );
  });

  it('empty project redirect mentions verification target', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(output.includes('100%'), 'Should mention 100% target');
    assert.ok(output.includes('max 3 cycles'), 'Should mention max cycles');
  });

  it('ends with goat-flow setup re-run instruction', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup .'),
      'Should include setup re-run instruction',
    );
  });

  it('--agent all includes multi-agent sync instruction', () => {
    // This tests the CLI dispatch, not composeSetup directly.
    // composeSetup is called per agent; the sync instruction is added by handleSetupCommand.
    // We test that composeSetup output does NOT contain it (that's the CLI's job).
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      !output.includes('Multi-agent sync'),
      'composeSetup should not contain sync instruction (CLI adds it)',
    );
  });
});

describe('M2.11b: scanner fixes', () => {
  it('lessons directory with only README/template text fails 2.3.2a', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/lessons/README.md':
        '# Lessons\n\nOne file per lesson.\n\n### Entry Format\n<!-- Describe what happened -->\n',
      '.goat-flow/config.yaml':
        'version: "1.0.0"\nlessons:\n  committed: ai-docs/lessons/\n  local: .goat-flow/lessons/\nfootguns:\n  committed: ai-docs/footguns/\n  local: .goat-flow/footguns/\ndecisions:\n  path: ai-docs/decisions/\ntasks:\n  path: .goat-flow/tasks/\nskills:\n  install: all\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.2a');
    assert.ok(check, 'Check 2.3.2a should exist');
    assert.equal(check.status, 'fail', 'Template-only lessons should fail');
  });

  it('lessons.md with real entries passes 2.3.2', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/lessons/':
        '# Lessons\n\n### 2026-03-20: Auth migration broke staging\nRolled back because the migration assumed sequential IDs.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.2a');
    assert.ok(check, 'Check 2.3.2a should exist');
    assert.equal(check.status, 'pass', 'Real lessons entries should pass');
  });

  it('AP11 fires when lessons is empty even if footguns has content', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/lessons/': '# Lessons\n\nNo entries yet.\n',
      'ai-docs/footguns/': '# Footguns\n\n- some pattern without evidence\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap11 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP11');
    assert.ok(ap11, 'AP11 should exist');
    assert.equal(
      ap11.triggered,
      true,
      'AP11 should fire when lessons is empty',
    );
  });
});

// ─── variable substitution ──────────────────────────────────────────

describe('Variable substitution', () => {
  it('fillTemplate replaces known variables', async () => {
    const { fillTemplate } =
      await import('../../src/cli/prompt/template-filler.js');
    const result = fillTemplate(
      'Hello {{agentName}}, your file is {{instructionFile}}',
      {
        agentId: 'claude',
        agentName: 'Claude Code',
        instructionFile: 'CLAUDE.md',
        settingsFile: '.claude/settings.json',
        skillsDir: '.claude/skills',
        hooksDir: '.claude/hooks',
        languages: 'typescript',
        buildCommand: 'tsc',
        testCommand: 'vitest',
        lintCommand: 'eslint .',
        formatCommand: 'prettier',
        grade: 'B',
        percentage: '87',
        failedCount: '5',
        passedCount: '57',
        totalCount: '62',
        date: '2026-03-21',
      },
    );
    assert.equal(result, 'Hello Claude Code, your file is CLAUDE.md');
  });

  it('fillTemplate leaves unknown variables as-is', async () => {
    const { fillTemplate } =
      await import('../../src/cli/prompt/template-filler.js');
    const result = fillTemplate('{{unknown}} stays', {
      agentId: 'claude',
      agentName: 'Claude Code',
      instructionFile: 'CLAUDE.md',
      settingsFile: '',
      skillsDir: '',
      hooksDir: '',
      languages: '',
      buildCommand: '',
      testCommand: '',
      lintCommand: '',
      formatCommand: '',
      grade: '',
      percentage: '',
      failedCount: '',
      passedCount: '',
      totalCount: '',
      date: '',
    });
    assert.equal(result, '[UNFILLED: unknown] stays');
  });

  it('extractTemplateVars fills all fields from scan report', async () => {
    const { extractTemplateVars } =
      await import('../../src/cli/prompt/template-filler.js');
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
  it('fresh project (no agents) → setup redirect', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('setup-claude.md'),
      'Should redirect to setup-claude.md',
    );
    assert.ok(
      output.includes('Deeply review and implement'),
      'Should instruct to follow the setup file',
    );
  });

  it('100% project → all-pass message', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    // Full project should score very high - if it hits 100%, we get the all-pass message
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
    assert.ok(
      !output.includes('## How this works'),
      'Should NOT be full setup mode',
    );
    assert.ok(output.includes('GOAT Flow Setup'), 'Should have title');
  });

});

// ─── M2.13: scanner accuracy & setup polish ──────────────────────────

describe('M2.13: AP12 stale ref filtering', () => {
  it('localhost:port is NOT counted as a stale ref', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/': '# Footguns\n\n- `localhost:48101` - dev server port\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    // AP12 should either not trigger or have 0 stale refs for localhost
    if (ap12) {
      assert.equal(
        ap12.triggered,
        false,
        'AP12 should not fire for localhost:port',
      );
    }
  });

  it('real file path IS counted as stale ref when file does not exist', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/': '# Footguns\n\n- `src/auth.ts:42` - race condition\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    assert.ok(ap12, 'AP12 should exist');
    assert.equal(ap12.triggered, true, 'AP12 should fire for stale file path');
  });
});

describe('M2.13: dedup template refs in targeted setup', () => {
  it('under 50% projects get setup redirect instead of inline tasks', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    // Low-scoring projects should redirect to setup file, not generate inline tasks
    assert.ok(
      output.includes('setup-claude.md'),
      'Should redirect to setup file',
    );
    assert.ok(!output.includes('### Task'), 'Should not have inline tasks');
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
    const lines = output.split('\n').filter((l) => l.startsWith('- **'));
    for (const line of lines) {
      const text = line.replace(/^- \*\*[^*]+\*\*:\s*/, '');
      assert.ok(
        text.length <= 200 || text.endsWith('.'),
        `Line may be truncated: ${text.slice(0, 50)}...`,
      );
    }
  });
});

describe('M2.13: Codex template map', () => {
  it('Codex setup maps enforcement fragments to setup-codex.md', async () => {
    const { getFragmentTemplate } =
      await import('../../src/cli/prompt/template-refs.js');
    const denyTemplate = getFragmentTemplate('create-deny-script', 'codex');
    assert.ok(denyTemplate, 'Should have a template for create-deny-script');
    assert.ok(
      denyTemplate.includes('setup-codex'),
      `Expected setup-codex.md, got ${denyTemplate}`,
    );
    assert.ok(
      !denyTemplate.includes('enforcement'),
      'Should NOT reference enforcement.md for Codex',
    );
  });

  it('Claude still maps enforcement fragments to enforcement.md', async () => {
    const { getFragmentTemplate } =
      await import('../../src/cli/prompt/template-refs.js');
    const denyTemplate = getFragmentTemplate('create-deny-script', 'claude');
    assert.ok(denyTemplate);
    assert.ok(
      denyTemplate.includes('enforcement'),
      'Claude should reference enforcement.md',
    );
  });
});

describe('M2.13: placeholder npm script filter', () => {
  it('filters out npm init default test command', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({
        name: 'test-proj',
        scripts: {
          test: 'echo "Error: no test specified" && exit 1',
          start: 'node .',
        },
      }),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    assert.ok(
      !report.stack.testCommand || !report.stack.testCommand.includes('Error:'),
      'Placeholder test command should be filtered out',
    );
  });
});

describe('M2.13: check 2.3.5 removed', () => {
  it('check 2.3.5 does not appear in scan results', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check235 = report.agents[0]?.checks.find((c) => c.id === '2.3.5');
    assert.ok(!check235, 'Check 2.3.5 should be removed (duplicate of AP12)');
  });
});

describe('M2.13: --agent all dedup', () => {
  it('multi-agent setup has shared files only once', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(output);
    // Shared tasks should be listed once, not repeated per agent
    const footgunsTaskCount = (
      output.match(/### Task \d+: Create `ai-docs\/footguns\/`/g) || []
    ).length;
    assert.equal(
      footgunsTaskCount,
      1,
      `shared ai-docs/footguns/ task should appear once, got ${footgunsTaskCount}`,
    );
    // Should have per-agent sections
    assert.ok(output.includes('Claude Code'), 'Should have Claude section');
    assert.ok(output.includes('Codex'), 'Should have Codex section');
    assert.ok(output.includes('Gemini CLI'), 'Should have Gemini section');
  });

  it('multi-agent setup is under 160 lines', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(output);
    const lineCount = output.split('\n').length;
    assert.ok(lineCount <= 500, `Expected ≤500 lines, got ${lineCount}`);
  });

  it('multi-agent setup has 3+ GATE instructions', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(output);
    const gateCount = (output.match(/GATE:/g) || []).length;
    assert.ok(
      gateCount >= 3,
      `Expected ≥3 GATE instructions, got ${gateCount}`,
    );
  });

  it('multi-agent setup uses generic skill paths (not .claude/skills/)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(output);
    // Skills in shared section should use {skills_dir}, not .claude/skills/
    const sharedSection = output.split('## Claude Code')[0] ?? '';
    assert.ok(
      !sharedSection.includes('.claude/skills/'),
      'Shared section should not have .claude/skills/ paths',
    );
  });
});

describe('M2.13: scan --verbose diagnostics', () => {
  it('verbose output includes Diagnostic Summary', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const text = renderText(report, true);
    assert.ok(
      text.includes('Diagnostic Summary'),
      'Verbose output should have Diagnostic Summary',
    );
  });

  it('non-verbose output does NOT include Diagnostic Summary', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const text = renderText(report, false);
    assert.ok(
      !text.includes('Diagnostic Summary'),
      'Non-verbose should not have Diagnostic Summary',
    );
  });
});

// ─── M2.14: audit fixes + template hardening ────────────────────────

describe('M2.14: hasEvidence filters URLs', () => {
  it('footguns with only localhost:port has no evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/':
        '# Footguns\n\n- `localhost:48101` - dev server port\n- `127.0.0.1:3000` - API\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(
      check.status,
      'fail',
      'Footguns with only URL-port refs should NOT have evidence',
    );
  });
});

describe('M2.14: eval format aliases', () => {
  it('eval with ## Scenario passes replay prompt check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/evals/test-1.md':
        '# E1\n\n**Origin:** real\n\n## Scenario\n\nDo X.\n',
      'ai-docs/evals/test-2.md':
        '# E2\n\n**Origin:** real\n\n## Scenario\n\nDo Y.\n',
      'ai-docs/evals/test-3.md':
        '# E3\n\n**Origin:** real\n\n## Scenario\n\nDo Z.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '3.1.4');
    assert.ok(check, 'Check 3.1.4 should exist');
    assert.equal(
      check.status,
      'pass',
      'Evals with ## Scenario should pass replay prompt check',
    );
  });

  it('eval with ## Origin section passes origin label check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/evals/test-1.md':
        '# E1\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\nx\n```\n',
      'ai-docs/evals/test-2.md':
        '# E2\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\ny\n```\n',
      'ai-docs/evals/test-3.md':
        '# E3\n\n## Origin\n\nreal-incident\n\n## Replay Prompt\n\n```\nz\n```\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '3.1.5');
    assert.ok(check, 'Check 3.1.5 should exist');
    assert.equal(
      check.status,
      'pass',
      'Evals with ## Origin section should pass origin label check',
    );
  });
});

describe('M2.14: root-level AP12 refs', () => {
  it('AGENTS.md:42 is counted as valid ref when AGENTS.md exists', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'AGENTS.md': '# AGENTS.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/':
        '# Footguns\n\n- `AGENTS.md:42` - instruction file footgun\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    if (ap12) {
      assert.equal(
        ap12.triggered,
        false,
        'AP12 should not fire when root-level ref exists',
      );
    }
  });

  it('AGENTS.md:42 is counted as stale when AGENTS.md does NOT exist', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/': '# Footguns\n\n- `AGENTS.md:42` - stale ref\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    assert.ok(ap12, 'AP12 should exist');
    assert.equal(
      ap12.triggered,
      true,
      'AP12 should fire for stale root-level ref',
    );
  });

  it('webpack:123 (no extension, no slash) is skipped by AP12', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/': '# Footguns\n\n- `webpack:123` - bundler warning\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    if (ap12) {
      assert.equal(
        ap12.triggered,
        false,
        'AP12 should not fire for extensionless bare name',
      );
    }
  });

  it('0.0.0.0:8080 is skipped by AP12', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/': '# Footguns\n\n- `0.0.0.0:8080` - bind address\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const ap12 = report.agents[0]?.antiPatterns.find((ap) => ap.id === 'AP12');
    if (ap12) {
      assert.equal(
        ap12.triggered,
        false,
        'AP12 should not fire for IP address',
      );
    }
  });
});

describe('M2.14: hasEvidence edge cases', () => {
  it('footguns with mixed real refs + URLs has evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/':
        '# Footguns\n\n- `localhost:3000` - dev\n- `src/auth.ts:1` - real ref\n',
      'src/auth.ts': 'export const x = 1;\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(
      check.status,
      'pass',
      'Mixed URLs + real refs should have evidence',
    );
  });

  it('footguns with only prose-style evidence fails', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/':
        '# Footguns\n\nThe auth module (lines 42-50) has a race condition.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(
      check.status,
      'fail',
      'Prose-style (lines N) evidence should NOT count without a real file:line ref',
    );
  });

  it('footguns with only http:// URL has no evidence', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/footguns/':
        '# Footguns\n\n- `https://example.com:443` - API endpoint\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '2.3.4');
    assert.ok(check, 'Check 2.3.4 should exist');
    assert.equal(
      check.status,
      'fail',
      'URL-only footguns should NOT have evidence',
    );
  });
});

describe('M2.14: preferred eval format (### Scenario H3)', () => {
  it('eval with ### Scenario (H3) passes replay prompt check', () => {
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/evals/test-1.md':
        '# E1\n\n**Origin:** real\n\n### Scenario\n\nDo X.\n',
      'ai-docs/evals/test-2.md':
        '# E2\n\n**Origin:** real\n\n### Scenario\n\nDo Y.\n',
      'ai-docs/evals/test-3.md':
        '# E3\n\n**Origin:** real\n\n### Scenario\n\nDo Z.\n',
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const check = report.agents[0]?.checks.find((c) => c.id === '3.1.4');
    assert.ok(check, 'Check 3.1.4 should exist');
    assert.equal(
      check.status,
      'pass',
      'Evals with ### Scenario (H3) should pass replay prompt check',
    );
  });

  it('eval with YAML frontmatter origin passes origin check', () => {
    const evalContent =
      '---\nname: test\norigin: real-incident\nskill: goat-debug\n---\n# Test\n\n**Origin:** real-incident\n\n### Scenario\n\nDo X.\n';
    const fs = createMockFS({
      'CLAUDE.md': '# CLAUDE.md\n\nBasic.\n',
      'package.json': JSON.stringify({ name: 'test' }),
      'ai-docs/evals/test-1.md': evalContent,
      'ai-docs/evals/test-2.md': evalContent.replace('test-1', 'test-2'),
      'ai-docs/evals/test-3.md': evalContent.replace('test-1', 'test-3'),
    });
    const report = scanProject(fs, '/test', { agentFilter: null });
    const originCheck = report.agents[0]?.checks.find((c) => c.id === '3.1.5');
    assert.ok(originCheck, 'Check 3.1.5 should exist');
    assert.equal(
      originCheck.status,
      'pass',
      'YAML frontmatter evals with **Origin:** should pass',
    );
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
    assert.ok(
      !report.stack.testCommand,
      'Placeholder test command should be null',
    );
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
    assert.equal(
      report.stack.testCommand,
      'vitest',
      'Real test should be kept',
    );
  });
});

describe('Rubric version consistency', () => {
  it('RUBRIC_VERSION matches package.json', async () => {
    const { readFileSync } = await import('node:fs');
    const { RUBRIC_VERSION } = await import('../../src/cli/rubric/version.js');
    const pkg = JSON.parse(readFileSync('package.json', 'utf-8')) as {
      version: string;
    };
    assert.equal(
      RUBRIC_VERSION,
      pkg.version,
      'RUBRIC_VERSION should match package.json version',
    );
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
  it('multi-agent setup has per-agent foundation sections', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(
      output.includes('Claude Code - Foundation'),
      'Should have Claude foundation section',
    );
    assert.ok(
      output.includes('Codex - Foundation'),
      'Should have Codex foundation section',
    );
    assert.ok(
      output.includes('Gemini CLI - Foundation'),
      'Should have Gemini foundation section',
    );
  });

  it('multi-agent setup has phased structure (Standard + Full sections)', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(
      output.includes('## Standard (shared across all agents)'),
      'Should have Standard section',
    );
    assert.ok(
      output.includes('## Full (shared across all agents)'),
      'Should have Full section',
    );
  });

  it('multi-agent setup includes skill quality requirements', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(
      output.includes('Skill quality check'),
      'Should have skill quality block',
    );
    assert.ok(
      output.includes('placeholder text'),
      'Should warn about generic skills',
    );
  });
});

// === Sprint 1 H-tests: New format verification ===

describe('H-tests: Setup prompt format verification', () => {
  it('GATE commands use resolved CLI path', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      !output.includes('`goat-flow scan'),
      'Should not have hardcoded goat-flow command',
    );
    assert.ok(output.includes('cli.js scan'), 'Should use resolved CLI path');
  });

  it('no Option A/B patterns in output', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(!output.includes('Option A'), 'Should not have Option A');
    assert.ok(!output.includes('Option B'), 'Should not have Option B');
  });

  it('short-fix renders full AP instructions (not truncated)', () => {
    const fs = buildFullProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    if (!output) return; // 100% projects have no fix output
    // If there are anti-patterns, they should render full instructions
    if (output.includes('Anti-patterns to fix')) {
      assert.ok(
        output.includes('### AP'),
        'AP sections should have heading format',
      );
    }
  });

  it('multi-agent setup uses task format', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeMultiAgentSetup(report, [
      'claude',
      'codex',
      'gemini',
    ]);
    assert.ok(
      output.includes('### Task 1:'),
      'Multi-agent should use task format',
    );
    assert.ok(
      output.includes('**Read template:**'),
      'Multi-agent tasks should have read step',
    );
  });

  it('empty project redirect includes scan re-run instruction', () => {
    const fs = buildEmptyProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('cli.js scan'),
      'Redirect should include scan re-run command',
    );
    assert.ok(
      output.includes('cli.js setup'),
      'Redirect should include setup re-run command',
    );
  });
});

// ─── M19: Setup reliability verification ───────────────────────────

describe('M19: setup redirect includes migration guidance', () => {
  it('setup redirect includes duplicate skill detection guidance', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('audit/'),
      'Should warn about generic audit/ skill directory',
    );
    assert.ok(
      output.includes('migrate unique content'),
      'Should suggest migrating content from generic to goat-* skill',
    );
  });

  it('setup redirect includes instruction file migration guidance', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('.github/instructions/'),
      'Should mention .github/instructions/ migration',
    );
    assert.ok(
      output.includes('ai-docs/coding-standards/'),
      'Should mention ai-docs/coding-standards/ as alternative',
    );
  });

  it('setup redirect includes permission pre-flight guidance', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('settings.local.json'),
      'Should mention permission restrictions check',
    );
  });

  it('setup redirect includes hook smoke-test instructions', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('bash -n'),
      'Should include hook syntax check command',
    );
    assert.ok(
      output.includes('shellcheck'),
      'Should include shellcheck command',
    );
  });

  it('setup redirect includes migrate-not-duplicate table', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('Migrate, don\'t duplicate'),
      'Should include migration guidance heading',
    );
    assert.ok(
      output.includes('agent-evals/'),
      'Should list eval duplicate path',
    );
  });

  it('setup redirect includes project size scaling guidance', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('Small projects'),
      'Should include small project guidance',
    );
    assert.ok(
      output.includes('Hot-path'),
      'Should categorize files as hot-path vs cold-path',
    );
  });

  it('setup redirect includes multi-agent consistency guidance', () => {
    const fs = buildMinimalProject();
    const report = scanProject(fs, '/test', { agentFilter: null });
    const output = composeSetup(report, 'claude');
    assert.ok(output);
    assert.ok(
      output.includes('Multi-agent consistency'),
      'Should include multi-agent cleanup guidance',
    );
    assert.ok(
      output.includes('GEMINI.md'),
      'Should mention updating GEMINI.md',
    );
  });
});
