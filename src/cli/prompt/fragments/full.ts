import type { Fragment } from '../types.js';

/**
 * Tier 3 — Full fragments (19 check keys)
 * Agent evals, CI validation, permission profiles, guidelines ownership, hygiene
 */
export const fullFragments: Fragment[] = [
  // === Agent Evals ===
  {
    key: 'create-evals-dir',
    phase: 'full',
    category: 'Agent Evals',
    instruction: `Create the \`agent-evals/\` directory for agent evaluation scenarios.`,
  },
  {
    key: 'create-evals-readme',
    phase: 'full',
    category: 'Agent Evals',
    instruction: `Create \`agent-evals/README.md\`:

\`\`\`markdown
# Agent Evals

Replay scenarios for testing agent behaviour. Each eval captures a real incident or synthetic seed.

## Format

Each eval file contains:
- **Origin:** real-incident | synthetic-seed
- **Agents:** which agents this applies to
- **Replay Prompt:** the exact prompt to paste

## Running Evals

Paste the Replay Prompt into the agent and verify it handles the scenario correctly.
\`\`\``,
    dependsOn: ['create-evals-dir'],
  },
  {
    key: 'add-evals',
    phase: 'full',
    category: 'Agent Evals',
    instruction: `Add 3+ eval files to \`agent-evals/\`. Each eval should capture a real incident:

\`\`\`markdown
# Eval: [Short description]

**Origin:** real-incident
**Agents:** all

## Context

[What was happening when the incident occurred]

## Replay Prompt

\\\`\\\`\\\`
[Exact prompt to reproduce the scenario]
\\\`\\\`\\\`

## Expected Behaviour

[What the agent should do]
\`\`\`

Prefer real incidents over synthetic seeds. At least 3 evals required.`,
    dependsOn: ['create-evals-dir'],
  },
  {
    key: 'add-replay-prompts',
    phase: 'full',
    category: 'Agent Evals',
    instruction: `Eval files are missing \`## Replay Prompt\` sections. Add a replay prompt to each eval:

\`\`\`markdown
## Replay Prompt

\\\`\\\`\\\`
[The exact text to paste into the agent to replay this scenario]
\\\`\\\`\\\`
\`\`\``,
  },
  {
    key: 'add-origin-labels',
    phase: 'full',
    category: 'Agent Evals',
    instruction: `Eval files are missing \`**Origin:**\` labels. Add to each eval:

\`\`\`markdown
**Origin:** real-incident
\`\`\`

Use \`real-incident\` for evals from actual bugs/issues. Use \`synthetic-seed\` for designed test scenarios.`,
  },

  // === CI Validation ===
  {
    key: 'create-ci-workflow',
    phase: 'full',
    category: 'CI Validation',
    instruction: `Create \`.github/workflows/context-validation.yml\`:

\`\`\`yaml
name: Context Validation
on: [push, pull_request]
jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Check instruction file line counts
        run: |
          for f in CLAUDE.md AGENTS.md GEMINI.md; do
            [ -f "$f" ] && lines=$(wc -l < "$f") && [ "$lines" -gt 150 ] && echo "::error::$f is $lines lines (limit 150)" && exit 1
          done
      - name: Check router references
        run: bash scripts/context-validate.sh || true
      - name: Check skills exist
        run: |
          for skill in preflight debug audit investigate review plan test; do
            for dir in .claude/skills .agents/skills; do
              [ -d "$dir/goat-$skill" ] && echo "✓ $dir/goat-$skill"
            done
          done
\`\`\``,
  },
  {
    key: 'ci-check-lines',
    phase: 'full',
    category: 'CI Validation',
    instruction: `Add a line count check step to \`.github/workflows/context-validation.yml\`:

\`\`\`yaml
- name: Check instruction file line counts
  run: |
    for f in CLAUDE.md AGENTS.md GEMINI.md; do
      [ -f "$f" ] && lines=$(wc -l < "$f") && [ "$lines" -gt 150 ] && echo "::error::$f is $lines lines" && exit 1
    done
\`\`\``,
    dependsOn: ['create-ci-workflow'],
  },
  {
    key: 'ci-check-router',
    phase: 'full',
    category: 'CI Validation',
    instruction: `Add a router reference check to \`.github/workflows/context-validation.yml\`. This verifies all paths in the router table resolve to existing files.`,
    dependsOn: ['create-ci-workflow'],
  },
  {
    key: 'ci-check-skills',
    phase: 'full',
    category: 'CI Validation',
    instruction: `Add a skills existence check to \`.github/workflows/context-validation.yml\`. Verify all 7 goat-* skill directories have a SKILL.md.`,
    dependsOn: ['create-ci-workflow'],
  },

  // === Permission Profiles ===
  {
    key: 'create-profiles-dir',
    phase: 'full',
    category: 'Permission Profiles',
    instruction: `Create \`.claude/profiles/\` directory for role-based permission profiles. Profiles allow different permission sets for different tasks (e.g., reviewer vs implementer).`,
  },
  {
    key: 'create-profiles',
    phase: 'full',
    category: 'Permission Profiles',
    instruction: `Create 2+ permission profiles in \`.claude/profiles/\`. Example:

\`\`\`json
// .claude/profiles/reviewer.json
{
  "permissions": {
    "deny": ["Bash(git commit*)", "Bash(git push*)", "Edit(*)", "Write(*)"]
  }
}
\`\`\`

Common profiles: reviewer (read-only), implementer (edit within scope), admin (full access).`,
    dependsOn: ['create-profiles-dir'],
  },
  {
    key: 'route-profiles',
    phase: 'full',
    category: 'Permission Profiles',
    instruction: `Add profiles to the router table in \`{{instructionFile}}\`:

\`\`\`markdown
| Profiles | \\\`.claude/profiles/\\\` |
\`\`\``,
  },

  // === Guidelines Ownership ===
  {
    key: 'fix-dod-overlap',
    phase: 'full',
    category: 'Guidelines Ownership',
    instruction: `The Definition of Done appears in both the instruction file and a guidelines file. Remove the DoD from the guidelines file — it belongs only in \`{{instructionFile}}\`.`,
  },
  {
    key: 'fix-loop-overlap',
    phase: 'full',
    category: 'Guidelines Ownership',
    instruction: `Execution loop content appears in both the instruction file and a guidelines file. Remove execution loop content from the guidelines file — it belongs only in \`{{instructionFile}}\`.`,
  },
  {
    key: 'create-ownership-split',
    phase: 'full',
    category: 'Guidelines Ownership',
    instruction: `Create \`docs/guidelines-ownership-split.md\` documenting what was migrated from guidelines to the instruction file and why.`,
  },
  {
    key: 'verify-separation',
    phase: 'full',
    category: 'Guidelines Ownership',
    instruction: `Verify clean separation: autonomy tiers, stop-the-line rules, and DoD should only appear in \`{{instructionFile}}\`, not in any guidelines file.`,
  },

  // === Hygiene ===
  {
    key: 'create-handoff-template',
    phase: 'full',
    category: 'Hygiene',
    instruction: `Create \`tasks/handoff-template.md\`:

\`\`\`markdown
# Handoff: [Task Name]

**Date:** YYYY-MM-DD
**Status:** incomplete | blocked | ready-for-review

## Current State
[What was done, what remains]

## Key Decisions
[Decisions made during this session]

## Known Risks
[What could go wrong]

## Next Step
[Exactly what to do next]
\`\`\``,
  },
  {
    key: 'add-rfc2119',
    phase: 'full',
    category: 'Hygiene',
    instruction: `Use RFC 2119 language in \`{{instructionFile}}\`: MUST, SHOULD, MAY.

- **MUST** — requirement, blocking
- **SHOULD** — recommended, strong expectation
- **MAY** — optional, acceptable to skip

Ensure at least 3 instances across the instruction file. Use MUST for DoD gates and enforcement, SHOULD for best practices.`,
  },
  {
    key: 'add-changelog',
    phase: 'full',
    category: 'Hygiene',
    instruction: `Add version tracking. Either:

**Option A:** Add a version history section to \`{{instructionFile}}\`
**Option B:** Create \`CHANGELOG.md\` at the project root

Track meaningful changes to the GOAT Flow configuration (not code changes).`,
  },
];
