# Prompt: Create ai/instructions/security.md

Cross-cutting security overlay. Load this whenever touching auth, secrets, validation, or user input.

---

## The Prompt

Write `ai/instructions/security.md`:

```
# Security Instructions

This file overrides all other instruction files when there is a conflict.

## Input Validation

Validate ALL external input at the boundary (HTTP handler, CLI parser, message consumer).
Never trust input from: request bodies, query params, headers, file uploads, webhook payloads.

```go
// Good — validate and constrain before use
pageSize, err := strconv.Atoi(r.URL.Query().Get("limit"))
if err != nil || pageSize < 1 || pageSize > 100 {
    pageSize = 20
}

// Bad — unbounded user input hits the database
limit := r.URL.Query().Get("limit")
db.Query(fmt.Sprintf("SELECT * FROM users LIMIT %s", limit))
```

Reject first, then allow. Default to deny.

## Authentication Boundaries

- Every endpoint must be explicitly marked public or authenticated. No implicit access.
- Auth middleware runs before handlers. Never check auth inside a handler.
- Token validation happens once at the middleware layer, not per-service-call.

```go
// Good — middleware handles auth
mux.Handle("/api/v1/users", authMiddleware(userHandler))
mux.Handle("/api/v1/health", publicHandler) // explicitly public

// Bad — auth check buried in handler
func handler(w http.ResponseWriter, r *http.Request) {
    token := r.Header.Get("Authorization")
    if !isValid(token) { ... } // easy to forget in new handlers
}
```

## Secret Handling

- Secrets come from environment variables ONLY. Never from config files, CLI args, or hardcoded strings.
- Never log secrets: tokens, passwords, API keys, session IDs.
- Never include secrets in error messages returned to clients.
- `.env` files are gitignored. Use `.env.example` with placeholder values.

```bash
# .env.example — committed, no real values
DATABASE_URL=postgres://user:password@localhost:5432/myapp_dev
STRIPE_API_KEY=sk_test_placeholder
JWT_SECRET=replace-me-with-random-64-chars

# .env — gitignored, real values
DATABASE_URL=postgres://prod_user:real_password@db.internal:5432/myapp
```

```go
// Good
key := os.Getenv("STRIPE_API_KEY")

// Bad — secret in source code
key := "sk_live_abc123def456"

// Bad — secret in log output
log.Printf("authenticating with key: %s", apiKey)
```

## Dangerous File Operations

- Never construct file paths from user input without sanitization.
- Always use `filepath.Clean()` and verify the result is within the expected directory.
- Reject paths containing `..`, null bytes, or absolute paths when relative is expected.

```go
// Good — sanitize and verify
cleanPath := filepath.Clean(userInput)
fullPath := filepath.Join(baseDir, cleanPath)
if !strings.HasPrefix(fullPath, baseDir) {
    return fmt.Errorf("path traversal attempt: %s", userInput)
}

// Bad — direct concatenation
path := fmt.Sprintf("uploads/%s", userInput)
```

## SQL Injection Prevention

- Always use parameterized queries. Never concatenate user input into SQL.
- If using an ORM or query builder, verify it parameterizes. If using raw SQL, use `$1` placeholders.

```go
// Good — parameterized
db.QueryRow("SELECT * FROM users WHERE id = $1", userID)

// Bad — concatenated
db.QueryRow("SELECT * FROM users WHERE id = " + userID)

// Bad — fmt.Sprintf into SQL
db.QueryRow(fmt.Sprintf("SELECT * FROM users WHERE email = '%s'", email))
```

## Checklist Before Merge

- [ ] No secrets in code, logs, or error responses
- [ ] All user input validated at the boundary
- [ ] Auth applied to every non-public endpoint
- [ ] SQL queries use parameterized placeholders
- [ ] File paths sanitized if derived from user input
```

Adjust examples to match this project's language, framework, and auth approach.
