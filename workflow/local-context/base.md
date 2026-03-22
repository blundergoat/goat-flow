# Prompt: Create ai/instructions/base.md

This is the always-loaded instruction file. Every agent task reads this first.

---

## The Prompt

Read the codebase, then write `ai/instructions/base.md` following this structure:

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

DO: Keep functions under 40 lines. Extract a helper when you exceed this.

DON'T: Add commented-out code. Delete it — git has history.

DO: Use named exports, not default exports.
```ts
// Good
export function UserCard() { ... }

// Bad
export default function() { ... }
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
