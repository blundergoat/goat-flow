import type { Fragment } from '../types.js';

/**
 * Tier 3 — Full fragments
 * Agent evals, CI validation, hygiene
 */
export const fullFragments: Fragment[] = [
  // === Agent Evals ===
  {
    key: 'create-evals-dir',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'create',
    instruction: `Create the \`agent-evals/\` directory for agent evaluation scenarios.`,
  },
  {
    key: 'add-evals',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'create',
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
  },
  {
    key: 'add-replay-prompts',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'fix',
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
    kind: 'fix',
    instruction: `Eval files are missing \`**Origin:**\` labels. Add to each eval:

\`\`\`markdown
**Origin:** real-incident
\`\`\`

Use \`real-incident\` for evals from actual bugs/issues. Use \`synthetic-seed\` for designed test scenarios.`,
  },
  {
    key: 'add-agents-labels',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'fix',
    instruction: `Eval files are missing \`**Agents:**\` labels. Add to each eval:

\`\`\`markdown
**Agents:** all
\`\`\`

Use \`all\` if the eval applies to every agent. Use \`claude\`, \`codex\`, or \`gemini\` if agent-specific.`,
  },
  {
    key: 'add-eval-skill-coverage',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'fix',
    instruction: `Each of the 8 canonical skills needs at least one eval. Add a \`skill:\` label to each eval's YAML frontmatter:

\`\`\`yaml
---
skill: goat-debug
origin: real-incident
agents: all
---
\`\`\`

Skills not yet covered should each get one eval targeting their most common failure mode:
- **goat-debug**: agent proposes a fix before completing diagnosis
- **goat-investigate**: agent skips Step 0 and fabricates context
- **goat-plan**: agent continues a stale plan without re-reading context
- **goat-refactor**: agent over-scopes and touches unrelated files
- **goat-review**: agent misses a footgun during code review
- **goat-security**: agent flags a framework-mitigated vulnerability as real
- **goat-simplify**: agent removes logic it didn't understand
- **goat-test**: agent generates tests that miss a critical boundary condition`,
  },

  // === CI Validation ===
  {
    key: 'create-ci-workflow',
    phase: 'full',
    category: 'CI Validation',
    kind: 'create',
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
          for skill in security debug investigate review plan test refactor simplify; do
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
    kind: 'create',
    instruction: `Add a line count check step to \`.github/workflows/context-validation.yml\`:

\`\`\`yaml
- name: Check instruction file line counts
  run: |
    for f in CLAUDE.md AGENTS.md GEMINI.md; do
      [ -f "$f" ] && lines=$(wc -l < "$f") && [ "$lines" -gt 150 ] && echo "::error::$f is $lines lines" && exit 1
    done
\`\`\``,
  },
  {
    key: 'ci-check-router',
    phase: 'full',
    category: 'CI Validation',
    kind: 'create',
    instruction: `Add a router reference check to \`.github/workflows/context-validation.yml\`. This verifies all paths in the router table resolve to existing files.`,
  },
  {
    key: 'ci-check-skills',
    phase: 'full',
    category: 'CI Validation',
    kind: 'create',
    instruction: `Add a skills existence check to \`.github/workflows/context-validation.yml\`. Verify all 8 goat-* skill directories have a SKILL.md.`,
  },
  {
    key: 'ci-trigger-prs',
    phase: 'full',
    category: 'CI Validation',
    kind: 'fix',
    instruction: `Add \`pull_request\` to the CI workflow triggers so validation runs automatically on every PR:

\`\`\`yaml
on: [push, pull_request]
\`\`\`

Without this, PRs can merge without context validation passing.`,
  },

  // === Hygiene ===
  {
    key: 'create-handoff-template',
    phase: 'full',
    category: 'Hygiene',
    kind: 'create',
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
    key: 'fix-handoff-sections',
    phase: 'full',
    category: 'Hygiene',
    kind: 'fix',
    instruction: '`tasks/handoff-template.md` is missing required sections. It must include: ## Status, ## Current State, ## Key Decisions, ## Known Risks, ## Next Step.',
  },
  {
    key: 'add-rfc2119',
    phase: 'full',
    category: 'Hygiene',
    kind: 'create',
    instruction: `Use RFC 2119 language in \`{{instructionFile}}\`: MUST, SHOULD, MAY.

- **MUST** — requirement, blocking
- **SHOULD** — recommended, strong expectation
- **MAY** — optional, acceptable to skip

Ensure at least 3 instances across the instruction file. Use MUST for DoD gates and enforcement, SHOULD for best practices.`,
  },
  // add-changelog removed — CHANGELOG.md is a project-level concern, not an AI workflow artifact.
  // === Execution Loop Sync ===
  {
    key: 'fix-execution-loop-sync',
    phase: 'full',
    category: 'Hygiene',
    kind: 'fix',
    instruction: `Multiple agent instruction files have diverged execution loops. When CLAUDE.md, AGENTS.md, and/or GEMINI.md all contain the execution loop (READ→CLASSIFY→SCOPE→ACT→VERIFY→LOG), changes must be propagated to all copies.

1. Diff the execution loop sections across all agent instruction files
2. Identify intentional differences (agent-specific adaptations) vs accidental drift
3. Reconcile: same rules should use same wording, agent-specific behaviour stays different
4. After reconciling, verify essential commands and Ask First boundaries are also consistent

Note: the execution loop MUST be duplicated (each file is loaded independently). The goal is consistency, not deduplication.`,
  },
  // diversify-evals removed — merged into add-eval-skill-coverage after 3.4.1 was removed.
];
