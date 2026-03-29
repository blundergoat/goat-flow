import type { Fragment } from '../types.js';

/**
 * Tier 2 — Standard fragments
 * Skills, hooks, learning loop, router, architecture, local context
 */
export const standardFragments: Fragment[] = [
  // === Skills (9 individual + 1 completeness + 7 quality + 2 cross-cutting) ===
  ...['security', 'debug', 'investigate', 'review', 'plan', 'test', 'refactor', 'simplify'].map(skill => ({
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
    instruction: `ALL skills must be conversational. Each skill needs three structural elements:

1. **BLOCKING GATE or HUMAN GATE** — an explicit stop point where the agent presents findings and waits for human input before proceeding. Not a checkpoint — a hard stop.

2. **Structured choices** — at each gate, offer lettered options like:
   (a) dig deeper into a specific finding
   (b) check a related area
   (c) proceed to the next phase
   (d) close

3. **No auto-advance** — the skill must explicitly state that the agent does NOT proceed past the gate without human input.

\`\`\`markdown
**BLOCKING GATE:** Present findings. Offer:
(a) drill into a specific finding
(b) review a related area
(c) proceed to next phase
(d) something else

Do NOT auto-advance. Let the human challenge, redirect, or confirm.
\`\`\`

The scanner checks for all three elements. A skill that matches only keywords like "conversational" without the structural gate pattern will not pass.`,
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
    instruction: `Ensure all 8 GOAT Flow skills are present under \`{{skillsDir}}/\`:

- goat-security, goat-debug, goat-investigate, goat-review, goat-plan, goat-test, goat-refactor, goat-simplify

Each skill needs a \`SKILL.md\` with: name, description, When to Use, Process, Output sections.`,
  },
  {
    key: 'add-skill-output-format',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should include an Output or Output Format section that defines what the agent produces. Add to each skill:

\`\`\`markdown
## Output

[Describe the expected deliverable: format, structure, required sections]
\`\`\`

Without an output format, agents produce inconsistent deliverables and the human cannot predict what to expect.`,
  },
  {
    key: 'install-dispatcher-skill',
    phase: 'standard',
    category: 'Skills',
    kind: 'create',
    instruction: `Install the \`goat\` dispatcher skill alongside the 8 canonical skills.

Copy \`workflow/skills/goat.md\` to \`{{skillsDir}}/goat/SKILL.md\`.

The dispatcher routes natural language to the correct skill — users type \`/goat fix the login bug\` instead of needing to know the exact skill name. Without it, skill discoverability depends entirely on users memorising 8 command names.`,
  },
  {
    key: 'add-skill-shared-conventions',
    phase: 'standard',
    category: 'Skills',
    kind: 'fix',
    instruction: `Skills should include a \`## Shared Conventions\` block that establishes cross-skill consistency. Add this block to each skill (immediately after the title heading, before ## When to Use):

\`\`\`markdown
## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs \`file:line\`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → \`docs/lessons.md\`. Architectural trap → \`docs/footguns.md\`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.
\`\`\`

This block ensures all skills apply the same severity ranking, evidence standard, and learning loop protocol — regardless of which skill is invoked.`,
  },

  {
    key: 'fix-lesson-stale-refs',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'fix',
    instruction: `\`docs/lessons.md\` contains file path references that no longer exist on disk. For each stale reference:
1. If the file was **renamed**: update the path
2. If the file was **deleted**: remove the reference or note it as historical
3. Verify with: \`grep -rn 'old/path' docs/lessons.md\``,
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
    key: 'fix-deny-json-parsing',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook uses \`grep -P\` for JSON parsing, which is not available on macOS. Replace with \`jq\`:

\`\`\`bash
# Good — portable JSON parsing
COMMAND=$(echo "$INPUT" | jq -r '.command // .input // empty' 2>/dev/null || echo "$INPUT")

# Bad — grep -P is not available on macOS
COMMAND=$(echo "$INPUT" | grep -oP '"command"\\s*:\\s*"([^"]*)"')
\`\`\`

If jq may not be installed, add a sed fallback after the jq attempt.`,
  },
  {
    key: 'fix-deny-chaining',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook does not handle command chaining. An input like \`echo hello && rm -rf /\` bypasses all pattern checks because the dangerous command is after \`&&\`.

Split the command on chaining operators before checking patterns:

\`\`\`bash
# Split on &&, ||, ; and check each segment
IFS=$'\\n' read -r -d '' -a segments < <(echo "$COMMAND" | sed 's/&&/\\n/g; s/||/\\n/g; s/;/\\n/g' && printf '\\0') || true
for segment in "\${segments[@]}"; do
  check_segment "$segment"
done
\`\`\``,
  },
  {
    key: 'fix-deny-rm-rf',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook MUST block \`rm -rf\` (and \`rm -fr\`). This is the most dangerous destructive command an agent can execute.

\`\`\`bash
# Block rm -rf and rm -fr (both flag orders)
if [[ "$cmd" =~ rm[[:space:]]+-[a-zA-Z]*r[a-zA-Z]*f|rm[[:space:]]+-[a-zA-Z]*f[a-zA-Z]*r ]]; then
  # Allow scoped deletions: rm -rf ./tmp, rm -fr build/
  if ! [[ "$cmd" =~ rm[[:space:]]+-(rf|fr)[[:space:]]+(\\./|[a-zA-Z]) ]]; then
    block "rm -rf without safe scoping"
  fi
fi
\`\`\``,
  },
  {
    key: 'fix-deny-force-push',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook MUST block force push. Force pushing can destroy shared branch history and lose other developers' work.

\`\`\`bash
# Block force push
if [[ "$cmd" =~ --force|push.*--force|-f.*push ]]; then
  block "force push"
fi
\`\`\`

Also block in settings.json deny list: \`"Bash(git push --force*)"\`, \`"Bash(git push -f*)"\`.`,
  },
  {
    key: 'fix-deny-chmod',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook MUST block \`chmod 777\`. World-writable permissions are a security vulnerability — any process can read, write, and execute the file.

\`\`\`bash
# Block chmod 777
if [[ "$cmd" =~ chmod.*777 ]]; then
  block "chmod 777 — world-writable permissions"
fi
\`\`\`

Also block in settings.json deny list: \`"Bash(chmod 777*)"\`.`,
  },
  {
    key: 'fix-deny-package-mutation',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The deny hook MUST block package manager commands that add or remove dependencies. Bare \`npm install\` (no args) is safe — it installs from the lockfile — so do NOT block it.

\`\`\`bash
# Block package manager mutations (bare install from lockfile is safe)
if [[ "$cmd" =~ ^(npm|pnpm|yarn)\\ (add|remove|uninstall) ]] ||
   [[ "$cmd" =~ ^(npm|pnpm|yarn)\\ install\\ [a-zA-Z@] ]] ||
   [[ "$cmd" =~ ^pip\\ install\\ [a-zA-Z] ]] ||
   [[ "$cmd" =~ ^composer\\ (require|remove) ]] ||
   [[ "$cmd" =~ ^go\\ get ]]; then
  block "package mutation — use Ask First"
fi
\`\`\`

Also block in settings.json deny list: \`"Bash(npm add*)", "Bash(yarn add*)", "Bash(pnpm add*)", "Bash(pip install [a-zA-Z]*)", "Bash(go get*)"\`.`,
  },
  {
    key: 'fix-read-deny-secrets',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `The settings permissions.deny list is missing read protection for common sensitive paths. Add these patterns:

\`\`\`json
{
  "permissions": {
    "deny": [
      "Read(**/.env*)",
      "Read(**/.ssh/**)",
      "Read(**/.aws/**)",
      "Read(**/*.pem)",
      "Read(**/*.key)",
      "Read(**/credentials*)",
      "Read(**/.docker/config.json)",
      "Read(**/.gnupg/**)",
      "Read(**/.kube/config)"
    ]
  }
}
\`\`\`

These prevent agents from reading SSH keys, cloud credentials, certificates, and secret files.`,
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
    instruction: `Create \`.github/workflows/context-validation.yml\` for CI-based context validation.

The workflow should check: instruction file line counts, router table references resolve, skills exist.
Trigger on pull requests that modify instruction files, skills, or docs/.`,
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
  // seed-lessons removed — merged into seed-lessons-minimum after 2.3.2 was removed as duplicate of 2.3.2a.
  {
    key: 'create-footguns',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'create',
    instruction: `Create \`docs/footguns.md\` with real traps from this codebase.

**Step 1:** Find potential footguns:
\`\`\`bash
grep -rn 'TODO\\|FIXME\\|HACK\\|XXX' src/ --include='*.ts' --include='*.php' --include='*.py' | head -20
git log --all --oneline -- '*migration*' '**/migrations/**' | head -10
\`\`\`

**Step 2:** For each real trap, document it:
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
  {
    key: 'add-footgun-labels',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'fix',
    instruction: `\`docs/footguns.md\` has evidence but no evidence type labels. Add one of these to each entry:

- **ACTUAL_MEASURED** — real data with source (e.g., production metrics, load test results)
- **DESIGN_TARGET** — intended values from specs (e.g., "target 120 lines per spec")
- **HYPOTHETICAL_EXAMPLE** — illustrative only (e.g., "imagine a 500ms timeout")

Bare claims without labels are not acceptable.`,
  },
  {
    key: 'route-learning-loop',
    phase: 'standard',
    category: 'Router Table',
    kind: 'fix',
    instruction: 'Add \`docs/lessons.md\` and \`docs/footguns.md\` to the router table in \`{{instructionFile}}\`.',
  },
  {
    key: 'route-architecture',
    phase: 'standard',
    category: 'Router Table',
    kind: 'fix',
    instruction: 'Add \`docs/architecture.md\` to the router table in \`{{instructionFile}}\`.',
  },
  {
    key: 'route-evals',
    phase: 'standard',
    category: 'Router Table',
    kind: 'fix',
    instruction: 'Add \`agent-evals/\` to the router table in \`{{instructionFile}}\`.',
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
  // === Local Instructions (cold path) ===
  {
    key: 'create-instructions-dir',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create the \`ai/instructions/\` directory and \`ai/README.md\` router:

\`\`\`markdown
# Project Coding Guidelines

Read \`instructions/conventions.md\` first for every task.

Then load additional files based on the work:

| Task | Load |
|------|------|
| Code review | \`instructions/code-review.md\` |
| Committing code | \`instructions/git-commit.md\` |

Precedence (highest first):
1. security.md (if touching auth/secrets/validation)
2. code-review.md (for review tasks only)
3. domain file (frontend/backend)
4. conventions.md (always loaded)

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
    key: 'create-conventions-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/conventions.md\` — the universal project contract. Include:

- What the repo is (one line)
- Architecture overview (2-3 lines)
- Build/test/lint commands
- Coding conventions (5-8 concrete do/don't rules)
- Generated files (never edit these)
- Dangerous operations (list with reasons)

Keep it concrete: "Use \`sqlc.arg(name)\` in queries" not "write clean SQL".`,
  },
  {
    key: 'improve-conventions-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'fix',
    instruction: `\`ai/instructions/conventions.md\` exists but lacks real content. A stub file is not useful. Add:

1. **Commands section** with actual build/test/lint commands in a bash code block
2. **Conventions section** with concrete DO/DON'T rules extracted from the codebase
3. At least 15 lines of substantive content

The agent should be able to read this file and immediately know how to build, test, and follow project conventions.`,
  },
  {
    key: 'create-frontend-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/frontend.md\` — frontend-specific coding conventions for the detected UI stack (React, Vue, Angular, Blade, Twig, ERB, Jinja, Blazor, Swift/iOS, or plain TS/JS). Include:

- Component/template patterns (naming, structure, composition)
- State management or data-binding conventions
- Styling approach and file organization
- Testing patterns for UI components or template rendering
- Common anti-patterns to avoid

Only include rules specific to frontend/UI work. Shared rules belong in \`conventions.md\`.`,
  },
  {
    key: 'create-backend-instructions',
    phase: 'standard',
    category: 'Local Instructions',
    kind: 'create',
    instruction: `Create \`ai/instructions/backend.md\` — backend-specific coding conventions. Include:

- API design patterns (request/response, error handling)
- Database conventions (queries, migrations, naming)
- Service layer structure
- Authentication/authorization patterns
- Testing patterns for backend code

Only include rules specific to backend work. Shared rules belong in \`conventions.md\`.`,
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
  // === Learning Loop Depth ===
  {
    key: 'seed-lessons-minimum',
    phase: 'standard',
    category: 'Learning Loop',
    kind: 'fix',
    instruction: `\`docs/lessons.md\` has no entries. Target 3-5 real incidents — at least 1 is required.

Option A — pull from git history:
\`\`\`bash
git log --oneline --all | grep -iE 'fix|revert|bug|broke|rollback|regression'
\`\`\`
For each incident found, add an entry:
\`\`\`markdown
### [Short description]
**What happened:** [What went wrong]
**Root cause:** [Why it happened]
**Fix:** [What was done]
**created_at:** YYYY-MM-DD
\`\`\`

Option B — if no incidents apply yet, add a placeholder:
\`\`\`markdown
### No incidents yet

[date] — Project is new. Add entries after the first agent mistake or correction.
\`\`\`

Do NOT invent hypothetical lessons.`,
  },
  {
    key: 'create-decisions-dir',
    phase: 'standard',
    category: 'Architecture',
    kind: 'create',
    instruction: `Create \`docs/decisions/\` and seed it with an ADR template:

\`\`\`markdown
# ADR-000: Template

**Status:** Template
**Date:** {{date}}

## Context

[Why does this decision need to be made? What forces are at play?]

## Decision

[What did we decide to do?]

## Consequences

[What are the trade-offs? What becomes easier or harder as a result?]
\`\`\`

Save as \`docs/decisions/ADR-000-template.md\`. Real ADRs are added when significant architectural decisions are made — name them \`ADR-NNN-short-title.md\`.`,
  },
  // Ask First enforcement hook removed — see ADR-006.

  {
    key: 'fix-deny-cloud-destructive',
    phase: 'standard',
    category: 'Hooks',
    kind: 'fix',
    instruction: `Deploy platforms detected but deny hook does not block cloud-destructive commands. Add to deny-dangerous.sh:

\`\`\`bash
# Block cloud-destructive commands
if [[ "$cmd" =~ docker[[:space:]]+push ]] ||
   [[ "$cmd" =~ terraform[[:space:]]+(destroy|apply.*-auto-approve) ]] ||
   [[ "$cmd" =~ aws[[:space:]]+(s3[[:space:]]+rm|ec2[[:space:]]+terminate) ]]; then
  block "cloud-destructive command — requires manual execution"
fi
\`\`\`

Also block in settings.json deny list: \`"Bash(docker push*)", "Bash(terraform destroy*)", "Bash(terraform apply*-auto-approve*)", "Bash(aws s3 rm*)", "Bash(aws ec2 terminate*)"\`.`,
  },

  // === Signal Follow-Through ===
  {
    key: 'fix-llm-signal-followthrough',
    phase: 'standard',
    category: 'Signal Follow-Through',
    kind: 'fix',
    instruction: `LLM integration detected but instruction file doesn't address it. Add to the instruction file:
1. Prompt/template file paths in the Router Table
2. "Prompt changes require scenario testing" in Ask First boundaries
3. Seed a learning-loop entry noting prompt-regression risk`,
  },
  {
    key: 'fix-compliance-signal-followthrough',
    phase: 'standard',
    category: 'Signal Follow-Through',
    kind: 'fix',
    instruction: `PHI/compliance signals detected but constraints are not on the instruction file hot path. Add to the execution loop or Ask First section (NOT only in cold-path docs):
- "MUST NOT log PHI/PII"
- "MUST NOT include patient data in error messages"
- "MUST scope all database queries by tenant"
- "Data-touching changes require audit-path verification"`,
  },
  {
    key: 'fix-formatter-gaps',
    phase: 'standard',
    category: 'Signal Follow-Through',
    kind: 'fix',
    instruction: `Formatter gaps detected: {{formatterGaps}}. Add formatters to the PostToolUse hook (format-file.sh) so every detected language has automatic formatting on save.`,
  },
];
