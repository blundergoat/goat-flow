# SQL Injection Prevention

Reference for generating `ai/instructions/security.md` in projects using SQL databases.

## Parameterized Queries by ORM

Every ORM has a safe default. Use it. Raw queries are escape hatches, not standard practice.

```php
// Laravel Eloquent — DO
$users = User::where('email', $email)->first();
$results = DB::table('orders')->where('status', '=', $status)->get();

// Laravel Eloquent — DON'T
$users = DB::select("SELECT * FROM users WHERE email = '$email'");
$results = DB::select(DB::raw("SELECT * FROM orders WHERE status = $status"));
```

```ruby
# ActiveRecord — DO
User.where(email: email).first
User.where("email = ?", email).first

# ActiveRecord — DON'T
User.where("email = '#{email}'").first
User.find_by_sql("SELECT * FROM users WHERE email = '#{email}'")
```

```python
# SQLAlchemy — DO
session.query(User).filter(User.email == email).first()
session.execute(text("SELECT * FROM users WHERE email = :email"), {"email": email})

# SQLAlchemy — DON'T
session.execute(f"SELECT * FROM users WHERE email = '{email}'")
```

```typescript
// Prisma — DO
const user = await prisma.user.findUnique({ where: { email } });

// Prisma — DON'T (raw query without parameterization)
const user = await prisma.$queryRawUnsafe(`SELECT * FROM users WHERE email = '${email}'`);

// Prisma — safe raw query
const user = await prisma.$queryRaw`SELECT * FROM users WHERE email = ${email}`;
```

```go
// sqlc — DO (generated code is parameterized by default)
user, err := queries.GetUserByEmail(ctx, email)

// database/sql — DO
row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE email = $1", email)

// database/sql — DON'T
row := db.QueryRowContext(ctx, "SELECT * FROM users WHERE email = '" + email + "'")
```

```csharp
// EF Core — DO
var user = context.Users.FirstOrDefault(u => u.Email == email);
var users = context.Users.FromSqlInterpolated($"SELECT * FROM users WHERE email = {email}");

// EF Core — DON'T
var users = context.Users.FromSqlRaw("SELECT * FROM users WHERE email = '" + email + "'");
```

```java
// Spring Data JPA — DO
@Query("SELECT u FROM User u WHERE u.email = :email")
User findByEmail(@Param("email") String email);

// JDBC — DON'T
String sql = "SELECT * FROM users WHERE email = '" + email + "'";
Statement stmt = connection.createStatement();
ResultSet rs = stmt.executeQuery(sql);
```

```rust
// Diesel — DO
users::table.filter(users::email.eq(&email)).first::<User>(&mut conn)?;

// sqlx — DO
let user = sqlx::query_as!(User, "SELECT * FROM users WHERE email = $1", email)
    .fetch_one(&pool).await?;
```

## Raw Query Escape Hatches

Sometimes raw SQL is necessary (complex reporting, database-specific features). When using it:

1. **Always parameterize inputs** — use the ORM's raw parameterized method, not string interpolation.
2. **Whitelist dynamic identifiers** — column/table names cannot be parameterized. Validate against an explicit allowlist.

```python
# DO — whitelist column names for dynamic ORDER BY
ALLOWED_SORT = {"name", "created_at", "email"}
if sort_column not in ALLOWED_SORT:
    raise ValueError(f"Invalid sort column: {sort_column}")
session.execute(text(f"SELECT * FROM users ORDER BY {sort_column}"), {})

# DON'T — user input as column name
session.execute(text(f"SELECT * FROM users ORDER BY {request.args['sort']}"), {})
```

## Query Builder Safety

Not all query builder methods are safe. Know which accept raw SQL.

| ORM | Safe methods | Unsafe (accepts raw SQL) |
|-----|-------------|------------------------|
| Eloquent | `where('col', val)`, `find()`, `pluck()` | `whereRaw()`, `selectRaw()`, `orderByRaw()`, `DB::raw()` |
| ActiveRecord | `where(hash)`, `find()`, `pluck()` | `where(string)`, `find_by_sql()`, `order(string)` |
| SQLAlchemy | `filter(Model.col == val)`, `get()` | `text()`, `literal_column()`, `from_statement()` |
| Django ORM | `filter(col=val)`, `get()`, `exclude()` | `extra()`, `raw()`, `RawSQL()` |
| Prisma | All standard methods | `$queryRawUnsafe()`, `$executeRawUnsafe()` |

## Stored Procedures

- Parameterize inputs to stored procedures the same way you parameterize queries.
- DO NOT concatenate SQL inside stored procedures.

## Common Footguns

- **Laravel `whereRaw()`**: passes raw SQL. Always use parameter binding: `whereRaw('email = ?', [$email])`.
- **Django `extra()`**: deprecated and dangerous. Use `annotate()` with `F()` and `Value()` instead.
- **Rails `find_by_sql`**: requires manual parameterization with `?` placeholders.
- **Rails `order()`**: accepts raw SQL strings. Whitelist sort columns.
- **Prisma `$queryRawUnsafe`**: the name says it all. Use tagged template `$queryRaw` instead.
- **LIKE wildcards**: user input with `%` or `_` can match more rows than intended. Escape wildcards before binding.
