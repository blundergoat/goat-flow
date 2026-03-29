# Prompt: Create ai/instructions/testing.md

Testing conventions template. Load this when writing or modifying tests.

---

## The Prompt

Read the existing tests in the codebase, then write `ai/instructions/testing.md`:

````
# Testing Instructions

## Test Naming

Name tests as sentences that describe the expected behavior. Use the function or component name as prefix.

```go
// Good — reads as a specification
func TestCreateUser_RejectsInvalidEmail(t *testing.T) { ... }
func TestCreateUser_HashesPasswordBeforeStoring(t *testing.T) { ... }
func TestListUsers_ReturnsEmptySliceWhenNoneExist(t *testing.T) { ... }

// Bad — vague
func TestCreateUser(t *testing.T) { ... }
func TestUser1(t *testing.T) { ... }
```

```ts
// Good
test("UserCard shows edit button when user has admin role", () => { ... });
test("UserCard hides edit button for read-only users", () => { ... });

// Bad
test("renders correctly", () => { ... });
test("it works", () => { ... });
```

## Test Structure: Arrange / Act / Assert

Every test has three distinct sections. Use comments or blank lines to separate them.

```go
func TestCreateUser_RejectsInvalidEmail(t *testing.T) {
    // Arrange
    svc := NewUserService(mockRepo)
    req := CreateUserRequest{Email: "not-an-email", Name: "Test"}

    // Act
    _, err := svc.Create(context.Background(), req)

    // Assert
    assert.ErrorContains(t, err, "email is invalid")
}
```

```ts
test("shows error when email is invalid", async () => {
  // Arrange
  render(<SignupForm />);

  // Act
  await userEvent.type(screen.getByLabelText("Email"), "not-an-email");
  await userEvent.click(screen.getByRole("button", { name: "Submit" }));

  // Assert
  expect(screen.getByText("Enter a valid email")).toBeVisible();
});
```

## What to Test

DO test:
- Business logic (validation rules, calculations, state transitions)
- Error paths (invalid input, missing data, timeouts)
- Edge cases (empty lists, max values, concurrent access)
- Integration points (database queries return expected rows, API calls send correct params)

DON'T test:
- Private functions directly — test them through the public API
- Third-party library internals (e.g., don't test that `json.Marshal` works)
- Trivial getters/setters with no logic
- CSS classes or DOM structure — test visible behavior instead

## Mocking Rules

Mock at boundaries only: database, external APIs, file system, clock.
Never mock the code under test.

```go
// Good — mock the repository interface
type mockUserRepo struct {
    users map[string]*User
}

func (m *mockUserRepo) GetByID(ctx context.Context, id string) (*User, error) {
    if u, ok := m.users[id]; ok {
        return u, nil
    }
    return nil, ErrUserNotFound
}

// Bad — mocking internal functions of the service you're testing
```

```ts
// Good — mock the API client
vi.mock("@/lib/api", () => ({
  api: {
    users: { list: vi.fn().mockResolvedValue([{ id: "1", name: "Test" }]) },
  },
}));

// Bad — mocking React hooks or internal state
```

## Property-Based Testing

For functions with well-defined contracts (parsers, serializers, math, data transformations), use property-based testing to find edge cases humans miss.

```python
# Python — Hypothesis
from hypothesis import given, strategies as st

@given(st.text())
def test_roundtrip_json(s):
    """Anything we serialize should deserialize to the same value."""
    assert json.loads(json.dumps(s)) == s

@given(st.integers(min_value=0, max_value=10000))
def test_discount_never_exceeds_total(amount):
    """Discount should never make the total negative."""
    result = apply_discount(amount, percent=50)
    assert result >= 0
```

```ts
// TypeScript — fast-check
import fc from "fast-check";

test("encode/decode roundtrip", () => {
  fc.assert(
    fc.property(fc.string(), (input) => {
      expect(decode(encode(input))).toBe(input);
    })
  );
});
```

```go
// Go — pgregory.net/rapid
func TestParseAmount_NeverPanics(t *testing.T) {
    rapid.Check(t, func(rt *rapid.T) {
        s := rapid.String().Draw(rt, "input")
        _, _ = ParseAmount(s) // must not panic
    })
}
```

Use property-based testing when: roundtrip invariants exist, output has mathematical properties (commutative, associative, bounded), or input space is large and varied.

## Flaky Test Policy

A flaky test is worse than no test. It erodes trust in the entire test suite.

**Root causes** (fix these, don't retry around them):
- **Timing dependencies:** Use deterministic clocks / mocked time, not `time.Sleep()` or wall-clock assertions
- **Shared state:** Tests mutating global variables, shared database rows, or files without cleanup
- **Network calls:** Tests hitting real external services. Mock them or use recorded fixtures
- **Non-deterministic ordering:** Tests relying on map iteration order, database row order without ORDER BY, or filesystem listing order

**When a test flakes:**
1. Reproduce locally (run it 100x: `for i in {1..100}; do go test -run TestFlaky ./... || break; done`)
2. Fix the root cause (usually one of the four above)
3. If genuinely unfixable: delete the test and create a tracking issue explaining why

Never: add retries to mask flakiness, mark as `@skip` and forget, or increase timeouts as a "fix."

## Test Isolation

Tests must not depend on execution order or shared state. Each test sets up and tears down its own data.

```go
// Good — each test is independent
func TestCreateUser(t *testing.T) {
    t.Parallel()
    db := setupTestDB(t) // fresh schema per test
    t.Cleanup(func() { db.Close() })

    repo := NewUserRepo(db)
    // ... test logic
}
```

```ts
// Good — isolated setup per test
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});
```

```go
// Bad — tests share state, order-dependent
var testDB *sql.DB // package-level, shared

func TestA(t *testing.T) {
    testDB.Exec("INSERT INTO users ...") // TestB depends on this row
}
func TestB(t *testing.T) {
    row := testDB.QueryRow("SELECT ...") // fails if TestA hasn't run
}
```

Use `t.Parallel()` (Go), parallel test runs (Jest default), or `pytest-xdist` (Python) to surface hidden dependencies. Use `--runInBand` (Jest) or sequential mode only as a last resort for tests that genuinely need serial execution.

## Coverage Expectations

- New features: cover the happy path + at least one error path.
- Bug fixes: add a test that reproduces the bug before fixing it.
- No coverage target percentage — meaningful tests over line counts.
- If a test is hard to write, the code probably needs refactoring.
````

Adjust the languages, test frameworks, and examples to match this project's actual test patterns.
Target 40-60 lines of content (not counting the prompt wrapper).
