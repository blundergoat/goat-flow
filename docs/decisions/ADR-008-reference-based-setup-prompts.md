# ADR-008: Replace inline setup skeletons with reference-based prompts

**Date:** 2026-03-28
**Status:** Accepted

## Context

The v0.6.0 `goat-flow setup` command generated ~860-line inline prompts containing full skeleton templates for every file the agent needed to create (CLAUDE.md, skills, hooks, settings, docs). This approach had three problems observed across 9 project deployments:

1. **Template drift.** The inline skeletons were duplicated from `workflow/` templates into `src/cli/prompt/fragments/`. When templates were updated, the inline copies lagged behind — creating contradictions between what the setup told agents to create and what the scanner expected.

2. **Agent copy-paste.** Agents receiving 860 lines of inline skeleton tended to copy them with minimal adaptation. The resulting CLAUDE.md files contained placeholder text ("[describe X]", "[your project's build command]") that the agent left unfilled. Real project-specific content was rare.

3. **Context budget waste.** 860 lines consumed a significant portion of the agent's context window on template boilerplate, leaving less room for the agent to read actual project files and adapt the output.

The reference-based alternative was validated during manual setup of healthkit and halaxy-cypress: giving the agent a path to a template file and saying "adapt this for the project" produced better results than giving it the template inline.

## Decision

Replace inline skeleton generation with reference-based prompts that point agents at template files.

- `goat-flow setup` now generates ~90-line prompts containing a template path table (skill name → `workflow/skills/goat-{name}.md` path) plus adaptation guidance
- The agent reads each template from disk at setup time, getting the canonical current version — no inline copy to drift
- Language-to-coding-standards mapper auto-selects the right backend/frontend/security templates based on detected stack
- Per-agent `--agent claude|codex|gemini` flag replaces `--agent all` (which tried to generate one prompt for all agents and produced confused output)
- `GOAT_FLOW_INLINE_SETUP=1` env var preserves the old fragment-based renderer as a rollback mechanism

## Consequences

- Templates in `workflow/` and `setup/` are now the single source of truth — updating a template immediately affects the next setup run
- Agents must have filesystem access to read templates (true for Claude Code, Codex, Gemini CLI; may not work for cloud-only agents)
- Setup output is dramatically shorter (~90 vs ~860 lines), freeing context budget for project-specific adaptation
- The `setup/` and `workflow/` directories are included in the npm tarball (`"files"` in package.json) so templates ship with the CLI
- Skill-quality recommendation keys (add-skill-step0, add-skill-human-gates, etc.) must render as instruction text, not template paths — otherwise they all resolve to "Adapt from goat-debug.md" (bug found and fixed during this release)
- Multi-agent deduplication: when multiple agents are detected, shared files (docs, scripts) are rendered once with per-agent sections following
