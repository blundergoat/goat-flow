import type { Fragment } from '../types.js';

/**
 * Tier 3 - Full fragments
 * Agent evals, CI validation, hygiene
 */
export const fullFragments: Fragment[] = [
  // === Agent Evals ===
  {
    key: 'create-evals-dir',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'create',
    instruction: `Create the \`ai/evals/\` directory for agent evaluation scenarios.`,
  },
  {
    key: 'add-evals',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'create',
    instruction: `Add 3+ eval files to \`ai/evals/\`. Each eval should capture a real incident:

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
    instruction: `Each of the 6 canonical skills needs at least one eval. Add a \`skill:\` label to each eval's YAML frontmatter:

\`\`\`yaml
---
skill: goat-debug
origin: real-incident
agents: all
---
\`\`\`

Skills not yet covered should each get one eval targeting their most common failure mode:
- **goat-debug**: agent proposes a fix before completing diagnosis; investigate mode: agent skips Step 0 and fabricates context
- **goat-plan**: agent continues a stale plan without re-reading context; refactor mode: agent over-scopes and touches unrelated files
- **goat-review**: agent misses a footgun during code review; simplify mode: agent removes logic it didn't understand
- **goat-security**: agent flags a framework-mitigated vulnerability as real
- **goat-test**: agent generates tests that miss a critical boundary condition`,
  },

  // === CI Validation ===
  {
    key: 'create-ci-workflow',
    phase: 'full',
    category: 'CI Validation',
    kind: 'create',
    instruction: `Copy the CI template to \`.github/workflows/context-validation.yml\`.

**Template:** Read \`workflow/templates/context-validation.yml\` from the goat-flow package and copy it to your project's \`.github/workflows/\` directory.

Do NOT rename the step names — the scanner checks for these exact strings: "Check instruction file line counts", "Check router references", "Check skills exist".

If the template file is not available, create \`.github/workflows/context-validation.yml\` with these steps:
1. Check instruction file line counts (CLAUDE.md, AGENTS.md, GEMINI.md must be ≤150 lines)
2. Run \`bash scripts/context-validate.sh\` for router reference validation
3. Check that the 6 canonical skill directories exist: goat, goat-debug, goat-plan, goat-review, goat-security, goat-test`,
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
    instruction: `Add a router reference check to \`.github/workflows/context-validation.yml\`. This verifies all paths in the router table resolve to existing files.

IMPORTANT: If writing inline shell instead of calling a script, do NOT use \`grep ... | while read\` — the pipe creates a subshell and error counts won't propagate. Use process substitution: \`while read ... done < <(grep ...)\` or write results to a temp file.`,
  },
  {
    key: 'ci-check-skills',
    phase: 'full',
    category: 'CI Validation',
    kind: 'create',
    instruction: `Add a skills existence check to \`.github/workflows/context-validation.yml\`. Verify all 6 goat-flow skill directories (5 + dispatcher) have a SKILL.md.`,
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
    key: 'create-logs-dir',
    phase: 'full',
    category: 'Hygiene',
    kind: 'create',
    instruction: `Create the telemetry logs directory for session tracking:

\`\`\`bash
mkdir -p .goat-flow/logs/sessions
\`\`\`

Copy the README from the goat-flow templates: \`workflow/evaluation/logs-README.md\` → \`.goat-flow/logs/README.md\`.

Add to \`.gitignore\`:
\`\`\`
.goat-flow/
\`\`\`

This enables the skill session logging protocol (Shared Conventions closing step) and telemetry from \`goat-flow scan\`.`,
  },
  {
    key: 'add-rfc2119',
    phase: 'full',
    category: 'Hygiene',
    kind: 'create',
    instruction: `Use RFC 2119 language in \`{{instructionFile}}\`: MUST, SHOULD, MAY.

- **MUST** - requirement, blocking
- **SHOULD** - recommended, strong expectation
- **MAY** - optional, acceptable to skip

Ensure at least 3 instances across the instruction file. Use MUST for DoD gates and enforcement, SHOULD for best practices.`,
  },
  // add-changelog removed - CHANGELOG.md is a project-level concern, not an AI workflow artifact.
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
  // diversify-evals removed - merged into add-eval-skill-coverage after 3.4.1 was removed.
  {
    key: 'fix-eval-frontmatter',
    phase: 'full',
    category: 'Agent Evals',
    kind: 'fix',
    instruction: `Some eval files use legacy format (bold markers like \`**Origin:**\`) instead of YAML frontmatter. Migrate all evals to canonical format with \`---\` frontmatter containing name, description, origin, agents, skill, and difficulty fields. Use \`### Scenario\` (not \`## Replay Prompt\`), checkbox gates in \`### Expected Behavior\`, and bullet list \`### Anti-Patterns\`.`,
  },
];
