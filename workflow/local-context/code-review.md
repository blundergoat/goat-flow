# Prompt: Create ai/instructions/code-review.md

Load this file when reviewing code (PRs, diffs, audit tasks).

---

## The Prompt

Write `ai/instructions/code-review.md`:

```
IMPORTANT: When listing anti-patterns or review checks, verify each against actual code:
- Do not reference files that don't exist — run ls/find to confirm paths
- Do not list API contracts that aren't implemented — read the source
- Do not include checks for patterns the project doesn't use
- Every file path in backticks must be verified before including it

# Code Review Instructions

## Priority Order

Check in this order. Stop and flag blocking issues before continuing.

1. **Correctness** — Does the code do what the PR says it does?
2. **Security** — SQL injection, auth bypass, secret leaks, path traversal?
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

## Do NOT Nitpick

These are handled by linters — do not comment on them:
- Formatting, whitespace, semicolons
- Import ordering
- Variable naming style (camelCase vs snake_case) unless inconsistent within a file
- Line length (configured in linter)
- Trailing commas
```

Adjust the language-specific examples to match this project's stack.
