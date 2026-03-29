# Setup — Claude Code

Set up or improve GOAT Flow for a project using Claude Code.

**Before you start:** Read [shared/guidelines-audit.md](shared/guidelines-audit.md) and do the audit if applicable.

---

## Claude Code specifics

These are the Claude Code-specific file paths and configurations. The shared
phases below reference "the instruction file" and "the skills directory" — for
Claude Code, these are:

- **Instruction file:** `CLAUDE.md`
- **Settings file:** `.claude/settings.json`
- **Skills directory:** `.claude/skills/`
- **Hooks directory:** `.claude/hooks/`

---

## Phase 1a-c — Foundation

Read and implement [shared/phase-1.md](shared/phase-1.md).

After completing Phase 1a and 1b from the shared instructions, implement
these Claude Code-specific enforcement items:

### Claude Code Enforcement (Phase 1c add-ons)

```
PRE-EXISTING HOOKS:
If hooks already exist in .claude/settings.json, migrate them to
external scripts under .claude/hooks/ before adding new hooks.

HOOKS:
1. .claude/settings.json - Permissions deny list:
   "deny": ["Bash(*git commit*)", "Bash(*git push*)"]

   Note: This blocks ALL commits/pushes, including when the user asks.
   Once trust is established, users can move these to
   .claude/settings.local.json allow list to reduce friction.

   PreToolUse hook: .claude/hooks/deny-dangerous.sh
   - For Bash: block rm -rf, git push main, git push --force, chmod 777,
     pipe-to-shell, --no-verify
   - Use jq for JSON input parsing (grep -P is not portable to macOS).
     Fall back to sed if jq is not installed.
   - Split commands on && || ; before checking patterns — without this,
     chained dangerous commands bypass detection.
   - .env files: block reads via permissions deny list
   - Exit 0 for everything else

   Stop hook: .claude/hooks/stop-lint.sh
   - Stack-adaptive (check git diff for file types)
   - MUST exit 0 even on errors (non-zero causes infinite loops)
   - Infinite loop guard, missing tool checks

   PostToolUse hook: .claude/hooks/format-file.sh
   - Format by file extension. Skip if no formatter configured.

   Notification hook (matcher: "compact"): .claude/hooks/on-compact.sh
   - Re-inject current task, modified files, and constraints after
     context compaction so the agent doesn't lose track mid-session.

   ALL paths MUST use: bash "$(git rev-parse --show-toplevel)/..."

2. Read deny patterns for secrets in .claude/settings.json:
   "Read(.env*)", "Read(**/secrets/**)", "Read(**/*.pem)", "Read(**/*.key)"

INFRASTRUCTURE FACTS:
Add a ## Project Infrastructure section to CLAUDE.md documenting:
- Deployment platform (Docker Compose, Kubernetes, bare VPS, serverless, etc.)
- Branch conventions (e.g., main=prod, develop=staging, feature/* → PRs)
- Required runtime versions (Node 20, PHP 8.2, Python 3.11 — whatever is pinned)
- Container/build rebuild command (exact command to run after server code or
  config changes, e.g., "docker compose up -d --build")
- CI/CD system and what triggers it

Agents without this context propose incompatible syntax, test against stale
containers, and push to the wrong branch. Document from reality, not aspirations.

VERIFICATION:
- GATE: Verify settings.json is valid JSON.
- GATE: Verify deny-dangerous.sh blocks expected commands.
- GATE: Verify stop-lint.sh exits 0 even on errors.
- GATE: Run bash -n on each .sh file to verify syntax.
```

---

## Phase 2 — Evals & Hygiene

Read and implement [shared/phase-2.md](shared/phase-2.md).

---

## Phase 3 — Verify & Quality Control

Read and implement [shared/phase-3.md](shared/phase-3.md).

Run the scanner for Claude Code:
```
goat-flow scan . --agent claude
```

**Definition of Done: 100% score with zero anti-pattern deductions.**
