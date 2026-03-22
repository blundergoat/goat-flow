# Prompt: Create ai/instructions/backend.md

Example domain overlay for a Go + PostgreSQL backend. Adapt to your actual stack.

---

## The Prompt

Read the backend codebase, then write `ai/instructions/backend.md`:

```
# Backend Instructions (Go + PostgreSQL)

## Handler / Service / Repository Pattern

Three layers, strict dependency direction: handler -> service -> repository.

```
cmd/api/
  main.go              # Wire dependencies, start server
internal/
  handler/             # HTTP handlers — parse request, call service, write response
  service/             # Business logic — orchestrates repositories, enforces rules
  repository/          # Database access — SQL queries, row scanning
  model/               # Shared types (User, Order, etc.)
```

Handlers never import repository. Repositories never import handler.

```go
// handler/user.go — thin, no business logic
func (h *UserHandler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateUserRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        http.Error(w, "invalid request body", http.StatusBadRequest)
        return
    }
    user, err := h.userService.Create(r.Context(), req)
    if err != nil {
        handleError(w, err)
        return
    }
    writeJSON(w, http.StatusCreated, user)
}
```

## Database Conventions

Migrations live in `db/migrations/` using golang-migrate format:
```
db/migrations/
  001_create_users.up.sql
  001_create_users.down.sql
  002_add_user_email_index.up.sql
  002_add_user_email_index.down.sql
```

Every migration must have both `up` and `down` files. Test rollbacks locally.

Use sqlc for query generation. Write SQL in `db/queries/`, run `sqlc generate`.
Never write raw SQL strings in Go code.

```sql
-- db/queries/users.sql
-- name: GetUserByID :one
SELECT id, email, name, created_at
FROM users
WHERE id = $1;

-- name: ListUsers :many
SELECT id, email, name, created_at
FROM users
ORDER BY created_at DESC
LIMIT $1 OFFSET $2;
```

## Error Handling

Wrap errors with context at every layer boundary. Use `fmt.Errorf` with `%w`.

```go
// Good — adds context, preserves chain
user, err := h.repo.GetByID(ctx, id)
if err != nil {
    return nil, fmt.Errorf("get user %s: %w", id, err)
}

// Bad — context lost
return nil, err
```

Use sentinel errors for business rules. Check with `errors.Is()`.

```go
var ErrUserNotFound = errors.New("user not found")
var ErrEmailTaken = errors.New("email already registered")

// In handler
if errors.Is(err, service.ErrUserNotFound) {
    http.Error(w, "user not found", http.StatusNotFound)
    return
}
```

## Validation

Validate at the handler layer, before calling service. Use a validation library or explicit checks.

```go
func (r CreateUserRequest) Validate() error {
    if r.Email == "" {
        return errors.New("email is required")
    }
    if !strings.Contains(r.Email, "@") {
        return errors.New("email is invalid")
    }
    if len(r.Name) > 255 {
        return errors.New("name exceeds 255 characters")
    }
    return nil
}
```

## API Versioning

Routes are prefixed with `/api/v1/`. When making breaking changes, create `/api/v2/` handlers alongside v1. Never modify the contract of a released v1 endpoint.

```go
mux.Handle("/api/v1/users", v1UserHandler)
mux.Handle("/api/v2/users", v2UserHandler) // new contract
```
```

Replace the paths, tools, and patterns above with what this project actually uses.
