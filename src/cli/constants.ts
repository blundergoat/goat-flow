/** Canonical list of all GOAT Flow skill names */
export const SKILL_NAMES = [
  'goat-security', 'goat-debug', 'goat-audit', 'goat-investigate',
  'goat-review', 'goat-plan', 'goat-test', 'goat-reflect',
  'goat-onboard', 'goat-resume',
] as const;

/** Type derived from the canonical skill list */
export type SkillName = typeof SKILL_NAMES[number];
