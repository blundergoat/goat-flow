/** Canonical list of all GOAT Flow skill names (v0.9.3: 5 skills + dispatcher = 6) */
export const SKILL_NAMES = [
  'goat', 'goat-debug', 'goat-review', 'goat-plan',
  'goat-security', 'goat-test',
] as const;


/** Type derived from the canonical skill list */
export type SkillName = typeof SKILL_NAMES[number];

/**
 * Current skill template version - matches the package/rubric version.
 * Skills embed this as `goat-flow-skill-version: X` in their YAML frontmatter.
 * The scanner compares the embedded version against this constant.
 * Re-exported from version.ts to keep a single source of truth.
 */
export { RUBRIC_VERSION as SKILL_VERSION } from './rubric/version.js';
