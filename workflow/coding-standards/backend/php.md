# PHP Coding Standards (No Framework)

Reference for generating `ai/instructions/backend.md` in PHP projects without a framework (vanilla PHP, custom MVC, legacy codebases, WordPress plugins/themes, or minimal libraries like Slim/Lumen).

Use this as a base for custom PHP applications and legacy web backends. If the
repo is a library, package, WordPress plugin/theme, or CLI-only tool, keep the
Composer, typing, testing, and database sections that match the repo and drop
the front-controller or session-specific guidance that does not.

## Project Structure

- In front-controller web apps, the common entry point is `public/index.php` or
  an equivalent web root file.
- Keep `public/` as the only web-accessible directory in front-controller apps.
- Autoload via Composer: `src/` mapped to a PSR-4 namespace in `composer.json`.
- Libraries, plugins/themes, and CLI-only repos may not have `public/` or a
  controller/service/repository split. Document the actual entry points instead
  of copying the example structure.

```
project/
├── public/
│   └── index.php        # entry point, no logic
├── src/
│   ├── Controller/      # request handling
│   ├── Service/         # business logic
│   ├── Repository/      # data access
│   └── Model/           # domain objects
├── config/
├── tests/
├── composer.json
└── .env
```

## Coding Style

- Follow PSR-12 (extended coding style). Enforce with `php-cs-fixer` or `phpcs`.
- Use strict types in every file: `declare(strict_types=1);` on line 1 after the opening tag.
- Use type declarations on all parameters, return types, and properties. Avoid `mixed` unless genuinely needed.

```php
<?php

declare(strict_types=1);

// DO — typed everything
final class InvoiceService
{
    public function __construct(
        private readonly InvoiceRepository $repo,
        private readonly TaxCalculator $tax,
    ) {}

    public function calculate(int $invoiceId): Money
    {
        $invoice = $this->repo->findOrFail($invoiceId);
        return $this->tax->apply($invoice->subtotal(), $invoice->region());
    }
}

// DON'T — untyped, no strict_types
class InvoiceService {
    private $repo;
    function calculate($id) {
        return $this->repo->find($id)->getTotal();
    }
}
```

## Error Handling

- Set error reporting to strict: `error_reporting(E_ALL)` and `ini_set('display_errors', '0')` in production.
- Convert PHP errors to exceptions with a custom error handler or `set_error_handler`.
- Throw domain-specific exceptions. Catch at the boundary (router/middleware), not inside business logic.
- Never use `@` to suppress errors — it hides real bugs.

```php
// DO — domain exception, caught at boundary
class OrderNotFoundException extends RuntimeException {}

// In service
$order = $this->repo->find($id);
if ($order === null) {
    throw new OrderNotFoundException("Order {$id} not found");
}

// DON'T — return false/null to signal errors
function findOrder($id) {
    $row = $db->query("...");
    if (!$row) return false; // caller forgets to check
}
```

## Database Access

- Use PDO with prepared statements. Never concatenate user input into SQL.
- Set PDO error mode to exceptions: `PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION`.
- Wrap multi-step operations in transactions.

```php
// DO — prepared statement with named parameters
$stmt = $pdo->prepare('SELECT * FROM users WHERE email = :email');
$stmt->execute(['email' => $email]);
$user = $stmt->fetch(PDO::FETCH_ASSOC);

// DON'T — string interpolation = SQL injection
$result = $pdo->query("SELECT * FROM users WHERE email = '$email'");
```

- For projects with many queries, use a lightweight query builder (e.g., `doctrine/dbal`) without the full ORM.
- Repository pattern: one class per aggregate root, returning typed objects not raw arrays.

## Dependencies and Autoloading

- Manage all dependencies through Composer. Never vendor libraries manually.
- Use PSR-4 autoloading. DO NOT use `require`/`include` for class files.
- Pin dependency versions in `composer.lock`. Commit the lock file.
- Run `composer audit` in CI to catch known vulnerabilities.

## Input Validation

- Validate all external input (query params, POST body, headers) at the entry point.
- Use `filter_input()` or a validation library. Never trust `$_GET`/`$_POST` directly.
- Sanitize output: `htmlspecialchars($value, ENT_QUOTES, 'UTF-8')` for HTML, `json_encode()` for JSON.

```php
// DO — validate before use
$id = filter_input(INPUT_GET, 'id', FILTER_VALIDATE_INT);
if ($id === false || $id === null) {
    http_response_code(400);
    exit;
}

// DON'T — raw superglobal
$id = $_GET['id']; // could be anything
```

## Testing

- Use PHPUnit. Structure: `tests/Unit/` for isolated logic, `tests/Integration/` for database/HTTP.
- Arrange-Act-Assert pattern. One assertion focus per test.
- Mock external dependencies (HTTP clients, file systems). Do not mock the class under test.
- For database tests, use transactions that roll back after each test.

```php
// DO — focused unit test
public function test_tax_calculation_applies_regional_rate(): void
{
    $calc = new TaxCalculator();
    $result = $calc->apply(new Money(10000), Region::EU);
    self::assertEquals(new Money(12100), $result); // 21% VAT
}
```

- Run tests: `vendor/bin/phpunit`
- Coverage: `vendor/bin/phpunit --coverage-text`

## Session and Auth (if the repo uses built-in PHP sessions)

- Only include this section when the repo actually uses built-in PHP sessions.
  Token-based APIs, libraries, and many plugins/themes should omit it.
- Use PHP's built-in session handling with `session_start()`. Set secure cookie params.
- Store session data server-side. Never trust client-side cookies for authorization.
- Regenerate session ID after login: `session_regenerate_id(true)`.

```php
// DO — secure session config
ini_set('session.cookie_httponly', '1');
ini_set('session.cookie_secure', '1');
ini_set('session.cookie_samesite', 'Lax');
ini_set('session.use_strict_mode', '1');
```

## Common Footguns

- **`include` vs `require`**: `include` only warns on failure, `require` fatals. Always use `require_once` for class files (or better, use autoloading).
- **Loose comparison**: `0 == "foo"` is true in PHP 7. Always use `===` and `!==`. Strict types help but don't cover all cases.
- **Silent type coercion in array keys**: `$a[true]` and `$a[1]` are the same key. Avoid non-string/int keys.
- **`$this` in static context**: PHP 8+ throws `Error`, older versions gave unexpected results. Use `static::` not `self::` for late static binding when needed.
- **Reference parameters**: Functions like `preg_match(&$matches)` use pass-by-reference. Missing the `&` in custom functions silently copies instead. Prefer return values over reference params.
