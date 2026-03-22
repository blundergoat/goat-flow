# Prompt: Create ai/instructions/conventions.md

This is the always-loaded instruction file. Every agent task reads this first.

---

## The Prompt

Read the codebase, then write `ai/instructions/conventions.md` following this structure:

```
IMPORTANT: Only document what currently exists in the codebase.
- Verify every claim by reading actual source files, not documentation or roadmaps
- Do NOT include planned/aspirational features from docs/architecture.md or roadmaps
- If a doc says something exists, check the code before including it
- Run the actual commands (build, test, lint) to confirm they work before listing them

# Base Instructions

## Project Identity

[One line: what this project is and what it does.]

## Architecture

[2-3 lines describing the high-level architecture. Example:]

Next.js frontend in `src/app/`, Go API in `cmd/api/`, PostgreSQL database.
Frontend calls API over REST. Background jobs run via `cmd/worker/`.
Shared types live in `pkg/types/` — both API and worker import them.

## Build / Test / Lint

```bash
npm run dev          # Start frontend dev server on :3000
go run ./cmd/api     # Start API on :8080
npm test             # Frontend tests (vitest)
go test ./...        # Backend tests
npm run lint         # ESLint + Prettier check
golangci-lint run    # Go linter
```

## Coding Conventions

DO: Use early returns to reduce nesting.
```go
// Good
if err != nil {
    return fmt.Errorf("fetch user: %w", err)
}
```

DON'T: Wrap errors without context.
```go
// Bad — loses call site info
return err
```

DO: Co-locate test files next to source.
```
src/components/Button.tsx
src/components/Button.test.tsx
```

DON'T: Put all tests in a top-level `__tests__/` directory.

DO: Name boolean variables as questions.
```ts
const isLoading = true;
const hasPermission = user.role === "admin";
```

DON'T: Use negative boolean names.
```ts
// Bad — double negatives cause bugs
const isNotDisabled = true;
```

DO: Keep functions under 50 lines (target 40 lines; hard limit 50). Extract a helper when you exceed this.

DON'T: Add commented-out code. Delete it — git has history.

DO: Use named exports, not default exports.
```ts
// Good
export function UserCard() { ... }

// Bad
export default function() { ... }
```

## Universal Standards (apply to all projects regardless of codebase)

**Function length:** Hard limit 50 lines. If a function exceeds this, extract a helper. No exceptions.

**Cyclomatic complexity:** Max 10 branches per function. Flatten with early returns, guard clauses, or strategy pattern.
```go
// Bad — deeply nested, high complexity
func process(order Order) error {
    if order.IsValid() {
        if order.HasItems() {
            for _, item := range order.Items {
                if item.InStock() {
                    if item.Price > 0 {
                        // ... 5 levels deep
                    }
                }
            }
        }
    }
    return nil
}

// Good — early returns, flat structure
func process(order Order) error {
    if !order.IsValid() {
        return fmt.Errorf("invalid order: %s", order.ID)
    }
    if !order.HasItems() {
        return fmt.Errorf("order %s has no items", order.ID)
    }
    for _, item := range order.Items {
        if err := processItem(item); err != nil {
            return fmt.Errorf("process item %s: %w", item.ID, err)
        }
    }
    return nil
}
```

**Dependencies:** Pin exact versions in lockfiles. Run `npm audit` / `cargo audit` / `pip-audit` before adding new deps. Prefer well-maintained deps with >1000 GitHub stars or proven track record.
```bash
# Before adding any dependency, check:
# 1. Is it maintained? (last commit within 6 months)
# 2. Open CVEs? (npm audit, cargo audit, pip-audit)
# 3. Alternatives already in the project?
# 4. Size impact? (bundlephobia.com for JS, cargo bloat for Rust)
```

**Supply chain security:** Never run install scripts from untrusted sources. Verify package checksums when available. Prefer `--ignore-scripts` for npm install in CI.
```bash
# CI installs — use locked, verified dependencies
npm ci --ignore-scripts        # Node
pip install --require-hashes   # Python
```

**CLI tool preferences:** Use ripgrep (`rg`) over `grep` for speed. Use `fd` over `find`. Use `jq` for JSON processing. Use `ast-grep` for structural code search when regex is insufficient.
```bash
rg "TODO|FIXME" --type ts           # fast, respects .gitignore
fd "\.test\.ts$" src/                # intuitive, fast file search
jq '.dependencies | keys' package.json  # structured JSON queries
ast-grep -p 'console.log($$$)' src/     # structural match, not string match
```

**Dead code:** Delete unused code immediately. Don't comment it out — git has history. Don't add TODO comments for code you just wrote — either implement it now or create a task.
```ts
// Bad — commented-out graveyard
// function oldHandler() { ... }
// TODO: maybe use this later?

// Bad — TODO for code you're actively writing
export function newHandler() {
  // TODO: implement validation
  // TODO: add error handling
}

// Good — either implement it or don't write the function yet
export function newHandler(req: Request): Response {
  const validated = validateInput(req.body);
  if (!validated.ok) {
    return errorResponse(400, validated.error);
  }
  return processRequest(validated.data);
}
```

**Error messages:** Include what went wrong, what was expected, and what to do about it.
```
Bad:  "Connection failed"
Bad:  "Error: ECONNREFUSED"
Good: "Failed to connect to database at localhost:5432 — is PostgreSQL running? Try: docker compose up -d"
Good: "Config file not found at ~/.config/app/config.toml — run 'app init' to create one"
```

## Generated Files — Never Edit

- `src/generated/api-client.ts` — run `npm run codegen` to regenerate
- `db/schema.sql` — managed by migrations in `db/migrations/`
- `*.lock` files — managed by package managers

## Dangerous Operations

- `db/migrations/` — migrations run automatically on deploy. Test locally first with `make migrate-test`.
- `pkg/types/` — shared between API and worker. Changes here break two services. Run both test suites.
- `.env.production` — never commit. Use `.env.example` as the template.

## Common Commands

```bash
make setup           # First-time project setup
make seed            # Seed database with test data
make migrate         # Run pending migrations
make docker-up       # Start all services in Docker
```
```

Replace the examples above with real values extracted from this project's codebase.
Every command must be runnable. Every convention must match existing code patterns.
Target 50-60 lines of content (not counting the prompt wrapper).
