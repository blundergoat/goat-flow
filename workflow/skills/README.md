# Layer 3 - Skill Templates

This folder contains the skill templates used during Phase 1b setup. Each file is the
authoritative template for the corresponding skill. Every skill is self-contained —
no external references required.

For skill documentation (when to use, design rationale, decision table), see
[docs/system/skills.md](../../docs/system/skills.md).

## Active Skills (8)

| Template | Creates |
|----------|---------|
| goat-investigate.md | Deep codebase investigation + onboarding mode |
| goat-review.md | Structured code review + quality audit mode + instruction review mode |
| goat-security.md | Threat-model-driven security assessment |
| goat-debug.md | Diagnosis-first debugging |
| goat-plan.md | 4-phase planning workflow |
| goat-test.md | 3-phase test plan generation |
| goat-refactor.md | Cross-file refactoring with verification |
| goat-simplify.md | Code readability and self-documentation improvement |

## Reference (internal to goat-flow)

These files are design references for the goat-flow project itself. They are NOT
referenced by the skill templates and are NOT needed in target projects.

| File | Purpose |
|------|---------|
| reference/shared-preamble.md | Original shared conventions (now inlined into each skill) |
| reference/output-skeletons.md | Output format templates for all report types |

## Migration Notes

- **goat-onboard** was merged into goat-investigate (onboard mode). Use `/goat-investigate` with purpose = "onboarding".
- **goat-reflect** was merged into goat-review (instruction review mode). Use `/goat-review` with target = "instruction files".
- **goat-audit** was merged into goat-review (audit mode). Use `/goat-review` with target = "codebase area".
- **goat-resume** was renamed to goat-context, then removed. Session resumption is handled by the agent's built-in context.
- **goat-simplify** is new — code readability and self-documentation improvement.
