# Rust Backend Standards (Tokio + HTTP + SQLx oriented)

Reference for generating `ai/instructions/backend.md` in Rust backend projects.

This file assumes Tokio for async work, HTTP extractors/middleware, and SQLx as
the common data layer. If the repo uses Actix-specific patterns, Diesel,
SeaORM, or a non-HTTP service shape, keep the error, async, and testing
guidance and replace the framework/data sections with the patterns actually
present.

## Error Handling

- Use `thiserror` for library error types with structured variants.
- Use `anyhow` for application-level error propagation where you don't need to match on variants.
- Use the `?` operator to propagate errors. DO NOT use `.unwrap()` or `.expect()` in production code paths.
- Map errors to HTTP responses at the handler boundary, not deep in business logic.

```rust
// DO — thiserror for domain errors
#[derive(Debug, thiserror::Error)]
pub enum OrderError {
    #[error("order {0} not found")]
    NotFound(Uuid),
    #[error("insufficient stock for product {product_id}")]
    InsufficientStock { product_id: Uuid },
    #[error(transparent)]
    Database(#[from] sqlx::Error),
}

// Convert to HTTP at the boundary
impl IntoResponse for OrderError {
    fn into_response(self) -> Response {
        let status = match &self {
            OrderError::NotFound(_) => StatusCode::NOT_FOUND,
            OrderError::InsufficientStock { .. } => StatusCode::CONFLICT,
            OrderError::Database(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (status, self.to_string()).into_response()
    }
}

// DON'T — unwrap in handler
async fn get_order(Path(id): Path<Uuid>) -> impl IntoResponse {
    let order = db.get_order(id).await.unwrap(); // panics on missing order
    Json(order)
}
```

## Ownership and Borrowing

- Borrow (`&T`, `&mut T`) when possible. Clone only when you genuinely need an owned copy.
- Use `Arc<T>` for shared ownership across threads. Add `Mutex<T>` or `RwLock<T>` only when mutation is needed.
- Prefer `impl Into<String>` over `String` in function parameters to accept both `&str` and `String`.

## Async Runtime

- Use `tokio` as the async runtime. Mark the entrypoint with `#[tokio::main]`.
- DO NOT call blocking code (file I/O, CPU-heavy computation) inside async tasks — use `tokio::task::spawn_blocking`.
- Use `tokio::select!` for racing multiple futures. Always include a cancellation branch.

```rust
// DO — spawn_blocking for CPU work
let hash = tokio::task::spawn_blocking(move || argon2::hash(password)).await?;

// DON'T — block the async runtime
let hash = argon2::hash(password); // blocks the tokio worker thread
```

## Web Framework (Axum example)

- Use extractors for parsing: `Path`, `Query`, `Json`, `State`.
- Share application state via `State<Arc<AppState>>`. Build state once at startup.
- Use `tower` middleware for cross-cutting concerns: logging, auth, CORS, timeouts.

```rust
// DO — extractors and shared state
async fn get_user(
    State(state): State<Arc<AppState>>,
    Path(user_id): Path<Uuid>,
) -> Result<Json<User>, AppError> {
    let user = state.user_service.get_by_id(user_id).await?;
    Ok(Json(user))
}

// DON'T — manual parsing
async fn get_user(req: Request) -> impl IntoResponse {
    let id = req.uri().path().split('/').last().unwrap();
    // ...
}
```

## Database (SQLx, if used)

- Use `sqlx` with compile-time checked queries (`sqlx::query!` / `sqlx::query_as!`).
- Use connection pooling via `PgPool`. Create the pool once, pass it via application state.
- Run migrations with `sqlx migrate run` or embed them with `sqlx::migrate!()`.

```rust
// DO — compile-time checked query
let user = sqlx::query_as!(User, "SELECT id, name, email FROM users WHERE id = $1", user_id)
    .fetch_optional(&pool)
    .await?;

// DON'T — unchecked string query
let user = sqlx::query("SELECT * FROM users WHERE id = " + &user_id.to_string())
    .fetch_one(&pool)
    .await?;
```

## Testing

- Use `#[tokio::test]` for async test functions.
- Use `mockall` for trait mocking in unit tests.
- For integration tests, spin up a real test database with `sqlx::test` or testcontainers.
- Put integration tests in `tests/` (separate crate), unit tests in the same file with `#[cfg(test)]`.

## Clippy

- Run `cargo clippy -- -W clippy::pedantic`. Fix warnings, suppress individually with `#[allow(...)]` only with a `// reason:` comment.
- Enable `clippy::unwrap_used` and `clippy::expect_used` lints for non-test code.

## Common Footguns

- **Deadlock with nested locks**: Acquiring the same `Mutex` twice in a call chain deadlocks. Use `RwLock` where readers outnumber writers, and never hold a lock across `.await`.
- **unwrap/expect in production**: Panics crash the task (or the server if unhandled). Use `?` and proper error types.
- **Large futures on the stack**: Deeply nested async functions create large `Future` types that can overflow the stack. Box large futures with `Box::pin(...)`.
- **Missing Send bound**: Futures used with `tokio::spawn` must be `Send`. Holding a non-Send type (like `Rc`) across an `.await` point breaks compilation.
- **Silent integer overflow**: In release mode, integer overflow wraps silently. Use `checked_add` or `saturating_add` for arithmetic that could overflow.
