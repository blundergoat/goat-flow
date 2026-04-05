/**
 * In-memory scanner regression suite.
 * These focused fixtures are cheaper than disk-backed projects and lock down individual rubric edge cases.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createMockFS } from '../helpers/mock-fs.js';
import { scanProject } from '../../src/cli/scanner/scan.js';
import { RUBRIC_VERSION } from '../../src/cli/rubric/version.js';
import type { ScanReport, Grade } from '../../src/cli/types.js';

// ─── Helpers ────────────────────────────────────────────────────────

function assertGrade(
  report: ScanReport,
  agentId: string,
  expected: Grade,
  label: string,
) {
  const agent = report.agents.find((a) => a.agent === agentId);
  assert.ok(agent, `${label}: agent '${agentId}' not found`);
  assert.equal(
    agent.score.grade,
    expected,
    `${label}: expected grade ${expected}, got ${agent.score.grade} (${agent.score.percentage}%)`,
  );
}

/** Assert percentage range. */
function assertPercentageRange(
  report: ScanReport,
  agentId: string,
  min: number,
  max: number,
  label: string,
) {
  const agent = report.agents.find((a) => a.agent === agentId);
  assert.ok(agent, `${label}: agent '${agentId}' not found`);
  assert.ok(
    agent.score.percentage >= min && agent.score.percentage <= max,
    `${label}: expected ${agentId} percentage ${min}-${max}%, got ${agent.score.percentage}%`,
  );
}

/** Assert no agents. */
function assertNoAgents(report: ScanReport, label: string) {
  assert.equal(
    report.agents.length,
    0,
    `${label}: expected no agents, got ${report.agents.length}`,
  );
}

/** Assert valid report. */
function assertValidReport(report: ScanReport, label: string) {
  assert.ok(report.schemaVersion, `${label}: missing schemaVersion`);
  assert.ok(report.packageVersion, `${label}: missing packageVersion`);
  assert.ok(report.rubricVersion, `${label}: missing rubricVersion`);
  assert.ok(report.meta.checkCount > 0, `${label}: checkCount should be > 0`);
  assert.ok(
    report.meta.antiPatternCount > 0,
    `${label}: antiPatternCount should be > 0`,
  );
  assert.ok(report.meta.versions, `${label}: missing meta.versions`);
  assert.equal(
    report.meta.versions.schema,
    report.schemaVersion,
    `${label}: meta schema version should match top-level schemaVersion`,
  );
  assert.equal(
    report.meta.versions.package,
    report.packageVersion,
    `${label}: meta package version should match top-level packageVersion`,
  );
  assert.equal(
    report.meta.versions.rubric,
    report.rubricVersion,
    `${label}: meta rubric version should match top-level rubricVersion`,
  );
  for (const agent of report.agents) {
    assert.ok(
      agent.checks.length > 0,
      `${label}: ${agent.agent} should have checks`,
    );
    for (const check of agent.checks) {
      assert.ok(
        check.confidence,
        `${label}: check ${check.id} missing confidence`,
      );
      assert.ok(
        ['pass', 'partial', 'fail', 'na'].includes(check.status),
        `${label}: check ${check.id} invalid status '${check.status}'`,
      );
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
| \`ai-docs/lessons/\` | Behavioural mistake |
| \`ai-docs/footguns/\` | Cross-doc architectural trap |

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
- \`docs/five-layers.md\`
- \`workflow/setup/\` prompt changes
- \`workflow/skills/\` template changes
- Changes spanning 3+ documentation files

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Overwrite existing files without checking.

## Definition of Done

MUST confirm ALL: (1) shellcheck passes on changed .sh files (2) no broken cross-references introduced (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames

## Router Table

| Resource | Path |
|----------|------|
| System spec | \`docs/system-spec.md\` |
| Skills | \`.claude/skills/\` |
| Footguns | \`ai-docs/footguns/\` |
| Lessons | \`ai-docs/lessons/\` |
| Architecture | \`ai-docs/architecture.md\` |
| Config | \`.goat-flow/config.yaml\` |
| Handoff | \`.goat-flow/tasks/handoff-template.md\` |
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

// Quality skill content for fixtures that expect high scores
function qualitySkill(name: string): string {
  return `---
name: goat-${name}
description: "${name} skill"
goat-flow-skill-version: "${RUBRIC_VERSION}"
---
# goat-${name}

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs \`file:line\`. Tag as OBSERVED (verified) or INFERRED. MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it - don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → \`ai-docs/lessons/\`. Architectural trap → \`ai-docs/footguns/\`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use for ${name} tasks.

## Step 0 - Gather Context

Ask the user before starting:
1. What is the scope?
2. What do you already know?

Do NOT start until the user has answered.

## Phase 1 - Investigate

Read relevant files. Collect evidence.

## Phase 2 - Report

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
    'package.json': JSON.stringify({
      name: 'my-project',
      scripts: { start: 'node index.js' },
    }),
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
    'package.json': JSON.stringify({
      name: 'my-app',
      scripts: { start: 'node server.js', test: 'jest' },
    }),
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
    assert.ok(
      grade === 'F' || grade === 'D',
      `Expected F or D, got ${grade} (${report.agents[0].score.percentage}%)`,
    );
  });

  it('has recommendations', () => {
    assert.ok(
      report.agents[0].recommendations.length > 5,
      'Expected many recommendations for minimal setup',
    );
  });
});

describe('Fixture 3: minimal-codex', () => {
  const fs = createMockFS({
    'AGENTS.md': MINIMAL_AGENTS_MD,
    'package.json': JSON.stringify({
      name: 'my-codex-app',
      scripts: { start: 'node app.js' },
    }),
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
      scripts: {
        build: 'tsc',
        test: 'vitest',
        lint: 'eslint .',
        format: 'prettier --write .',
      },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)', 'Bash(rm -rf*)'] },
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }] },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '.claude/hooks/format-file.sh' }] },
        ],
        Notification: [
          { matcher: 'compact', hooks: [{ type: 'command', command: 'echo context' }] },
        ],
      },
    }),
    // 6 skills (5 + dispatcher)
    ...Object.fromEntries(
      ['debug', 'review', 'plan', 'security', 'test'].map((s) => [
        `.claude/skills/goat-${s}/SKILL.md`,
        qualitySkill(s),
      ]),
    ),
    // Hooks
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh':
      '#!/usr/bin/env bash\nnpx eslint . --quiet\nexit 0\n',
    '.claude/hooks/format-file.sh':
      '#!/usr/bin/env bash\nINPUT=$(cat)\nFILE_PATH=$(echo "$INPUT" | jq -r \'.file_path // empty\' 2>/dev/null)\n[ -z "$FILE_PATH" ] && exit 0\ncase "$FILE_PATH" in\n  */.claude/*|*/.gemini/*|*/.codex/*|*/.agents/*|*/.github/skills/*) exit 0 ;;\nesac\nprettier --write "$FILE_PATH"\nexit 0\n',
    // Learning loop
    'ai-docs/footguns/':
      '# Footguns\n\n## Footgun: Auth race\n\n**Evidence:**\n- `src/auth.ts:42` - race condition\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\nexport function login() {}\n',
    'ai-docs/lessons/':
      '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** broke prod\n\n### Entry 2\n**What happened:** missed test\n\n### Entry 3\n**What happened:** stale ref\n',
    // Architecture
    'ai-docs/architecture.md':
      '# Architecture\n\n' + 'System overview.\n'.repeat(10),
    // Evals
    'ai-docs/evals/README.md': '# Agent Evals\n',
    'ai-docs/evals/eval-1.md':
      '---\nname: eval-1\norigin: real-incident\nagents: all\nskill: goat-debug\n---\n\n### Scenario\n\n```\nDo the thing\n```\n',
    'ai-docs/evals/eval-2.md':
      '---\nname: eval-2\norigin: real-incident\nagents: all\nskill: goat-review\n---\n\n### Scenario\n\n```\nDo something\n```\n',
    'ai-docs/evals/eval-3.md':
      '---\nname: eval-3\norigin: synthetic-seed\nagents: claude\nskill: goat-plan\n---\n\n### Scenario\n\n```\nAnother prompt\n```\n',
    'ai-docs/evals/eval-4.md':
      '---\nname: eval-4\norigin: real-incident\nagents: all\nskill: goat-security\n---\n\n### Scenario\n\n```\nCheck auth\n```\n',
    'ai-docs/evals/eval-5.md':
      '---\nname: eval-5\norigin: real-incident\nagents: all\nskill: goat-debug\n---\n\n### Scenario\n\n```\nExplore module\n```\n',
    'ai-docs/evals/eval-6.md':
      '---\nname: eval-6\norigin: real-incident\nagents: all\nskill: goat-test\n---\n\n### Scenario\n\n```\nVerify changes\n```\n',
    'ai-docs/evals/eval-7.md':
      '---\nname: eval-7\norigin: real-incident\nagents: all\nskill: goat-plan\n---\n\n### Scenario\n\n```\nRename across files\n```\n',
    'ai-docs/evals/eval-8.md':
      '---\nname: eval-8\norigin: real-incident\nagents: all\nskill: goat-review\n---\n\n### Scenario\n\n```\nClean up naming\n```\n',
    'ai-docs/evals/eval-9.md':
      '---\nname: eval-9\norigin: real-incident\nagents: all\nskill: goat\n---\n\n### Scenario\n\n```\nRoute intent\n```\n',
    // CI
    '.github/workflows/context-validation.yml':
      'name: Context Validation\non: [push, pull_request]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: bash scripts/context-validate.sh\n      - run: ls .claude/skills/goat-debug/SKILL.md\n',
    // Preflight + validation
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\necho "preflight"\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\necho "validate"\n',
    // Handoff
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    // Gitignore
    '.gitignore': '.env\nsettings.local.json\nnode_modules/\n',
    // Referenced router paths
    'docs/system-spec.md': '# System Spec\n',
  });
  const report = scanProject(fs, '/test/full-claude', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'full-claude');
  });

  it('scores A, B, or C (all required checks pass)', () => {
    const agent = report.agents[0];
    assert.ok(
      ['A', 'B', 'C'].includes(agent.score.grade),
      `full-claude: expected A, B, or C, got ${agent.score.grade} (${agent.score.percentage}%)`,
    );
    assertPercentageRange(report, 'claude', 70, 100, 'full-claude');
  });

  it('has zero or near-zero anti-pattern deductions', () => {
    const triggered = report.agents[0].antiPatterns.filter(
      (ap) => ap.triggered,
    );
    assert.ok(
      triggered.length <= 1,
      `Expected 0-1 triggered anti-patterns, got ${triggered.length}: ${triggered.map((t) => t.id).join(', ')}`,
    );
  });

  it('has few recommendations', () => {
    assert.ok(
      report.agents[0].recommendations.length <= 30,
      `Expected ≤30 recommendations, got ${report.agents[0].recommendations.length}`,
    );
  });

  it('confidence field present on all checks', () => {
    for (const check of report.agents[0].checks) {
      assert.ok(
        ['high', 'medium', 'low'].includes(check.confidence),
        `Check ${check.id} missing valid confidence`,
      );
    }
  });
});

describe('Fixture 5: full-multi-agent', () => {
  const skills = Object.fromEntries(
    ['preflight', 'debug', 'audit', 'review', 'plan', 'test'].flatMap((s) => [
      [`.claude/skills/goat-${s}/SKILL.md`, qualitySkill(s)],
      [`.agents/skills/goat-${s}/SKILL.md`, qualitySkill(s)],
    ]),
  );
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'AGENTS.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'AGENTS.md'),
    'GEMINI.md': FULL_CLAUDE_MD.replace('CLAUDE.md', 'GEMINI.md'),
    'package.json': JSON.stringify({
      name: 'multi-agent',
      devDependencies: { typescript: '^5.0.0' },
      scripts: { test: 'vitest', lint: 'eslint .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }] },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '.claude/hooks/format-file.sh' }] },
        ],
      },
    }),
    '.gemini/settings.json': JSON.stringify({
      permissions: { deny: ['git commit', 'git push'] },
      hooks: {
        AfterAgent: [
          { hooks: [{ type: 'command', command: '.gemini/hooks/stop-lint.sh' }] },
        ],
      },
    }),
    ...skills,
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nnpx eslint . --quiet\nexit 0\n',
    '.claude/hooks/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/stop-lint.sh': '#!/usr/bin/env bash\nnpx eslint . --quiet\nexit 0\n',
    '.codex/rules/deny-dangerous.star':
      '# execpolicy\n# deny git commit\n# deny git push\n',
    '.codex/config.toml':
      '[stop]\ncommand = ["scripts/stop-lint.sh"]\n\n[after_tool_use]\ncommand = ["scripts/format-file.sh"]\n',
    'scripts/stop-lint.sh': '#!/usr/bin/env bash\nnpx eslint . --quiet\nexit 0\n',
    'scripts/format-file.sh': '#!/usr/bin/env bash\nexit 0\n',
    'ai-docs/footguns/': '# Footguns\n\n**Evidence:**\n- `src/a.ts:1`\n',
    'ai-docs/lessons/': '# Lessons\n\n### Entry 1\n**What happened:** x\n',
    'ai-docs/architecture.md': '# Architecture\n\nOverview.\n',
    'ai-docs/evals/README.md': '# Evals\n',
    'ai-docs/evals/eval-1.md':
      '---\nname: e1\norigin: real-incident\nagents: all\n---\n\n### Scenario\n\n```\nx\n```\n',
    'ai-docs/evals/eval-2.md':
      '---\nname: e2\norigin: real-incident\nagents: all\n---\n\n### Scenario\n\n```\ny\n```\n',
    'ai-docs/evals/eval-3.md':
      '---\nname: e3\norigin: synthetic-seed\nagents: claude\n---\n\n### Scenario\n\n```\nz\n```\n',
    '.github/workflows/context-validation.yml':
      'name: CV\non: [push, pull_request]\njobs:\n  v:\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: bash scripts/context-validate.sh\n      - run: ls .claude/skills/goat-debug/SKILL.md\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.gitignore': '.env\nsettings.local.json\n',
  });
  const report = scanProject(fs, '/test/multi', { agentFilter: null });

  it('detects all 3 agents', () => {
    assert.equal(report.agents.length, 3);
    assert.deepEqual(report.agents.map((a) => a.agent).sort(), [
      'claude',
      'codex',
      'gemini',
    ]);
  });

  it('all agents score D or better', () => {
    for (const agent of report.agents) {
      assert.ok(
        agent.score.grade === 'A' ||
          agent.score.grade === 'B' ||
          agent.score.grade === 'C' ||
          agent.score.grade === 'D',
        `${agent.agent}: expected A-D, got ${agent.score.grade} (${agent.score.percentage}%)`,
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
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    ...Object.fromEntries(
      ['preflight', 'debug', 'audit', 'review', 'plan', 'test'].map((s) => [
        `.claude/skills/goat-${s}/SKILL.md`,
        qualitySkill(s),
      ]),
    ),
    'ai-docs/footguns/': '# Footguns\n\n- `src/index.ts:10` - gotcha\n',
    'ai-docs/lessons/': '# Lessons\n\n### Entry 1\nStuff.\n',
  });
  const report = scanProject(fs, '/test/library', { agentFilter: null });

  it('produces valid report for library project', () => {
    assertValidReport(report, 'library');
  });
});

describe('Fixture 7: anti-patterns', () => {
  const fs = createMockFS({
    'CLAUDE.md': AP_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'bad-project',
      scripts: { start: 'node .' },
    }),
    '.claude/settings.json': '{ invalid json !!!',
    'ai-docs/footguns/':
      '# Footguns\n\nSome footguns but no file:line evidence at all.\n',
    '.claude/skills/not-goat-prefixed/SKILL.md': '# bad skill\n',
  });
  const report = scanProject(fs, '/test/anti-patterns', { agentFilter: null });

  it('produces valid report', () => {
    assertValidReport(report, 'anti-patterns');
  });

  it('triggers AP1 (over 150 lines)', () => {
    const ap1 = report.agents[0].antiPatterns.find((ap) => ap.id === 'AP1');
    assert.ok(ap1, 'AP1 not found');
    assert.ok(ap1.triggered, 'AP1 should be triggered (file is >150 lines)');
    assert.equal(ap1.deduction, -3);
  });

  it('triggers AP4 (footguns without evidence)', () => {
    const ap4 = report.agents[0].antiPatterns.find((ap) => ap.id === 'AP4');
    assert.ok(ap4, 'AP4 not found');
    assert.ok(ap4.triggered, 'AP4 should be triggered (no file:line evidence)');
    assert.equal(ap4.deduction, -5);
  });

  it('triggers AP5 (invalid settings JSON)', () => {
    const ap5 = report.agents[0].antiPatterns.find((ap) => ap.id === 'AP5');
    assert.ok(ap5, 'AP5 not found');
    assert.ok(ap5.triggered, 'AP5 should be triggered (invalid JSON)');
    assert.equal(ap5.deduction, -5);
  });

  it('triggers AP8 (generic Ask First)', () => {
    const ap8 = report.agents[0].antiPatterns.find((ap) => ap.id === 'AP8');
    assert.ok(ap8, 'AP8 not found');
    assert.ok(
      ap8.triggered,
      'AP8 should be triggered (template text in Ask First)',
    );
    assert.equal(ap8.deduction, -2);
  });

  it('total deductions capped at -15', () => {
    assert.ok(
      report.agents[0].score.deductions >= -15,
      `Deductions should be >= -15, got ${report.agents[0].score.deductions}`,
    );
  });

  it('scores F due to anti-patterns + missing features', () => {
    assertGrade(report, 'claude', 'F', 'anti-patterns');
  });
});

describe('Fixture 8: partial-setup', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'partial',
      scripts: { test: 'jest' },
    }),
    // Has settings but no deny patterns
    '.claude/settings.json': JSON.stringify({ theme: 'dark' }),
    // Has some skills but not all
    '.claude/skills/goat-security/SKILL.md': '# goat-security\n',
    '.claude/skills/goat-debug/SKILL.md': '# goat-debug\n',
    '.claude/skills/goat-review/SKILL.md': '# goat-review\n',
    // Learning loop - lessons exists but no footguns
    'ai-docs/lessons/': '# Lessons\n\n### Entry 1\nSomething.\n',
    // Architecture exists
    'ai-docs/architecture.md': '# Architecture\n\nOverview.\n',
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
    const priorities = new Set(
      report.agents[0].recommendations.map((r) => r.priority),
    );
    assert.ok(
      priorities.has('critical') || priorities.has('high'),
      'Expected at least critical or high priority recommendations',
    );
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
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    ...Object.fromEntries(
      ['preflight', 'debug', 'audit', 'review', 'plan', 'test'].map((s) => [
        `.claude/skills/goat-${s}/SKILL.md`,
        qualitySkill(s),
      ]),
    ),
    'ai-docs/footguns/': '# Footguns\n\n- `src/a.ts:5` - evidence\n',
    'ai-docs/lessons/': '# Lessons\n\n### E1\nStuff.\n',
    'ai-docs/architecture.md': '# Arch\n\nOverview.\n',
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.gitignore': '.env\nsettings.local.json\n',
  });
  const report = scanProject(fs, '/test/allowed-missing', {
    agentFilter: null,
  });

  it('N/A checks do not inflate score (earned=0, maxPoints=0)', () => {
    const naChecks = report.agents[0].checks.filter((c) => c.status === 'na');
    for (const check of naChecks) {
      assert.equal(
        check.points,
        0,
        `N/A check ${check.id} should have 0 points`,
      );
      assert.equal(
        check.maxPoints,
        0,
        `N/A check ${check.id} should have 0 maxPoints`,
      );
    }
  });

  it('local instruction checks exist', () => {
    const localChecks = report.agents[0].checks.filter(
      (c) => c.category === 'Local Instructions',
    );
    assert.ok(
      localChecks.length >= 4,
      `Expected 4+ local instruction checks, got ${localChecks.length}`,
    );
  });
});

describe('Fixture 10a: project with ai-docs/coding-standards/', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'with-ai',
      scripts: { test: 'jest' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    'ai-docs/README.md':
      '# Project Guidelines\n\nRead [conventions](ai-docs/coding-standards/conventions.md) first.\n',
    'ai-docs/coding-standards/conventions.md':
      "# Conventions\n\n## Commands\n\n```bash\nnpm test\nnpm run build\nnpm run lint\n```\n\n## Conventions\n\nDo: use early returns\nDon't: nest deeply\nDo: co-locate tests\nDon't: hardcode secrets\n",
    'ai-docs/coding-standards/frontend.md': '# Frontend\n\nFrontend conventions.\n',
    'ai-docs/coding-standards/code-review.md':
      '# Code Review\n\nReview standards.\n',
    'ai-docs/coding-standards/git-commit.md': '# Git Commit\n\nCommit format.\n',
    '.github/git-commit-instructions.md': '# Git Commit\n\nCommit format.\n',
  });
  const report = scanProject(fs, '/test/ai-instructions', {
    agentFilter: null,
  });

  it('all local instruction checks pass', () => {
    const localChecks = report.agents[0].checks.filter(
      (c) => c.category === 'Local Instructions',
    );
    const failing = localChecks.filter((c) => c.status === 'fail');
    assert.equal(
      failing.length,
      0,
      `Expected 0 failures, got: ${failing.map((c) => c.id + ' ' + c.name).join(', ')}`,
    );
  });

  it('detects ai-docs/ location', () => {
    const dirCheck = report.agents[0].checks.find((c) => c.id === '2.6.1');
    assert.ok(dirCheck);
    assert.equal(dirCheck.status, 'pass');
    assert.ok(
      dirCheck.message.includes('ai-docs/coding-standards'),
      dirCheck.message,
    );
  });
});

describe('Fixture 10b: project with .github/instructions/ only', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'gh-only',
      scripts: { test: 'jest' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.github/instructions/conventions.instructions.md': '# Conventions\n',
    '.github/instructions/code-review.instructions.md': '# Review\n',
    '.github/instructions/git-commit.instructions.md': '# Commit\n',
    '.github/git-commit-instructions.md': '# Commit\n',
  });
  const report = scanProject(fs, '/test/gh-instructions', {
    agentFilter: null,
  });

  it('accepts .github/instructions/ as alternative', () => {
    const dirCheck = report.agents[0].checks.find((c) => c.id === '2.6.1');
    assert.ok(dirCheck);
    assert.equal(dirCheck.status, 'pass');
  });

  it('accepts .instructions.md extension', () => {
    const baseCheck = report.agents[0].checks.find((c) => c.id === '2.6.3');
    assert.ok(baseCheck);
    assert.equal(baseCheck.status, 'pass');
  });
});

describe('Regression: duplicate local-instruction surfaces should fail', () => {
  const fs = createMockFS({
    'CLAUDE.md': MINIMAL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'duplicate-instruction-surfaces' }),
    'ai-docs/README.md':
      '# Coding Guidelines\n\nSee [Conventions](ai-docs/coding-standards/conventions.md).\n',
    'ai-docs/coding-standards/conventions.md':
      '# Conventions\n\n## Commands\n\n```bash\nnpm test\n```\n\n## Conventions\n\nDo: use TypeScript\nDon\'t: use any\n\nLine.\n'.repeat(
        4,
      ),
    '.github/instructions/conventions.instructions.md': '# Conventions\n',
    '.github/instructions/code-review.instructions.md': '# Review\n',
  });
  const report = scanProject(fs, '/test/duplicate-instruction-surfaces', {
    agentFilter: 'claude',
  });

  it('fails 2.6.1a when both ai-docs/ and .github/instructions/ exist', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.6.1a');
    assert.ok(check, 'Expected check 2.6.1a');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /ai-docs\/coding-standards/);
    assert.match(check.message, /\.github\/instructions/);
  });
});

describe('Fixture 10c: project without instructions', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'no-instructions',
      scripts: { test: 'jest' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
  });
  const report = scanProject(fs, '/test/no-instructions', {
    agentFilter: null,
  });

  it('local instruction checks fail', () => {
    const localChecks = report.agents[0].checks.filter(
      (c) => c.category === 'Local Instructions',
    );
    const failing = localChecks.filter((c) => c.status === 'fail');
    assert.ok(
      failing.length >= 4,
      `Expected 4+ failures, got ${failing.length}`,
    );
  });
});

describe('Regression: hooks exist without registration should fail', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'hooks-not-registered',
      scripts: { test: 'node --test', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: [],
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\necho lint\nexit 0\n',
    '.claude/hooks/format-file.sh':
      '#!/usr/bin/env bash\nprettier --write "$1"\nexit 0\n',
  });
  const report = scanProject(fs, '/test/hooks-not-registered', {
    agentFilter: 'claude',
  });

  it('fails post-turn registration when hook file exists but not registered', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.2');
    assert.ok(check, 'Expected check 2.2.2');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('.claude/settings.json'), check.message);
    assert.ok(check.message.includes('"Stop"'), check.message);
    assert.ok(
      check.message.includes('.claude/hooks/stop-lint.sh'),
      check.message,
    );
  });

  it('fails post-tool registration when hook file exists but not registered', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.4');
    assert.ok(check, 'Expected check 2.2.4');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('.claude/settings.json'), check.message);
    assert.ok(check.message.includes('"PostToolUse"'), check.message);
    assert.ok(
      check.message.includes('.claude/hooks/format-file.sh'),
      check.message,
    );
  });
});

describe('Regression: registered hook paths must exist on disk', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'registered-hook-paths-missing',
      scripts: { test: 'node --test', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: 'command',
                command: '.claude/hooks/missing-stop-lint.sh',
              },
            ],
          },
        ],
        PostToolUse: [
          {
            matcher: 'Write|Edit|MultiEdit',
            hooks: [
              {
                type: 'command',
                command: '.claude/hooks/missing-format-file.sh',
              },
            ],
          },
        ],
      },
    }),
  });
  const report = scanProject(fs, '/test/registered-hook-paths-missing', {
    agentFilter: 'claude',
  });

  it('fails check 2.2.2a when a registered hook script path does not exist', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.2a');
    assert.ok(check, 'Expected check 2.2.2a');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /missing-stop-lint\.sh/);
    assert.match(check.message, /missing-format-file\.sh/);
  });
});

describe('Regression: registered post-turn hook without validation should fail', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'registered-hook-without-validation',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }],
          },
        ],
      },
    }),
    '.claude/hooks/stop-lint.sh':
      '#!/usr/bin/env bash\nset -euo pipefail\necho "checked" >&2\nexit 0\n',
  });
  const report = scanProject(fs, '/test/registered-hook-without-validation', {
    agentFilter: 'claude',
  });

  it('fails check 2.2.2 when the registered hook is a no-op wrapper', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.2');
    assert.ok(check, 'Expected check 2.2.2');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /\.claude\/hooks\/stop-lint\.sh/);
    assert.match(check.message, /no lint, typecheck, or format-check commands/i);
  });

  it('fails check 2.2.4b for missing validation logic', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.4b');
    assert.ok(check, 'Expected check 2.2.4b');
    assert.equal(check.status, 'fail');
  });
});

describe('Regression: deny hook must block pipe-to-shell', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'deny-hook-missing-pipe-to-shell',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': `#!/usr/bin/env bash
block() { echo "BLOCKED: $1" >&2; exit 2; }
cmd="$(cat)"
if [[ "$cmd" =~ rm[[:space:]]+-rf ]]; then block "rm -rf"; fi
if [[ "$cmd" =~ --force ]]; then block "force push"; fi
if [[ "$cmd" =~ chmod[[:space:]]+777 ]]; then block "chmod 777"; fi
exit 0
`,
  });
  const report = scanProject(fs, '/test/deny-hook-missing-pipe-to-shell', {
    agentFilter: 'claude',
  });

  it('fails 2.2.5i when the deny hook omits pipe-to-shell blocking', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.5i');
    assert.ok(check, 'Expected check 2.2.5i');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /curl \| bash|wget \| sh|pipe-to-shell/i);
  });
});

describe('Regression: post-turn hook swallowing failures should fail honesty checks', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'swallowed-hook-failures',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: {
        Stop: [
          {
            hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }],
          },
        ],
      },
    }),
    '.claude/hooks/stop-lint.sh':
      '#!/usr/bin/env bash\nset -euo pipefail\nROOT=$(pwd)\nif [ -z "$ROOT" ]; then\n  exit 0\nfi\nfor f in scripts/*.sh; do\n  SC_OUT=$(shellcheck "$f" 2>&1) || true\n  if [ -n "$SC_OUT" ]; then\n    echo "$SC_OUT" >&2\n  fi\ndone\nprintf "checked\\n" >&2\nexit 0\n',
  });
  const report = scanProject(fs, '/test/swallowed-hook-failures', {
    agentFilter: 'claude',
  });

  it('fails check 2.2.3 when validation commands use || true', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.3');
    assert.ok(check, 'Expected check 2.2.3');
    assert.equal(check.status, 'fail');
    assert.ok(check.message.includes('|| true'), check.message);
  });

  it('still recognizes that the hook has validation logic', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.4b');
    assert.ok(check, 'Expected check 2.2.4b');
    assert.equal(check.status, 'pass');
  });

  it('triggers AP6 for swallowed validation failures', () => {
    const antiPattern = report.agents[0].antiPatterns.find(
      (ap) => ap.id === 'AP6',
    );
    assert.ok(antiPattern, 'Expected anti-pattern AP6');
    assert.equal(antiPattern.triggered, true);
    assert.ok(antiPattern.message.includes('|| true'), antiPattern.message);
  });
});

describe('Regression: post-tool hook behavior checks should fail on schema drift', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'post-tool-schema-drift',
      scripts: { test: 'node --test', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
      hooks: {
        PostToolUse: [
          {
            matcher: 'Write|Edit|MultiEdit',
            hooks: [
              { type: 'command', command: '.claude/hooks/format-file.sh' },
            ],
          },
        ],
      },
    }),
    '.claude/hooks/format-file.sh':
      '#!/usr/bin/env bash\nINPUT=$(cat)\nFILE=$(echo "$INPUT" | jq -r \'.tool_input.file_path // empty\' 2>/dev/null)\n[ -z "$FILE" ] && exit 0\nprettier --write "$FILE"\nexit 0\n',
  });
  const report = scanProject(fs, '/test/post-tool-schema-drift', {
    agentFilter: 'claude',
  });

  it('fails check 2.2.4d when the hook reads the wrong event field', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.4d');
    assert.ok(check, 'Expected check 2.2.4d');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /Expected top-level `?\.file_path`?/);
  });

  it('fails check 2.2.4e when the hook does not skip agent config dirs', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.2.4e');
    assert.ok(check, 'Expected check 2.2.4e');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /\.claude\//);
    assert.match(check.message, /\.agents\//);
    assert.match(check.message, /\.gemini\//);
  });
});

describe('Regression: broken ai-docs/README router should fail', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'broken-ai-router',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    'ai-docs/README.md':
      '# Coding Guidelines\n\nSee [Conventions](ai-docs/coding-standards/missing.md).\n',
    'ai-docs/coding-standards/conventions.md':
      "# Conventions\n\n## Commands\n\n```bash\nnpm test\n```\n\n## Conventions\n\nDo: use early returns\nDon't: hardcode secrets\n" +
      'Line.\n'.repeat(16),
    'ai-docs/coding-standards/code-review.md':
      '# Code Review\n\nReview checklist.\n',
    'ai-docs/coding-standards/git-commit.md':
      '# Git Commit\n\nCommit conventions.\n',
    '.github/git-commit-instructions.md':
      '# Git Commit\n\nCommit conventions.\n',
  });
  const report = scanProject(fs, '/test/broken-ai-router', {
    agentFilter: 'claude',
  });

  it('fails the router validity check when ai-docs/README.md points at a missing file', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.6.2');
    assert.ok(check, 'Expected check 2.6.2');
    assert.equal(check.status, 'fail');
    assert.ok(
      check.message.includes('references missing paths'),
      check.message,
    );
    assert.ok(
      check.message.includes('ai-docs/coding-standards/missing.md'),
      check.message,
    );
  });

  it('does not treat a broken ai-docs/README.md as a passing router', () => {
    const localChecks = report.agents[0].checks.filter(
      (c) => c.category === 'Local Instructions',
    );
    assert.ok(
      localChecks.some(
        (check) => check.id === '2.6.2' && check.status === 'fail',
      ),
    );
  });

  it('does not score as a perfect setup when the router is broken', () => {
    assert.ok(
      report.agents[0].score.percentage < 100,
      `Expected score < 100, got ${report.agents[0].score.percentage}%`,
    );
  });
});

describe('Regression: multiline CI run blocks are parsed as real validation', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'multiline-ci-validation',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.github/workflows/context-validation.yml': `name: Context Validation
on: [pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check instruction file line count
        run: |
          for f in CLAUDE.md AGENTS.md GEMINI.md; do
            [ -f "$f" ] && wc -l "$f"
          done
      - name: Check router references
        run: |
          grep -oP '\`[^\`]+\`' CLAUDE.md | tr -d '\`' | while read -r ref; do
            [ ! -e "$ref" ] && echo "missing path: $ref"
          done
      - name: Check skills exist
        run: |
          fail=0
          for skill in goat goat-debug goat-plan goat-review goat-security goat-test; do
            [ ! -f ".claude/skills/$skill/SKILL.md" ] && fail=1
          done
          [ "$fail" -eq 0 ] || exit 1
`,
  });
  const report = scanProject(fs, '/test/multiline-ci-validation', {
    agentFilter: 'claude',
  });

  it('passes 3.2.1 when the workflow contains real multiline validation commands', () => {
    const check = report.agents[0].checks.find((c) => c.id === '3.2.1');
    assert.ok(check, 'Expected check 3.2.1');
    assert.equal(check.status, 'pass');
  });

  it('passes the line/router/skills CI checks for block-style workflows', () => {
    const lineCount = report.agents[0].checks.find((c) => c.id === '3.2.2');
    const router = report.agents[0].checks.find((c) => c.id === '3.2.3');
    const skills = report.agents[0].checks.find((c) => c.id === '3.2.4');
    assert.ok(lineCount, 'Expected check 3.2.2');
    assert.ok(router, 'Expected check 3.2.3');
    assert.ok(skills, 'Expected check 3.2.4');
    assert.equal(lineCount.status, 'pass');
    assert.equal(router.status, 'pass');
    assert.equal(skills.status, 'pass');
  });
});

describe('Regression: CI scanner bait should not satisfy skill validation', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'ci-scanner-bait',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.github/workflows/context-validation.yml':
      'name: Context Validation\non: [pull_request]\njobs:\n  validate:\n    steps:\n      - run: echo "checking skills goat-debug"\n      - run: ls .claude/skills/goat-debug/SKILL.md\n',
  });
  const report = scanProject(fs, '/test/ci-scanner-bait', {
    agentFilter: 'claude',
  });

  it('fails 3.2.1 when the workflow has no real validation commands', () => {
    const check = report.agents[0].checks.find((c) => c.id === '3.2.1');
    assert.ok(check, 'Expected check 3.2.1');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /no real validation commands/i);
  });

  it('fails 3.2.4 when the workflow only lists one skill path', () => {
    const check = report.agents[0].checks.find((c) => c.id === '3.2.4');
    assert.ok(check, 'Expected check 3.2.4');
    assert.equal(check.status, 'fail');
  });
});

describe('Regression: category bucket learning loop counts entries, not files', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'category-buckets',
      scripts: { test: 'node --test', format: 'prettier --write .' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    'src/hook.ts': 'export const hook = true;\n',
    'src/router.ts': 'export const router = true;\n',
    'ai-docs/lessons/verification.md':
      '---\ncategory: verification\n---\n\n## Lesson: First lesson\n**Created:** 2026-04-03\n**What happened:** Missed a real regression.\n**Evidence:** `src/hook.ts:1` - hook changed without a fixture.\n**Prevention:** Add the fixture first.\n\n## Lesson: Second lesson\n**Created:** 2026-04-03\n**What happened:** Trusted stale expectations.\n**Evidence:** `src/router.ts:1` - the routing contract had changed.\n**Prevention:** Re-run the scanner before updating fixtures.\n',
    'ai-docs/footguns/hooks.md':
      '---\ncategory: hooks\n---\n\n## Footgun: Hook payload mismatch\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Symptoms:** Hook never sees the edited file.\n**Why it happens:** The wrong JSON field is parsed.\n**Evidence:**\n- `src/hook.ts:1` - hook consumes the wrong payload shape.\n**Prevention:** Read the actual runtime payload.\n\n## Footgun: Router drift\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Symptoms:** Router docs and code diverge.\n**Why it happens:** One side changes without the other.\n**Evidence:**\n- `src/router.ts:1` - router behavior is the real contract.\n**Prevention:** Update both sides together.\n',
  });
  const report = scanProject(fs, '/test/category-buckets', {
    agentFilter: 'claude',
  });

  it('counts lesson entries inside a single bucket file', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.3.2a');
    assert.ok(check, 'Expected check 2.3.2a');
    assert.equal(check.status, 'pass');
    assert.ok(
      check.message.includes('2 lesson entries (2 committed, 0 local)'),
      check.message,
    );
  });

  it('counts footgun evidence labels per entry, not per file', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.3.5a');
    assert.ok(check, 'Expected check 2.3.5a');
    assert.equal(check.status, 'pass');
    assert.ok(check.message.includes('2/2 footgun entries'), check.message);
  });
});

describe('Regression: footgun line refs must stay within file bounds', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'footgun-line-bounds',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    'src/auth.ts': 'export function login() {}\n',
    'ai-docs/footguns/hooks.md':
      '---\ncategory: hooks\n---\n\n## Footgun: Out-of-range line ref\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Symptoms:** Scanner trusted a stale line ref.\n**Why it happens:** The cited file changed after the incident was logged.\n**Evidence:**\n- `src/auth.ts:99` - no such line exists anymore.\n**Prevention:** Update the cited line after refactors.\n',
  });
  const report = scanProject(fs, '/test/footgun-line-bounds', {
    agentFilter: 'claude',
  });

  it('fails 2.3.4 when a cited footgun line is out of bounds', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.3.4');
    assert.ok(check, 'Expected check 2.3.4');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /out-of-range lines/i);
  });

  it('does not trigger AP12 when the file exists but the line number is stale', () => {
    const antiPattern = report.agents[0].antiPatterns.find(
      (ap) => ap.id === 'AP12',
    );
    assert.ok(antiPattern, 'Expected anti-pattern AP12');
    assert.equal(antiPattern.triggered, false);
  });
});

describe('Regression: duplicate legacy learning-loop surfaces trigger AP22', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'duplicate-learning-loop-surfaces',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    'src/auth.ts': 'export function login() {}\n',
    'ai-docs/footguns/hooks.md':
      '---\ncategory: hooks\n---\n\n## Footgun: Bucket entry\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Evidence:**\n- `src/auth.ts:1` - current bucket evidence.\n',
    'ai-docs/lessons/verification.md':
      '---\ncategory: verification\n---\n\n## Lesson: Bucket entry\n**Created:** 2026-04-03\nUse the bucket layout.\n',
    'docs/footguns.md':
      '# Footguns\n\n## Footgun: Legacy duplicate\n\n**Evidence:**\n- `src/auth.ts:1` - old flat-file surface.\n',
    'docs/lessons.md':
      '# Lessons\n\n## Entries\n\n### Legacy duplicate\n**What happened:** old flat-file lesson still exists.\n',
  });
  const report = scanProject(fs, '/test/duplicate-learning-loop-surfaces', {
    agentFilter: 'claude',
  });

  it('triggers AP22 for legacy flat files that compete with bucket dirs', () => {
    const antiPattern = report.agents[0].antiPatterns.find(
      (ap) => ap.id === 'AP22',
    );
    assert.ok(antiPattern, 'Expected anti-pattern AP22');
    assert.equal(antiPattern.triggered, true);
    assert.match(antiPattern.message, /docs\/footguns\.md/);
    assert.match(antiPattern.message, /docs\/lessons\.md/);
  });

  it('fails 2.3.5b for the same duplicate learning-loop surfaces', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.3.5b');
    assert.ok(check, 'Expected check 2.3.5b');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /docs\/footguns\.md/);
    assert.match(check.message, /docs\/lessons\.md/);
  });

  it('adds the duplicate-surface recommendation', () => {
    const recommendation = report.agents[0].recommendations.find(
      (rec) => rec.key === 'ap-fix-duplicate-learning-loop-surfaces',
    );
    assert.ok(
      recommendation,
      'Expected duplicate learning-loop surfaces recommendation',
    );
  });
});

describe('Regression: committed plus local bucket split does not trigger AP22', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD,
    'package.json': JSON.stringify({
      name: 'canonical-learning-loop-split',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    'src/auth.ts': 'export function login() {}\n',
    'ai-docs/footguns/hooks.md':
      '---\ncategory: hooks\n---\n\n## Footgun: Committed bucket\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Evidence:**\n- `src/auth.ts:1` - committed evidence.\n',
    '.goat-flow/footguns/local.md':
      '---\ncategory: local\n---\n\n## Footgun: Local bucket\n**Status:** active\n**Created:** 2026-04-03\n**Evidence type:** ACTUAL_MEASURED\n**Evidence:**\n- `src/auth.ts:1` - local evidence.\n',
    'ai-docs/lessons/verification.md':
      '---\ncategory: verification\n---\n\n## Lesson: Committed bucket\n**Created:** 2026-04-03\nCommitted lesson.\n',
    '.goat-flow/lessons/local.md':
      '---\ncategory: local\n---\n\n## Lesson: Local bucket\n**Created:** 2026-04-03\nLocal-only lesson.\n',
  });
  const report = scanProject(fs, '/test/canonical-learning-loop-split', {
    agentFilter: 'claude',
  });

  it('keeps AP22 clear when only the configured committed/local split exists', () => {
    const antiPattern = report.agents[0].antiPatterns.find(
      (ap) => ap.id === 'AP22',
    );
    assert.ok(antiPattern, 'Expected anti-pattern AP22');
    assert.equal(antiPattern.triggered, false);
  });

  it('passes 2.3.5b when only the configured committed/local split exists', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.3.5b');
    assert.ok(check, 'Expected check 2.3.5b');
    assert.equal(check.status, 'pass');
  });
});

describe('Regression: router skills row must cover dispatcher and goat-star skills', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD.replace(
      '| Skills | `.claude/skills/` |',
      '| Skills | `.claude/skills/goat-*/` |',
    ),
    'package.json': JSON.stringify({
      name: 'router-skills-glob',
      scripts: { test: 'node --test' },
    }),
  });
  const report = scanProject(fs, '/test/router-skills-glob', {
    agentFilter: 'claude',
  });

  it('fails 2.4.3 when the router only points at goat-*', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.4.3');
    assert.ok(check, 'Expected check 2.4.3');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /misses the `goat\/` dispatcher/i);
  });
});

describe('Regression: router must reference handoff template and config', () => {
  const fs = createMockFS({
    'CLAUDE.md': FULL_CLAUDE_MD
      .replace('| Config | `.goat-flow/config.yaml` |\n', '')
      .replace('| Handoff | `.goat-flow/tasks/handoff-template.md` |\n', ''),
    'package.json': JSON.stringify({
      name: 'router-missing-handoff-and-config',
      scripts: { test: 'node --test' },
    }),
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.goat-flow/config.yaml': 'version: 1.0.0\n',
  });
  const report = scanProject(fs, '/test/router-missing-handoff-and-config', {
    agentFilter: 'claude',
  });

  it('fails 2.4.7 when the handoff template path is missing from the router', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.4.7');
    assert.ok(check, 'Expected check 2.4.7');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /\.goat-flow\/tasks\/handoff-template\.md/);
  });

  it('fails 2.4.8 when the config path is missing from the router', () => {
    const check = report.agents[0].checks.find((c) => c.id === '2.4.8');
    assert.ok(check, 'Expected check 2.4.8');
    assert.equal(check.status, 'fail');
    assert.match(check.message, /\.goat-flow\/config\.yaml/);
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
    'package.json': JSON.stringify({
      name: 'goat-flow',
      scripts: { test: 'node --test' },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
    '.gemini/settings.json': JSON.stringify({
      permissions: { deny: ['git commit', 'git push'] },
    }),
    // Skills for all agents (5 required skills)
    ...Object.fromEntries(
      ['debug', 'review', 'plan', 'security', 'test'].flatMap((s) => [
        [
          `.claude/skills/goat-${s}/SKILL.md`,
          `---\nname: goat-${s}\ngoat-flow-skill-version: "${RUBRIC_VERSION}"\n---\n# goat-${s}\n`,
        ],
        [
          `.agents/skills/goat-${s}/SKILL.md`,
          `---\nname: goat-${s}\ngoat-flow-skill-version: "${RUBRIC_VERSION}"\n---\n# goat-${s}\n`,
        ],
      ]),
    ),
    // Hooks
    '.claude/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.claude/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/deny-dangerous.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.gemini/hooks/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    '.codex/rules/deny-dangerous.star':
      '# execpolicy\n# deny git commit\n# deny git push\n',
    'scripts/stop-lint.sh': '#!/usr/bin/env bash\nexit 0\n',
    // Learning loop
    'ai-docs/footguns/':
      '# Footguns\n\n## Footgun: Auth\n\n**Evidence:**\n- `src/auth.ts:42` - broke login\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\n',
    'ai-docs/lessons/':
      '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** something\n\n### Entry 2\n**What happened:** missed test\n\n### Entry 3\n**What happened:** stale ref\n',
    // Architecture
    'ai-docs/architecture.md':
      '# Architecture\n\n' + 'System overview.\n'.repeat(10),
    // Evals
    'ai-docs/evals/README.md': '# Agent Evals\n',
    'ai-docs/evals/eval-1.md':
      '---\nname: eval-1\norigin: real-incident\nagents: all\n---\n\n### Scenario\n\n```\nDo the thing\n```\n',
    'ai-docs/evals/eval-2.md':
      '---\nname: eval-2\norigin: real-incident\nagents: all\n---\n\n### Scenario\n\n```\nDo another thing\n```\n',
    'ai-docs/evals/eval-3.md':
      '---\nname: eval-3\norigin: synthetic-seed\nagents: claude\n---\n\n### Scenario\n\n```\nThird eval\n```\n',
    // CI
    '.github/workflows/context-validation.yml':
      'name: CV\non: [push, pull_request]\njobs:\n  v:\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: bash scripts/context-validate.sh\n      - run: ls .claude/skills/goat-debug/SKILL.md\n',
    // Scripts
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\n',
    'scripts/context-validate.sh': '#!/usr/bin/env bash\n',
    // Misc
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
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

  it('Codex scores B or C (65-100%)', () => {
    assertPercentageRange(report, 'codex', 65, 100, 'self-goat-flow');
  });

  it('Gemini scores C or better (65-100%)', () => {
    assertPercentageRange(report, 'gemini', 65, 100, 'self-goat-flow');
  });

  it('zero false positive anti-patterns on known-good setup', () => {
    for (const agent of report.agents) {
      const triggered = agent.antiPatterns.filter((ap) => ap.triggered);
      assert.equal(
        triggered.length,
        0,
        `${agent.agent}: unexpected anti-patterns: ${triggered.map((t) => `${t.id}(${t.message})`).join(', ')}`,
      );
    }
  });

  it('recommendation keys are stable strings', () => {
    for (const agent of report.agents) {
      for (const rec of agent.recommendations) {
        assert.ok(rec.key, `Recommendation for ${rec.checkId} missing key`);
        assert.ok(
          rec.key.length > 0,
          `Recommendation key for ${rec.checkId} is empty`,
        );
        assert.ok(
          !rec.key.includes(' '),
          `Recommendation key '${rec.key}' contains spaces`,
        );
      }
    }
  });
});

// ─── F1: Regression test corpus ──────────────────────────────────────
// These tests pin specific behaviors so threshold changes are detected.

describe('Regression: full project score stability', () => {
  const REGRESSION_CLAUDE_MD =
    FULL_CLAUDE_MD +
    `
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
      scripts: {
        build: 'tsc',
        test: 'vitest',
        lint: 'eslint .',
        format: 'prettier --write .',
      },
    }),
    '.claude/settings.json': JSON.stringify({
      permissions: {
        deny: [
          'Bash(git commit*)',
          'Bash(git push*)',
          'Read(.env*)',
          'Read(.ssh/**)',
          'Read(.aws/**)',
        ],
      },
      hooks: {
        Stop: [
          { hooks: [{ type: 'command', command: '.claude/hooks/stop-lint.sh' }] },
        ],
        PostToolUse: [
          { matcher: 'Edit|Write', hooks: [{ type: 'command', command: '.claude/hooks/format-file.sh' }] },
        ],
        Notification: [
          { matcher: 'compact', hooks: [{ type: 'command', command: 'echo context' }] },
        ],
      },
    }),
    ...Object.fromEntries(
      ['debug', 'review', 'plan', 'security', 'test'].map((s) => [
        `.claude/skills/goat-${s}/SKILL.md`,
        qualitySkill(s),
      ]),
    ),
    '.claude/skills/goat/SKILL.md': `---\nname: goat\ndescription: "Dispatcher"\ngoat-flow-skill-version: "${RUBRIC_VERSION}"\n---\n# /goat\n\n## How It Works\n\nRoutes to the right skill.\n\n## Constraints\n\n- MUST announce selected skill\n`,
    '.claude/hooks/deny-dangerous.sh':
      '#!/usr/bin/env bash\nset -euo pipefail\nINPUT=$(cat)\nCMD=$(echo "$INPUT" | jq -r .command // empty)\ncase "$CMD" in *rm\\ -rf*|*--force*|*chmod\\ 777*) exit 2;; esac\nexit 0\n',
    '.claude/hooks/stop-lint.sh':
      '#!/usr/bin/env bash\nnpx eslint . --quiet\nexit 0\n',
    '.claude/hooks/format-file.sh':
      '#!/usr/bin/env bash\nINPUT=$(cat)\nFILE_PATH=$(echo "$INPUT" | jq -r \'.file_path // empty\' 2>/dev/null)\n[ -z "$FILE_PATH" ] && exit 0\ncase "$FILE_PATH" in\n  */.claude/*|*/.gemini/*|*/.codex/*|*/.agents/*|*/.github/skills/*) exit 0 ;;\nesac\nprettier --write "$FILE_PATH"\nexit 0\n',
    'ai-docs/footguns/':
      '# Footguns\n\n## Footgun: Auth race\n\n**Evidence type:** ACTUAL_MEASURED\n\n**Evidence:**\n- `src/auth.ts:42` - race condition\n- `src/auth.ts:88` - missing lock\n',
    'src/auth.ts': '// auth module\n',
    'ai-docs/lessons/':
      '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** broke prod deploy\n\n### Entry 2\n**What happened:** missed test coverage\n\n### Entry 3\n**What happened:** stale ref after rename\n',
    'ai-docs/architecture.md':
      '# Architecture\n\n' + 'System overview line.\n'.repeat(8),
    'ai-docs/evals/README.md': '# Agent Evals\n',
    'ai-docs/evals/eval-1.md':
      '---\nname: eval-1\norigin: real-incident\nagents: all\nskill: goat-debug\n---\n\n### Scenario\n\n```\nDo the thing\n```\n',
    'ai-docs/evals/eval-2.md':
      '---\nname: eval-2\norigin: real-incident\nagents: all\nskill: goat-review\n---\n\n### Scenario\n\n```\nDo something\n```\n',
    'ai-docs/evals/eval-3.md':
      '---\nname: eval-3\norigin: synthetic-seed\nagents: claude\nskill: goat-plan\n---\n\n### Scenario\n\n```\nAnother prompt\n```\n',
    'ai-docs/evals/eval-4.md':
      '---\nname: eval-4\norigin: real-incident\nagents: all\nskill: goat-security\n---\n\n### Scenario\n\n```\nCheck auth\n```\n',
    'ai-docs/evals/eval-5.md':
      '---\nname: eval-5\norigin: real-incident\nagents: all\nskill: goat-debug\n---\n\n### Scenario\n\n```\nExplore module\n```\n',
    'ai-docs/evals/eval-6.md':
      '---\nname: eval-6\norigin: real-incident\nagents: all\nskill: goat-test\n---\n\n### Scenario\n\n```\nVerify changes\n```\n',
    'ai-docs/evals/eval-7.md':
      '---\nname: eval-7\norigin: real-incident\nagents: all\nskill: goat-plan\n---\n\n### Scenario\n\n```\nRename across files\n```\n',
    'ai-docs/evals/eval-8.md':
      '---\nname: eval-8\norigin: real-incident\nagents: all\nskill: goat-review\n---\n\n### Scenario\n\n```\nClean up naming\n```\n',
    'ai-docs/evals/eval-9.md':
      '---\nname: eval-9\norigin: real-incident\nagents: all\nskill: goat\n---\n\n### Scenario\n\n```\nRoute intent\n```\n',
    '.github/workflows/context-validation.yml':
      'name: Context Validation\non:\n  pull_request:\n    paths: [CLAUDE.md]\njobs:\n  validate:\n    runs-on: ubuntu-latest\n    steps:\n      - run: wc -l CLAUDE.md\n      - run: bash scripts/context-validate.sh\n      - run: ls .claude/skills/goat-debug/SKILL.md\n',
    'scripts/preflight-checks.sh': '#!/usr/bin/env bash\necho "preflight"\n',
    '.goat-flow/tasks/handoff-template.md': HANDOFF_TEMPLATE,
    '.gitignore': '.env\nsettings.local.json\nnode_modules/\n',
    'docs/system-spec.md': '# System Spec\n',
    'ai-docs/README.md':
      '# Coding Guidelines\n\nSee [Conventions](ai-docs/coding-standards/conventions.md) and [Code Review](ai-docs/coding-standards/code-review.md).\n',
    'ai-docs/coding-standards/conventions.md':
      "# Conventions\n\n## Commands\n\n```bash\nnpm test\n```\n\n## Conventions\n\nDo: use TypeScript\nDon't: use any\n\n" +
      'Line.\n'.repeat(10),
    'ai-docs/coding-standards/code-review.md':
      '# Code Review\n\nReview checklist.\n',
    'ai-docs/coding-standards/git-commit.md':
      '# Git Commit\n\nCommit conventions.\n',
    'CHANGELOG.md': '# Changelog\n\n## v1.0\n\nInitial setup.\n',
    '.goat-flow/config.yaml': 'version: "1.0.0"\nuserRole: developer\n',
    '.goat-flow/config.local.yaml': '# Local overrides\n# userRole: investigator\n',
  });
  const report = scanProject(fs, '/test/regression', { agentFilter: null });

  it('full project scores A or B (80%+)', () => {
    assertValidReport(report, 'regression-full');
    const agent = report.agents.find((a) => a.agent === 'claude');
    assert.ok(agent, 'Claude agent should exist');
    assert.ok(
      agent.score.percentage >= 80,
      `Expected 80%+, got ${agent.score.percentage}%`,
    );
    assert.ok(
      ['A', 'B'].includes(agent.score.grade),
      `Expected A or B, got ${agent.score.grade}`,
    );
  });

  it('has zero anti-pattern deductions', () => {
    const agent = report.agents.find((a) => a.agent === 'claude')!;
    const triggered = agent.antiPatterns.filter((ap) => ap.triggered);
    assert.equal(
      triggered.length,
      0,
      `Expected 0 triggered APs, got: ${triggered.map((a) => a.id).join(', ')}`,
    );
  });

  it('all foundation checks pass', () => {
    const agent = report.agents.find((a) => a.agent === 'claude')!;
    const foundationFails = agent.checks.filter(
      (c) => c.tier === 'foundation' && c.status === 'fail',
    );
    assert.equal(
      foundationFails.length,
      0,
      `Foundation failures: ${foundationFails.map((c) => `${c.id}: ${c.message}`).join(', ')}`,
    );
  });

  it('check count is stable', () => {
    assert.ok(
      report.meta.checkCount >= 95,
      `Expected 95+ checks, got ${report.meta.checkCount}`,
    );
    assert.ok(
      report.meta.antiPatternCount >= 14,
      `Expected 14+ APs, got ${report.meta.antiPatternCount}`,
    );
  });
});

// ─── Regression: tightened checks (Phase 2 scanner honesty) ───────

describe('Regression: 1.1.5 requires project paths in BAD/GOOD examples', () => {
  // PASS: has BAD/GOOD markers AND backtick-wrapped paths with /
  const passFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

## Essential Commands

\`\`\`bash
npm test
\`\`\`

BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read \`docs/system-spec.md:104\` → "Target 120 lines. Hard limit 150."
`,
    'package.json': JSON.stringify({ name: 'test' }),
  });
  const passReport = scanProject(passFs, '/test/1.1.5-pass', { agentFilter: 'claude' });

  it('passes when BAD/GOOD examples reference project paths', () => {
    const check = passReport.agents[0]?.checks.find(c => c.id === '1.1.5');
    assert.ok(check, '1.1.5 not found');
    assert.equal(check.status, 'pass', `Expected pass: ${check.message}`);
  });

  // FAIL: has BAD/GOOD markers but NO backtick-wrapped paths
  const failFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

## Essential Commands

\`\`\`bash
npm test
\`\`\`

BAD:  Writing verbose code
GOOD: Writing concise code
`,
    'package.json': JSON.stringify({ name: 'test' }),
  });
  const failReport = scanProject(failFs, '/test/1.1.5-fail', { agentFilter: 'claude' });

  it('fails when BAD/GOOD examples lack project path references', () => {
    const check = failReport.agents[0]?.checks.find(c => c.id === '1.1.5');
    assert.ok(check, '1.1.5 not found');
    assert.equal(check.status, 'fail', `Expected fail: ${check.message}`);
  });
});

describe('Regression: 1.1.5a requires 2+ resolvable project paths', () => {
  // PASS: router + ask-first have 2+ paths that exist
  const passFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

## Router Table

| Resource | Path |
|----------|------|
| Docs | \`ai-docs/architecture.md\` |
| Config | \`.goat-flow/config.yaml\` |

## Autonomy Tiers

**Ask First** Boundaries:
- \`src/auth.ts\` changes

**Never:** Delete .env
`,
    'package.json': JSON.stringify({ name: 'test' }),
    'ai-docs/architecture.md': '# Arch\n',
    'src/auth.ts': '// auth\n',
  });
  const passReport = scanProject(passFs, '/test/1.1.5a-pass', { agentFilter: 'claude' });

  it('passes with 2+ resolvable paths', () => {
    const check = passReport.agents[0]?.checks.find(c => c.id === '1.1.5a');
    assert.ok(check, '1.1.5a not found');
    assert.equal(check.status, 'pass', `Expected pass: ${check.message}`);
  });

  // FAIL: router paths don't resolve
  const failFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

## Router Table

| Resource | Path |
|----------|------|
| Phantom | \`does/not/exist.md\` |
`,
    'package.json': JSON.stringify({ name: 'test' }),
  });
  const failReport = scanProject(failFs, '/test/1.1.5a-fail', { agentFilter: 'claude' });

  it('fails when no project paths resolve', () => {
    const check = failReport.agents[0]?.checks.find(c => c.id === '1.1.5a');
    assert.ok(check, '1.1.5a not found');
    assert.equal(check.status, 'fail', `Expected fail: ${check.message}`);
  });
});

describe('Regression: 1.2.6 LOG step paths must exist on disk', () => {
  // PASS: LOG mentions lessons/ and the dir exists
  const passFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

**LOG** - MUST update when tripped. lessons/ and footguns/ entries.

| File | When |
|------|------|
| \`ai-docs/lessons/\` | mistakes |
| \`ai-docs/footguns/\` | traps |
`,
    'package.json': JSON.stringify({ name: 'test' }),
    'ai-docs/lessons/': '# Lessons\n\n### E1\nStuff.\n',
    'ai-docs/footguns/': '# Footguns\n\n- `src/x.ts:1` - evidence\n',
  });
  const passReport = scanProject(passFs, '/test/1.2.6-pass', { agentFilter: 'claude' });

  it('passes when LOG step paths exist', () => {
    const check = passReport.agents[0]?.checks.find(c => c.id === '1.2.6');
    assert.ok(check, '1.2.6 not found');
    assert.equal(check.status, 'pass', `Expected pass: ${check.message}`);
  });

  // FAIL: LOG mentions lessons/ but dirs don't exist
  const failFs = createMockFS({
    'CLAUDE.md': `# CLAUDE.md - v1.0

**LOG** - MUST update when tripped. lessons/ and footguns/ entries.
`,
    'package.json': JSON.stringify({ name: 'test' }),
  });
  const failReport = scanProject(failFs, '/test/1.2.6-fail', { agentFilter: 'claude' });

  it('fails when LOG step paths do not exist', () => {
    const check = failReport.agents[0]?.checks.find(c => c.id === '1.2.6');
    assert.ok(check, '1.2.6 not found');
    assert.equal(check.status, 'fail', `Expected fail: ${check.message}`);
  });
});

describe('Regression: 1.5.1 deny mechanism requires 3+ patterns', () => {
  // PASS: 3 deny patterns in settings
  const passFs = createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n',
    'package.json': JSON.stringify({ name: 'test' }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)', 'Bash(rm -rf*)'] },
    }),
  });
  const passReport = scanProject(passFs, '/test/1.5.1-pass', { agentFilter: 'claude' });

  it('passes with 3+ deny patterns', () => {
    const check = passReport.agents[0]?.checks.find(c => c.id === '1.5.1');
    assert.ok(check, '1.5.1 not found');
    assert.equal(check.status, 'pass', `Expected pass: ${check.message}`);
    assert.equal(check.points, 3);
  });

  // PARTIAL: 2 deny patterns
  const partialFs = createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n',
    'package.json': JSON.stringify({ name: 'test' }),
    '.claude/settings.json': JSON.stringify({
      permissions: { deny: ['Bash(git commit*)', 'Bash(git push*)'] },
    }),
  });
  const partialReport = scanProject(partialFs, '/test/1.5.1-partial', { agentFilter: 'claude' });

  it('gives partial credit with 1-2 deny patterns', () => {
    const check = partialReport.agents[0]?.checks.find(c => c.id === '1.5.1');
    assert.ok(check, '1.5.1 not found');
    assert.equal(check.status, 'partial', `Expected partial: ${check.message}`);
    assert.equal(check.points, 1);
  });

  // FAIL: no deny patterns
  const failFs = createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n',
    'package.json': JSON.stringify({ name: 'test' }),
  });
  const failReport = scanProject(failFs, '/test/1.5.1-fail', { agentFilter: 'claude' });

  it('fails with no deny mechanism', () => {
    const check = failReport.agents[0]?.checks.find(c => c.id === '1.5.1');
    assert.ok(check, '1.5.1 not found');
    assert.equal(check.status, 'fail', `Expected fail: ${check.message}`);
    assert.equal(check.points, 0);
  });
});

describe('Regression: 2.1.12 requires Step 0 AND constraints', () => {
  // PASS: skills have both Step 0 and Constraints
  const skillWithBoth = (name: string) => `---
name: goat-${name}
goat-flow-skill-version: "${RUBRIC_VERSION}"
---
# goat-${name}

## Step 0 - Gather Context

Ask the user before starting.

## Constraints

- MUST gather context before acting
- MUST provide file:line evidence
`;
  const passFs = createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n',
    'package.json': JSON.stringify({ name: 'test' }),
    ...Object.fromEntries(
      ['debug', 'review', 'plan', 'security', 'test'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`,
        skillWithBoth(s),
      ]),
    ),
  });
  const passReport = scanProject(passFs, '/test/2.1.12-pass', { agentFilter: 'claude' });

  it('passes when skills have both Step 0 and constraints', () => {
    const check = passReport.agents[0]?.checks.find(c => c.id === '2.1.12');
    assert.ok(check, '2.1.12 not found');
    assert.equal(check.status, 'pass', `Expected pass: ${check.message}`);
  });

  // FAIL: skills have Step 0 but no Constraints
  const skillNoConstraints = (name: string) => `---
name: goat-${name}
goat-flow-skill-version: "${RUBRIC_VERSION}"
---
# goat-${name}

## Step 0 - Gather Context

Ask the user before starting.

## Phase 1

Do the thing.
`;
  const failFs = createMockFS({
    'CLAUDE.md': '# CLAUDE.md\n',
    'package.json': JSON.stringify({ name: 'test' }),
    ...Object.fromEntries(
      ['debug', 'review', 'plan', 'security', 'test'].map(s => [
        `.claude/skills/goat-${s}/SKILL.md`,
        skillNoConstraints(s),
      ]),
    ),
  });
  const failReport = scanProject(failFs, '/test/2.1.12-fail', { agentFilter: 'claude' });

  it('fails when skills lack constraints (scope confirmation)', () => {
    const check = failReport.agents[0]?.checks.find(c => c.id === '2.1.12');
    assert.ok(check, '2.1.12 not found');
    assert.equal(check.status, 'fail', `Expected fail: ${check.message}`);
  });
});

describe('Regression: minimal project scores F', () => {
  const fs = createMockFS({
    'CLAUDE.md': MINIMAL_CLAUDE_MD,
    'package.json': JSON.stringify({ name: 'minimal' }),
  });
  const report = scanProject(fs, '/test/regression-minimal', {
    agentFilter: null,
  });

  it('minimal project scores D or F', () => {
    const agent = report.agents.find((a) => a.agent === 'claude');
    assert.ok(agent, 'Claude agent should exist');
    assert.ok(
      agent.score.percentage < 50,
      `Expected <50%, got ${agent.score.percentage}%`,
    );
  });

  it('has many recommendations', () => {
    const agent = report.agents.find((a) => a.agent === 'claude')!;
    assert.ok(
      agent.recommendations.length >= 10,
      `Expected 10+ recommendations, got ${agent.recommendations.length}`,
    );
  });
});
