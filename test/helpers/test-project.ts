import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const EXPECTED_SKILLS = [
  'preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test',
] as const;

/**
 * Builder for creating real temporary project directories for integration tests.
 */
export class TestProject {
  private files: Map<string, string> = new Map();

  withFile(path: string, content: string): this {
    this.files.set(path, content);
    return this;
  }

  withInstructionFile(agent: 'claude' | 'codex' | 'gemini', content: string): this {
    const filename = { claude: 'CLAUDE.md', codex: 'AGENTS.md', gemini: 'GEMINI.md' }[agent];
    return this.withFile(filename, content);
  }

  withSettings(agent: 'claude' | 'gemini', settings: object): this {
    const path = agent === 'claude' ? '.claude/settings.json' : '.gemini/settings.json';
    return this.withFile(path, JSON.stringify(settings, null, 2));
  }

  withSkills(agent: 'claude' | 'codex' | 'gemini', names?: readonly string[]): this {
    const dir = agent === 'claude' ? '.claude/skills' : '.agents/skills';
    const skillNames = names ?? EXPECTED_SKILLS;
    for (const name of skillNames) {
      this.withFile(
        `${dir}/goat-${name}/SKILL.md`,
        `---\nname: goat-${name}\ndescription: "${name}"\n---\n# goat-${name}\n\n## When to Use\n\nUse for ${name}.\n\n## Process\n\n1. Do the thing.\n\n## Output\n\nResults.\n`
      );
    }
    return this;
  }

  withHooks(agent: 'claude' | 'gemini'): this {
    const dir = agent === 'claude' ? '.claude/hooks' : '.gemini/hooks';
    this.withFile(`${dir}/deny-dangerous.sh`, '#!/usr/bin/env bash\nexit 0\n');
    this.withFile(`${dir}/stop-lint.sh`, '#!/usr/bin/env bash\nexit 0\n');
    return this;
  }

  withLearningLoop(): this {
    this.withFile('docs/footguns.md', '# Footguns\n\n## Footgun: Example\n\n**Evidence:**\n- `src/auth.ts:42` - broke login\n');
    this.withFile('docs/lessons.md', '# Lessons\n\n## Entries\n\n### Entry 1\n**What happened:** something\n\n**created_at:** 2026-01-01\n');
    return this;
  }

  withEvals(count: number = 3): this {
    this.withFile('agent-evals/README.md', '# Agent Evals\n');
    for (let i = 1; i <= count; i++) {
      this.withFile(
        `agent-evals/eval-${i}.md`,
        `# Eval ${i}\n\n**Origin:** real-incident\n**Agents:** all\n\n## Replay Prompt\n\n\`\`\`\nDo the thing\n\`\`\`\n`
      );
    }
    return this;
  }

  withArchitecture(): this {
    return this.withFile('docs/architecture.md', '# Architecture\n\n' + 'System overview.\n'.repeat(10));
  }

  withHandoff(): this {
    return this.withFile('tasks/handoff-template.md', '# Handoff Template\n');
  }

  create(): { root: string; cleanup: () => void } {
    const root = mkdtempSync(join(tmpdir(), 'goat-flow-test-'));

    for (const [path, content] of this.files) {
      const fullPath = join(root, path);
      mkdirSync(dirname(fullPath), { recursive: true });
      writeFileSync(fullPath, content);
    }

    return {
      root,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    };
  }
}
