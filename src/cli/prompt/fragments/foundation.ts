/**
 * Static prompt fragments for foundation-tier requirements.
 * These snippets back generated setup prompts for instruction files, enforcement, and execution-loop basics.
 */
import type { Fragment } from '../types.js';

/**
 * Tier 1 - Foundation fragments (23 check keys)
 * Instruction file, execution loop, autonomy tiers, DoD, enforcement
 */
export const foundationFragments: Fragment[] = [
  // === Instruction File ===
  {
    key: 'create-instruction-file',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'create',
    instruction: `Create \`{{instructionFile}}\` at the project root. This is the primary instruction file for {{agentName}}.

Start with this skeleton:

\`\`\`markdown
# {{instructionFile}} - v1.0 ({{date}})

[One-line project description]. Stack: {{languages}}.

## Essential Commands

\\\`\\\`\\\`bash
{{buildCommand}}
{{testCommand}}
{{lintCommand}}
\\\`\\\`\\\`
\`\`\`

Keep it under 120 lines. The remaining foundation checks will fill in the sections.`,
  },
  {
    key: 'compress-instruction-file',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'fix',
    instruction: `\`{{instructionFile}}\` is over the 120-line target. Compress it:

1. Remove verbose examples - one BAD/GOOD pair per concept is enough
2. Replace explanatory paragraphs with terse bullet points
3. Collapse tables where a one-liner suffices
4. Move reference material to \`ai-docs/\` and link from the router table

Hard limit: 150 lines. Target: under 120.`,
  },
  {
    key: 'add-version-header',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'create',
    instruction: `Add a version header to line 1 of \`{{instructionFile}}\`:

\`\`\`markdown
# {{instructionFile}} - v1.0 (YYYY-MM-DD)
\`\`\``,
  },
  {
    key: 'add-essential-commands',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'create',
    instruction: `Add an Essential Commands section to \`{{instructionFile}}\`:

\`\`\`markdown
## Essential Commands

\\\`\\\`\\\`bash
{{buildCommand}}    # Build
{{testCommand}}     # Test
{{lintCommand}}     # Lint
\\\`\\\`\\\`
\`\`\`

List only commands the agent will actually run. Skip "none".`,
  },

  {
    key: 'add-concrete-examples',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'create',
    instruction: `Add concrete BAD/GOOD or DO/DON'T examples to \`{{instructionFile}}\`. Agents follow examples better than abstract rules.

\`\`\`markdown
BAD:  "The spec says 100 lines for apps" (guessed without reading)
GOOD: Read docs/system-spec.md:104 → "Target 120 lines. Hard limit 150."
\`\`\`

Include at least 2 example pairs showing right vs wrong approaches for your most important rules.`,
  },
  {
    key: 'add-resolvable-paths',
    phase: 'foundation',
    category: 'Instruction File',
    kind: 'fix',
    instruction: `Your instruction file should reference at least 2 real project file paths that exist on disk. Add backtick-wrapped paths in the Router Table and Ask First sections:

\`\`\`markdown
## Router Table

| Resource | Path |
|----------|------|
| Source code | \`src/\` |
| Config | \`.goat-flow/config.yaml\` |

## Autonomy Tiers

**Ask First** Boundaries:
- \`docs/api-spec.md\` changes
- \`src/auth/\` modifications
\`\`\`

These paths must point to files or directories that actually exist in your project.`,
  },

  // === Execution Loop ===
  {
    key: 'add-read-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the READ step to \`{{instructionFile}}\`:

\`\`\`markdown
**READ** - MUST read relevant files before changes. Never fabricate codebase facts.
\`\`\`

This is the first step of the execution loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.`,
  },
  {
    key: 'add-classify-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the CLASSIFY step to \`{{instructionFile}}\`:

\`\`\`markdown
**CLASSIFY** - Three signals: (1) Intent: question → answer, directive → act. (2) Complexity + budgets. (3) Mode.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
\`\`\``,
  },
  {
    key: 'add-classify-budgets',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'fix',
    instruction: `The CLASSIFY step exists but lacks numeric budgets. Add a complexity budget table with concrete read/turn limits:

\`\`\`markdown
| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
| Infrastructure | 8 reads | 25 turns |
\`\`\`

Over budget = re-classify before continuing.`,
  },
  {
    key: 'add-scope-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the SCOPE step to \`{{instructionFile}}\`:

\`\`\`markdown
**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius.
\`\`\``,
  },
  {
    key: 'add-act-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the ACT step to \`{{instructionFile}}\`:

\`\`\`markdown
**ACT** - MUST declare: \\\`State: [MODE] | Goal: [one line] | Exit: [condition]\\\`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No file edits. |
| Implement | Edit in 2-3 turns. |
| Debug | Diagnosis with file:line first. |
\`\`\``,
  },
  {
    key: 'add-verify-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the VERIFY step to \`{{instructionFile}}\`:

\`\`\`markdown
**VERIFY** - MUST check cross-references after renames. Two corrections on same approach = MUST rewind.
\`\`\``,
  },
  {
    key: 'add-log-step',
    phase: 'foundation',
    category: 'Execution Loop',
    kind: 'create',
    instruction: `Add the LOG step to \`{{instructionFile}}\`:

\`\`\`markdown
**LOG** - MUST update when tripped. Use category bucket files - do not append to a monolithic log and do not create one file per incident forever.

| File | When to update |
|------|---------------|
| \\\`ai-docs/lessons/\\\` or \\\`.goat-flow/lessons/\\\` | Behavioural mistake |
| \\\`ai-docs/footguns/\\\` or \\\`.goat-flow/footguns/\\\` | Cross-doc architectural trap |

Lessons use category files such as \\\`verification.md\\\` with frontmatter \\\`category\\\`, then \\\`## Lesson:\\\` / \\\`## Pattern:\\\` entries inside.
Footguns use category files such as \\\`hooks.md\\\` with frontmatter \\\`category\\\`, then \\\`## Footgun:\\\` entries with Status/Created/Evidence type inside.
\`\`\``,
  },
  {
    key: 'create-goat-flow-config',
    phase: 'foundation',
    category: 'Project Config',
    kind: 'create',
    instruction: `Create \`.goat-flow/config.yaml\`:

\`\`\`yaml
version: "0.10.0"
footguns:
  committed: ai-docs/footguns/
  local: .goat-flow/footguns/
lessons:
  committed: ai-docs/lessons/
  local: .goat-flow/lessons/
decisions:
  path: ai-docs/decisions/
tasks:
  path: .goat-flow/tasks/
logs:
  path: .goat-flow/tasks/logs/
agents:
  - {{agentId}}
skills:
  install: all
\`\`\`

If you want auto-detection, omit \`agents\`. If multiple agents are installed, list them explicitly.

Also create \`.goat-flow/config.local.yaml\` (gitignored - personal overrides):

\`\`\`yaml
# Local overrides - this file is gitignored.
# Values here merge on top of config.yaml.
# Uncomment and edit as needed.

# userRole: investigator
\`\`\`

Ensure \`.goat-flow/config.local.yaml\` is gitignored (the default \`.goat-flow/.gitignore\` pattern \`*\` handles this).`,
  },
  {
    key: 'create-config-local',
    phase: 'foundation',
    category: 'Project Config',
    kind: 'fix',
    instruction: `Create \`.goat-flow/config.local.yaml\` for personal overrides (gitignored):

\`\`\`yaml
# Local overrides - this file is gitignored.
# Values here merge on top of config.yaml.
# Uncomment and edit as needed.

# userRole: investigator
\`\`\`

This file is automatically gitignored by the \`.goat-flow/.gitignore\` pattern.`,
  },
  {
    key: 'fix-goat-flow-config',
    phase: 'foundation',
    category: 'Project Config',
    kind: 'fix',
    instruction: `Fix \`.goat-flow/config.yaml\` so it is valid YAML and matches the supported schema:

- \`version\`: string
- \`footguns.committed\`, \`footguns.local\`: non-empty strings
- \`lessons.committed\`, \`lessons.local\`: non-empty strings
- \`decisions.path\`, \`tasks.path\`, \`logs.path\`: non-empty strings
- \`agents\`: null or a non-empty array of \`claude\`, \`codex\`, \`gemini\`
- \`skills.install\`: \`all\` or a non-empty array of skill names

Unknown keys are warnings, not fatal.`,
  },

  // === Autonomy Tiers ===
  {
    key: 'add-autonomy-tiers',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    kind: 'create',
    instruction: `Add three autonomy tiers to \`{{instructionFile}}\`:

\`\`\`markdown
## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope

**Ask First** (MUST answer before proceeding):
- [ ] What else depends on this? [list callers/consumers]
- [ ] How do I undo this? [exact rollback command]

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push.
\`\`\``,
  },
  {
    key: 'project-specific-ask-first',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    kind: 'fix',
    instruction: `The Ask First section in \`{{instructionFile}}\` is too generic. Replace template boundaries with real project paths:

**Instead of:** "auth, routing, deployment, API, DB"
**Write:** The actual files/directories that need approval before changes. Consider which modules are high-risk or cross-cutting.

List 3-7 specific boundaries with actual file paths from this project.`,
  },
  {
    key: 'fix-ask-first-paths',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    kind: 'fix',
    instruction: `The Ask First section in \`{{instructionFile}}\` references file paths that don't exist on disk. For each broken path:

1. Check if the file was renamed - update to the new path
2. Check if the file was deleted - remove from the boundary list
3. Check if it's a typo - fix the path

**Every path in Ask First must resolve.** Phantom paths mislead agents - they'll look for files that don't exist and may create them (the exact anti-pattern this section is meant to prevent).

Run \`ls\` on each backtick-wrapped path to verify.`,
  },
  {
    key: 'add-never-guards',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    kind: 'create',
    instruction: `Add destructive guards to the Never tier in \`{{instructionFile}}\`:

\`\`\`markdown
**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Commit unless asked. Overwrite existing files without checking.
\`\`\``,
  },
  {
    key: 'add-micro-checklist',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    kind: 'create',
    instruction: `Add the Ask First checklist to \`{{instructionFile}}\`. Choose the short form (recommended) or full form (for high-risk/PHI codebases):

**Short form (2 questions):**
\`\`\`markdown
**Ask First** (MUST answer before proceeding):
- [ ] What else depends on this? [list callers/consumers]
- [ ] How do I undo this? [exact rollback command]
\`\`\`

**Full form (5 items - use for healthcare, multi-tenant, or compliance-critical projects):**
\`\`\`markdown
**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local file or "none"]
- [ ] Rollback command: [exact command]
\`\`\``,
  },

  // === Definition of Done ===
  {
    key: 'add-dod',
    phase: 'foundation',
    category: 'Definition of Done',
    kind: 'create',
    instruction: `Add a Definition of Done section to \`{{instructionFile}}\`:

\`\`\`markdown
## Definition of Done

MUST confirm ALL before marking complete.
\`\`\``,
  },
  {
    key: 'add-dod-gates',
    phase: 'foundation',
    category: 'Definition of Done',
    kind: 'create',
    instruction: `Add 6 explicit gates to the DoD section in \`{{instructionFile}}\`:

\`\`\`markdown
MUST confirm ALL: (1) tests pass on changed files (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames
\`\`\``,
  },
  {
    key: 'add-grep-gate',
    phase: 'foundation',
    category: 'Definition of Done',
    kind: 'create',
    instruction: `Add the grep-after-rename gate to DoD in \`{{instructionFile}}\`:

After any rename, grep for the old pattern to confirm zero remaining references.`,
  },
  {
    key: 'add-log-gate',
    phase: 'foundation',
    category: 'Definition of Done',
    kind: 'create',
    instruction: `Add the log-update gate to DoD in \`{{instructionFile}}\`:

If VERIFY caught a failure or you corrected course: create a lesson entry in \`ai-docs/lessons/\` or \`.goat-flow/lessons/\` before DoD.`,
  },

  // === Enforcement ===
  {
    key: 'add-deny-mechanism',
    phase: 'foundation',
    category: 'Enforcement',
    kind: 'create',
    instruction: `Create a deny mechanism for {{agentName}}. This prevents the agent from running destructive commands.`,
    agentOverrides: {
      claude: `Create \`.claude/settings.json\` with deny patterns:

\`\`\`json
{
  "permissions": {
    "deny": [
      "Bash(git commit*)",
      "Bash(git push*)",
      "Bash(rm -rf*)",
      "Read(**/.env*)",
      "Edit(**/.env*)",
      "Write(**/.env*)"
    ]
  }
}
\`\`\``,
      codex: `Create \`.codex/rules/deny-dangerous.star\` (Starlark execpolicy):

\`\`\`starlark
# Block destructive commands via Codex execpolicy
def check(command):
    for pattern in ["git commit", "git push --force", "rm -rf", "chmod 777"]:
        if pattern in command:
            return {"status": "blocked", "message": "BLOCKED: " + pattern}
    return {"status": "allowed"}
\`\`\``,
      gemini: `Create \`.gemini/settings.json\` with deny patterns:

\`\`\`json
{
  "permissions": {
    "deny": ["git commit", "git push", "rm -rf"]
  }
}
\`\`\``,
    },
  },
  {
    key: 'block-git-commit',
    phase: 'foundation',
    category: 'Enforcement',
    kind: 'create',
    instruction: `Add \`git commit\` to the deny list in {{settingsFile}}.

> **Note:** This blocks ALL commits, including when the user explicitly asks to commit. Once trust is established, move \`git commit\` to \`settings.local.json\` allow list to reduce friction on feature branches.`,
    agentOverrides: {
      claude:
        'Add `"Bash(git commit*)"` to `permissions.deny` in `.claude/settings.json`.\n\n> **Escape hatch:** Once trust is established, add `"Bash(git commit*)"` to `.claude/settings.local.json` `permissions.allow` to skip approval on feature branches.',
      codex:
        'Add `"git commit"` to the blocked patterns in `.codex/rules/deny-dangerous.star`.',
      gemini:
        'Add `"git commit"` to `permissions.deny` in `.gemini/settings.json`.',
    },
  },
  {
    key: 'block-git-push',
    phase: 'foundation',
    category: 'Enforcement',
    kind: 'create',
    instruction: `Add \`git push\` to the deny list in {{settingsFile}}.`,
    agentOverrides: {
      claude:
        'Add `"Bash(git push*)"` to `permissions.deny` in `.claude/settings.json`.',
      codex:
        'Add `"git push"` to the blocked patterns in `.codex/rules/deny-dangerous.star`.',
      gemini:
        'Add `"git push"` to `permissions.deny` in `.gemini/settings.json`.',
    },
  },
  {
    key: 'create-deny-script',
    phase: 'foundation',
    category: 'Enforcement',
    kind: 'create',
    instruction: `Create the deny hook/script for {{agentName}}.`,
    agentOverrides: {
      claude: `Create \`.claude/hooks/deny-dangerous.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# PreToolUse hook - block destructive Bash commands
exit 0
\`\`\`

The actual blocking is done via \`permissions.deny\` in settings.json. This hook is a backup for commands that slip through.`,
      codex: `Create \`.codex/rules/deny-dangerous.star\` (see add-deny-mechanism fragment). Optionally create \`scripts/deny-dangerous.sh\` as documentation/self-test only.`,
      gemini: `Create \`.gemini/hooks/deny-dangerous.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# BeforeTool hook - block destructive commands
exit 0
\`\`\``,
    },
  },
];
