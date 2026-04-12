/**
 * Prompt fragments promoted from the former Full tier into Standard.
 * Hygiene, execution loop sync, skill conventions.
 */
import type { Fragment } from "../types.js";

export const promotedFragments: Fragment[] = [
  // Agent Evals fragments removed - evals system removed in v1.1.0 (M09).

  // CI Validation fragments removed - CI workflow is a project-level concern.

  // === Hygiene ===
  // create-handoff-template and fix-handoff-sections removed - handoff is workspace-level, not a rubric concern.
  {
    key: "create-logs-dir",
    phase: "standard",
    category: "Hygiene",
    kind: "create",
    instruction: `Create the telemetry logs directory for session tracking:

\`\`\`bash
mkdir -p .goat-flow/logs/sessions
\`\`\`

Copy the README from the goat-flow templates: \`workflow/evaluation/README.md\` → \`.goat-flow/logs/README.md\`.

Add to \`.gitignore\`:
\`\`\`
.goat-flow/
\`\`\`

This enables the skill session logging protocol (Shared Conventions closing step) and telemetry from \`goat-flow audit\`.`,
  },
  {
    key: "add-rfc2119",
    phase: "standard",
    category: "Hygiene",
    kind: "create",
    instruction: `Use RFC 2119 language in \`{{instructionFile}}\`: MUST, SHOULD, MAY.

- **MUST** - requirement, blocking
- **SHOULD** - recommended, strong expectation
- **MAY** - optional, acceptable to skip

Ensure at least 3 instances across the instruction file. Use MUST for DoD gates and enforcement, SHOULD for best practices.`,
  },
  // add-changelog removed - CHANGELOG.md is a project-level concern, not an AI workflow artifact.
  // === Execution Loop Sync ===
  {
    key: "fix-execution-loop-sync",
    phase: "standard",
    category: "Hygiene",
    kind: "fix",
    instruction: `Multiple agent instruction files have diverged execution loops. When CLAUDE.md, AGENTS.md, and/or GEMINI.md all contain the execution loop (READ → SCOPE → ACT → VERIFY), changes must be propagated to all copies.

1. Diff the execution loop sections across all agent instruction files
2. Identify intentional differences (agent-specific adaptations) vs accidental drift
3. Reconcile: same rules should use same wording, agent-specific behaviour stays different
4. After reconciling, verify essential commands and Ask First boundaries are also consistent

Note: the execution loop MUST be duplicated (each file is loaded independently). The goal is consistency, not deduplication.`,
  },

  // === Skill Conventions ===
  {
    key: "create-skill-conventions",
    phase: "standard",
    category: "Skill Conventions",
    kind: "create",
    instruction:
      "Create `.goat-flow/skill-preamble.md` and `.goat-flow/skill-conventions.md`. Copy from `workflow/skills/reference/skill-preamble.md` and `workflow/skills/reference/skill-conventions.md`.",
  },
];
