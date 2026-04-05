/**
 * Temporary on-disk project builder for integration tests.
 * Use it when a test needs real files, directories, and shell-visible paths rather than the mock filesystem.
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const EXPECTED_SKILLS = [
  'preflight',
  'debug',
  'audit',
  'review',
  'plan',
  'test',
] as const;

/**
 * Builder for creating real temporary project directories for integration tests.
 */
export class TestProject {
  private files: Map<string, string> = new Map();

  /** Queue an arbitrary file to be written into the temporary test project. */
  withFile(path: string, content: string): this {
    this.files.set(path, content);
    return this;
  }

  /** Add the root instruction file for the requested agent. */
  withInstructionFile(
    agent: 'claude' | 'codex' | 'gemini',
    content: string,
  ): this {
    const filename = {
      claude: 'CLAUDE.md',
      codex: 'AGENTS.md',
      gemini: 'GEMINI.md',
    }[agent];
    return this.withFile(filename, content);
  }

  /** Add a JSON settings file for agents that support one. */
  withSettings(agent: 'claude' | 'gemini', settings: object): this {
    const path =
      agent === 'claude' ? '.claude/settings.json' : '.gemini/settings.json';
    return this.withFile(path, JSON.stringify(settings, null, 2));
  }

  /** Add a minimal installed-skill set for the requested agent. */
  withSkills(
    agent: 'claude' | 'codex' | 'gemini',
    names?: readonly string[],
  ): this {
    const dir = agent === 'claude' ? '.claude/skills' : '.agents/skills';
    const skillNames = names ?? EXPECTED_SKILLS;
    for (const name of skillNames) {
      this.withFile(
        `${dir}/goat-${name}/SKILL.md`,
        `---\nname: goat-${name}\ndescription: "${name}"\n---\n# goat-${name}\n\n## When to Use\n\nUse for ${name}.\n\n## Process\n\n1. Do the thing.\n\n## Output\n\nResults.\n`,
      );
    }
    return this;
  }

  /** Add minimal deny and post-turn hooks for the requested agent. */
  withHooks(agent: 'claude' | 'gemini'): this {
    const dir = agent === 'claude' ? '.claude/hooks' : '.gemini/hooks';
    this.withFile(`${dir}/deny-dangerous.sh`, '#!/usr/bin/env bash\nexit 0\n');
    this.withFile(`${dir}/stop-lint.sh`, '#!/usr/bin/env bash\nexit 0\n');
    return this;
  }

  /** Add the minimal goat-flow config, footguns, and lessons needed by scanner tests. */
  withLearningLoop(): this {
    this.withFile(
      '.goat-flow/config.yaml',
      'version: "1.0.0"\nfootguns:\n  committed: ai-docs/footguns/\n  local: .goat-flow/footguns/\nlessons:\n  committed: ai-docs/lessons/\n  local: .goat-flow/lessons/\ndecisions:\n  path: ai-docs/decisions/\ntasks:\n  path: .goat-flow/tasks/\nskills:\n  install: all\n',
    );
    this.withFile('ai-docs/footguns/README.md', '# Footguns\n');
    this.withFile(
      'ai-docs/footguns/example.md',
      '---\nname: Example footgun\nstatus: active\ncreated: 2026-01-01\nevidence_type: ACTUAL_MEASURED\n---\n\n**Evidence:**\n- `src/auth.ts:42` - broke login\n',
    );
    this.withFile('ai-docs/lessons/README.md', '# Lessons\n');
    this.withFile(
      'ai-docs/lessons/2026-01-01-entry-1.md',
      '---\nname: Entry 1\ncreated: 2026-01-01\n---\n\n**What happened:** something\n',
    );
    return this;
  }

  /** Add a small eval corpus under `ai-docs/evals/`. */
  withEvals(count: number = 3): this {
    this.withFile('ai-docs/evals/README.md', '# Agent Evals\n');
    for (let i = 1; i <= count; i++) {
      this.withFile(
        `ai-docs/evals/eval-${i}.md`,
        `# Eval ${i}\n\n**Origin:** real-incident\n**Agents:** all\n\n## Replay Prompt\n\n\`\`\`\nDo the thing\n\`\`\`\n`,
      );
    }
    return this;
  }

  /** Add a non-trivial architecture document. */
  withArchitecture(): this {
    return this.withFile(
      'ai-docs/architecture.md',
      '# Architecture\n\n' + 'System overview.\n'.repeat(10),
    );
  }

  /** Add the shared handoff template expected by scanner checks. */
  withHandoff(): this {
    return this.withFile(
      '.goat-flow/tasks/handoff-template.md',
      '# Handoff Template\n\n## Date\n\n## Status\n\n## Current State\n\n## Key Decisions\n\n## Errors & Corrections\n\n## Learnings\n\n## Known Risks\n\n## Next Step\n\n## Context Files\n',
    );
  }

  /** Materialize the queued files into a temporary directory and return a cleanup hook. */
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
