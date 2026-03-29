# Authentication & Authorization Standards

Reference for generating `ai/instructions/security.md` in projects using JWT, OAuth, or session-based auth.

## JWT

- **Access tokens**: 15-minute expiry maximum. Short-lived limits damage from token theft.
- **Refresh tokens**: single-use with rotation. Issue a new refresh token on each use and invalidate the old one.
- **Storage (browser)**: httpOnly cookie. Never localStorage or sessionStorage — both are readable by JavaScript and vulnerable to XSS.
- **Storage (native mobile)**: use the platform secure store (iOS Keychain, Android Keystore), not shared preferences or localStorage equivalents.
- **Storage (server-to-server)**: environment variables or a secrets manager. Cookies are not the right model.
- **Validation**: always verify signature, `exp`, `iss`, `aud`. Reject tokens missing any claim.

```js
// DO — store JWT in httpOnly cookie
res.cookie('access_token', jwt, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict',
  maxAge: 15 * 60 * 1000,  // 15 minutes
  path: '/',
});

// DON'T — store JWT in localStorage (accessible to XSS)
localStorage.setItem('access_token', jwt);
```

```python
# DO — validate all claims
payload = jwt.decode(
    token,
    key=PUBLIC_KEY,
    algorithms=["RS256"],
    audience="https://api.example.com",
    issuer="https://auth.example.com",
)

# DON'T — skip validation
payload = jwt.decode(token, options={"verify_signature": False})
```

- Use asymmetric signing (RS256/ES256) for services that only verify, never issue tokens.
- Implement a token revocation list or use short expiry + refresh rotation to handle logout.

## OAuth 2.0

- **Authorization Code flow with PKCE**: the only flow for browser and mobile apps.
- **Never use Implicit flow**: it exposes tokens in the URL fragment.
- **State parameter**: random, single-use, tied to the user's session. Prevents CSRF on the callback.
- **PKCE**: generate `code_verifier` (43-128 chars), derive `code_challenge` via S256. Send challenge on authorize, verifier on token exchange.

```js
// DO — authorization code with PKCE
const codeVerifier = crypto.randomBytes(32).toString('base64url');
const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');
const state = crypto.randomBytes(16).toString('hex');

const authUrl = `https://auth.example.com/authorize?` +
  `response_type=code&client_id=${clientId}&redirect_uri=${redirectUri}` +
  `&code_challenge=${codeChallenge}&code_challenge_method=S256&state=${state}`;

// DON'T — implicit flow
const authUrl = `https://auth.example.com/authorize?response_type=token&...`;
```

## Session Management

- Store session data server-side (Redis, database). The client holds only an opaque session ID.
- Regenerate session ID after login to prevent session fixation.
- Absolute timeout: 24 hours. Idle timeout: 30 minutes.
- Invalidate all sessions on password change.

```python
# DO — regenerate session after login (Django)
request.session.cycle_key()

# DO — set session timeouts
SESSION_COOKIE_AGE = 86400          # 24-hour absolute timeout
SESSION_SAVE_EVERY_REQUEST = True   # rolling expiry — resets on each request for idle tracking
# Note: Django has no built-in idle timeout separate from absolute. For a 30-min idle
# cutoff, use middleware that checks request.session['last_activity'] and expires manually.
```

## RBAC (Role-Based Access Control)

- Check permissions at the route/handler level, not in templates or frontend code.
- Deny by default. Every route requires explicit authorization unless marked public.
- Separate authentication (who are you?) from authorization (what can you do?).

```python
# DO — check at the handler
@require_permission("orders:read")
def list_orders(request):
    return Order.objects.filter(tenant=request.user.tenant)

# DON'T — check only in the template
{% if user.role == "admin" %}
  <a href="/admin/users">Manage Users</a>  {# endpoint still unprotected #}
{% endif %}
```

## API Keys

- Hash stored copies with bcrypt, scrypt, or Argon2 (SHA-256 is too fast for key hashing). Never store plaintext API keys in the database. Note: bcrypt truncates input at 72 bytes — for API keys longer than 72 characters, pre-hash with SHA-256 before passing to bcrypt.
- Scope each key to minimum required permissions and resources.
- Rotate on a schedule (90 days) and on any suspected compromise.
- Prefix keys for identification: `prefix_live_`, `prefix_test_` (use your project's prefix). Makes leaked key triage faster.
- Log key usage. Alert on anomalous patterns (sudden volume spike, geographic shift).

## Machine-to-Machine Auth (service-to-service)

- Use OAuth 2.0 Client Credentials flow for service-to-service communication. Developers often reach for shared API keys when Client Credentials is the correct, auditable pattern.
- Each service gets its own client ID and secret. Never share credentials across services.
- Tokens are short-lived (5-15 minutes). The calling service requests a new token when the current one expires.
- Never pass API keys in URL query parameters — they appear in server logs, browser history, and proxy logs. Use the `Authorization` header.

```python
# DO — OAuth 2.0 Client Credentials flow
import httpx

token_resp = httpx.post("https://auth.example.com/oauth/token", data={
    "grant_type": "client_credentials",
    "client_id": os.environ["SERVICE_CLIENT_ID"],
    "client_secret": os.environ["SERVICE_CLIENT_SECRET"],
    "scope": "orders:read",
})
access_token = token_resp.json()["access_token"]

resp = httpx.get("https://api.example.com/orders",
    headers={"Authorization": f"Bearer {access_token}"})

# DON'T — shared API key in URL
resp = httpx.get(f"https://api.example.com/orders?api_key={SHARED_KEY}")
```

## mTLS (Mutual TLS)

- For zero-trust or high-security service-to-service communication, use mutual TLS: both client and server present certificates.
- Issue per-service certificates from an internal CA. Do not use self-signed certificates in production.
- Rotate certificates before expiry. Automate rotation with cert-manager (Kubernetes) or ACME.
- mTLS authenticates the service identity at the transport layer — still use application-level authorization to control what the service can do.

## Brute-Force Protection

- Rate-limit login and token endpoints. Use progressive delays or account lockout after repeated failures.
- Lock accounts after 5-10 failed attempts. Require CAPTCHA or email verification to unlock.
- Log all failed authentication attempts with IP, timestamp, and target account for monitoring.
- Apply rate limits per IP and per account independently — per-IP alone doesn't stop credential stuffing across accounts.

## Common Footguns

- **JWT in localStorage**: any XSS vulnerability leaks the token. Use httpOnly cookies.
- **Missing audience/issuer validation**: tokens from one service accepted by another.
- **No token revocation**: user logs out but token is valid for 15 more minutes. Mitigate with short expiry + refresh rotation.
- **Client-side auth checks only**: hiding a button is not access control. The API must enforce permissions.
- **Long-lived refresh tokens without rotation**: if stolen, attacker has indefinite access.
- **Shared API keys**: one key per integration, never a master key passed to multiple consumers.
- **API keys in URLs**: query parameter keys appear in server access logs, browser history, referrer headers, and proxy logs. Use the `Authorization` header instead.
