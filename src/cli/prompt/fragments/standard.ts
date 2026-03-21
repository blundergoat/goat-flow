import type { Fragment } from '../types.js';

/**
 * Tier 2 — Standard fragments (21 check keys)
 * Skills, hooks, learning loop, router, architecture, local context
 */
export const standardFragments: Fragment[] = [
  // === Skills (7 individual + 1 completeness) ===
  ...['preflight', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map(skill => ({
    key: `create-skill-${skill}`,
    phase: 'standard' as const,
    category: 'Skills',
    kind: 'create' as const,
    instruction: `Create \`{{skillsDir}}/goat-${skill}/SKILL.md\`.

Use this structure:
\`\`\`markdown
---
name: goat-${skill}
description: "${skill} skill for GOAT Flow"
---
# goat-${skill}

## When to Use

[When to invoke this skill]

## Process

1. [Step 1]
2. [Step 2]

## Output

[Expected output format]
\`\`\`

Refer to the goat-flow documentation for the full skill template.`,
  })),
  {
    key: 'create-all-skills',
    phase: 'standard',
    category: 'Skills',
    kind: 'create',
    instruction: `Ensure all 7 GOAT Flow skills are present under \`{{skillsDir}}/\`:

- goat-preflight, goat-debug, goat-audit, goat-investigate, goat-review, goat-plan, goat-test

Each skill needs a \`SKILL.md\` with: name, description, When to Use, Process, Output sections.`,
  },

  // === Hooks ===
  {
    key: 'fix-settings-json',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `\`{{settingsFile}}\` is invalid JSON. Open it, find the syntax error, and fix it. Common issues: trailing commas, missing quotes, unescaped characters.`,
  },
  {
    key: 'create-stop-lint',
    phase: 'standard',
    category: 'Hooks',
    kind: 'create',
    instruction: `Create a post-turn verification hook for {{agentName}}.`,
    agentOverrides: {
      claude: `Create \`.claude/hooks/stop-lint.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# Stop hook — runs after each agent turn
# Add lint checks, line count checks, etc.
exit 0
\`\`\`

IMPORTANT: The script MUST end with \`exit 0\`. Non-zero exit causes infinite retry loops.`,
      codex: `Create \`scripts/stop-lint.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# Post-turn verification for Codex
exit 0
\`\`\``,
      gemini: `Create \`.gemini/hooks/stop-lint.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# AfterAgent hook — post-turn verification
exit 0
\`\`\``,
    },
  },
  {
    key: 'fix-hook-exit',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The post-turn hook (stop-lint.sh) may not exit 0. This causes infinite retry loops.

Open the hook script and ensure the last line is \`exit 0\`. If the script has conditional exits, ensure all code paths eventually reach \`exit 0\`.`,
  },
  {
    key: 'create-format-hook',
    phase: 'standard',
    category: 'Hooks',
    kind: 'create',
    instruction: `Create a post-tool formatting hook.`,
    agentOverrides: {
      claude: `Create \`.claude/hooks/format-file.sh\` (skip if no formatter is configured):

\`\`\`bash
#!/usr/bin/env bash
# PostToolUse hook — auto-format after file edits
# Replace YOUR_FORMATTER with your format command (e.g., prettier --write)
YOUR_FORMATTER "$1" 2>/dev/null || true
exit 0
\`\`\``,
      gemini: `Create \`.gemini/hooks/format-file.sh\` (skip if no formatter is configured):

\`\`\`bash
#!/usr/bin/env bash
# AfterTool hook — auto-format after file edits
# Replace YOUR_FORMATTER with your format command (e.g., prettier --write)
YOUR_FORMATTER "$1" 2>/dev/null || true
exit 0
\`\`\``,
      codex: `No post-tool hook for Codex. If you have a formatter, document it in AGENTS.md under Essential Commands instead.`,
    },
  },
  {
    key: 'create-preflight-script',
    phase: 'standard',
    category: 'Hooks',
    kind: 'create',
    instruction: `Create \`scripts/preflight-checks.sh\`:

\`\`\`bash
#!/usr/bin/env bash
set -euo pipefail

echo "=== Preflight Checks ==="

# Lint (skip if no linter configured)
if command -v {{lintCommand}} >/dev/null 2>&1; then
  {{lintCommand}} || { echo "FAIL: lint"; exit 1; }
fi

# Tests (skip if no test command configured)
if [ -n "{{testCommand}}" ]; then
  {{testCommand}} || { echo "FAIL: tests"; exit 1; }
fi

# Line count check
for f in CLAUDE.md AGENTS.md GEMINI.md; do
  [ -f "$f" ] && lines=$(wc -l < "$f") && [ "$lines" -gt 150 ] && echo "WARN: $f is $lines lines (limit 150)"
done

echo "=== All checks passed ==="
\`\`\`

Adjust the lint and test commands to match your project. Remove steps that don't apply.`,
  },
  {
    key: 'create-context-validation',
    phase: 'standard',
    category: 'Hooks',
    kind: 'create',
    instruction: `Create context validation. Either:

**Option A:** \`scripts/context-validate.sh\` (local script)
**Option B:** \`.github/workflows/context-validation.yml\` (CI)

The script should check: instruction file line counts, router table references resolve, skills exist.`,
  },

  // === Learning Loop ===
  {
    key: 'create-lessons',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'create',
    instruction: `Create \`docs/lessons.md\`:

\`\`\`markdown
# Lessons

## Entries

(Entries appear here as real incidents occur. Never seed with hypothetical examples.)
\`\`\``,
  },
  {
    key: 'seed-lessons',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'fix',
    instruction: `\`docs/lessons.md\` exists but has no entries. Add entries from real incidents:

\`\`\`markdown
### Entry: [Short description]
**What happened:** [What went wrong]
**Root cause:** [Why it happened]
**Fix:** [What was done]
**created_at:** YYYY-MM-DD
\`\`\`

Only add entries from actual incidents. Never use hypothetical examples.`,
  },
  {
    key: 'create-footguns',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'create',
    instruction: `Create \`docs/footguns.md\`:

\`\`\`markdown
# Footguns

Architectural traps with file:line evidence.

## Footgun: [Name]

**Evidence:**
- \\\`src/example.ts:42\\\` - [what the trap is]
\`\`\`

Every footgun MUST have file:line evidence. No hypotheticals.`,
  },
  {
    key: 'add-footgun-evidence',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'fix',
    instruction: `\`docs/footguns.md\` exists but entries are missing file:line evidence. Update each entry:

**Before:** "Auth module has race conditions"
**After:** "\`src/auth.ts:42\` — race condition between token refresh and request dispatch"

Every footgun entry MUST have at least one \`file:line\` reference.`,
  },

  // === Router Table ===
  {
    key: 'add-router',
    phase: 'standard',
    category: 'Router Table',
    kind: 'create',
    instruction: `Add a Router Table section to \`{{instructionFile}}\`:

\`\`\`markdown
## Router Table

| Resource | Path |
|----------|------|
| Skills | \\\`{{skillsDir}}/goat-*/\\\` |
| Footguns | \\\`docs/footguns.md\\\` |
| Lessons | \\\`docs/lessons.md\\\` |
| Architecture | \\\`docs/architecture.md\\\` |
\`\`\`

Every path in the router MUST resolve to an existing file or directory.`,
  },
  {
    key: 'fix-router-refs',
    phase: 'standard',
    category: 'Router Table',
    kind: 'fix',
    instruction: `Some router table paths in \`{{instructionFile}}\` don't resolve. For each broken reference:

1. Check if the file was renamed — update the path
2. Check if the file was deleted — remove the row or create the file
3. Check if it's a typo — fix the path

Every router path MUST point to something that exists.`,
  },
  {
    key: 'route-skills',
    phase: 'standard',
    category: 'Router Table',
    kind: 'create',
    instruction: `Add skill directories to the router table in \`{{instructionFile}}\`:

\`\`\`markdown
| Skills | \\\`{{skillsDir}}/goat-*/\\\` |
\`\`\``,
  },

  // === Architecture ===
  {
    key: 'create-architecture',
    phase: 'standard',
    category: 'Architecture',
    kind: 'create',
    instruction: `Create \`docs/architecture.md\` — a concise system overview:

\`\`\`markdown
# Architecture

## What
[One paragraph: what the system does]

## Why
[One paragraph: why it exists, key constraints]

## How
[Key components, data flow, dependencies]
\`\`\`

Keep under 100 lines. This is for agent orientation, not exhaustive documentation.`,
  },
  {
    key: 'compress-architecture',
    phase: 'standard',
    category: 'Architecture',
    kind: 'fix',
    instruction: `\`docs/architecture.md\` is over 100 lines. Compress:

1. Remove implementation details — keep only architectural decisions
2. Replace prose with bullet lists
3. Move detailed component docs to separate files and link from here

Target: under 100 lines.`,
  },
  {
    key: 'create-domain-reference',
    phase: 'standard',
    category: 'Architecture',
    kind: 'create',
    instruction: `Create \`docs/domain-reference.md\` — domain terms and concepts that were migrated out of the instruction file.

Only create this if domain content was extracted from \`{{instructionFile}}\` to reduce its line count.`,
  },

];
