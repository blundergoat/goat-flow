---
goat-flow-reference-version: "1.16.0"
---
# goat-security reference: identity and data confidentiality

Use for login, session, token, reset, role, tenant, object access, logs, telemetry, errors, prompts, artifacts, debug endpoints, or credential storage. Authentication changes attacker preconditions; it does not make an unauthorized disclosure safe. Record the actual actor, authorization boundary, data class, and blast radius.

## Auth and authz

### Common failure classes

- authentication mistaken for authorization
- missing object ownership checks on ids from path, query, form, or body
- role checks present on UI only, not on the server path
- cookie-authenticated state-changing requests missing framework CSRF protection
- password reset, invite, MFA enrollment, or recovery flows missing actor and replay validation
- weak or legacy password storage instead of a salted adaptive password hash; credential stuffing, enumeration, weak throttling, or MFA bypass
- session fixation or missing rotation after login, privilege change, reset, or impersonation
- OAuth/OIDC issuer, audience, signature, state, nonce, redirect, or PKCE validation gaps
- API key, service account, or workload identity with excessive scope, weak rotation/revocation, or unsafe delegation
- webhook authentication missing signature verification, freshness bounds, or replay protection
- token/session lifetime, revocation, binding, cookie, or scope mismatch
- session cookies missing appropriate `Secure`, `HttpOnly`, and `SameSite` attributes or over-broad Domain/Path scope
- admin or support tooling reusing normal user paths without stricter checks

### High-signal review questions

- Who is allowed to act on this object?
- Where is that rule enforced server-side?
- Can an authenticated low-privilege actor swap the target id?
- Does the code trust client-supplied tenant, role, or user ids?
- Does a background job or webhook bypass the same guardrails?
- Are API keys and service accounts scoped to the exact workload, stored safely, rotated, and revocable?
- Does each webhook verify its signature over the raw payload, enforce freshness, and reject replay before privileged work?
- Does each cookie-authenticated browser mutation validate a CSRF token or an equivalent framework control rather than relying on SameSite alone?
- Can login, reset, recovery, or token endpoints be replayed, enumerated, or abused without rate controls?

### Strong evidence patterns

- endpoint reads `userId`, `accountId`, `tenantId`, or `orgId` from input without matching it to the session principal
- object lookup happens before authorization and the returned object is used directly
- password reset, MFA reset, or email change accepts attacker-chosen target identifiers
- staff-only action guarded only by `isAuthenticated`, `@login_required`, or equivalent
- an OIDC callback accepts a token without verifying issuer, audience, signature, state, and nonce as required by the flow
- session identifiers survive authentication or privilege changes without rotation

### Common false positives

- route is public by design and the action is read-only, low-sensitivity, and documented
- framework policy layer already enforces object ownership on the exact path
- the target id is derived from a verified principal and the same server-side policy constrains the exact object/action

### Attack-scenario shorthand

- "Any authenticated user can act on another tenant's object by swapping `<id>` in `<path>`."
- "A low-privilege user can trigger `<admin action>` because the endpoint checks login but not role/ownership."

## Secrets and data exposure

### Common failure classes

- secrets logged in plaintext
- credentials or tokens committed to config, examples, or templates
- verbose errors exposing internal paths, queries, or secrets
- build or CI artifacts containing environment data
- prompts or agent instructions that encourage exfiltration or unsafe disclosure
- caches, reports, or screenshots persisting sensitive data longer than intended
- data classification, minimization, retention, residency, deletion, or tenant-isolation gaps

### High-signal review questions

- Does this path read, write, log, upload, or echo secrets?
- Could an error path expose data that the success path hides?
- Do docs, examples, or prompts include real keys or production URLs?
- Are CI artifacts or diagnostic bundles filtered before upload?
- Are secret classes distinguished, or is everything treated as low-sensitivity text?
- Do storage, telemetry, support, model, and third-party paths honor classification, minimization, and retention rules?

### Strong evidence patterns

- direct logging of tokens, passwords, env vars, auth headers, cookies, or private keys
- credentials or reset/session tokens in URLs, referrers, traces, shell arguments, or process listings
- workflow step uploads `.env`, config directories, or raw debug dumps
- prompt or hook text instructs the agent to print secrets or copy them into reports
- examples in tracked files contain live credentials or internal-only endpoints

### Common false positives

- secret placeholders clearly marked as placeholders
- documented irreversible identifiers with no secret or correlation value; password hashes and keyed digests remain sensitive
- debug logs proven local/scoped, access-controlled, short-lived, and free of secret-bearing fields

### Positive observations

- explicit redaction helpers
- allowlisted artifact contents
- docs that show placeholder formats instead of real values
- rotation/revocation paths and audited privileged impersonation
- deny rules that block secret reads plus retention/deletion enforcement
