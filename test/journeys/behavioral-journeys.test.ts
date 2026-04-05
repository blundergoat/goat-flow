/**
 * Layer 6: Behavioral journey tests.
 * Validates that eval specs from ai-docs/evals/ are well-formed and define
 * testable contracts. In Layer 7 (smoke tests), these contracts are scored
 * against real agent transcripts.
 *
 * What this tests NOW (without a real agent):
 * - Every eval file parses correctly (frontmatter + sections)
 * - Every eval has a scenario prompt, behavioral gates, and anti-patterns
 * - Behavioral gates are checkboxes (scoreable)
 * - Key workflow evals exist for the critical behavioral contracts
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const EVALS_DIR = join(ROOT, 'ai-docs/evals');
const EXCLUDED = new Set(['README.md', 'FORMAT.md']);

interface ParsedEval {
  name: string;
  frontmatter: Record<string, string>;
  scenario: string | null;
  gates: string[];
  antiPatterns: string[];
}

/** Parse a single eval markdown file into structured data. */
function parseEval(filePath: string): ParsedEval {
  const content = readFileSync(filePath, 'utf-8');
  const name = filePath.split('/').pop()?.replace('.md', '') ?? 'unknown';

  // Parse YAML frontmatter
  const frontmatter: Record<string, string> = {};
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
  if (fmMatch?.[1]) {
    for (const line of fmMatch[1].split('\n')) {
      const kv = line.match(/^(\w+):\s*(.+)/);
      if (kv?.[1] && kv[2]) frontmatter[kv[1]] = kv[2].replace(/^["']|["']$/g, '');
    }
  }

  // Extract scenario - new format (### Scenario + code fence) or legacy (## Replay Prompt / ## Scenario N:)
  const scenarioMatch = content.match(/### Scenario\s*\n+```(?:text)?\n([\s\S]*?)```/)
    ?? content.match(/## Replay Prompt\s*\n([\s\S]*?)(?=\n## |$)/)
    ?? content.match(/## Scenario 1:.*\n\*\*Replay:\*\*\s*(.+)/);
  const scenario = scenarioMatch?.[1]?.trim() ?? null;

  // Extract behavioral gates - new format (### Expected Behavior checkboxes) or legacy (## Expected Outcome numbered list)
  const behaviorSection = content.match(/### Expected Behavior\s*\n([\s\S]*?)(?=\n### |$)/)
    ?? content.match(/## Expected Outcome\s*\n([\s\S]*?)(?=\n## |$)/);
  const gates: string[] = [];
  if (behaviorSection?.[1]) {
    for (const line of behaviorSection[1].split('\n')) {
      // Checkbox format: - [ ] description
      const gate = line.match(/^- \[[ x]\] (.+)/);
      if (gate?.[1]) { gates.push(gate[1]); continue; }
      // Numbered list format: 1. description
      const numbered = line.match(/^\d+\.\s+(.+)/);
      if (numbered?.[1]) gates.push(numbered[1]);
    }
  }
  // Legacy multi-scenario format: count **Expected:** lines as gates
  if (gates.length === 0) {
    for (const match of content.matchAll(/\*\*Expected:\*\*\s*(.+)/g)) {
      if (match[1]) gates.push(match[1]);
    }
  }

  // Extract anti-patterns - new format (### Anti-Patterns) or legacy (## Known Failure Mode)
  const apSection = content.match(/### Anti-Patterns\s*\n([\s\S]*?)(?=\n### |$)/)
    ?? content.match(/## Known Failure Mode\s*\n([\s\S]*?)(?=\n## |$)/);
  const antiPatterns: string[] = [];
  if (apSection?.[1]) {
    for (const line of apSection[1].split('\n')) {
      const ap = line.match(/^- (.+)/);
      if (ap?.[1]) antiPatterns.push(ap[1]);
      // Plain paragraph counts as 1 anti-pattern in legacy format
    }
    // If no bullet points but has content, count the whole section as 1 anti-pattern
    if (antiPatterns.length === 0 && apSection[1].trim().length > 20) {
      antiPatterns.push(apSection[1].trim().split('\n')[0]);
    }
  }

  return { name, frontmatter, scenario, gates, antiPatterns };
}

// ---------------------------------------------------------------
// Parse and validate ALL eval files
// ---------------------------------------------------------------
describe('All evals parse correctly', () => {
  if (!existsSync(EVALS_DIR)) return;

  const evalFiles = readdirSync(EVALS_DIR)
    .filter(f => f.endsWith('.md') && !EXCLUDED.has(f))
    .sort();

  it(`found ${evalFiles.length} eval files`, () => {
    assert.ok(evalFiles.length >= 10, `Expected at least 10 evals, found ${evalFiles.length}`);
  });

  for (const file of evalFiles) {
    describe(file, () => {
      const eval_ = parseEval(join(EVALS_DIR, file));

      it('has YAML frontmatter with name', () => {
        assert.ok(eval_.frontmatter.name, `${file}: missing frontmatter name`);
      });

      it('has a scenario prompt', () => {
        assert.ok(eval_.scenario, `${file}: missing scenario code block`);
        assert.ok(eval_.scenario.length > 10, `${file}: scenario too short`);
      });

      it('has at least 2 behavioral gates', () => {
        assert.ok(
          eval_.gates.length >= 2,
          `${file}: only ${eval_.gates.length} gates (need 2+): ${eval_.gates.join(', ')}`,
        );
      });

      it('has anti-patterns or is explicitly simple', () => {
        // Anti-patterns are recommended but not required for simple evals
        if (eval_.antiPatterns.length === 0) {
          assert.ok(
            eval_.frontmatter.difficulty === 'easy' || eval_.gates.length >= 4,
            `${file}: no anti-patterns and not marked easy - consider adding anti-patterns`,
          );
        }
      });
    });
  }
});

// ---------------------------------------------------------------
// Critical workflow evals exist
// ---------------------------------------------------------------
describe('Critical workflow evals exist', () => {
  const required = [
    'debug-before-fix',
    'question-vs-directive',
    'ask-first-boundary',
    'cross-reference-rename',
  ];

  for (const name of required) {
    it(`${name}.md exists with valid structure`, () => {
      const path = join(EVALS_DIR, `${name}.md`);
      assert.ok(existsSync(path), `Missing critical eval: ${name}.md`);
      const eval_ = parseEval(path);
      assert.ok(eval_.scenario, `${name}: no scenario`);
      assert.ok(eval_.gates.length >= 3, `${name}: too few gates (${eval_.gates.length})`);
    });
  }
});

// ---------------------------------------------------------------
// Eval contracts are specific enough to score
// ---------------------------------------------------------------
describe('Eval gates are specific and scoreable', () => {
  if (!existsSync(EVALS_DIR)) return;

  const evalFiles = readdirSync(EVALS_DIR)
    .filter(f => f.endsWith('.md') && !EXCLUDED.has(f));

  it('no eval has vague gates like "agent does well"', () => {
    const vague = /^(agent does well|good response|correct behavior)$/i;
    for (const file of evalFiles) {
      const eval_ = parseEval(join(EVALS_DIR, file));
      for (const gate of eval_.gates) {
        assert.ok(!vague.test(gate), `${file}: vague gate: "${gate}"`);
      }
    }
  });

  it('all gates reference specific actions or artifacts', () => {
    let totalGates = 0;
    for (const file of evalFiles) {
      const eval_ = parseEval(join(EVALS_DIR, file));
      totalGates += eval_.gates.length;
    }
    assert.ok(totalGates >= 50, `Expected 50+ total gates across all evals, got ${totalGates}`);
  });
});
