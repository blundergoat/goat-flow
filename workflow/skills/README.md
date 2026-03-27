# Layer 3 - Skill Templates

This folder contains the skill templates used during Phase 1b setup. Each file is the
authoritative template for the corresponding skill. For skill documentation (when to use,
design rationale, decision table), see [docs/system/skills.md](../../docs/system/skills.md).

## Active Skills (9)

| Template | Creates |
|----------|---------|
| goat-investigate.md | Deep codebase investigation + onboarding mode |
| goat-review.md | Structured code review + instruction-file audit mode |
| goat-security.md | Threat-model-driven security assessment |
| goat-debug.md | Diagnosis-first debugging |
| goat-plan.md | 4-phase planning workflow |
| goat-audit.md | Multi-phase quality audit |
| goat-test.md | 3-phase test plan generation |
| goat-context.md | Session context reconstruction |
| goat-refactor.md | Cross-file refactoring with verification |

## Shared Infrastructure

| File | Purpose |
|------|---------|
| shared-preamble.md | Shared conventions referenced by all skills |
| output-skeletons.md | Literal output templates for all report types |

## Deprecated (will be removed next version)

| Template | Merged into | Migration |
|----------|-------------|-----------|
| goat-onboard.md | goat-investigate (onboard mode) | Use `/goat-investigate` with purpose = "onboarding" |
| goat-reflect.md | goat-review (instruction review mode) | Use `/goat-review` with target = "instruction files" |
