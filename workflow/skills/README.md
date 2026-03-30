# Layer 3 - Skill Templates

This folder contains the skill templates used during Phase 1b setup. Each file is the
authoritative template for the corresponding skill. Every skill is self-contained -
no external references required.

For skill documentation (when to use, design rationale, decision table), see
[docs/system/skills.md](../../docs/system/skills.md).

## Active Skills (5)

| Template | Creates |
|----------|---------|
| goat-debug.md | Diagnosis-first debugging + investigate/onboard mode |
| goat-review.md | Structured code review + quality audit mode + instruction review mode + simplify mode |
| goat-security.md | Threat-model-driven security assessment |
| goat-plan.md | 4-phase planning workflow + refactor planning mode |
| goat-test.md | 3-phase test plan generation |

## Reference (internal to goat-flow)

These files are design references for the goat-flow project itself. They are NOT
referenced by the skill templates and are NOT needed in target projects.

| File | Purpose |
|------|---------|
| reference/shared-preamble.md | Original shared conventions (now inlined into each skill) |

## Migration Notes

- **goat-onboard** was merged into goat-debug (investigate/onboard mode). Use `/goat-debug` with purpose = "onboarding".
- **goat-reflect** was merged into goat-review (instruction review mode). Use `/goat-review` with target = "instruction files".
- **goat-audit** was merged into goat-review (audit mode). Use `/goat-review` with target = "codebase area".
- **goat-resume** was renamed to goat-context, then removed. Session resumption is handled by the agent's built-in context.
- **goat-investigate** was merged into goat-debug (investigate mode). Use `/goat-debug` with purpose = "investigation".
- **goat-simplify** was merged into goat-review (simplify mode). Use `/goat-review` with target = "readability".
- **goat-refactor** was merged into goat-plan (refactor planning mode). Use `/goat-plan` with purpose = "refactoring".
