# Go Coding Standards

Reference for generating `ai/instructions/backend.md` in Go projects.

## Project Layout

- Standard layout: `cmd/` for entrypoints, `internal/` for private packages, `pkg/` for public libraries.
- Small projects and CLIs: flat layout is fine. DO NOT create `cmd/internal/pkg/` for a single-binary project.
- One `main.go` per binary in `cmd/<binary-name>/`.

## Architecture

- Handler -> Service -> Repository pattern. Handlers parse HTTP, services hold business logic, repositories talk to storage.
- Define interfaces where they are consumed, not where they are implemented.
- Use constructor functions that return interfaces for dependency injection.

```go
// DO — interface defined by consumer, constructor returns concrete
type UserService interface {
    GetByID(ctx context.Context, id string) (User, error)
}

type userService struct {
    repo UserRepository
}

func NewUserService(repo UserRepository) UserService {
    return &userService{repo: repo}
}

// DON'T — accept concrete types, define interface next to implementation
func NewHandler(svc *userService) Handler { ... }
```

## Error Handling

- Wrap errors with context using `fmt.Errorf("fetch user %s: %w", id, err)`.
- Define sentinel errors for expected conditions: `var ErrNotFound = errors.New("not found")`.
- Use `errors.Is` and `errors.As` for checking — never compare error strings.
- Return errors, don't panic. Reserve `panic` for truly unrecoverable programmer bugs.

```go
// DO
if err != nil {
    return fmt.Errorf("get user %s: %w", id, err)
}

// DON'T
if err != nil {
    log.Fatal(err) // kills the server
}
```

## Context

- Pass `ctx context.Context` as the first parameter to every function that does I/O.
- Use context for cancellation and timeouts, not for passing business data.
- Set timeouts on outbound calls: `ctx, cancel := context.WithTimeout(ctx, 5*time.Second)`.

## Concurrency

- Use `errgroup.Group` for parallel work that needs error collection.
- Every goroutine must have a clear shutdown path. Leaked goroutines are memory leaks.
- Protect shared state with `sync.Mutex` — prefer channels for coordination, mutexes for protection.

```go
// DO — errgroup for parallel fetches
g, ctx := errgroup.WithContext(ctx)
g.Go(func() error { user, err = fetchUser(ctx, id); return err })
g.Go(func() error { orders, err = fetchOrders(ctx, id); return err })
if err := g.Wait(); err != nil { return err }

// DON'T — fire-and-forget goroutine with no error handling
go fetchUser(ctx, id)
```

## Database

- Prefer `sqlc` for type-safe query generation or `pgx` for direct PostgreSQL access.
- Always use parameterized queries. Never interpolate user input into SQL strings.
- Use transactions for multi-step writes: `tx, err := db.BeginTx(ctx, nil)`.

## Testing

- Table-driven tests for functions with multiple input/output combinations.
- Use `testify/assert` and `testify/require` for readable assertions.
- Use `httptest.NewRecorder` and `httptest.NewRequest` for handler tests.
- `t.Parallel()` on independent tests. DO NOT use it when tests share database state.

```go
// DO — table-driven test
tests := []struct {
    name    string
    input   string
    want    int
    wantErr bool
}{
    {"valid", "42", 42, false},
    {"empty", "", 0, true},
}
for _, tt := range tests {
    t.Run(tt.name, func(t *testing.T) {
        got, err := Parse(tt.input)
        if tt.wantErr {
            require.Error(t, err)
            return
        }
        require.NoError(t, err)
        assert.Equal(t, tt.want, got)
    })
}
```

## Linting

- Run `golangci-lint` with at minimum: `govet`, `staticcheck`, `gosec`, `errcheck`, `ineffassign`.
- Fix lint warnings, don't suppress them with `//nolint` unless justified in a comment.

## Common Footguns

- **defer in loops**: `defer` runs at function exit, not loop iteration. Close resources explicitly inside loops or extract to a helper function.
- **nil pointer on interface**: An interface holding a nil concrete value is not itself nil. Check the concrete value, not the interface.
- **goroutine leaks**: A goroutine blocked on a channel that nobody reads is a permanent leak. Always provide a cancellation path.
- **shadowed err**: `:=` inside an `if` block creates a new `err` that shadows the outer one. The outer `err` stays nil and the real error is silently discarded.
- **range variable capture**: In Go <1.22, loop variables are reused. Capture with `v := v` before passing to goroutines or closures.
