# Universal Web Security Standards

Reference for generating `ai/instructions/security.md` in any web project.

## OWASP Top 10 Quick Reference

| # | Risk | Prevention |
|---|------|-----------|
| A01 | Broken Access Control | Deny by default, enforce server-side, CORS restrict origins |
| A02 | Cryptographic Failures | TLS everywhere, hash passwords with bcrypt/argon2, no MD5/SHA1 for secrets |
| A03 | Injection | Parameterized queries, context-aware output encoding, never concatenate user input |
| A04 | Insecure Design | Threat model before coding, enforce limits and quotas, unit test abuse cases |
| A05 | Security Misconfiguration | Disable debug in production, remove default creds, automate hardened config |
| A06 | Vulnerable Components | Keep deps updated, monitor advisories, audit lockfiles in CI |
| A07 | Auth Failures | MFA support, rate-limit login, never expose session IDs in URLs |
| A08 | Data Integrity Failures | Verify signatures on updates/serialized data, use SRI for CDN scripts |
| A09 | Logging Failures | Log auth events and access control failures, never log secrets or PII |
| A10 | SSRF | Validate/whitelist outbound URLs, block internal network ranges, disable redirects |

## HTTP Security Headers

Set these on every response. Values below are conservative defaults — adjust CSP directives for your actual asset sources and inline script needs.

```
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: camera=(), microphone=(), geolocation=()
```

```python
# DO — set all security headers (Django middleware example)
response["Content-Security-Policy"] = "default-src 'self'; script-src 'self'"
response["X-Content-Type-Options"] = "nosniff"
response["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains; preload"

# DON'T — skip headers or use unsafe values
response["Content-Security-Policy"] = "default-src *; script-src 'unsafe-inline' 'unsafe-eval'"
```

## Cookie Security

Every cookie that holds session or auth data MUST set all flags.

```
Set-Cookie: session_id=abc123; Secure; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400
```

- **Secure**: only sent over HTTPS. No exceptions in production.
- **HttpOnly**: JavaScript cannot read the cookie. Blocks XSS theft.
- **SameSite=Lax**: prevents CSRF on GET-mutating routes. Use `Strict` if no cross-site navigation needed.
- **Path=/**: scope to the application root unless a narrower scope is justified.
- **Domain**: omit to restrict to the exact issuing host. Set only for subdomain sharing.

```js
// DO
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  maxAge: 86400000,
  path: '/',
});

// DON'T — missing flags
res.cookie('session', token);
```

## CORS Configuration

```js
// DO — explicit origin whitelist
const allowedOrigins = ['https://app.example.com', 'https://admin.example.com'];
app.use(cors({
  origin: (origin, cb) => allowedOrigins.includes(origin) ? cb(null, true) : cb(new Error('Blocked')),
  credentials: true,
}));

// DON'T — wildcard with credentials
app.use(cors({ origin: '*', credentials: true }));
```

- Never use `origin: '*'` in production. Enumerate allowed origins.
- When `credentials: true`, the browser rejects wildcard origins anyway — but misconfigured servers may reflect the request origin, which is equally dangerous.

## Rate Limiting

- **Per-IP**: 100 requests/minute for general endpoints. Lower for expensive operations.
- **Per-user**: 20 requests/minute for auth-sensitive endpoints (login, password reset).
- **Auth failures**: exponential backoff — 1s, 2s, 4s, 8s... up to 5-minute lockout after 10 failures.
- Return `429 Too Many Requests` with a `Retry-After` header.

## Error Responses

```json
// DO — safe error response
{ "error": "An unexpected error occurred", "request_id": "abc-123" }

// DON'T — leaks internals
{ "error": "SQLSTATE[42S02]: Table 'users' not found at /var/www/app/Models/User.php:42" }
```

- Never return stack traces, file paths, SQL errors, or dependency versions to clients.
- Log the full error server-side with a request ID. Return only the request ID to the client.
- Use generic messages: "Invalid credentials" not "User not found" vs "Wrong password" (prevents user enumeration).
