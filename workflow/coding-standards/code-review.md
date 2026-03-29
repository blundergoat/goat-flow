# Prompt: Create ai/instructions/code-review.md

Load this file when reviewing code (PRs, diffs, audit tasks).

---

## The Prompt

Write `ai/instructions/code-review.md`:

````
IMPORTANT: When listing anti-patterns or review checks, verify each against actual code:
- Do not reference files that don't exist — run ls/find to confirm paths
- Do not list API contracts that aren't implemented — read the source
- Do not include checks for patterns the project doesn't use
- Every file path in backticks must be verified before including it

# Code Review Instructions

## Priority Order

Check in this order. Stop and flag blocking issues before continuing.

1. **Security** — SQL injection, auth bypass, secret leaks, path traversal?
2. **Correctness** — Does the code do what the PR says it does?
3. **Data integrity** — Missing transactions, race conditions, partial writes?
4. **Maintainability** — Can someone else understand this in 6 months?
5. **Performance** — Only flag if measurable (N+1 queries, unbounded loops).

## Approval Criteria

Approve when ALL are true:
- Tests pass and cover the changed logic
- No security issues (load `security.md` if unsure)
- No broken error handling (errors logged or returned, never swallowed)
- Public API changes are backwards-compatible or explicitly versioned
- Database migrations are reversible

## Anti-Patterns to Flag

**Swallowed errors.** Must log or return — never silently drop.
```go
// Bad — error disappears
result, _ := db.Query(query)

// Good — handle it
result, err := db.Query(query)
if err != nil {
    return fmt.Errorf("list users: %w", err)
}
```

**Unbounded queries.** Every database query must have a LIMIT or pagination.
```sql
-- Bad
SELECT * FROM events WHERE org_id = $1;

-- Good
SELECT * FROM events WHERE org_id = $1 LIMIT 100 OFFSET $2;
```

**Hardcoded secrets or config.** Use environment variables.
```ts
// Bad
const apiKey = "sk-live-abc123";

// Good
const apiKey = process.env.STRIPE_API_KEY;
```

**Missing input validation.** All external input must be validated before use.
```go
// Bad — trusts user input
func handler(w http.ResponseWriter, r *http.Request) {
    id := r.URL.Query().Get("id")
    db.Query("SELECT * FROM users WHERE id = " + id)
}
```

**Overly broad catches.** Catch specific errors, not everything.
```ts
// Bad
try { ... } catch (e) { console.log("something failed"); }

// Good
try { ... } catch (e) {
  if (e instanceof ValidationError) { ... }
  throw e; // re-throw unexpected errors
}
```

## Dependency & Architecture Checks

**Dependency changes:** Any new dependency must justify its addition. Check: is it maintained (last commit)? Are there open CVEs? Are there alternatives already in the project? What's the size impact?
```
# When reviewing a PR that adds a dependency, verify:
1. Lockfile updated (not just package.json / go.mod)
2. No unnecessary transitive dependencies pulled in
3. License is compatible (MIT, Apache-2.0, BSD — flag GPL in non-GPL projects)
4. Package is not deprecated or abandoned
```

**API surface changes:** Public API changes need backwards-compatibility analysis. Breaking changes need explicit versioning.
```
# Flags to look for in API changes:
- Removed or renamed fields → breaking (even if "nobody uses it")
- Changed field types → breaking
- New required fields → breaking
- New optional fields → safe
- Changed HTTP status codes → breaking for clients that branch on status
```

**Error handling audit:** Every `catch`, `rescue`, `except`, or `if err != nil` must either: handle the error, wrap with context and re-raise, or explicitly document why it's swallowed.
```go
// Flag this in review — swallowed error
result, _ := db.Query(query)

// Flag this — catch-all with no context
try { riskyOp(); } catch (e) { return null; }

// Acceptable — explicitly documented suppression
_, _ = writer.Write(logMsg) // best-effort logging, failure is non-critical
```

**Concurrency review:** Check for shared mutable state, missing locks, race conditions in concurrent code. Use `-race` flag for Go tests, thread sanitizers for C/C++.
```bash
# Go: always run tests with race detector in CI
go test -race ./...

# C/C++: compile with thread sanitizer for concurrency tests
clang -fsanitize=thread -g -o test_binary test.c

# JS/TS: check for shared mutable state in async code
# Flag: module-level let/var mutated inside async functions
```

## Do NOT Nitpick

These are handled by linters — do not comment on them:
- Formatting, whitespace, semicolons
- Import ordering
- Variable naming style (camelCase vs snake_case) unless inconsistent within a file
- Line length (configured in linter)
- Trailing commas
````

Adjust the language-specific examples to match this project's stack.
Target 40-60 lines of content (not counting the prompt wrapper).
