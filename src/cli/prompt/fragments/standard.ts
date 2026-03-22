import type { Fragment } from '../types.js';

/**
 * Tier 2 — Standard fragments (41 check keys)
 * Skills, hooks, learning loop, router, architecture, local context
 */
export const standardFragments: Fragment[] = [
  // === Skills (7 individual + 1 completeness) ===
  ...['security', 'debug', 'audit', 'investigate', 'review', 'plan', 'test'].map(skill => ({
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
  // Skill quality fragments
  {
    key: 'add-skill-step0',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Most skills should include a Step 0 that gathers context before acting. Add to each skill:

\`\`\`markdown
## Step 0 — Gather Context

Ask the user before starting:
1. [What specific questions to ask for this skill]
2. [What context the agent needs]

Do NOT start until the user has answered.
\`\`\`

This prevents blind execution — the agent asks before it acts.`,
  },
  {
    key: 'add-skill-human-gates',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should include HUMAN GATE checkpoints where the agent pauses for review before proceeding to the next phase. Add to each skill between major phases:

\`\`\`markdown
**HUMAN GATE:** Present findings. Ask "Does this look right?" Do NOT proceed until confirmed.
\`\`\`

This prevents the agent from auto-advancing through diagnosis → fix → deploy without human review.`,
  },
  {
    key: 'add-skill-constraints',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should use MUST/MUST NOT constraints to enforce boundaries. Add a Constraints section:

\`\`\`markdown
## Constraints

- MUST gather context before acting (Step 0)
- MUST stop after presenting findings — no fixes until human reviews
- MUST NOT skip phases
- MUST NOT fabricate file paths or evidence
\`\`\`

Use RFC 2119 language. MUST = blocking, SHOULD = recommended, MAY = optional.`,
  },
  {
    key: 'add-skill-conversational',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should be conversational, not one-shot. After each major phase, the agent should present findings and let the human drill in before proceeding.

Add to each skill after the main output phase:

\`\`\`markdown
Present your findings. Then ask: "Want me to dig deeper on any of these? Any that look wrong?"

Do NOT auto-advance to the next phase. Let the human:
- Ask follow-up questions ("Walk me through the riskiest change")
- Challenge findings ("That looks like a false positive")
- Redirect ("Also check X")
- Confirm ("Looks good, proceed")

Conversational reviews catch architectural problems. One-shot dumps flag style nits.
\`\`\``,
  },
  {
    key: 'add-skill-chaining',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should include a "Chains with" footer linking to related skills. Add to each skill:

\`\`\`markdown
## Chains With

- goat-[related-skill] — [why this skill chains to it]
\`\`\`

Common chains:
- investigate → plan (investigated area needs work)
- debug → test (regression test after fix)
- audit → review (audit findings become review checklist)
- security → review (security-specific PR review)
- plan → test (verify implementation against plan)`,
  },
  {
    key: 'add-skill-choices',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should offer structured choices at phase transitions instead of binary yes/no gates. Replace:

\`\`\`
"Does this look right?" → proceed
\`\`\`

With:

\`\`\`
"Want me to:
  (a) [drill deeper on specific area]
  (b) [check related concern]
  (c) [shift focus]
  (d) [proceed to next phase]"
\`\`\`

The human drives direction, not just pace.`,
  },
  {
    key: 'add-skill-phases',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should have a phased process that prevents step-skipping. Structure as:

\`\`\`markdown
## Phase 1 — [First step]
[Instructions]

## Phase 2 — [Second step]
[Instructions — only after Phase 1 complete]

## Phase 3 — [Third step]
[Instructions — only after human reviews Phase 2]
\`\`\`

Each phase should have a clear entry condition (what must be done before starting it).`,
  },
  {
    key: 'create-all-skills',
    phase: 'standard',
    category: 'Skills',
    kind: 'create',
    instruction: `Ensure all 7 GOAT Flow skills are present under \`{{skillsDir}}/\`:

- goat-security, goat-debug, goat-audit, goat-investigate, goat-review, goat-plan, goat-test

Each skill needs a \`SKILL.md\` with: name, description, When to Use, Process, Output sections.`,
  },

  // === Hooks ===
  {
    key: 'add-deny-blocks',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook exists but has no real blocking logic. A deny hook that just \`exit 0\` provides no protection.

Add blocking patterns for dangerous commands. The hook should \`exit 2\` (with a message to stderr) for:
- \`rm -rf\` without safe scoping
- Direct push to main/master
- Force push
- \`chmod 777\`
- Pipe to shell (\`curl | bash\`)
- \`.env\` file modifications
- \`--no-verify\` bypass

See \`workflow/runtime/enforcement.md\` for the full deny pattern list.`,
  },
  {
    key: 'add-compaction-hook',
    phase: 'standard',
    category: 'Hooks',
    kind: 'create',
    instruction: `Register a Notification hook that fires after context compaction to re-inject key context.

Add to \`{{settingsFile}}\` hooks array:

\`\`\`json
{
  "type": "Notification",
  "matcher": "compact",
  "command": "echo 'CONTEXT AFTER COMPACTION:' && echo 'Modified files:' && git diff --name-only 2>/dev/null && echo '---' && cat tasks/todo.md 2>/dev/null || echo 'No active tasks' && echo '---' && echo 'Constraints: read {{instructionFile}} Autonomy Tiers before proceeding'"
}
\`\`\`

This preserves context during long sessions — the agent gets reminded of current task, modified files, and constraints after compaction.`,
  },
  {
    key: 'add-stop-lint-validation',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The post-turn hook (stop-lint.sh) exists but has no actual validation logic. It should run checks after each agent turn:

- Shellcheck on changed \`.sh\` files
- Typecheck (\`tsc --noEmit\`) on changed \`.ts\` files
- Lint check on changed files (language-appropriate)
- Format check (if formatter configured)

The hook MUST exit 0 even if checks fail (non-zero causes infinite loops). Report issues to stderr as informational feedback.

See \`workflow/runtime/enforcement.md\` for the full stop-lint template.`,
  },
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
if [ -n "{{lintCommand}}" ]; then
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

  // === Local Instructions (cold path) ===
  {
    key: 'create-instructions-dir',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create the \`ai/instructions/\` directory and \`ai/README.md\` router:

\`\`\`markdown
# Project Coding Guidelines

Read \`instructions/base.md\` first for every task.

Then load additional files based on the work:

| Task | Load |
|------|------|
| Code review | \`instructions/code-review.md\` |
| Committing code | \`instructions/git-commit.md\` |

Precedence (highest first):
1. security.md (if touching auth/secrets/validation)
2. code-review.md (for review tasks only)
3. domain file (frontend/backend)
4. base.md (always loaded)

Only load files that exist.
\`\`\`

Add rows for domain files as you create them (frontend.md, backend.md, security.md, testing.md).`,
  },
  {
    key: 'create-instructions-router',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/README.md\` as the routing map for instruction files. This tells agents which files to load for which tasks. See the \`ai/instructions/\` directory for the files it references.`,
  },
  {
    key: 'create-base-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/base.md\` — the universal project contract. Include:

- What the repo is (one line)
- Architecture overview (2-3 lines)
- Build/test/lint commands
- Coding conventions (5-8 concrete do/don't rules)
- Generated files (never edit these)
- Dangerous operations (list with reasons)

Keep it concrete: "Use \`sqlc.arg(name)\` in queries" not "write clean SQL".`,
  },
  {
    key: 'create-code-review-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/code-review.md\` — review standards for this project. Include:

- Priority order: correctness > security > maintainability
- Approval criteria (what must pass before merge)
- 3-5 common anti-patterns to flag (with code examples)
- What NOT to nitpick (style handled by linter)`,
  },
  {
    key: 'create-git-commit-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/git-commit.md\` — commit conventions for this project. Include:

- Commit message format (with good/bad examples)
- Branch naming convention
- PR workflow (draft → review → merge)
- What to include in PR descriptions`,
  },
  {
    key: 'create-github-git-commit',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`.github/git-commit-instructions.md\` — universal commit instructions for any tool or human making commits. Include the key rules from \`ai/instructions/git-commit.md\` inline (tools may not follow references to other files).`,
  },
  {
    key: 'create-copilot-bridge',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`.github/instructions/\` bridge files for GitHub Copilot. For each file in \`ai/instructions/\`, create a matching \`.instructions.md\` file with:

1. \`applyTo\` frontmatter scoping it to the relevant paths
2. The content from the source file (Copilot needs inline content, not links)

Example:
\`\`\`markdown
---
applyTo: "src/frontend/**"
---
<!-- Source: ai/instructions/frontend.md — keep in sync -->
[content from ai/instructions/frontend.md]
\`\`\``,
  },
];
