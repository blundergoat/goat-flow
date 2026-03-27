import type { Fragment } from '../types.js';
import { SKILL_VERSION } from '../../constants.js';

/**
 * Anti-pattern fix fragments (12 keys)
 */
export const antiPatternFragments: Fragment[] = [
  {
    key: 'ap-compress-instruction-file',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
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
    kind: 'fix',
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
    kind: 'fix',
    instruction: `Definition of Done appears in both the instruction file and a guidelines file. This causes confusion about which is authoritative.

Remove the DoD from the guidelines file. The DoD belongs only in \`{{instructionFile}}\`.`,
  },
  {
    key: 'ap-add-footgun-evidence',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
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
    kind: 'fix',
    instruction: `**CRITICAL:** \`{{settingsFile}}\` is invalid JSON. This is an anti-pattern that costs -5 points.

1. Open the file and find the syntax error
2. Common issues: trailing commas, missing quotes, unescaped backslashes
3. Validate with: \`node -e "JSON.parse(require('fs').readFileSync('{{settingsFile}}', 'utf8'))"\``,
  },
  {
    key: 'ap-fix-hook-exit',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `**CRITICAL:** The post-turn hook (stop-lint.sh) does not end with \`exit 0\`. Non-zero exit causes infinite retry loops. This costs -5 points.

Fix: ensure the last line of the script is \`exit 0\`. If the script has conditional exits, ensure ALL code paths reach \`exit 0\`.`,
  },
  {
    key: 'ap-compress-local-files',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `Local instruction files are over 20 lines. Compress each one:

1. Keep only directory-specific context (3-5 lines of gotchas)
2. Remove anything duplicated from the root instruction file
3. Reference the root file: "See {{instructionFile}} for full rules"`,
  },
  {
    key: 'ap-fix-generic-ask-first',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
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
    kind: 'fix',
    instruction: `\`settings.local.json\` should be in \`.gitignore\` to prevent committing personal settings.

Add to \`.gitignore\`:
\`\`\`
settings.local.json
.env
\`\`\``,
  },
  // AP10 (ap-prune-settings-local) removed — settings.local.json is personal preference.
  {
    key: 'ap-fix-empty-scaffolding',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `Learning loop files exist but are empty — created to pass the scanner, not to capture knowledge.

Either:
1. **Populate** — search git history for real incidents: \`git log --oneline | grep -iE 'fix|revert|bug|broke|regression'\`. Seed from real mistakes only.
2. **Or remove** — delete the empty files. Let them materialise on first real use.

Empty scaffolding provides no value and creates a false sense of completeness.`,
  },
  {
    key: 'ap-fix-stale-references',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `\`docs/footguns.md\` contains file:line references to files that no longer exist. Stale references mislead agents.

**Stale refs found:** {{evidence.ap-fix-stale-references}}

For each stale reference:
1. If the file was **renamed**: update the path to the new location
2. If the file was **deleted**: remove the footgun entry or update with current evidence
3. If the footgun is **no longer relevant**: remove the entire entry

Every file:line reference must point to a real file on disk.`,
  },
  {
    key: 'ap-fix-stale-instruction-refs',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `\`{{instructionFile}}\` contains backtick-wrapped code paths that don't exist on disk.

**Stale refs found:** {{evidence.ap-fix-stale-instruction-refs}}

For each stale reference:
1. If the file was **renamed**: update the path (check \`git log --diff-filter=R --summary\`)
2. If the file was **deleted**: remove the reference
3. If the path is a **typo**: fix it

Every code path in the instruction file should resolve to a real file.`,
  },
  {
    key: 'ap-fix-duplicate-skills',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `This project has both generic and goat-prefixed versions of the same skill. This causes agent confusion about which to invoke.

For each duplicate pair:
1. Compare the content of both versions
2. Keep the \`goat-*\` version (it follows the standard template)
3. Migrate any unique content from the generic version
4. Delete the generic skill directory`,
  },
  {
    key: 'ap-fix-outdated-skills',
    phase: 'anti-pattern',
    category: 'Anti-Pattern Fix',
    kind: 'fix',
    instruction: `Some skills have outdated or missing version tags. Skills should include \`goat-flow-skill-version\` in their YAML frontmatter to track compatibility.

**Outdated skills:** {{evidence.ap-fix-outdated-skills}}

For each outdated skill:
1. Read the current template from goat-flow (\`workflow/skills/goat-{name}.md\`)
2. Compare against your installed version — look for new sections, renamed phases, or structural changes
3. Update the skill content to match the current template structure
4. Add or update the frontmatter version tag:

\`\`\`yaml
---
name: goat-{name}
goat-flow-skill-version: "${SKILL_VERSION}"
---
\`\`\``,
  },
];
