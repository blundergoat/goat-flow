# Laravel Security Standards

Reference for generating `ai/instructions/security.md` in Laravel projects.

## CSRF Protection

Laravel includes CSRF protection via the `VerifyCsrfToken` middleware. Every state-changing form must include the token.

```blade
{{-- DO — include CSRF token in forms --}}
<form method="POST" action="/orders">
    @csrf
    <button type="submit">Place Order</button>
</form>

{{-- DON'T — omit CSRF token --}}
<form method="POST" action="/orders">
    <button type="submit">Place Order</button>
</form>
```

- For SPAs using Sanctum, call `/sanctum/csrf-cookie` before making POST requests.
- Never add routes to the `$except` array in `VerifyCsrfToken` unless they are webhook endpoints with their own signature verification.

## Mass Assignment

Always define `$fillable` (whitelist). Never use `$guarded = []`.

```php
// DO — explicit fillable
class User extends Model {
    protected $fillable = ['name', 'email'];
}

// DON'T — disable guarding
class User extends Model {
    protected $guarded = [];  // allows setting is_admin, role, etc.
}
```

- Never pass `$request->all()` to `create()` or `update()`. Use `$request->validated()` after form request validation.

## Eloquent Injection

Standard Eloquent methods are safe. Raw methods require manual parameterization.

```php
// DO — parameterized raw query
$users = DB::select('SELECT * FROM users WHERE email = ?', [$email]);
User::whereRaw('LOWER(email) = ?', [strtolower($email)])->first();

// DON'T — concatenated raw query
$users = DB::select("SELECT * FROM users WHERE email = '$email'");
User::whereRaw("email = '$email'")->first();
```

## Encryption and APP_KEY

- `APP_KEY` must be unique per environment. Generate with `php artisan key:generate`.
- Never commit `APP_KEY` to version control. Store in `.env` (local) or secret manager (CI/production).
- Rotating `APP_KEY` invalidates all encrypted data, sessions, and signed URLs. Plan rotation carefully.
- Use `encrypt()` / `decrypt()` for sensitive data at rest, not base64 or reversible hashing.

## Authentication Guards

```php
// DO — use guards explicitly
Auth::guard('api')->user();
$this->middleware('auth:sanctum');

// DON'T — rely on default guard without specifying
Auth::user();  // may not check the expected guard in API contexts
```

- Use Sanctum for SPA/mobile token auth. Use Passport only if you need full OAuth2 server.
- Enforce email verification with `verified` middleware before granting access to sensitive routes.

## Rate Limiting

```php
// DO — define rate limits in RouteServiceProvider or bootstrap
RateLimiter::for('login', function (Request $request) {
    return Limit::perMinute(5)->by($request->ip());
});

// Apply to routes
Route::post('/login', [AuthController::class, 'login'])->middleware('throttle:login');
```

- Rate-limit login, password reset, and email verification endpoints.
- Use `by()` to scope limits — per-IP for login, per-user for API endpoints.

## File Validation

```php
// DO — validate file type, size, and MIME
$request->validate([
    'document' => ['required', 'file', 'mimetypes:application/pdf,image/jpeg', 'max:10240'],
]);

// DON'T — validate only by extension
$request->validate([
    'document' => ['required', 'file', 'extensions:pdf,jpg'],  // extension-only, easily spoofed
]);
// Note: Use `mimetypes:` for MIME-type checking by content, `mimes:` for extension+content.
// Avoid `extensions:` alone (extension-only, easily spoofed).
```

- Store uploads on S3 or a non-public disk. Never store in `public/` with the original filename.

## Common Footguns

- **`$guarded = []`**: allows mass-assigning any column including `is_admin`, `role`, `password`.
- **`$request->all()` with `create()`**: bypasses form request validation. Use `$request->validated()`.
- **`whereRaw` without bindings**: SQL injection. Always pass the second parameter array.
- **Debug mode in production**: `APP_DEBUG=true` leaks environment variables, database credentials, and stack traces.
- **Missing `SANCTUM_STATEFUL_DOMAINS`**: SPA auth silently fails or allows unintended domains.
- **Blade `{!! !!}` unescaped output**: XSS vector. Use `{{ }}` (escaped) unless rendering trusted HTML with explicit sanitization.
