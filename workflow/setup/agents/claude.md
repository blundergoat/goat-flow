# Agent Config - Claude Code

## Paths

| Resource | Path |
|----------|------|
| Instruction file | `CLAUDE.md` |
| Settings | `.claude/settings.json` |
| Skills directory | `.claude/skills/` |
| Hooks directory | `.claude/hooks/` |

## Owns

CLAUDE.md, `.claude/`, and shared `.goat-flow/`.

## Hands off

AGENTS.md, GEMINI.md, `.agents/`, `.gemini/`, `.codex/`.

## Agent-specific setup

### Hooks

After completing step 03 (skills), wire hooks:
- Copy scripts from `workflow/hooks/` to `.claude/hooks/`: `deny-dangerous.sh` (required)
- Copy `workflow/hooks/agent-config/claude.json` as the base for `.claude/settings.json`. The default template keeps secret deny patterns plus git commit/push blocking.
- If hooks already exist in `.claude/settings.json`, migrate inline commands to external scripts under `.claude/hooks/` before adding new hooks.
- If the project uses a code formatter (prettier, biome, etc.), add `.goat-flow/skill-preamble.md` and `.goat-flow/**/*.md` to the formatter's ignore file (`.prettierignore`, `biome.json` ignores, etc.). Verify YAML examples in skill-preamble.md still use `---` delimiters after formatting.

### Conditional rules

For large codebases, add `<important if="...">` tags to CLAUDE.md to scope rules to relevant contexts:
```
<important if="editing PHP files">
PHPStan level 10 must pass. Run: vendor/bin/phpstan analyse
</important>
```
Only Claude Code supports this syntax.

### Verification

- `.claude/settings.json` is valid JSON
- `bash -n` passes on each hook script
- deny-dangerous.sh blocks: rm -rf, git push main, --force, chmod 777

---

Begin setup: proceed to `01-system-overview.md`
