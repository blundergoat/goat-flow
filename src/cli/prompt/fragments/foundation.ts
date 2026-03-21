import type { Fragment } from '../types.js';

/**
 * Tier 1 — Foundation fragments (22 check keys)
 * Instruction file, execution loop, autonomy tiers, DoD, enforcement
 */
export const foundationFragments: Fragment[] = [
  // === Instruction File ===
  {
    key: 'create-instruction-file',
    phase: 'foundation',
    category: 'Instruction File',
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
    instruction: `\`{{instructionFile}}\` is over the 120-line target. Compress it:

1. Remove verbose examples — one BAD/GOOD pair per concept is enough
2. Replace explanatory paragraphs with terse bullet points
3. Collapse tables where a one-liner suffices
4. Move reference material to \`docs/\` and link from the router table

Hard limit: 150 lines. Target: under 120.`,
  },
  {
    key: 'add-version-header',
    phase: 'foundation',
    category: 'Instruction File',
    instruction: `Add a version header to line 1 of \`{{instructionFile}}\`:

\`\`\`markdown
# {{instructionFile}} - v1.0 (YYYY-MM-DD)
\`\`\``,
  },
  {
    key: 'add-essential-commands',
    phase: 'foundation',
    category: 'Instruction File',
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

  // === Execution Loop ===
  {
    key: 'add-read-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the READ step to \`{{instructionFile}}\`:

\`\`\`markdown
**READ** - MUST read relevant files before changes. Never fabricate codebase facts.
\`\`\`

This is the first step of the execution loop: READ → CLASSIFY → SCOPE → ACT → VERIFY → LOG.`,
    dependsOn: ['create-instruction-file'],
  },
  {
    key: 'add-classify-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the CLASSIFY step to \`{{instructionFile}}\`:

\`\`\`markdown
**CLASSIFY** - Three signals: (1) Intent: question → answer, directive → act. (2) Complexity + budgets. (3) Mode.

| Complexity | Read budget | Turn budget |
|------------|-------------|-------------|
| Hotfix | 2 reads | 3 turns |
| Standard Feature | 4 reads | 10 turns |
| System Change | 6 reads | 20 turns |
\`\`\``,
    dependsOn: ['add-read-step'],
  },
  {
    key: 'add-scope-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the SCOPE step to \`{{instructionFile}}\`:

\`\`\`markdown
**SCOPE** - MUST declare before acting: files allowed to change, non-goals, max blast radius.
\`\`\``,
    dependsOn: ['add-classify-step'],
  },
  {
    key: 'add-act-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the ACT step to \`{{instructionFile}}\`:

\`\`\`markdown
**ACT** - MUST declare: \\\`State: [MODE] | Goal: [one line] | Exit: [condition]\\\`

| Mode | Behaviour |
|------|-----------|
| Plan | Produce artefact only. No file edits. |
| Implement | Edit in 2-3 turns. |
| Debug | Diagnosis with file:line first. |
\`\`\``,
    dependsOn: ['add-scope-step'],
  },
  {
    key: 'add-verify-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the VERIFY step to \`{{instructionFile}}\`:

\`\`\`markdown
**VERIFY** - MUST run \\\`{{lintCommand}}\\\` on changes. MUST check cross-references after renames.
Two corrections on same approach = MUST rewind.
\`\`\``,
    dependsOn: ['add-act-step'],
  },
  {
    key: 'add-log-step',
    phase: 'foundation',
    category: 'Execution Loop',
    instruction: `Add the LOG step to \`{{instructionFile}}\`:

\`\`\`markdown
**LOG** - MUST update when tripped.

| File | When to update |
|------|---------------|
| \\\`docs/lessons.md\\\` | Behavioural mistake |
| \\\`docs/footguns.md\\\` | Cross-doc architectural trap |
\`\`\``,
    dependsOn: ['add-verify-step'],
  },

  // === Autonomy Tiers ===
  {
    key: 'add-autonomy-tiers',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    instruction: `Add three autonomy tiers to \`{{instructionFile}}\`:

\`\`\`markdown
## Autonomy Tiers

**Always:** Read any file, lint scripts, edit within assigned scope

**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Rollback command: [exact command]

**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push.
\`\`\``,
    dependsOn: ['create-instruction-file'],
  },
  {
    key: 'project-specific-ask-first',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    instruction: `The Ask First section in \`{{instructionFile}}\` is too generic. Replace template boundaries with real project paths:

**Instead of:** "auth, routing, deployment, API, DB"
**Write:** The actual files/directories that need approval before changes. Consider which modules are high-risk or cross-cutting.

List 3-7 specific boundaries with actual file paths from this project.`,
    dependsOn: ['add-autonomy-tiers'],
  },
  {
    key: 'add-never-guards',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    instruction: `Add destructive guards to the Never tier in \`{{instructionFile}}\`:

\`\`\`markdown
**Never:** Delete docs without replacement. Modify .env/secrets. Push to main. Force push. Commit unless asked. Overwrite existing files without checking.
\`\`\``,
    dependsOn: ['add-autonomy-tiers'],
  },
  {
    key: 'add-micro-checklist',
    phase: 'foundation',
    category: 'Autonomy Tiers',
    instruction: `Add the 5-item micro-checklist to Ask First in \`{{instructionFile}}\`:

\`\`\`markdown
**Ask First** (MUST complete before proceeding):
- [ ] Boundary touched: [name]
- [ ] Related code read: [yes/no]
- [ ] Footgun entry checked: [relevant entry, or "none"]
- [ ] Local instruction checked: [local file or "none"]
- [ ] Rollback command: [exact command]
\`\`\``,
    dependsOn: ['add-autonomy-tiers'],
  },

  // === Definition of Done ===
  {
    key: 'add-dod',
    phase: 'foundation',
    category: 'Definition of Done',
    instruction: `Add a Definition of Done section to \`{{instructionFile}}\`:

\`\`\`markdown
## Definition of Done

MUST confirm ALL before marking complete.
\`\`\``,
    dependsOn: ['create-instruction-file'],
  },
  {
    key: 'add-dod-gates',
    phase: 'foundation',
    category: 'Definition of Done',
    instruction: `Add 6 explicit gates to the DoD section in \`{{instructionFile}}\`:

\`\`\`markdown
MUST confirm ALL: (1) tests pass on changed files (2) no broken cross-references (3) no unapproved boundary changes (4) logs updated if tripped (5) working notes current (6) grep old pattern after renames
\`\`\``,
    dependsOn: ['add-dod'],
  },
  {
    key: 'add-grep-gate',
    phase: 'foundation',
    category: 'Definition of Done',
    instruction: `Add the grep-after-rename gate to DoD in \`{{instructionFile}}\`:

After any rename, grep for the old pattern to confirm zero remaining references.`,
    dependsOn: ['add-dod'],
  },
  {
    key: 'add-log-gate',
    phase: 'foundation',
    category: 'Definition of Done',
    instruction: `Add the log-update gate to DoD in \`{{instructionFile}}\`:

If VERIFY caught a failure or you corrected course: \`docs/lessons.md\` entry required before DoD.`,
    dependsOn: ['add-dod'],
  },

  // === Enforcement ===
  {
    key: 'add-deny-mechanism',
    phase: 'foundation',
    category: 'Enforcement',
    instruction: `Create a deny mechanism for {{agentName}}. This prevents the agent from running destructive commands.`,
    agentOverrides: {
      claude: `Create \`.claude/settings.json\` with deny patterns:

\`\`\`json
{
  "permissions": {
    "deny": [
      "Bash(git commit*)",
      "Bash(git push*)",
      "Bash(rm -rf*)"
    ]
  }
}
\`\`\``,
      codex: `Create \`scripts/deny-dangerous.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# Block destructive commands
case "$1" in
  *"git commit"*|*"git push"*|*"rm -rf"*) echo "BLOCKED: $1"; exit 1 ;;
esac
\`\`\`

Make it executable: \`chmod +x scripts/deny-dangerous.sh\``,
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
    instruction: `Add \`git commit\` to the deny list in {{settingsFile}}.`,
    agentOverrides: {
      claude: 'Add `"Bash(git commit*)"` to `permissions.deny` in `.claude/settings.json`.',
      codex: 'Add a case for `*"git commit"*` in `scripts/deny-dangerous.sh`.',
      gemini: 'Add `"git commit"` to `permissions.deny` in `.gemini/settings.json`.',
    },
    dependsOn: ['add-deny-mechanism'],
  },
  {
    key: 'block-git-push',
    phase: 'foundation',
    category: 'Enforcement',
    instruction: `Add \`git push\` to the deny list in {{settingsFile}}.`,
    agentOverrides: {
      claude: 'Add `"Bash(git push*)"` to `permissions.deny` in `.claude/settings.json`.',
      codex: 'Add a case for `*"git push"*` in `scripts/deny-dangerous.sh`.',
      gemini: 'Add `"git push"` to `permissions.deny` in `.gemini/settings.json`.',
    },
    dependsOn: ['add-deny-mechanism'],
  },
  {
    key: 'create-deny-script',
    phase: 'foundation',
    category: 'Enforcement',
    instruction: `Create the deny hook/script for {{agentName}}.`,
    agentOverrides: {
      claude: `Create \`.claude/hooks/deny-dangerous.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# PreToolUse hook — block destructive Bash commands
exit 0
\`\`\`

The actual blocking is done via \`permissions.deny\` in settings.json. This hook is a backup for commands that slip through.`,
      codex: `Create \`scripts/deny-dangerous.sh\` (see add-deny-mechanism fragment).`,
      gemini: `Create \`.gemini/hooks/deny-dangerous.sh\`:

\`\`\`bash
#!/usr/bin/env bash
# BeforeTool hook — block destructive commands
exit 0
\`\`\``,
    },
  },
];
