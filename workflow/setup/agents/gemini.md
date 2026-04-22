# Agent Config - Gemini CLI

> Canonical machine-readable source for these paths: `workflow/manifest.json` via `src/cli/agents/registry.ts`. If this doc drifts, the manifest-backed registry wins.

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `GEMINI.md` |
| Settings | `.gemini/settings.json` |
| Skills directory | `.agents/skills/` |
| Hooks directory | `.gemini/hooks/` |
| Hook events used by default template | `BeforeTool` |

## Owns

GEMINI.md, `.gemini/`, and shared `.goat-flow/`.

`.agents/skills/` is a **shared surface** - both Codex and Gemini use it as their skills directory. Either agent's setup can create/update skills here.

## Hands off

CLAUDE.md, AGENTS.md, `.claude/`, `.codex/`.

## Agent-specific setup

### Hooks

After completing step 03 (skills):
- Copy scripts from `workflow/hooks/` to `.gemini/hooks/`: `deny-dangerous.sh` (required)
- Copy `workflow/hooks/agent-config/gemini.json` as `.gemini/settings.json` (ships the deny list and the `BeforeTool` Bash deny-hook registration)
- Create `.geminiignore` with secret patterns: `.env*`, `!.env.example`, `**/secrets/`, `**/*.pem`, `**/*.key`

If the project later opts into post-turn validation hooks, Gemini's post-turn event is `AfterAgent`. The default goat-flow template does not install a post-turn hook.

### Verification

- `.gemini/settings.json` is valid JSON
- `bash -n` passes on each hook script
- `bash .gemini/hooks/deny-dangerous.sh --self-test` passes

---

Begin setup: proceed to `01-system-overview.md`
