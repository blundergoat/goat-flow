/** Canonical list of all GOAT Flow skill names */
export const SKILL_NAMES = [
  'goat-security', 'goat-debug', 'goat-audit', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test', 'goat-context',
  'goat-refactor',
] as const;

/** Deprecated skill names — scanner accepts these during migration grace period */
export const DEPRECATED_SKILL_NAMES = ['goat-reflect', 'goat-onboard', 'goat-resume'] as const;

/** Type derived from the canonical skill list */
export type SkillName = typeof SKILL_NAMES[number];

/**
 * Current skill template version — matches the package/rubric version.
 * Skills embed this as `goat-flow-skill-version: X` in their YAML frontmatter.
 * The scanner compares the embedded version against this constant.
 * Re-exported from version.ts to keep a single source of truth.
 */
export { RUBRIC_VERSION as SKILL_VERSION } from './rubric/version.js';
