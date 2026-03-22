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

/** Regex to match YAML frontmatter delimited by --- lines */
const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---/;

/** Parse YAML frontmatter block into a structured EvalFrontmatter object */
function parseFrontmatter(raw: string): EvalFrontmatter | null {
  /** Regex match result for the frontmatter block */
  const match = raw.match(FRONTMATTER_RE);
  if (match == null) return null;

  /** Raw text content between the --- delimiters */
  const block = match[1];
  /** Map of key-value pairs extracted from the frontmatter lines */
  const fields = new Map<string, string>();

  if (block == null) return null;
  // Iterate over each line in the frontmatter block to extract key-value pairs
  for (const line of block.split('\n')) {
    /** Index of the first colon separator in the line */
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    /** Trimmed key portion before the colon */
    const key = line.slice(0, idx).trim();
    /** Trimmed value portion after the colon, with surrounding quotes stripped */
    const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
    fields.set(key, val);
  }

  /** Eval name from frontmatter, empty string if missing */
  const name = fields.get('name') ?? '';
  /** Eval description from frontmatter, empty string if missing */
  const description = fields.get('description') ?? '';
  /** Validated origin field (real-incident or synthetic-seed) */
  const origin = validateOrigin(fields.get('origin'));
  /** Validated agents field (all, claude, codex, or gemini) */
  const agents = validateAgents(fields.get('agents'));
  /** Validated skill field, or null if unrecognized */
  const skill = validateSkill(fields.get('skill'));
  /** Validated difficulty field (easy, medium, or hard) */
  const difficulty = validateDifficulty(fields.get('difficulty'));

  if (name === '') return null;

  return { name, description, origin, agents, skill, difficulty };
}

/** Validate and normalize an origin value, defaulting to synthetic-seed */
function validateOrigin(val: string | undefined): EvalOrigin {
  if (val === 'real-incident' || val === 'synthetic-seed') return val;
  return 'synthetic-seed';
}

/** Validate and normalize an agents value, defaulting to all */
function validateAgents(val: string | undefined): EvalAgents {
  if (val === 'all' || val === 'claude' || val === 'codex' || val === 'gemini') return val;
  return 'all';
}

/** Validate a skill value against the known skill list, returning null if invalid */
function validateSkill(val: string | undefined): EvalSkill | null {
  /** List of all recognized GOAT Flow skill identifiers */
  const valid: EvalSkill[] = [
    'goat-debug', 'goat-audit', 'goat-review', 'goat-investigate',
    'goat-plan', 'goat-test', 'goat-security', 'goat-reflect',
    'goat-onboard', 'goat-resume',
  ];
  if (val && valid.includes(val as EvalSkill)) return val as EvalSkill;
  return null;
}

/** Validate and normalize a difficulty value, defaulting to medium */
function validateDifficulty(val: string | undefined): EvalDifficulty {
  if (val === 'easy' || val === 'medium' || val === 'hard') return val;
  return 'medium';
}

// --- Legacy format parsing ---

/** Parse legacy eval format (no frontmatter) by extracting metadata from markdown body */
function parseLegacyFrontmatter(raw: string, filename: string): EvalFrontmatter {
  // Extract **Origin:** and **Agents:** from markdown body
  /** Regex match for the **Origin:** metadata line */
  const originMatch = raw.match(/\*\*Origin:\*\*\s*`?([^`\n]+)`?/);
  /** Regex match for the **Agents:** metadata line */
  const agentsMatch = raw.match(/\*\*Agents:\*\*\s*`?([^`\n]+)`?/);
  /** Regex match for the # Eval: title heading */
  const titleMatch = raw.match(/^#\s+Eval:\s*(.+)/m);

  /** Validated origin extracted from the markdown body */
  const origin = validateOrigin(originMatch?.[1]?.trim());
  /** Validated agents extracted from the markdown body */
  const agents = validateAgents(agentsMatch?.[1]?.trim());
  /** Eval name derived from the filename without .md extension */
  const name = filename.replace(/\.md$/, '');
  /** Eval description extracted from the title heading */
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

/** Extract the text content under a given heading from a markdown document */
function extractSection(raw: string, heading: string): string {
  // Match ## Heading or ### Heading, case-insensitive
  /** Regex pattern to locate the target heading at level 2 or 3 */
  const pattern = new RegExp(
    `^#{2,3}\\s+${escapeRegex(heading)}\\s*$`,
    'im',
  );
  /** Regex match result for the heading location */
  const match = raw.match(pattern);
  if (match == null || match.index === undefined) return '';

  /** Character offset where section content begins (after the heading) */
  const start = match.index + match[0].length;
  // Find next heading of same or higher level
  /** Remaining text after the matched heading */
  const rest = raw.slice(start);
  /** Match for the next heading that terminates this section */
  const nextHeading = rest.match(/^#{1,3}\s+/m);
  /** Character offset where the section content ends */
  const end = nextHeading?.index ?? rest.length;

  return rest.slice(0, end).trim();
}

/** Escape special regex characters in a string for safe use in RegExp */
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// --- Behavioral gates ---

/** Parse a section's checkbox and numbered list items into BehavioralGate objects */
function parseGates(section: string): BehavioralGate[] {
  /** Accumulator for parsed behavioral gate entries */
  const gates: BehavioralGate[] = [];
  // Match lines like: - [ ] Text or - [x] Text or numbered list items
  /** Individual lines of the section to scan for gate patterns */
  const lines = section.split('\n');

  // Iterate over each line to detect checkbox or numbered list gate entries
  for (const line of lines) {
    /** Regex match for markdown checkbox syntax (- [ ] or - [x]) */
    const checkboxMatch = line.match(/^[-*]\s+\[([ xX])\]\s+(.+)/);
    if (checkboxMatch) {
      gates.push({
        text: checkboxMatch[2]!.trim(),
        status: checkboxMatch[1] === ' ' ? 'fail' : 'pass',
      });
      continue;
    }
    // Also match numbered list items (legacy: "1. Agent enters Debug mode")
    /** Regex match for numbered list item syntax */
    const numberedMatch = line.match(/^\d+\.\s+(.+)/);
    if (numberedMatch) {
      gates.push({
        text: numberedMatch[1]!.trim(),
        // Unchecked by default
        status: 'fail',
      });
    }
  }

  return gates;
}

// --- Anti-patterns ---

/** Parse bullet-list items from a section into an array of anti-pattern strings */
function parseAntiPatterns(section: string): string[] {
  /** Accumulator for extracted anti-pattern text items */
  const patterns: string[] = [];
  /** Individual lines of the section to scan for bullet items */
  const lines = section.split('\n');

  // Iterate over each line to extract bulleted anti-pattern entries
  for (const line of lines) {
    /** Regex match for markdown bullet list syntax */
    const bulletMatch = line.match(/^[-*]\s+(.+)/);
    if (bulletMatch) {
      patterns.push(bulletMatch[1]!.trim());
    }
  }

  return patterns;
}

// --- Main parser ---

/** Parse a raw eval markdown file into a structured ParsedEval object */
export function parseEvalFile(raw: string, filename: string): ParsedEval {
  /** Whether the raw content starts with YAML frontmatter delimiters */
  const hasFrontmatter = FRONTMATTER_RE.test(raw);

  let frontmatter: EvalFrontmatter;
  let body: string;

  if (hasFrontmatter) {
    /** Parsed frontmatter from the new-format eval file */
    const parsed = parseFrontmatter(raw);
    if (parsed == null) {
      throw new Error(`Invalid frontmatter in ${filename}`);
    }
    frontmatter = parsed;
    body = raw.replace(FRONTMATTER_RE, '').trim();
  } else {
    frontmatter = parseLegacyFrontmatter(raw, filename);
    body = raw;
  }

  // Extract sections (try both new and legacy heading names)
  /** Scenario text extracted from Scenario or Replay Prompt heading */
  const scenario =
    extractSection(body, 'Scenario') ||
    extractSection(body, 'Replay Prompt') ||
    '';

  /** Expected behavior section extracted from various heading name variants */
  const expectedSection =
    extractSection(body, 'Expected Behavior') ||
    extractSection(body, 'Expected Behaviour') ||
    extractSection(body, 'Expected Outcome') ||
    '';

  /** Anti-pattern section extracted from Anti-Patterns or Known Failure Mode heading */
  const antiPatternSection =
    extractSection(body, 'Anti-Patterns') ||
    extractSection(body, 'Known Failure Mode') ||
    '';

  /** Parsed behavioral gates from the expected behavior section */
  const expectedBehaviors = parseGates(expectedSection);
  /** Parsed anti-pattern strings from the anti-pattern section */
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

/** Strip code fences from scenario text if present */
function extractScenarioText(raw: string): string {
  // Remove ```text ... ``` or ``` ... ``` wrapper
  /** Regex match for code fence blocks wrapping the scenario text */
  const fenceMatch = raw.match(/```(?:text)?\n([\s\S]*?)```/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  return raw.trim();
}
