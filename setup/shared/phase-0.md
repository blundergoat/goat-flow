# Phase 0 — Bootstrap (minimal entry point)

Use Phase 0 when you want minimal protection with zero ceremony. Creates only two
things: a lean instruction file and a deny hook. Nothing else.

**Skip to Phase 1 if:** you want skills, docs, evals, or hooks beyond deny.

---

## What Phase 0 Creates

| File | Purpose |
|------|---------|
| `{instruction-file}` (CLAUDE.md / AGENTS.md / GEMINI.md) | 30–50 line instruction file |
| `{settings or hooks}/deny-dangerous.sh` | Block rm -rf, force push, secrets edits |

That's it. No skills, no docs/, no evals, no learning loop files.

---

## Instructions for the Agent

```
GOAL: Minimal GOAT Flow bootstrap — instruction file + deny hook only.

STEP 1 — Detect the project:
- Read package.json / Cargo.toml / go.mod / composer.json (whichever exists)
  to find: language, build command, test command.
- Check if the instruction file already exists. If it does, read it. Do not
  overwrite content that looks intentional — merge instead.

STEP 2 — Create the instruction file (30–50 lines):
Include only these sections:
  # {ProjectName} - v0.1.0
  ## Essential Commands     ← build, test, lint (one line each)
  ## Autonomy Tiers         ← Always / Ask First / Never (minimal list)
  ## Definition of Done     ← 3–4 gates: lint, no broken refs, logs updated

Leave out: execution loop, router table, complexity budgets, working memory,
footguns/lessons references. Those belong in Phase 1.

STEP 3 — Create the deny hook:
For Claude Code: add to .claude/settings.json PreToolUse hook.
For Codex/Gemini: create scripts/deny-dangerous.sh.

The deny hook MUST block: rm -rf, git push --force, .env edits, main/master push.
Use scripts/deny-dangerous.sh as the reference implementation if it exists.

STEP 4 — Verify:
- Instruction file is under 50 lines.
- Deny hook is wired and exits 0 on safe commands.
- Nothing else was created or modified.

NEXT STEP: When ready to expand, run Phase 1 (setup/shared/phase-1.md).
```

---

## When Phase 0 Is the Right Choice

- Greenfield project not ready for full setup
- Adding baseline protection before a long session
- Evaluating GOAT Flow before committing to the full setup

Phase 0 does not satisfy the Foundation tier rubric checks. Run Phase 1 when you
want scanner scores to reflect your setup.
