# Prompt: Create Domain Instruction Files (Layer 2)

Paste this into your coding agent to create domain-scoped instruction files that auto-load when the agent works in that area of the codebase.

---

## When to Use

After the root instruction file (CLAUDE.md / AGENTS.md) is set up. Domain instruction files are Layer 2 — they keep deep domain knowledge out of the always-loaded Layer 1 budget and load automatically when the agent enters that directory.

## File Locations

| Agent | Path | Auto-loading |
|-------|------|-------------|
| Claude Code | `.github/instructions/{domain}.instructions.md` | Via `applyTo` frontmatter glob |
| Claude Code | `{directory}/CLAUDE.md` | Auto-loaded when working in that directory |
| Codex | `.github/instructions/{domain}.instructions.md` | Via `applyTo` frontmatter glob |

Use `.github/instructions/` for domain-scoped files with glob matching. Use directory-level `CLAUDE.md` files for high-risk directories that need auto-loading on every access (see `workflow/runtime/claude-code-prompts.md` Phase 1a, Step 5 for local CLAUDE.md guidance).

---

## The Prompt

```
Create domain-specific instruction files for this project. These are
Layer 2 (Local Context) — they load automatically when the agent works
in a specific area, keeping deep domain knowledge out of the root
instruction file's line budget.

Read the entire codebase first to discover the actual domains, conventions,
and patterns in use. Do NOT invent conventions — extract rules from what
the code already does.

Create one file per distinct domain in .github/instructions/:

For each domain file:

1. FRONTMATTER — YAML with applyTo glob pattern:
   ---
   applyTo: "src/auth/**"
   ---

2. STRUCTURE — each file should cover:
   - Domain overview (what this area does, 2-3 sentences)
   - File structure (key files and what they own)
   - Conventions and patterns (extracted from existing code)
   - Common gotchas and "never do this" warnings
   - Cross-boundary dependencies (what breaks if you change things here)
   - A concise code example showing the correct pattern
   - See Also: link back to CLAUDE.md for the execution loop and
     autonomy tiers

3. RULES:
   - Each file MUST be self-contained: an agent reading only this file
     should be able to work correctly in that area
   - Target 200-400 lines per file
   - Every gotcha must reference real code (file:line where possible)
   - Extract patterns from the existing codebase, don't prescribe new ones
   - Cross-reference docs/footguns.md — if footguns exist for this
     domain, summarise them here

DOMAIN DISCOVERY — look for these natural boundaries:
- Backend language/framework (e.g., PHP/Laravel, Go, Rust)
- Frontend framework (e.g., React, Vue, Svelte)
- Database/SQL layer
- API layer (if distinct patterns from general backend)
- Test infrastructure
- Infrastructure/DevOps (Docker, CI, deployment)
- Shared utilities or libraries
- Domain-specific areas with unique patterns (auth, payments, etc.)

Name files: {domain}.instructions.md (e.g., backend-php.instructions.md,
frontend-react.instructions.md, database.instructions.md)

Only create files for domains that genuinely exist in this codebase.
A small project may have 2-3 files. A large multi-language app may
have 6-8.

VERIFICATION:
- Verify each file has valid YAML frontmatter with applyTo glob
- Verify applyTo globs match actual directory paths in the project
- Verify each file is self-contained (has overview, conventions, gotchas)
- Verify no invented conventions (all extracted from existing code)
- Verify root instruction file router table references .github/instructions/
- Report: number of domain files created and which domains they cover
```
