# Cypress Security Standards

Reference for generating `ai/instructions/security.md` in projects that use Cypress for browser or end-to-end testing.

This file is additive. Load it alongside the application's real framework-specific security file.

## Test-Only Auth And Seed Shortcuts

Test helpers that bypass normal auth or seed privileged state are acceptable only when they are hard-gated to test environments.

```ts
// DO — test-only helper guarded by environment
app.post('/__test__/login', (req, res) => {
  if (process.env.NODE_ENV !== 'test') {
    return res.status(404).end();
  }
  // create scoped test session here
  res.status(204).end();
});

// DON'T — permanent backdoor route
app.post('/test-login', (req, res) => {
  // works in dev, staging, and prod
  res.json({ token: 'admin-token' });
});
```

- Test-only routes must be disabled outside automated test environments.
- Never ship admin-seed endpoints, bypass tokens, or "magic login" routes to shared environments.

## Secrets In Cypress Config

```json
// DO — use environment variables or CI secret injection
{
  "baseUrl": "http://localhost:3000"
}

// DON'T — commit real secrets to cypress.env.json
{
  "adminEmail": "real-admin@example.com",
  "adminPassword": "RealPassword123!",
  "apiKey": "sk_live_real_key"
}
```

- Do not commit real credentials, session cookies, API keys, or bearer tokens in `cypress.env.json`, fixtures, or screenshots.
- Prefer `CYPRESS_*` environment variables in CI over checked-in test secrets.

## Browser Security Settings

```ts
// DO — keep browser security defaults unless there is a documented, narrow reason
export default defineConfig({
  e2e: {
    baseUrl: 'http://localhost:3000',
  },
});

// DON'T — disable browser protections to "make tests pass"
export default defineConfig({
  chromeWebSecurity: false,
});
```

- `chromeWebSecurity: false` weakens same-origin protections and can hide real production security bugs.
- If a test truly needs a relaxed browser setting, document why and scope it to the narrowest possible case.

## CSRF, CSP, And SameSite

- Do not disable CSRF, CSP, or `SameSite` protections globally just because Cypress tests are failing.
- Test the real browser flow: fetch CSRF token, submit forms correctly, and assert secure cookie behavior.
- If you need cross-origin flows, prefer explicit Cypress support (`cy.origin`) over weakening the application.

```ts
// DO — test the real flow
cy.visit('/login');
cy.get('form').within(() => {
  cy.get('input[name=email]').type('test@example.com');
  cy.get('input[name=password]').type('password');
  cy.root().submit();
});

// DON'T — patch the app to skip CSRF for all test traffic
if (process.env.CYPRESS) {
  app.disableCsrf = true;
}
```

## Network Stubbing And External Calls

```ts
// DO — stub third-party calls in tests
cy.intercept('POST', 'https://api.stripe.com/**', {
  statusCode: 200,
  body: { id: 'tok_test_123' },
});

// DON'T — run destructive tests against live third-party services
cy.request('POST', 'https://api.stripe.com/v1/charges', realPayload);
```

- Use `cy.intercept()` to stub external dependencies and failure modes.
- Never point Cypress at production or shared destructive environments for write-path tests.

## Artifact And Fixture Hygiene

- Screenshots, videos, and downloaded artifacts may contain PII, tokens, or internal URLs.
- Sanitize fixtures and seed data. Use fake users, fake cards, fake documents, and fake addresses.
- Treat uploaded test artifacts as sensitive if they include auth state, customer data, or admin views.

## Common Footguns

- **`chromeWebSecurity: false`**: hides real same-origin and CSP issues instead of testing them.
- **Committed `cypress.env.json` secrets**: test credentials leak into git history and CI logs.
- **Permanent test backdoor routes**: `/test-login`, `/seed-admin`, or similar helpers survive into non-test environments.
- **Disabling CSRF or CSP for Cypress**: weakens the real app instead of fixing the test setup.
- **Running tests against prod/shared data**: destructive specs mutate real accounts and leak artifacts.
- **Fixtures with real PII**: screenshots and videos become a secondary data leak path.
