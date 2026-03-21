import type { Fragment } from '../types.js';

/**
 * Anti-pattern fix fragments (9 keys)
 */
export const antiPatternFragments: Fragment[] = [
  {
    key: 'ap-compress-instruction-file',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `**CRITICAL:** \`{{instructionFile}}\` is over 150 lines (hard limit). This is an anti-pattern that costs -3 points.

Immediate actions:
1. Remove verbose examples — keep one BAD/GOOD pair per concept
2. Replace paragraphs with bullet points
3. Move reference material to \`docs/\` and link from router table
4. Collapse multi-row tables into inline text where possible

Target: under 120 lines. Hard limit: 150.`,
  },
  {
    key: 'ap-fix-skill-names',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `Skills without the \`goat-\` prefix conflict with potential built-in commands. Rename:

1. Find skills in \`{{skillsDir}}/\` that don't start with \`goat-\`
2. Rename the directory: \`mv {{skillsDir}}/[old-name] {{skillsDir}}/goat-[old-name]\`
3. Update the SKILL.md \`name:\` field inside each renamed skill
4. Update any references in \`{{instructionFile}}\` router table`,
  },
  {
    key: 'ap-fix-dod-overlap',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `Definition of Done appears in both the instruction file and a guidelines file. This causes confusion about which is authoritative.

Remove the DoD from the guidelines file. The DoD belongs only in \`{{instructionFile}}\`.`,
  },
  {
    key: 'ap-add-footgun-evidence',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `**CRITICAL:** \`docs/footguns.md\` has entries without file:line evidence. This is an anti-pattern that costs -5 points.

For every footgun entry, add at least one \`file:line\` reference:

**Before:** "The auth module has race conditions"
**After:** "\`src/auth.ts:42\` — race condition between token refresh and request dispatch"

If the evidence no longer applies (code changed), either update the reference or remove the footgun.`,
  },
  {
    key: 'ap-fix-settings-json',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `**CRITICAL:** \`{{settingsFile}}\` is invalid JSON. This is an anti-pattern that costs -5 points.

1. Open the file and find the syntax error
2. Common issues: trailing commas, missing quotes, unescaped backslashes
3. Validate with: \`node -e "JSON.parse(require('fs').readFileSync('{{settingsFile}}', 'utf8'))"\``,
  },
  {
    key: 'ap-fix-hook-exit',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `**CRITICAL:** The post-turn hook (stop-lint.sh) does not end with \`exit 0\`. Non-zero exit causes infinite retry loops. This costs -5 points.

Fix: ensure the last line of the script is \`exit 0\`. If the script has conditional exits, ensure ALL code paths reach \`exit 0\`.`,
  },
  {
    key: 'ap-compress-local-files',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `Local instruction files are over 20 lines. Compress each one:

1. Keep only directory-specific context (3-5 lines of gotchas)
2. Remove anything duplicated from the root instruction file
3. Reference the root file: "See {{instructionFile}} for full rules"`,
  },
  {
    key: 'ap-fix-generic-ask-first',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `The Ask First section contains generic template text like "auth, routing, deployment, API, DB". This is an anti-pattern that costs -2 points.

Replace with project-specific boundaries using actual file paths:

**Before:** "auth, routing, deployment, API, DB"
**After:** Specific boundaries from this project, e.g.:
- \`src/auth/\` — authentication module (cross-cutting)
- \`config/\` — environment configuration
- \`migrations/\` — database migrations`,
  },
  {
    key: 'ap-gitignore-settings-local',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    instruction: `\`settings.local.json\` should be in \`.gitignore\` to prevent committing personal settings.

Add to \`.gitignore\`:
\`\`\`
settings.local.json
.env
\`\`\``,
  },
];
