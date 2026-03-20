# Domain Instruction Files (Layer 2)

Domain instruction files keep deep domain knowledge out of the always-loaded Layer 1 budget. They live in `.github/instructions/` and load automatically when the agent works on files matching their glob pattern.

---

## When to Use

After the root instruction file (CLAUDE.md / AGENTS.md) is set up. Create domain files when:
- A domain has conventions that differ from the project default
- A domain has 2+ footgun entries in docs/footguns.md
- A domain is an Ask First boundary
- The domain is complex enough that an agent needs dedicated context

## Where They Live

All domain instruction files go in `.github/instructions/`. One file per domain.

```
.github/instructions/
├── backend-php.instructions.md
├── frontend-react.instructions.md
├── database.instructions.md
├── testing.instructions.md
└── infrastructure.instructions.md
```

Each file has YAML frontmatter with an `applyTo` glob pattern that tells the agent when to load it:

```yaml
---
applyTo: "src/auth/**"
---
```

This works with Claude Code, GitHub Copilot, and Codex. For agents that don't support `applyTo` natively, add the files to the router table in your root instruction file so the agent knows to read them when working in that area.

---

## The Prompt

```
Create domain-specific instruction files for this project. These are
Layer 2 (Local Context) — they load automatically when the agent works
in a specific area, keeping deep domain knowledge out of the root
instruction file's line budget.

All files go in .github/instructions/

STEP 1 — DISCOVER DOMAINS

Read the entire codebase first. Do NOT invent conventions — extract
rules from what the code already does.

Look for these natural boundaries:
- Languages/frameworks (PHP/Laravel, TypeScript/React, Go, Rust, Python)
- Database/SQL layer (if distinct patterns from general backend)
- API layer (if distinct conventions)
- Test infrastructure (shared utilities, fixtures, patterns)
- Infrastructure/DevOps (Docker, CI, deployment)
- Shared libraries or utilities (common helpers, shared modules)
- Domain areas with unique patterns (auth, payments, notifications)

Only create files for domains that genuinely exist. A small project
may need 2-3 files. A large multi-language app may need 6-8.

STEP 2 — CREATE DOMAIN FILES

For each domain, create .github/instructions/{domain}.instructions.md

Examples: backend-php.instructions.md, frontend-react.instructions.md,
testing.instructions.md, database.instructions.md

Each file MUST have:

1. YAML FRONTMATTER with applyTo glob:
   ---
   applyTo: "src/auth/**"
   ---

2. SECTIONS:
   - **Overview** — what this area does (2-3 sentences)
   - **Key files** — which files own what responsibility
   - **Conventions** — patterns extracted from existing code
   - **Gotchas** — "never do this" warnings with file:line evidence
   - **Cross-boundary dependencies** — what breaks if you change here
   - **Code example** — one concise example showing the correct pattern
   - **See also** — link to root instruction file and relevant
     docs/footguns.md entries

Rules:
- Each file MUST be self-contained — an agent reading only this file
  should be able to work correctly in that area
- Target 200-400 lines per file
- Every gotcha must reference real code (file:line where possible)
- Extract patterns from what the code already does
- Cross-reference docs/footguns.md — summarise relevant footguns here

STEP 3 — UPDATE ROUTER TABLE

Add all created files to the root instruction file's router table:

| Resource | Path |
|----------|------|
| [domain] conventions | .github/instructions/{domain}.instructions.md |

VERIFICATION:
- Verify each file has valid YAML frontmatter with applyTo glob
- Verify applyTo globs match actual paths in the project
- Verify each file is self-contained (overview, conventions, gotchas)
- Verify no invented conventions — all extracted from existing code
- Verify router table updated
- Report: number of files created and which domains they cover
```
