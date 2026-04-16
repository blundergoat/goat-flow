---
name: goat
description: "The primary GOAT Flow skill for all engineering tasks. Includes modes: debug, test, plan, review, security, and sbao. Use this whenever you need to apply a structured workflow."
goat-flow-skill-version: "1.1.0"
---
# /goat

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## Usage

Use this skill when you need to perform a structured engineering task. Choose the appropriate mode based on your intent:

| Mode | Use When... | Implementation |
|------|-------------|----------------|
| **debug** | Diagnosing a bug, failure, or investigating unfamiliar code. | Read `DEBUG.md` |
| **test** | Identifying testing gaps, coverage, or verifying changes. | Read `TEST.md` |
| **plan** | Creating milestones and structured task lists for features. | Read `PLAN.md` |
| **review** | Performing a structured code review or quality audit. | Read `REVIEW.md` |
| **security** | Threat modeling or auditing dependencies and security. | Read `SECURITY.md` |
| **sbao** | Critiquing a plan or approach via multi-perspective analysis. | Read `SBAO.md` |

## Progressive Disclosure

1. **Activate:** Call `activate_skill(name="goat")`.
2. **Context:** Read `.goat-flow/skill-preamble.md` for shared conventions.
3. **Dispatch:** Identify your mode from the table above and read the corresponding `.md` file.

## Planning Route (Dispatcher)

For planning requests, always check `.goat-flow/tasks/` for existing milestone files before starting fresh.

| Complexity | Approach |
|------------|----------|
| **Hotfix** | Skip `plan` mode. Implement directly using `READ → SCOPE → ACT → VERIFY`. |
| **Small Feature** | Use `plan` mode for 1-2 milestones with minimal ceremony. |
| **Standard** | Use `plan` mode for full milestone breakdown with testing gates. |
| **System/Infra** | Use `plan` mode → `sbao` mode for cross-boundary critique. |

## Constraints

- MUST read `skill-preamble.md` before proceeding to any specific mode.
- MUST choose exactly one mode for the current task.
- MUST include a one-sentence rationale for the chosen mode in your response.
- MUST NOT load more than one mode's logic unless the task specifically requires a transition (e.g., debug → plan).
