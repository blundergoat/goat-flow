# Symfony Security Standards

Reference for generating `ai/coding-standards/security.md` in Symfony projects.

## CSRF Protection

- Symfony Form component generates and validates CSRF tokens automatically. Manual forms and AJAX endpoints need explicit handling.
- Every state-changing form must include `{{ csrf_token('action_name') }}` and validate with `$this->isCsrfTokenValid()` or `#[IsCsrfTokenValid]` (6.3+).
- Never disable CSRF globally. Disable only on stateless firewalls using token/JWT auth.

## Access Control

- `access_control` in `security.yaml` matches URL patterns only — it does NOT enforce ownership.
- Implement a `Voter` for object-level permissions. Call `$this->denyAccessUnlessGranted('EDIT', $post)` or use `#[IsGranted('EDIT', subject: 'post')]` on the action.
- Apply grants on the action, not just the controller class, to avoid inheriting broad permissions.

## Input Validation

- Validate at the controller boundary using Validator constraints (`#[Assert\NotBlank]`, `#[Assert\Email]`, etc.) on DTOs.
- For API endpoints, use `#[MapRequestPayload]` (6.3+) — deserializes and validates in one step.
- Symfony Forms run `$form->isValid()` automatically.

## XSS Prevention

- Twig auto-escapes all output by default. `|raw` and `{% autoescape false %}` bypass escaping — every use needs a justification comment.
- Only use `|raw` on content you generated (e.g., server-side Markdown rendering with a trusted library).
- For user-supplied rich text, sanitize with `HtmlSanitizer` component or `ezyang/htmlpurifier` before marking safe.

## Doctrine SQL Injection

- QueryBuilder and DQL parameterize automatically: `$qb->where('u.email = :email')->setParameter('email', $email)`.
- Raw SQL via DBAL requires explicit binding: `$conn->executeQuery('...WHERE email = :email', ['email' => $email])`.
- Never string-interpolate into any query. `createNativeQuery()` and `extra()` do NOT auto-parameterize.

## Rate Limiting

- Configure `framework.rate_limiter` in YAML. Apply to login, password reset, email verification.
- Consume a token with `$limiter->consume()->isAccepted()` before processing sensitive actions.
- Multi-instance: use Redis-backed store for `cache.rate_limiter` pool.

## Secrets & APP_SECRET

- `APP_SECRET` must be ≥32 random bytes. Signs cookies, CSRF tokens, remember-me. Never reuse across environments.
- Use the Symfony secrets vault (`secrets:set`) or environment variables in production. Never commit real values.
- Rotating `APP_SECRET` invalidates all signed cookies and CSRF tokens — active sessions dropped.

## Production

- `APP_ENV=prod`, `APP_DEBUG=0`. Debug mode exposes profiler, stack traces, database queries, environment variables.
- Consider `nelmio/security-bundle` for CSP, HSTS, X-Frame-Options headers.

## Password Hashing

- Use `algorithm: auto` in `security.yaml` — selects strongest available (argon2id > bcrypt). Transparent rehashing on login.
- Never use `md5()`, `sha1()`, or hardcode `bcrypt` when `argon2id` is available.

## File Upload

- Validate MIME type by file content (`File` constraint with `mimeTypes`), not by extension (spoofable).
- Store uploads outside public directory. Serve through authorized controller. Never use original filename.

## Dependency Audit

- Run `composer audit` in CI on every PR. Treat high-severity advisories as build failures.

## Common Footguns

- **`APP_ENV=dev` in production**: exposes `/_profiler`, full stack traces, database queries
- **Missing `denyAccessUnlessGranted()`**: `access_control` matches URLs, not ownership
- **`|raw` on user input**: bypasses auto-escaping
- **String interpolation in queries**: always use parameter binding
- **`APP_SECRET` shared across environments**: compromised dev = compromised production
- **Extension-only file validation**: trivially bypassed by renaming
- **Hardcoded `algorithm: bcrypt`**: prevents transparent upgrade to argon2id
