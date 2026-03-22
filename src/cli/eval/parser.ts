/**
 * Parses eval markdown files into structured objects.
 *
 * Supports two formats:
 * - New format: YAML frontmatter with --- delimiters, structured sections
 * - Legacy format: Markdown headers with **Key:** value metadata
 *
 * Legacy evals (without frontmatter) get sensible defaults for missing fields.
 */

import type {
  ParsedEval,
  EvalFrontmatter,
  BehavioralGate,
  EvalOrigin,
  EvalAgents,
  EvalDifficulty,
  EvalSkill,
} from './types.js';

// --- Frontmatter parsing ---

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

function parseFrontmatter(raw: string): EvalFrontmatter | null {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return null;

  const block = match[1];
  const fields = new Map<string, string>();

  for (const line of block.split('\n')) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    fields.set(key, val);
  }

  const name = fields.get('name') ?? '';
  const description = fields.get('description') ?? '';
  const origin = validateOrigin(fields.get('origin'));
  const agents = validateAgents(fields.get('agents'));
  const skill = validateSkill(fields.get('skill'));
  const difficulty = validateDifficulty(fields.get('difficulty'));

  if (!name) return null;

  return { name, description, origin, agents, skill, difficulty };
}

function validateOrigin(val: string | undefined): EvalOrigin {
  if (val === 'real-incident' || val === 'synthetic-seed') return val;
  return 'synthetic-seed';
}

function validateAgents(val: string | undefined): EvalAgents {
  if (val === 'all' || val === 'claude' || val === 'codex' || val === 'gemini') return val;
  return 'all';
}

function validateSkill(val: string | undefined): EvalSkill | null {
  const valid: EvalSkill[] = [
    'goat-debug', 'goat-audit', 'goat-review', 'goat-investigate',
    'goat-plan', 'goat-test', 'goat-security', 'goat-reflect',
    'goat-onboard', 'goat-resume',
  ];
  if (val && valid.includes(val as EvalSkill)) return val as EvalSkill;
  return null;
}

function validateDifficulty(val: string | undefined): EvalDifficulty {
  if (val === 'easy' || val === 'medium' || val === 'hard') return val;
  return 'medium';
}

// --- Legacy format parsing ---

function parseLegacyFrontmatter(raw: string, filename: string): EvalFrontmatter {
  // Extract **Origin:** and **Agents:** from markdown body
  const originMatch = raw.match(/\*\*Origin:\*\*\s*`?([^`\n]+)`?/);
  const agentsMatch = raw.match(/\*\*Agents:\*\*\s*`?([^`\n]+)`?/);
  const titleMatch = raw.match(/^#\s+Eval:\s*(.+)/m);

  const origin = validateOrigin(originMatch?.[1]?.trim());
  const agents = validateAgents(agentsMatch?.[1]?.trim());
  const name = filename.replace(/\.md$/, '');
  const description = titleMatch?.[1]?.trim() ?? '';

  return {
    name,
    description,
    origin,
    agents,
    skill: null,
    difficulty: 'medium',
  };
}

// --- Section extraction ---

function extractSection(raw: string, heading: string): string {
  // Match ## Heading or ### Heading, case-insensitive
  const pattern = new RegExp(
    `^#{2,3}\\s+${escapeRegex(heading)}\\s*$`,
    'im',
  );
  const match = raw.match(pattern);
  if (!match || match.index === undefined) return '';

  const start = match.index + match[0].length;
  // Find next heading of same or higher level
  const rest = raw.slice(start);
  const nextHeading = rest.match(/^#{1,3}\s+/m);
  const end = nextHeading?.index ?? rest.length;

  return rest.slice(0, end).trim();
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Behavioral gates ---

function parseGates(section: string): BehavioralGate[] {
  const gates: BehavioralGate[] = [];
  // Match lines like: - [ ] Text or - [x] Text or numbered list items
  const lines = section.split('\n');

  for (const line of lines) {
    const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      gates.push({
        text: checkboxMatch[2].trim(),
        status: checkboxMatch[1] === ' ' ? 'fail' : 'pass',
      });
      continue;
    }
    // Also match numbered list items (legacy: "1. Agent enters Debug mode")
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      gates.push({
        text: numberedMatch[1].trim(),
        status: 'fail', // Unchecked by default
      });
    }
  }

  return gates;
}

// --- Anti-patterns ---

function parseAntiPatterns(section: string): string[] {
  const patterns: string[] = [];
  const lines = section.split('\n');

  for (const line of lines) {
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      patterns.push(bulletMatch[1].trim());
    }
  }

  return patterns;
}

// --- Main parser ---

export function parseEvalFile(raw: string, filename: string): ParsedEval {
  const hasFrontmatter = FRONTMATTER_RE.test(raw);

  let frontmatter: EvalFrontmatter;
  let body: string;

  if (hasFrontmatter) {
    const parsed = parseFrontmatter(raw);
    if (!parsed) {
      throw new Error(`Invalid frontmatter in ${filename}`);
    }
    frontmatter = parsed;
    body = raw.replace(FRONTMATTER_RE, '').trim();
  } else {
    frontmatter = parseLegacyFrontmatter(raw, filename);
    body = raw;
  }

  // Extract sections (try both new and legacy heading names)
  const scenario =
    extractSection(body, 'Scenario') ||
    extractSection(body, 'Replay Prompt') ||
    '';

  const expectedSection =
    extractSection(body, 'Expected Behavior') ||
    extractSection(body, 'Expected Behaviour') ||
    extractSection(body, 'Expected Outcome') ||
    '';

  const antiPatternSection =
    extractSection(body, 'Anti-Patterns') ||
    extractSection(body, 'Known Failure Mode') ||
    '';

  const expectedBehaviors = parseGates(expectedSection);
  const antiPatterns = parseAntiPatterns(antiPatternSection);

  // If anti-pattern section has no bullets, treat the whole text as one item
  if (antiPatterns.length === 0 && antiPatternSection.length > 0) {
    antiPatterns.push(antiPatternSection);
  }

  return {
    file: filename,
    frontmatter,
    scenario: extractScenarioText(scenario),
    expectedBehaviors,
    antiPatterns,
  };
}

/** Strip code fences from scenario text if present. */
function extractScenarioText(raw: string): string {
  // Remove ```text ... ``` or ``` ... ``` wrapper
  const fenceMatch = raw.match(/```(?:text)?\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1].trim();
  return raw.trim();
}
