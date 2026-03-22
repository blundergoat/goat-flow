# Prompt: Create ai/instructions/testing.md

Testing conventions template. Load this when writing or modifying tests.

---

## The Prompt

Read the existing tests in the codebase, then write `ai/instructions/testing.md`:

```
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

## Coverage Expectations

- New features: cover the happy path + at least one error path.
- Bug fixes: add a test that reproduces the bug before fixing it.
- No coverage target percentage — meaningful tests over line counts.
- If a test is hard to write, the code probably needs refactoring.
```

Adjust the languages, test frameworks, and examples to match this project's actual test patterns.
