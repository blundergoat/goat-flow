# Symfony Security Standards

Reference for generating `ai/instructions/security.md` in Symfony projects.

## CSRF Protection

Symfony's CSRF component is opt-in per form. Every state-changing form must include a token.

```twig
{# DO — include CSRF token in Twig forms #}
<form method="POST" action="{{ path('order_create') }}">
    <input type="hidden" name="_token" value="{{ csrf_token('order_create') }}">
    <button type="submit">Place Order</button>
</form>
```

```php
// DO — validate in the controller
if (!$this->isCsrfTokenValid('order_create', $request->request->get('_token'))) {
    throw $this->createAccessDeniedException('Invalid CSRF token.');
}

// Symfony 6.3+ — use the attribute instead
#[IsCsrfTokenValid('order_create', tokenKey: '_token')]
public function create(Request $request): Response { ... }
```

```yaml
# security.yaml — CSRF is disabled automatically for stateless firewalls
firewalls:
    api:
        pattern: ^/api/
        stateless: true   # no session, no CSRF needed — token/JWT auth handles it
    main:
        # stateful firewall: CSRF protection is active by default
```

- Symfony Form component generates and validates CSRF tokens automatically. Only manual forms and AJAX endpoints need explicit handling.
- Never disable CSRF globally. Disable it only on stateless firewalls that use token auth.

## Access Control

```php
// DO — deny at the top of the action
public function edit(Post $post): Response
{
    $this->denyAccessUnlessGranted('EDIT', $post); // custom Voter for object-level check
    ...
}

// DO — attribute form (Symfony 5.2+)
#[IsGranted('EDIT', subject: 'post')]
public function edit(Post $post): Response { ... }

// DON'T — rely on access_control alone for object-level permissions
```

- `access_control` in `security.yaml` matches URL patterns. It does not enforce ownership or object-level rules — that is the Voter's job.
- Implement a `Voter` for ownership checks. Never inline ownership logic across multiple controllers.
- Use `#[IsGranted]` on the action, not just on the controller class, to avoid accidentally inheriting broad grants.

## Input Validation

```php
// DO — constrain DTOs with the Validator component
use Symfony\Component\Validator\Constraints as Assert;

class CreateUserInput
{
    #[Assert\NotBlank]
    #[Assert\Email]
    public string $email = '';

    #[Assert\NotBlank]
    #[Assert\Length(min: 8, max: 128)]
    public string $password = '';
}

// Validate explicitly in the controller
$violations = $validator->validate($input);
if (count($violations) > 0) {
    return $this->json(['errors' => (string) $violations], 422);
}

// Or use Symfony Forms — $form->isValid() runs validation automatically
```

- Validate at the controller boundary, before passing data to a service or repository.
- For API endpoints, use `#[MapRequestPayload]` (Symfony 6.3+) — it deserializes and validates in one step.

## XSS Prevention

Twig auto-escapes all output by default. Bypassing escaping is an XSS vector.

```twig
{# DO — auto-escaped output #}
<p>{{ user.bio }}</p>

{# DON'T — bypass escaping #}
<p>{{ user.bio|raw }}</p>
{% autoescape false %}{{ user.bio }}{% endautoescape %}
```

- Only use `|raw` on content you generated (e.g., Markdown rendered server-side with a trusted library).
- If you must render user-supplied rich text, sanitize with a library (e.g., `HtmlSanitizer` component, `ezyang/htmlpurifier`) before marking safe.
- Check Twig templates for `|raw` in code review — every use needs a justification comment.

## Doctrine SQL Injection

Doctrine DQL and QueryBuilder parameterize automatically. Raw SQL requires explicit binding.

```php
// DO — QueryBuilder with named parameter
$qb->where('u.email = :email')->setParameter('email', $email);

// DO — raw SQL with binding via DBAL
$conn->executeQuery('SELECT * FROM users WHERE email = :email', ['email' => $email]);

// DON'T — string interpolation in any form
$conn->executeQuery("SELECT * FROM users WHERE email = '$email'");
$em->createQuery("SELECT u FROM User u WHERE u.email = '$email'");
```

- `createNativeQuery()` requires a `ResultSetMapping` and explicit binding. Never interpolate variables into the query string.
- `extra()` on the QueryBuilder does not parameterize automatically — treat it like raw SQL.

## Rate Limiting

```yaml
# config/packages/rate_limiter.yaml
framework:
    rate_limiter:
        login:
            policy: fixed_window
            limit: 5
            interval: '1 minute'
        api:
            policy: sliding_window
            limit: 100
            interval: '1 minute'
```

```php
// DO — consume a token before processing the sensitive action
public function login(RateLimiterFactory $loginLimiter, Request $request): Response
{
    $limiter = $loginLimiter->create($request->getClientIp());
    if (!$limiter->consume()->isAccepted()) {
        return $this->json(['error' => 'Too many attempts. Try again later.'], 429);
    }
    ...
}
```

- Rate-limit login, password reset, and email verification endpoints.
- In multi-instance deployments, configure a Redis-backed store as the `cache.rate_limiter` pool.

## APP_SECRET and Secrets Management

```bash
# DO — use the Symfony secrets vault per environment
php bin/console secrets:set DATABASE_PASSWORD          # stored in config/secrets/{env}/
php bin/console secrets:set DATABASE_PASSWORD --env=prod

# .env — placeholder values only, never real secrets
APP_SECRET=replace-with-64-char-random-hex
DATABASE_URL=postgresql://app:!ChangeMe!@127.0.0.1:5432/app
```

- `APP_SECRET` must be at least 32 random bytes. It signs cookies, CSRF tokens, and remember-me tokens. Never reuse across environments.
- In production, inject secrets via environment variables or the secrets vault. Never commit real values to `.env.local` or `.env.prod`.
- Rotating `APP_SECRET` invalidates all signed cookies and CSRF tokens — active sessions will be dropped.

## Production Settings

```bash
APP_ENV=prod
APP_DEBUG=0   # never 1 in production: exposes profiler, debug toolbar, full stack traces
```

- `APP_ENV=dev` exposes the Symfony Profiler at `/_profiler`, the debug toolbar, database queries, and request details.
- Consider `nelmio/security-bundle` for centralized security header management (CSP, HSTS, X-Frame-Options, referrer policy) via `config/packages/nelmio_security.yaml`.

## Password Hashing

```yaml
# config/packages/security.yaml
security:
    password_hashers:
        App\Entity\User:
            algorithm: auto   # selects bcrypt or argon2id based on available extensions
```

```php
// DO — use the injected hasher
$user->setPassword($hasher->hashPassword($user, $plainPassword));

// DON'T — hash manually
$user->setPassword(md5($plain));
$user->setPassword(sha1($plain));
```

- `algorithm: auto` selects the strongest available algorithm. Do not hardcode `bcrypt` if `argon2id` is available.
- `UserPasswordHasherInterface::isPasswordValid()` handles transparent rehashing on login when the algorithm changes.

## File Upload

```php
// DO — validate MIME type by file content
use Symfony\Component\Validator\Constraints\File;

$violations = $validator->validate($uploadedFile, [
    new File(
        maxSize: '10M',
        mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'],
        mimeTypesMessage: 'Please upload a valid file.',
    ),
]);

// DON'T — validate by extension only (easily spoofed)
// ExtensionValidator checks the extension string, not the actual file content.
```

- Store uploads outside the public directory. Serve files through a controller that checks authorization before streaming.
- Never use the original filename for storage. Generate a UUID or content hash.

## Security Audit

```bash
# Check for known CVEs in installed packages
composer audit

# Run in CI — fail on high-severity advisories
composer audit --no-dev --format=json | jq '.advisories | length'
```

- Run `composer audit` in CI on every PR. Treat high-severity advisories as build failures.
- For deeper static analysis, add `psalm/plugin-symfony` or `phpstan/phpstan-symfony` with their security rule sets.

## Common Footguns

- **`APP_ENV=dev` in production**: exposes `/_profiler`, full stack traces, database queries, and environment variables.
- **`denyAccessUnlessGranted()` missing from action**: `access_control` in `security.yaml` matches URL patterns, not object ownership — a Voter call in the controller is still required.
- **`|raw` Twig filter on user input**: bypasses auto-escaping. Every use needs a comment explaining why the content is trusted.
- **`$conn->executeQuery("... WHERE id = $id")`**: concatenated SQL is injectable. Always use `?` or `:param` binding.
- **`APP_SECRET` too short or shared across environments**: all HMAC-signed tokens share the same key. A compromised dev secret compromises production if reused.
- **`ExtensionValidator` without `MimeTypeValidator`**: extension-only checks are trivially bypassed by renaming a file.
- **`algorithm: bcrypt` hardcoded**: if the server gains `argon2id` support later, existing passwords are not automatically upgraded. Use `auto` to get transparent rehashing.
