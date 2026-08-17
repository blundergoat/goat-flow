/**
 * The starter files a user gets from `goat-flow skill new`.
 *
 * Each template is a complete, working skill or playbook with its required sections already in place, so someone creating their first one starts from
 * something valid and edits it, rather than facing an empty file and guessing at the contract.
 *
 * Placeholders use `{{name}}`-style markers filled in at scaffold time.
 * Keep the section headings here in step with what the skill contracts actually require - a template that drifts hands every new author a file that
 * fails validation the moment they run it.
 */

const WORKFLOW_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline, mode system) and \`.goat-flow/skill-docs/skill-conventions.md\` before acting.

## When to Use

Use when [describe the trigger condition for this skill].

**NOT this skill:** [list distinctly different intents that route elsewhere].

## Read First

[List the files / directories the skill must load before acting.]

## Step 0 - Intake

State the intake context:
- Goal: [one-line goal]
- Mode: [Read-Only | File-Write - defaults to Read-Only]
- Read first: [files this skill will load]

## Phase 1 - [Title]

[Procedure for the first phase.]

CHECKPOINT: [what stops execution before continuing to Phase 2].

## Phase 2 - [Title]

[Procedure for the second phase.]

CHECKPOINT: [what stops execution before continuing].

## Phase 3 - [Title]

[Procedure for the third phase.]

## Verification

Apply the Proof Gate from \`skill-preamble.md\` to every claim. Evidence required for every CONFIRMED finding.

- [ ] [criterion 1]
- [ ] [criterion 2]

BLOCKING GATE: human approval required before [final action].

## Modes

- **Read-Only mode**: [describe what this skill does in read-only mode].
- **File-Write mode**: [describe; requires explicit mode confirmation and human approval].

Mode escalation requires explicit user approval before any write.
`;

const DISPATCHER_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline) before routing.

## When to Use

Use when the user's intent matches one of the routes below. This skill does not execute work itself; it dispatches to other skills.

## How It Works

This skill is a router. It reads user intent, matches it against the route map, and dispatches to the appropriate sibling skill. No file writes happen at this layer - the dispatched skill owns its own gates and verification.

## Route Map

| User intent | Route to |
|---|---|
| [intent A - describe] | [/skill-name-a] |
| [intent B - describe] | [/skill-name-b] |
| Unknown intent | Ask the user to clarify before dispatching |

## Read First

Read \`skill-preamble.md\` for the Proof Gate the dispatched skill will apply.
`;

const REPORT_TEMPLATE = `---
name: {{NAME}}
description: "{{DESCRIPTION}}"
goat-flow-skill-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# /{{NAME}}

## Shared Conventions

Always read \`.goat-flow/skill-docs/skill-preamble.md\` (Proof Gate, evidence discipline) before scanning.

## When to Use

Use when [describe the assessment trigger - audit, review, scan].

**NOT this skill:** [list distinctly different intents - for instance, this is reporting-only; if writes are required, route elsewhere].

## Read First

Read \`skill-preamble.md\` and any project-specific scope files before scanning.

## Quick Scan Path

[Fast assessment for low-risk cases. Lists targets, surfaces obvious findings, exits with a summary.]

## Full Assessment Path

[Deeper assessment for high-risk cases. Multi-phase scan with structured output.]

## Output Format

Reports findings as structured markdown:

\`\`\`markdown
## Findings

- **CONFIRMED**: [finding] - evidence: [OBSERVED file + semantic anchor]
- **SUSPECTED**: [finding] - evidence: [INFERRED reasoning]
\`\`\`

## Constraints

This skill is reporting-only. It must not write files or modify state. If a finding warrants action, route to the appropriate execution skill via the dispatcher.

## Verification

Apply the Proof Gate from \`skill-preamble.md\`. Every CONFIRMED finding requires fresh evidence (OBSERVED tag with file + semantic anchor) re-read in the current session.

- [ ] every finding has cited evidence
- [ ] no fabricated or paraphrased claims

BLOCKING GATE: human reviews findings before any action is taken.
`;

const PLAYBOOK_TEMPLATE = `---
goat-flow-reference-version: "{{VERSION}}"
goat-flow-ownership: "user-owned"
---

# {{NAME}}

## Purpose

{{DESCRIPTION}}

## Availability Check

\`\`\`bash
command -v {{NAME}} || echo "{{NAME}} not installed; use the manual fallback below"
\`\`\`

If the tool is unavailable, use the [Fallback / Troubleshooting](#fallback--troubleshooting) section.

## Boundary

- **Use when:** [describe the tool/capability situation this playbook handles].
- **Do not use when:** [name the adjacent skill, playbook, or instruction-file route].
- **Writes:** read-only guidance unless the workflow below names an explicit file-write action and verification gate.

## Workflow

### Step 1: [Action]

\`\`\`bash
[command]
\`\`\`

[What this step does and what to verify.]

### Step 2: [Verify]

[How to confirm the action succeeded - what file appears, what output is expected.]

## Fallback / Troubleshooting

If the tool is unavailable or fails:
- **Alternative tool**: [describe the alternative]
- **Manual approach**: [describe the manual procedure]
- **Common errors**: [list likely failure modes and remedies]

## Verification Gate

- [ ] Availability check result recorded, or non-runnable reference load condition stated.
- [ ] Boundary still routes adjacent work to the right skill, playbook, instruction file, or CLI.
- [ ] Workflow output has concrete pass/fail evidence.

## When to Load

Skills load this playbook when [describe the trigger - e.g., when user evidence requires browser interaction].
`;

export const TEMPLATES_BY_SUBTYPE: Record<string, string> = {
  workflow: WORKFLOW_TEMPLATE,
  dispatcher: DISPATCHER_TEMPLATE,
  report: REPORT_TEMPLATE,
  playbook: PLAYBOOK_TEMPLATE,
};
