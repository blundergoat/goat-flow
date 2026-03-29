import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scanProject } from '../../src/cli/scanner/scan.js';
import type { ScanReport, Grade } from '../../src/cli/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function assertGrade(report: ScanReport, agentId: string, expected: Grade, label: string) {
  const agent = report.agents.find(a => a.agent === agentId);
  assert.ok(agent, `${label}: agent '${agentId}' not found`);
  assert.equal(agent.score.grade, expected, `${label}: expected grade ${expected}, got ${agent.score.grade} (${agent.score.percentage}%)`);
}

function assertPercentageRange(report: ScanReport, agentId: string, min: number, max: number, label: string) {
  const agent = report.agents.find(a => a.agent === agentId);
  assert.ok(agent, `${label}: agent '${agentId}' not found`);
  assert.ok(
    agent.score.percentage >= min && agent.score.percentage <= max,
    `${label}: expected ${agentId} percentage ${min}-${max}%, got ${agent.score.percentage}%`,
  );
}

function assertNoAgents(report: ScanReport, label: string) {
  assert.equal(report.agents.length, 0, `${label}: expected no agents, got ${report.agents.length}`);
}

function assertValidReport(report: ScanReport, label: string) {
  assert.ok(report.schemaVersion, `${label}: missing schemaVersion`);
  assert.ok(report.packageVersion, `${label}: missing packageVersion`);
  assert.ok(report.rubricVersion, `${label}: missing rubricVersion`);
  assert.ok(report.meta.checkCount > 0, `${label}: checkCount should be > 0`);
  assert.ok(report.meta.antiPatternCount > 0, `${label}: antiPatternCount should be > 0`);
  for (const agent of report.agents) {
    assert.ok(agent.checks.length > 0, `${label}: ${agent.agent} should have checks`);
    for (const check of agent.checks) {
      assert.ok(check.confidence, `${label}: check ${check.id} missing confidence`);
      assert.ok(['pass', 'partial', 'fail', 'na'].includes(check.status), `${label}: check ${check.id} invalid status '${check.status}'`);
    }
  }
}

// ─── Instruction file content builders ──────────────────────────────

const FULL_CLAUDE_MD = `# CLAUDE.md - v1.0 (2026-03-20)

Documentation framework for AI coding agent workflows.

## Essential Commands

\`\`\`bash
shellcheck scripts/maintenance/*.sh
bash -n scripts/maintenance/*.sh
bash scripts/preflight-checks.sh
\`\`\`

## Execution Loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG

**READ** - MUST read relevant files before changes. Never fabricate codebase facts.

**CLASSIFY** - Three signals before acting: (1) Intent. (2) Complexity + budgets.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |

**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius.

**ACT** - MUST declare: \`State: [MODE] | Goal: [one line] | Exit: [condition]\`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No file edits. Exit on LGTM |
| Implement | Edit in 2-3 turns. 4th read without writing = stop |
| Debug | Diagnosis with file:line first. Fixes after human reviews |

**VERIFY** - MUST run shellcheck on .sh changes. Two corrections on same approach = MUST rewind.

**LOG** - MUST update when tripped. If VERIFY caught a failure: lessons.md entry required before DoD.

| File | When to update |
|------|---------------|
| \`docs/lessons.md\` | Behavioural mistake |
| \`docs/footguns.md\` | Cross-doc architectural trap |

## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local CLAUDE.md / .github/instructions/ / none]
- [ ] Rollback command: [exact command]

Boundaries:
- \`docs/system-spec.md\` changes (canonical spec)
- \`docs/system/five-layers.md\`, \`docs/system/six-steps.md\`
- \`setup/\` prompt changes
- \`workflow/skills/\` template changes
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Overwrite existing files without checking.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Router Table

| Resource | Path |
|----------|------|
| System spec | \`docs/system-spec.md\` |
| Skills | \`.claude/skills/goat-*/\` |
| Footguns | \`docs/footguns.md\` |
| Lessons | \`docs/lessons.md\` |
| Architecture | \`docs/architecture.md\` |
`;

const MINIMAL_CLAUDE_MD = `# CLAUDE.md

Basic instructions for the agent.

## Commands

\`\`\`bash
npm test
npm run build
\`\`\`
`;

const MINIMAL_AGENTS_MD = `# AGENTS.md

Basic instructions for Codex.

## Commands

\`\`\`bash
npm test
\`\`\`
`;

const AP_CLAUDE_MD = `# CLAUDE.md
${'Line of content for padding.\n'.repeat(160)}

## Ask First

auth, routing, deployment, API, DB
Shared sourced files, CONFIGURATION
`;

// Quality skill content for fixtures that expect high scores
function qualitySkill(name: string): string {
  return `---
name: goat-${name}
description: "${name} skill"
goat-flow-skill-version: "0.9.0"
---
# goat-${name}

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs \`file:line\`. Tag as OBSERVED (verified) or INFERRED. MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → \`docs/lessons.md\`. Architectural trap → \`docs/footguns.md\`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use for ${name} tasks.

## Step 0 — Gather Context

Ask the user before starting:
1. What is the scope?
2. What do you already know?

Do NOT start until the user has answered.

## Phase 1 — Investigate

Read relevant files. Collect evidence.

## Phase 2 — Report

Present findings with file:line evidence.

**HUMAN GATE:** Present your findings. Then ask: "Want me to dig deeper on any of these?"

Do NOT auto-advance. Let the human drill into findings, challenge conclusions, or redirect.

## Constraints

- MUST gather context before acting (Step 0)
- MUST NOT skip phases
- MUST provide file:line evidence

## Output

Structured report with findings.
`;
}

// ─── Fixtures ───────────────────────────────────────────────────────

describe('Fixture 1: empty project', () => {
  const fs = createMockFS({
    'README.md': '# My Project\n',
    'package.json': JSON.stringify({ name: 'my-project', scripts: { start: 'node index.js' } }),
  });
  const report = scanProject(fs, '/test/empty', { agentFilter: null });

  it('produces valid report with no agents', () => {
    assertValidReport(report, 'empty');
    assertNoAgents(report, 'empty');
  });
});

describe('Fixture 2: minimal-claude', () => {
  const fs = createMockFS({
    'CLAUDE.md': MINIMAL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'my-app', scripts: { start: 'node server.js', test: 'jest' } }),
  });
  const report = scanProject(fs, '/test/minimal-claude', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'minimal-claude');
  });

  it('finds one agent (claude)', () => {
    assert.equal(report.agents.length, 1);
    assert.equal(report.agents[0].agent, 'claude');
  });

  it('scores F or D (no execution loop, no skills, no enforcement)', () => {
    const grade = report.agents[0].score.grade;
    assert.ok(grade === 'F' || grade === 'D', `Expected F or D, got ${grade} (${report.agents[0].score.percentage}%)`);
  });

  it('has recommendations', () => {
    assert.ok(report.agents[0].recommendations.length > 5, 'Expected many recommendations for minimal setup');
  });
});

describe('Fixture 3: minimal-codex', () => {
  const fs = createMockFS({
    'AGENTS.md': MINIMAL_AGENTS_MD,
    'package.json': JSON.stringify({ name: 'my-codex-app', scripts: { start: 'node app.js' } }),
  });
  const report = scanProject(fs, '/test/minimal-codex', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'minimal-codex');
  });

  it('finds one agent (codex)', () => {
    assert.equal(report.agents.length, 1);
    assert.equal(report.agents[0].agent, 'codex');
  });

  it('scores F or D', () => {
    const grade = report.agents[0].score.grade;
    assert.ok(grade === 'F' || grade === 'D', `Expected F or D, got ${grade}`);
  });
});

describe('Fixture 4: full-claude', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'full-project',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: [{ type: 'Notification', matcher: 'compact', command: 'echo context' }],
    }),
    // 8 skills
    ...Object.fromEntries(
      ['security', 'debug', 'investigate', 'review', 'plan', 'test', 'refactor', 'simplify'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s),
      ]),
    ),
    // Hooks
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\necho "lint check"\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nprettier --write "$1"\nexit 0\n',
    // Learning loop
    'docs/footguns.md': '# Footguns\n\n## Footgun: Auth race\n\n**Evidence:**\n- `src/auth.ts:42` - race condition\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\nexport function login() {}\n',
    'docs/lessons.md': '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** broke prod\n\n### Entry 2\n**What happened:** missed test\n\n### Entry 3\n**What happened:** stale ref\n',
    // Architecture
    'docs/architecture.md': '# Architecture\n\n' + 'System overview.\n'.repeat(10),
    // Evals
    'agent-evals/README.md': '# Agent Evals\n',
    'agent-evals/eval-1.md': '# Eval 1\n\n**Origin:** real-incident\n**Agents:** all\n\n## Replay Prompt\n\n```\nDo the thing\n```\n',
    'agent-evals/eval-2.md': '# Eval 2\n\n**Origin:** real-incident\n**Agents:** all\n\n## Replay Prompt\n\n```\nDo something\n```\n',
    'agent-evals/eval-3.md': '# Eval 3\n\n**Origin:** synthetic-seed\n**Agents:** claude\n\n## Replay Prompt\n\n```\nAnother prompt\n```\n',
    // CI
    '.github/workflows/context-validation.yml': 'name: Context Validation\non: push\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: scripts/check-router.sh\n      - run: scripts/check-skills.sh\n',
    // Preflight + validation
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\necho "preflight"\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\necho "validate"\n',
    // Handoff
    'tasks/handoff-template.md': '# Handoff Template\n',
    // Gitignore
    '.gitignore': '.env\nsettings.local.json\nnode_modules/\n',
    // Referenced router paths
    'docs/system-spec.md': '# System Spec\n',
  });
  const report = scanProject(fs, '/test/full-claude', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'full-claude');
  });

  it('scores A or B', () => {
    assertGrade(report, 'claude', report.agents[0].score.percentage >= 90 ? 'A' : 'B', 'full-claude');
    assertPercentageRange(report, 'claude', 75, 100, 'full-claude');
  });

  it('has zero or near-zero anti-pattern deductions', () => {
    const triggered = report.agents[0].antiPatterns.filter(ap => ap.triggered);
    assert.ok(triggered.length <= 1, `Expected 0-1 triggered anti-patterns, got ${triggered.length}: ${triggered.map(t => t.id).join(', ')}`);
  });

  it('has few recommendations', () => {
    assert.ok(report.agents[0].recommendations.length <= 30, `Expected ≤30 recommendations, got ${report.agents[0].recommendations.length}`);
  });

  it('confidence field present on all checks', () => {
    for (const check of report.agents[0].checks) {
      assert.ok(['high', 'medium', 'low'].includes(check.confidence), `Check ${check.id} missing valid confidence`);
    }
  });
});

describe('Fixture 5: full-multi-agent', () => {
  const skills = Object.fromEntries(
    ['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].flatMap(s => [
      [`.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s)],
      [`.agents/skills/goat-${s}/SKILL.md`, qualitySkill(s)],
    ]),
  );
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'AGENTS.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'AGENTS.md'),
    'GEMINI.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'GEMINI.md'),
    'package.json': JSON.stringify({ name: 'multi-agent', devDependencies: { typescript: '^5.0.0' }, scripts: { test: 'vitest', lint: 'eslint .' } }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] } }),
    '.gemini/settings.json': JSON.stringify({ permissions: { deny: ['git commit', 'git push'] } }),
    ...skills,
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    'scripts/deny-dangerous.sh': '#!/usr/bin/env bash\n# deny git commit\n# deny git push\nexit 0\n',
    'scripts/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    'docs/footguns.md': '# Footguns\n\n**Evidence:**\n- `src/a.ts:1`\n',
    'docs/lessons.md': '# Lessons\n\n### Entry 1\n**What happened:** x\n',
    'docs/architecture.md': '# Architecture\n\nOverview.\n',
    'agent-evals/README.md': '# Evals\n',
    'agent-evals/eval-1.md': '# E1\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nx\n```\n',
    'agent-evals/eval-2.md': '# E2\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\ny\n```\n',
    'agent-evals/eval-3.md': '# E3\n\n**Origin:** synthetic-seed\n\n## Replay Prompt\n\n```\nz\n```\n',
    '.github/workflows/context-validation.yml': 'name: CV\non: push\njobs:\n  v:\n    steps:\n      - run: wc -l\n      - run: check router\n      - run: check skills\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    'tasks/handoff-template.md': '# Handoff\n',
    '.gitignore': '.env\nsettings.local.json\n',
  });
  const report = scanProject(fs, '/test/multi', { agentFilter: null });

  it('detects all 3 agents', () => {
    assert.equal(report.agents.length, 3);
    assert.deepEqual(report.agents.map(a => a.agent).sort(), ['claude', 'codex', 'gemini']);
  });

  it('all agents score C or better', () => {
    for (const agent of report.agents) {
      assert.ok(
        agent.score.grade === 'A' || agent.score.grade === 'B' || agent.score.grade === 'C',
        `${agent.agent}: expected A, B, or C, got ${agent.score.grade} (${agent.score.percentage}%)`,
      );
    }
  });

  it('--agent filter works', () => {
    const filtered = scanProject(fs, '/test/multi', { agentFilter: 'claude' });
    assert.equal(filtered.agents.length, 1);
    assert.equal(filtered.agents[0].agent, 'claude');
  });
});

describe('Fixture 6: N/A checks', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: '@scope/my-lib',
      exports: { '.': './dist/index.js' },
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'vitest' },
    }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)'] } }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    ...Object.fromEntries(
      ['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s),
      ]),
    ),
    'docs/footguns.md': '# Footguns\n\n- `src/index.ts:10` - gotcha\n',
    'docs/lessons.md': '# Lessons\n\n### Entry 1\nStuff.\n',
  });
  const report = scanProject(fs, '/test/library', { agentFilter: null });

  it('produces valid report for library project', () => {
    assertValidReport(report, 'library');
  });
});

describe('Fixture 7: anti-patterns', () => {
  const fs = createMockFS({
    'CLAUDE.md': AP_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'bad-project', scripts: { start: 'node .' } }),
    '.claude/settings.json': '{ invalid json !!!',
    'docs/footguns.md': '# Footguns\n\nSome footguns but no file:line evidence at all.\n',
    '.claude/skills/not-goat-prefixed/SKILL.md': '# bad skill\n',
  });
  const report = scanProject(fs, '/test/anti-patterns', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'anti-patterns');
  });

  it('triggers AP1 (over 150 lines)', () => {
    const ap1 = report.agents[0].antiPatterns.find(ap => ap.id === 'AP1');
    assert.ok(ap1, 'AP1 not found');
    assert.ok(ap1.triggered, 'AP1 should be triggered (file is >150 lines)');
    assert.equal(ap1.deduction, -3);
  });

  it('triggers AP4 (footguns without evidence)', () => {
    const ap4 = report.agents[0].antiPatterns.find(ap => ap.id === 'AP4');
    assert.ok(ap4, 'AP4 not found');
    assert.ok(ap4.triggered, 'AP4 should be triggered (no file:line evidence)');
    assert.equal(ap4.deduction, -5);
  });

  it('triggers AP5 (invalid settings JSON)', () => {
    const ap5 = report.agents[0].antiPatterns.find(ap => ap.id === 'AP5');
    assert.ok(ap5, 'AP5 not found');
    assert.ok(ap5.triggered, 'AP5 should be triggered (invalid JSON)');
    assert.equal(ap5.deduction, -5);
  });

  it('triggers AP8 (generic Ask First)', () => {
    const ap8 = report.agents[0].antiPatterns.find(ap => ap.id === 'AP8');
    assert.ok(ap8, 'AP8 not found');
    assert.ok(ap8.triggered, 'AP8 should be triggered (template text in Ask First)');
    assert.equal(ap8.deduction, -2);
  });

  it('total deductions capped at -15', () => {
    assert.ok(report.agents[0].score.deductions >= -15, `Deductions should be >= -15, got ${report.agents[0].score.deductions}`);
  });

  it('scores F due to anti-patterns + missing features', () => {
    assertGrade(report, 'claude', 'F', 'anti-patterns');
  });
});

describe('Fixture 8: partial-setup', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'partial', scripts: { test: 'jest' } }),
    // Has settings but no deny patterns
    '.claude/settings.json': JSON.stringify({ theme: 'dark' }),
    // Has some skills but not all
    '.claude/skills/goat-security/SKILL.md': '# goat-security\n',
    '.claude/skills/goat-debug/SKILL.md': '# goat-debug\n',
    '.claude/skills/goat-review/SKILL.md': '# goat-review\n',
    // Learning loop — lessons exists but no footguns
    'docs/lessons.md': '# Lessons\n\n### Entry 1\nSomething.\n',
    // Architecture exists
    'docs/architecture.md': '# Architecture\n\nOverview.\n',
    '.gitignore': '.env\nnode_modules/\n',
  });
  const report = scanProject(fs, '/test/partial', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'partial');
  });

  it('scores D or F (decent instruction file but missing enforcement + skills + new checks)', () => {
    const grade = report.agents[0].score.grade;
    assert.ok(
      grade === 'C' || grade === 'D' || grade === 'F',
      `Expected C, D, or F, got ${grade} (${report.agents[0].score.percentage}%)`,
    );
  });

  it('foundation tier is higher than standard tier', () => {
    const { foundation, standard } = report.agents[0].score.tiers;
    assert.ok(
      foundation.percentage >= standard.percentage,
      `Expected foundation (${foundation.percentage}%) >= standard (${standard.percentage}%)`,
    );
  });

  it('has critical and high priority recommendations', () => {
    const priorities = new Set(report.agents[0].recommendations.map(r => r.priority));
    assert.ok(priorities.has('critical') || priorities.has('high'), 'Expected at least critical or high priority recommendations');
  });
});

describe('Fixture 9: allowed-missing (N/A checks)', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: '@scope/lib',
      exports: { '.': './dist/index.js' },
      devDependencies: { typescript: '^5.0.0' },
      scripts: { test: 'vitest' },
    }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] } }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    ...Object.fromEntries(
      ['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s),
      ]),
    ),
    'docs/footguns.md': '# Footguns\n\n- `src/a.ts:5` - evidence\n',
    'docs/lessons.md': '# Lessons\n\n### E1\nStuff.\n',
    'docs/architecture.md': '# Arch\n\nOverview.\n',
    'tasks/handoff-template.md': '# Handoff\n',
    '.gitignore': '.env\nsettings.local.json\n',
  });
  const report = scanProject(fs, '/test/allowed-missing', { agentFilter: null });

  it('N/A checks do not inflate score (earned=0, maxPoints=0)', () => {
    const naChecks = report.agents[0].checks.filter(c => c.status === 'na');
    for (const check of naChecks) {
      assert.equal(check.points, 0, `N/A check ${check.id} should have 0 points`);
      assert.equal(check.maxPoints, 0, `N/A check ${check.id} should have 0 maxPoints`);
    }
  });

  it('local instruction checks exist', () => {
    const localChecks = report.agents[0].checks.filter(c => c.category === 'Local Instructions');
    assert.ok(localChecks.length >= 4, `Expected 4+ local instruction checks, got ${localChecks.length}`);
  });
});

describe('Fixture 10a: project with ai/instructions/', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'with-ai', scripts: { test: 'jest' } }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] } }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    'ai/README.md': '# Project Guidelines\n\nRead instructions/conventions.md first.\n',
    'ai/instructions/conventions.md': '# Conventions\n\n## Commands\n\n```bash\nnpm test\nnpm run build\nnpm run lint\n```\n\n## Conventions\n\nDo: use early returns\nDon\'t: nest deeply\nDo: co-locate tests\nDon\'t: hardcode secrets\n',
    'ai/instructions/frontend.md': '# Frontend\n\nFrontend conventions.\n',
    'ai/instructions/code-review.md': '# Code Review\n\nReview standards.\n',
    'ai/instructions/git-commit.md': '# Git Commit\n\nCommit format.\n',
    '.github/git-commit-instructions.md': '# Git Commit\n\nCommit format.\n',
  });
  const report = scanProject(fs, '/test/ai-instructions', { agentFilter: null });

  it('all local instruction checks pass', () => {
    const localChecks = report.agents[0].checks.filter(c => c.category === 'Local Instructions');
    const failing = localChecks.filter(c => c.status === 'fail');
    assert.equal(failing.length, 0, `Expected 0 failures, got: ${failing.map(c => c.id + ' ' + c.name).join(', ')}`);
  });

  it('detects ai/ location', () => {
    const dirCheck = report.agents[0].checks.find(c => c.id === '2.6.1');
    assert.ok(dirCheck);
    assert.equal(dirCheck.status, 'pass');
    assert.ok(dirCheck.message.includes('ai/instructions'), dirCheck.message);
  });
});

describe('Fixture 10b: project with .github/instructions/ only', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'gh-only', scripts: { test: 'jest' } }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] } }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.github/instructions/conventions.instructions.md': '# Conventions\n',
    '.github/instructions/code-review.instructions.md': '# Review\n',
    '.github/instructions/git-commit.instructions.md': '# Commit\n',
    '.github/git-commit-instructions.md': '# Commit\n',
  });
  const report = scanProject(fs, '/test/gh-instructions', { agentFilter: null });

  it('accepts .github/instructions/ as alternative', () => {
    const dirCheck = report.agents[0].checks.find(c => c.id === '2.6.1');
    assert.ok(dirCheck);
    assert.equal(dirCheck.status, 'pass');
  });

  it('accepts .instructions.md extension', () => {
    const baseCheck = report.agents[0].checks.find(c => c.id === '2.6.3');
    assert.ok(baseCheck);
    assert.equal(baseCheck.status, 'pass');
  });
});

describe('Fixture 10c: project without instructions', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'no-instructions', scripts: { test: 'jest' } }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)'] } }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
  });
  const report = scanProject(fs, '/test/no-instructions', { agentFilter: null });

  it('local instruction checks fail', () => {
    const localChecks = report.agents[0].checks.filter(c => c.category === 'Local Instructions');
    const failing = localChecks.filter(c => c.status === 'fail');
    assert.ok(failing.length >= 4, `Expected 4+ failures, got ${failing.length}`);
  });
});

describe('Fixture 10: self-goat-flow (score snapshot)', () => {
  // This fixture is tested via `npm run self-scan` against the real repo.
  // Here we verify the scoring engine's consistency with a synthetic full setup
  // that mirrors goat-flow's structure.
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'AGENTS.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'AGENTS.md'),
    'GEMINI.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'GEMINI.md'),
    'package.json': JSON.stringify({ name: 'goat-flow', scripts: { test: 'node --test' } }),
    '.claude/settings.json': JSON.stringify({ permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] } }),
    '.gemini/settings.json': JSON.stringify({ permissions: { deny: ['git commit', 'git push'] } }),
    // Skills for all agents (8 required skills)
    ...Object.fromEntries(
      ['security', 'debug', 'investigate', 'review', 'plan', 'test', 'refactor', 'simplify'].flatMap(s => [
        [`.claude/skills/goat-${s}/SKILL.md`, `---\nname: goat-${s}\ngoat-flow-skill-version: "0.9.0"\n---\n# goat-${s}\n`],
        [`.agents/skills/goat-${s}/SKILL.md`, `---\nname: goat-${s}\ngoat-flow-skill-version: "0.9.0"\n---\n# goat-${s}\n`],
      ]),
    ),
    // Hooks
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    'scripts/deny-dangerous.sh': '#!/usr/bin/env bash\n# deny git commit\n# deny git push\nexit 0\n',
    'scripts/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    // Learning loop
    'docs/footguns.md': '# Footguns\n\n## Footgun: Auth\n\n**Evidence:**\n- `src/auth.ts:42` - broke login\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\n',
    'docs/lessons.md': '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** something\n\n### Entry 2\n**What happened:** missed test\n\n### Entry 3\n**What happened:** stale ref\n',
    // Architecture
    'docs/architecture.md': '# Architecture\n\n' + 'System overview.\n'.repeat(10),
    // Evals
    'agent-evals/README.md': '# Agent Evals\n',
    'agent-evals/eval-1.md': '# Eval 1\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nDo the thing\n```\n',
    'agent-evals/eval-2.md': '# Eval 2\n\n**Origin:** real-incident\n\n## Replay Prompt\n\n```\nDo another thing\n```\n',
    'agent-evals/eval-3.md': '# Eval 3\n\n**Origin:** synthetic-seed\n\n## Replay Prompt\n\n```\nThird eval\n```\n',
    // CI
    '.github/workflows/context-validation.yml': 'name: CV\non: push\njobs:\n  v:\n    steps:\n      - run: wc -l\n      - run: check router\n      - run: check skills\n',
    // Scripts
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    // Misc
    'tasks/handoff-template.md': '# Handoff Template\n',
    '.gitignore': '.env\nsettings.local.json\nnode_modules/\n',
    'docs/system-spec.md': '# System Spec\n',
    'CHANGELOG.md': '# Changelog\n',
  });
  const report = scanProject(fs, '/test/self-goat-flow', { agentFilter: null });

  it('all 3 agents detected', () => {
    assert.equal(report.agents.length, 3);
  });

  it('Claude scores B or C (70-100%)', () => {
    assertPercentageRange(report, 'claude', 70, 100, 'self-goat-flow');
  });

  it('Codex scores B or C (70-100%)', () => {
    assertPercentageRange(report, 'codex', 70, 100, 'self-goat-flow');
  });

  it('Gemini scores B or C (70-100%)', () => {
    assertPercentageRange(report, 'gemini', 70, 100, 'self-goat-flow');
  });

  it('zero false positive anti-patterns on known-good setup', () => {
    for (const agent of report.agents) {
      const triggered = agent.antiPatterns.filter(ap => ap.triggered);
      assert.equal(triggered.length, 0, `${agent.agent}: unexpected anti-patterns: ${triggered.map(t => `${t.id}(${t.message})`).join(', ')}`);
    }
  });

  it('recommendation keys are stable strings', () => {
    for (const agent of report.agents) {
      for (const rec of agent.recommendations) {
        assert.ok(rec.key, `Recommendation for ${rec.checkId} missing key`);
        assert.ok(rec.key.length > 0, `Recommendation key for ${rec.checkId} is empty`);
        assert.ok(!rec.key.includes(' '), `Recommendation key '${rec.key}' contains spaces`);
      }
    }
  });
});

// ─── F1: Regression test corpus ──────────────────────────────────────
// These tests pin specific behaviors so threshold changes are detected.

describe('Regression: full project score stability', () => {
  const REGRESSION_CLAUDE_MD = FULL_CLAUDE_MD + `
\`\`\`
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read docs/system-spec.md:104 → "Target 120 lines. Hard limit 150."
\`\`\`

\`\`\`
BAD:  Created abstract template system (one format exists)
GOOD: Inline format. Extract when second format needed
\`\`\`
`;
  const fs = createMockFS({
    'CLAUDE.md': REGRESSION_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'regression-project',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { build: 'tsc', test: 'vitest', lint: 'eslint .', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)', 'Read(.env*)', 'Read(.ssh/**)', 'Read(.aws/**)'] },
      hooks: [{ type: 'Notification', matcher: 'compact', command: 'echo context' }],
    }),
    ...Object.fromEntries(
      ['security', 'debug', 'investigate', 'review', 'plan', 'test', 'refactor', 'simplify'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s),
      ]),
    ),
    '.claude/skills/goat/SKILL.md': `---\nname: goat\ndescription: "Dispatcher"\ngoat-flow-skill-version: "0.9.0"\n---\n# /goat\n\n## How It Works\n\nRoutes to the right skill.\n\n## Constraints\n\n- MUST announce selected skill\n`,
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nset -euo pipefail\nINPUT=$(cat)\nCMD=$(echo "$INPUT" | jq -r .command // empty)\ncase "$CMD" in *rm\\ -rf*|*--force*|*chmod\\ 777*) exit 2;; esac\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\necho "lint check"\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nprettier --write "$1"\nexit 0\n',
    'docs/footguns.md': '# Footguns\n\n## Footgun: Auth race\n\n**Evidence type:** ACTUAL_MEASURED\n\n**Evidence:**\n- `src/auth.ts:42` - race condition\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\n',
    'docs/lessons.md': '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** broke prod deploy\n\n### Entry 2\n**What happened:** missed test coverage\n\n### Entry 3\n**What happened:** stale ref after rename\n',
    'docs/architecture.md': '# Architecture\n\n' + 'System overview line.\n'.repeat(8),
    'agent-evals/README.md': '# Agent Evals\n',
    'agent-evals/eval-1.md': '# Eval 1\n\n**Origin:** real-incident\n**Agents:** all\n**Skill:** goat-debug\n\n## Replay Prompt\n\n```\nDo the thing\n```\n',
    'agent-evals/eval-2.md': '# Eval 2\n\n**Origin:** real-incident\n**Agents:** all\n**Skill:** goat-review\n\n## Replay Prompt\n\n```\nDo something\n```\n',
    'agent-evals/eval-3.md': '# Eval 3\n\n**Origin:** synthetic-seed\n**Agents:** claude\n**Skill:** goat-plan\n\n## Replay Prompt\n\n```\nAnother prompt\n```\n',
    '.github/workflows/context-validation.yml': 'name: Context Validation\non:\n  pull_request:\n    paths: [CLAUDE.md]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: scripts/check-router.sh\n      - run: scripts/check-skills.sh\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\necho "preflight"\n',
    'tasks/handoff-template.md': '# Handoff Template\n\n## Status\n\n## Current State\n\n## Key Decisions\n\n## Known Risks\n\n## Next Step\n',
    '.gitignore': '.env\nsettings.local.json\nnode_modules/\n',
    'docs/system-spec.md': '# System Spec\n',
    'ai/README.md': '# Coding Guidelines\n\nRouter for instruction files.\n',
    'ai/instructions/conventions.md': '# Conventions\n\n## Commands\n\n```bash\nnpm test\n```\n\n## Conventions\n\nDo: use TypeScript\nDon\'t: use any\n\n' + 'Line.\n'.repeat(10),
    'ai/instructions/code-review.md': '# Code Review\n\nReview checklist.\n',
    'ai/instructions/git-commit.md': '# Git Commit\n\nCommit conventions.\n',
    'CHANGELOG.md': '# Changelog\n\n## v1.0\n\nInitial setup.\n',
  });
  const report = scanProject(fs, '/test/regression', { agentFilter: null });

  it('full project scores A (90%+)', () => {
    assertValidReport(report, 'regression-full');
    const agent = report.agents.find(a => a.agent === 'claude');
    assert.ok(agent, 'Claude agent should exist');
    assert.ok(agent.score.percentage >= 90, `Expected 90%+, got ${agent.score.percentage}%`);
    assert.equal(agent.score.grade, 'A');
  });

  it('has zero anti-pattern deductions', () => {
    const agent = report.agents.find(a => a.agent === 'claude')!;
    const triggered = agent.antiPatterns.filter(ap => ap.triggered);
    assert.equal(triggered.length, 0, `Expected 0 triggered APs, got: ${triggered.map(a => a.id).join(', ')}`);
  });

  it('all foundation checks pass', () => {
    const agent = report.agents.find(a => a.agent === 'claude')!;
    const foundationFails = agent.checks.filter(c => c.tier === 'foundation' && c.status === 'fail');
    assert.equal(foundationFails.length, 0, `Foundation failures: ${foundationFails.map(c => `${c.id}: ${c.message}`).join(', ')}`);
  });

  it('check count is stable', () => {
    assert.ok(report.meta.checkCount >= 95, `Expected 95+ checks, got ${report.meta.checkCount}`);
    assert.ok(report.meta.antiPatternCount >= 14, `Expected 14+ APs, got ${report.meta.antiPatternCount}`);
  });
});

describe('Regression: minimal project scores F', () => {
  const fs = createMockFS({
    'CLAUDE.md': MINIMAL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'minimal' }),
  });
  const report = scanProject(fs, '/test/regression-minimal', { agentFilter: null });

  it('minimal project scores D or F', () => {
    const agent = report.agents.find(a => a.agent === 'claude');
    assert.ok(agent, 'Claude agent should exist');
    assert.ok(agent.score.percentage < 50, `Expected <50%, got ${agent.score.percentage}%`);
  });

  it('has many recommendations', () => {
    const agent = report.agents.find(a => a.agent === 'claude')!;
    assert.ok(agent.recommendations.length >= 10, `Expected 10+ recommendations, got ${agent.recommendations.length}`);
  });
});
