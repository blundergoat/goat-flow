/** Canonical list of all GOAT Flow skill names */
export const SKILL_NAMES = [
  'goat-security', 'goat-debug', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test',
  'goat-refactor', 'goat-simplify',
] as const;

/** Deprecated skill names — scanner accepts these during migration grace period.
 *  Not exported: values are inlined where needed. Kept as documentation. */
const DEPRECATED_SKILL_NAMES = [
  'goat-reflect', 'goat-onboard', 'goat-resume',
  'goat-audit', 'goat-context',
] as const;
void DEPRECATED_SKILL_NAMES;

/** Type derived from the canonical skill list */
export type SkillName = typeof SKILL_NAMES[number];

/**
 * Current skill template version — matches the package/rubric version.
 * Skills embed this as `goat-flow-skill-version: X` in their YAML frontmatter.
 * The scanner compares the embedded version against this constant.
 * Re-exported from version.ts to keep a single source of truth.
 */
export { RUBRIC_VERSION as SKILL_VERSION } from './rubric/version.js';
