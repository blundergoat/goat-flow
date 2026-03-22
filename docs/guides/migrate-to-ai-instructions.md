# Migrate from .github/instructions/ to ai/instructions/

For projects that already have `.github/instructions/` files and want to move to the vendor-neutral `ai/instructions/` structure.

---

## Why Migrate

`.github/instructions/` is GitHub-specific. It works for Copilot, but Claude Code, Gemini CLI, Codex, Cursor, and Aider don't auto-discover it. You end up duplicating content in CLAUDE.md, AGENTS.md, and GEMINI.md to compensate.

`ai/instructions/` fixes this:

- **Vendor-neutral** -- works with any agent, any platform, even without GitHub
- **Domain-based instead of file-based** -- `backend.md` covers PHP + Python + SQL together, instead of one file per language
- **Routed** -- `ai/README.md` tells agents which files to load for which tasks
- **Single source of truth** -- edit in `ai/instructions/`, bridge to `.github/instructions/` only if you use Copilot

After migration, `.github/instructions/` files become thin Copilot bridges that reference the `ai/` originals. If you don't use Copilot, you can delete them entirely.

---

## Before You Start

Inventory what you have. Run:

```bash
ls .github/instructions/
```

Typical output for a project like **blundergoat-platform**:

```
ai-agent-guidelines.instructions.md
code-review.instructions.md
commit-messages.instructions.md
frontend.instructions.md
handlers.instructions.md
security.instructions.md
tests.instructions.md
```

Or for a project like **ambient-scribe** (multi-language):

```
php.instructions.md
python.instructions.md
twig.instructions.md
javascript.instructions.md
shell.instructions.md
sql.instructions.md
security.instructions.md
```

Read every file. You need to know what's in them before you can group by domain.

---

## Step 1: Create the ai/ Structure

```bash
mkdir -p ai/instructions
```

Create the router file `ai/README.md`:

```markdown
# Project Coding Guidelines

Read `instructions/base.md` first for every task.

Then load additional files based on the work:

| Task | Load |
|------|------|
| Frontend work | `instructions/frontend.md` |
| Backend work | `instructions/backend.md` |
| Code review | `instructions/code-review.md` |
| Security-sensitive work | `instructions/security.md` |
| Writing tests | `instructions/testing.md` |

Precedence (highest first):
1. security.md (always applies if touching auth/secrets/validation)
2. code-review.md (for review tasks only)
3. domain file (frontend/backend)
4. base.md (always loaded)
```

Remove rows for files you don't create. Add rows if your project needs domain files not listed here (e.g., `instructions/infrastructure.md`).

---

## Step 2: Group by Domain

This is the main work. Map your existing file-scoped instructions into domain-scoped files.

### Mapping Table

| Old file (.github/instructions/) | New file (ai/instructions/) | Notes |
|---|----|---|
| `ai-agent-guidelines.instructions.md` | `base.md` | Project-wide conventions, commands, boundaries |
| `php.instructions.md` | `backend.md` | Combine all backend languages into one file |
| `python.instructions.md` | `backend.md` | Same file -- agents working on backend need both |
| `frontend.instructions.md` | `frontend.md` | Rename, strip `.instructions.md` extension |
| `twig.instructions.md` | `frontend.md` | Twig is a frontend templating concern |
| `javascript.instructions.md` | `frontend.md` | Client-side JS belongs with frontend |
| `shell.instructions.md` | `base.md` | Fold into base if small; keep as own file only if 30+ lines of shell-specific rules |
| `sql.instructions.md` | `backend.md` | SQL is a backend concern |
| `handlers.instructions.md` | `backend.md` | Handler patterns are backend domain |
| `code-review.instructions.md` | `code-review.md` | Rename |
| `commit-messages.instructions.md` | `git-commit.md` | Rename |
| `security.instructions.md` | `security.md` | Rename |
| `tests.instructions.md` | `testing.md` | Rename |

### How to Combine Files

When merging multiple files into one domain file, don't just concatenate. Restructure:

1. **Start with a 2-3 sentence overview** of what this domain covers
2. **Merge overlapping rules** -- if `php.instructions.md` and `python.instructions.md` both say "use type hints," put that once at the top
3. **Use language headers for language-specific rules** -- `## PHP`, `## Python` within `backend.md`
4. **Keep it under 60 lines** -- if the merged file exceeds this, cut the obvious stuff ("write clean code") and keep the project-specific stuff ("use `sqlc.arg(name)` in queries")
5. **Drop rules that are already in your CLAUDE.md/AGENTS.md** -- no duplication between hot path and cold path

### What Goes in base.md

`base.md` is the universal contract -- loaded for every task. Include:

- What the repo is (one paragraph)
- Architecture overview (directory structure, key patterns)
- Build/test/lint commands
- Conventions that apply everywhere (naming, error handling style, logging format)
- Generated files that agents must not edit
- Common footguns

Do **not** put language-specific or domain-specific rules in `base.md`. If a rule only applies when working on the frontend, it belongs in `frontend.md`.

---

## Step 3: Create git-commit Instructions

Two files, serving different purposes.

### ai/instructions/git-commit.md

Full commit conventions for any AI agent. Include commit message format, branch naming, PR workflow, and examples. See `workflow/local-context/git-commit.md` for a template.

### .github/git-commit-instructions.md

Universal commit instructions for any tool or human. This is not agent-specific -- GitHub tools and pre-commit hooks look for it. Include the key rules inline (tools may not follow references).

```markdown
# Commit Message Instructions

Source of truth: `ai/instructions/git-commit.md` (read that file for full details).

## Format

<type>: <what changed and why>

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `ci`

## Rules

- First line under 72 characters
- Lowercase after the type prefix
- Describe what AND why, not just what
- One logical change per commit
```

If `.github/git-commit-instructions.md` already exists, merge your `commit-messages.instructions.md` content into it and delete the old file from `.github/instructions/`.

---

## Step 4: Convert .github/instructions/ to Bridges

After creating the `ai/instructions/` files, replace the content of each `.github/instructions/` file with a bridge.

### Bridge Pattern

A bridge file has `applyTo` frontmatter and includes the full content from the corresponding `ai/instructions/` file inline. Copilot does not follow file references, so the content must be pasted in.

Example -- `.github/instructions/backend.instructions.md`:

```markdown
---
applyTo: "src/api/**,src/services/**,**/*.php,**/*.py"
---

# Backend Instructions

<!-- Source: ai/instructions/backend.md -- keep in sync -->

[Paste the full content of ai/instructions/backend.md here]
```

### applyTo Patterns by Domain

| Domain file | Bridge file | applyTo |
|---|---|---|
| `ai/instructions/base.md` | `.github/instructions/base.instructions.md` | `"**"` |
| `ai/instructions/frontend.md` | `.github/instructions/frontend.instructions.md` | `"src/app/**,src/components/**,*.tsx,*.ts,*.vue,**/*.twig"` |
| `ai/instructions/backend.md` | `.github/instructions/backend.instructions.md` | `"src/api/**,src/services/**,**/*.php,**/*.py,**/*.go"` |
| `ai/instructions/code-review.md` | `.github/instructions/code-review.instructions.md` | `"**"` |
| `ai/instructions/git-commit.md` | `.github/instructions/git-commit.instructions.md` | `"**"` |
| `ai/instructions/security.md` | `.github/instructions/security.instructions.md` | `"**/auth/**,**/middleware/**,**/security/**"` |
| `ai/instructions/testing.md` | `.github/instructions/testing.instructions.md` | `"**/*.test.*,**/*.spec.*,**/test/**,**/tests/**"` |

Adjust the `applyTo` globs to match your project's actual directory structure.

### Delete Old Files

After creating bridges, delete the old `.github/instructions/` files that no longer have a 1:1 mapping:

```bash
# These were merged into backend.md -- delete the originals
rm .github/instructions/php.instructions.md
rm .github/instructions/python.instructions.md
rm .github/instructions/sql.instructions.md
rm .github/instructions/handlers.instructions.md

# This was folded into base.md
rm .github/instructions/shell.instructions.md
rm .github/instructions/ai-agent-guidelines.instructions.md

# This moved to .github/git-commit-instructions.md
rm .github/instructions/commit-messages.instructions.md
```

If you don't use Copilot at all, you can delete `.github/instructions/` entirely. The `ai/instructions/` files are the source of truth.

---

## Step 5: Update Router Tables

Add `ai/README.md` to your agent config file's router table so the agent knows the cold path exists.

### CLAUDE.md

Add this row to the Router Table section:

```markdown
| Project guidelines | `ai/README.md` |
```

### AGENTS.md

Add to the Resource List:

```markdown
| Project guidelines | `ai/README.md` |
```

### GEMINI.md

Add to the Resource List:

```markdown
| Project guidelines | `ai/README.md` |
```

If you have a `.github/copilot-instructions.md`, add the same router entry there too.

---

## Step 6: Verify

Run `goat-flow scan .` and confirm:

- Instructions directory exists (checks `ai/instructions/` first, falls back to `.github/instructions/`)
- Router exists (`ai/README.md`)
- `base.md` exists
- `code-review.md` exists
- `git-commit.md` exists
- `.github/git-commit-instructions.md` exists

All six checks should pass. If any fail, the scan output tells you exactly which file is missing.

If you use Copilot bridges, do a quick diff to make sure they match:

```bash
# Spot-check that bridges are in sync with source
diff <(tail -n +6 .github/instructions/backend.instructions.md) ai/instructions/backend.md
```

---

## Example: blundergoat-platform

A TypeScript full-stack app with 7 `.github/instructions/` files.

### Before

```
.github/instructions/
├── ai-agent-guidelines.instructions.md    # 45 lines - project conventions
├── code-review.instructions.md            # 30 lines - review checklist
├── commit-messages.instructions.md        # 20 lines - commit format
├── frontend.instructions.md               # 35 lines - React/Next.js patterns
├── handlers.instructions.md               # 25 lines - API handler conventions
├── security.instructions.md               # 20 lines - auth, input validation
└── tests.instructions.md                  # 25 lines - Jest, testing-library
```

### After

```
ai/
├── README.md                              # router
└── instructions/
    ├── base.md                            # from ai-agent-guidelines + project analysis
    ├── backend.md                         # from handlers.instructions.md + API conventions
    ├── frontend.md                        # from frontend.instructions.md (renamed)
    ├── code-review.md                     # from code-review.instructions.md (renamed)
    ├── git-commit.md                      # from commit-messages.instructions.md (expanded)
    ├── security.md                        # from security.instructions.md (renamed)
    └── testing.md                         # from tests.instructions.md (renamed)

.github/
├── git-commit-instructions.md            # universal commit rules (new)
└── instructions/
    ├── base.instructions.md              # bridge → ai/instructions/base.md
    ├── backend.instructions.md           # bridge → ai/instructions/backend.md
    ├── frontend.instructions.md          # bridge → ai/instructions/frontend.md
    ├── code-review.instructions.md       # bridge → ai/instructions/code-review.md
    ├── security.instructions.md          # bridge → ai/instructions/security.md
    └── testing.instructions.md           # bridge → ai/instructions/testing.md
```

**7 files** in `.github/instructions/` became **7 domain files** in `ai/instructions/` (this project mapped nearly 1:1 because the original files were already somewhat domain-scoped). The key changes: `ai-agent-guidelines` became `base.md`, `handlers` became `backend.md`, `commit-messages` became `git-commit.md` with a separate `.github/git-commit-instructions.md`.

Old files `ai-agent-guidelines.instructions.md`, `handlers.instructions.md`, and `commit-messages.instructions.md` were deleted. The remaining `.github/instructions/` files were replaced with bridge content.

---

## Example: ambient-scribe

A Symfony + FastAPI medical scribe app with 7 language-scoped `.github/instructions/` files.

### Before

```
.github/instructions/
├── php.instructions.md                    # 40 lines - Symfony, PHP 8.3
├── python.instructions.md                 # 35 lines - FastAPI, Pydantic
├── twig.instructions.md                   # 20 lines - Twig templates
├── javascript.instructions.md             # 25 lines - Alpine.js, Stimulus
├── shell.instructions.md                  # 15 lines - bash conventions
├── sql.instructions.md                    # 20 lines - Doctrine queries, migrations
└── security.instructions.md               # 30 lines - HIPAA, auth, PHI handling
```

### After

```
ai/
├── README.md                              # router
└── instructions/
    ├── base.md                            # project overview + shell conventions (from shell.instructions.md)
    ├── backend.md                         # PHP + Python + SQL merged (from php + python + sql .instructions.md)
    ├── frontend.md                        # Twig + JS merged (from twig + javascript .instructions.md)
    └── security.md                        # from security.instructions.md (expanded for HIPAA)

.github/
├── git-commit-instructions.md            # universal commit rules (new)
└── instructions/
    ├── base.instructions.md              # bridge → ai/instructions/base.md
    ├── backend.instructions.md           # bridge → ai/instructions/backend.md
    ├── frontend.instructions.md          # bridge → ai/instructions/frontend.md
    └── security.instructions.md          # bridge → ai/instructions/security.md
```

**7 language files** became **3 domain files** + `base.md`:

- `php.instructions.md` + `python.instructions.md` + `sql.instructions.md` merged into **`backend.md`** with `## PHP (Symfony)`, `## Python (FastAPI)`, and `## Database` sections. An agent working on the backend needs all three -- they share the same request lifecycle.
- `twig.instructions.md` + `javascript.instructions.md` merged into **`frontend.md`**. Twig renders the HTML, Alpine.js and Stimulus handle interactivity -- same domain.
- `shell.instructions.md` (15 lines of bash conventions) folded into **`base.md`** as a "Shell Scripts" section. Not enough content for its own file.
- `security.instructions.md` stayed as **`security.md`** -- HIPAA rules are cross-cutting and apply to both frontend and backend.

Old files `php.instructions.md`, `python.instructions.md`, `twig.instructions.md`, `javascript.instructions.md`, `shell.instructions.md`, and `sql.instructions.md` were deleted from `.github/instructions/`. The remaining bridges use `applyTo` globs matching the actual project paths:

- `backend.instructions.md`: `applyTo: "src/**/*.php,api/**/*.py,migrations/**"`
- `frontend.instructions.md`: `applyTo: "templates/**/*.twig,assets/**/*.js"`
- `security.instructions.md`: `applyTo: "**/auth/**,**/security/**,**/*Patient*,**/*PHI*"`

---

## Quick Reference

| Step | What to do | Time |
|------|-----------|------|
| 1 | Create `ai/` + `ai/README.md` router | 2 min |
| 2 | Group existing files by domain, write new `ai/instructions/` files | 15-30 min |
| 3 | Create `ai/instructions/git-commit.md` + `.github/git-commit-instructions.md` | 5 min |
| 4 | Replace `.github/instructions/` content with bridges, delete merged files | 10 min |
| 5 | Add `ai/README.md` to CLAUDE.md / AGENTS.md / GEMINI.md router tables | 2 min |
| 6 | Run `goat-flow scan .` and verify all checks pass | 2 min |

Total: 30-50 minutes for a typical project.
