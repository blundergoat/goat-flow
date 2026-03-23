# Workflow Templates

Templates and prompts for the GOAT Flow workflow layers. See
`docs/system/five-layers.md` for the full architecture.

## Subdirectories

| Directory | Purpose |
|-----------|---------|
| `evaluation/` | Learning loop templates: footguns, lessons, evals, CI validation, handoff |
| `coding-standards/` | Coding standards templates (conventions, code review, security, testing, git commit) |
| `playbooks/planning/` | Feature brief, mob elaboration, SBAO ranking, milestone planning |
| `playbooks/testing/` | Testing workflow methodology and test plan generation |
| `runtime/` | Enforcement hooks, permission profiles, RFC 2119, code map, architecture, guidelines split |
| `skills/` | 10 goat-* skill templates: security, debug, audit, investigate, review, plan, test, reflect, onboard, resume |

## Usage

These are **prompt templates**, not executable code. Copy the prompt
block from any file and paste it into your coding agent. The setup
guides in `setup/` reference these templates during Phase 1b (skills)
and Phase 2 (evaluation).
