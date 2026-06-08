---
goat-flow-reference-version: "1.10.1"
---
# goat-security reference: identity and data confidentiality

Use this pack for login, session, token, password reset, role, tenant, or object-access paths AND for logs, telemetry, error handling, prompts, artifacts, debug endpoints, or credential storage. Auth/authz and data-exposure failures share the same trust boundaries: an authenticated path that leaks data is equivalent to an unauthenticated read.

## Auth and authz

### Common failure classes

- authentication mistaken for authorization
- missing object ownership checks on ids from path, query, form, or body
- role checks present on UI only, not on the server path
- password-reset or invite flows missing actor validation
- token or session audience / scope mismatch
- admin or support tooling reusing normal user paths without stricter checks

### High-signal review questions

- Who is allowed to act on this object?
- Where is that rule enforced server-side?
- Can an authenticated low-privilege actor swap the target id?
- Does the code trust client-supplied tenant, role, or user ids?
- Does a background job or webhook bypass the same guardrails?

### Strong evidence patterns

- endpoint reads `userId`, `accountId`, `tenantId`, or `orgId` from input without matching it to the session principal
- object lookup happens before authorization and the returned object is used directly
- password reset, MFA reset, or email change accepts attacker-chosen target identifiers
- staff-only action guarded only by `isAuthenticated`, `@login_required`, or equivalent

### Common false positives

- route is public by design and the action is read-only, low-sensitivity, and documented
- framework policy layer already enforces object ownership on the exact path
- the target id is derived exclusively from the session or a trusted backend token, not user input

### Attack-scenario shorthand

- "Any authenticated user can act on another tenant's object by swapping `<id>` in `<path>`."
- "A low-privilege user can trigger `<admin action>` because the endpoint checks login but not role/ownership."

### Related surfaces

- session fixation / cookie scope
- JWT audience, issuer, and scope validation
- support impersonation tooling
- audit logs for privileged actions

## Secrets and data exposure

### Common failure classes

- secrets logged in plaintext
- credentials or tokens committed to config, examples, or templates
- verbose errors exposing internal paths, queries, or secrets
- build or CI artifacts containing environment data
- prompts or agent instructions that encourage exfiltration or unsafe disclosure
- caches, reports, or screenshots persisting sensitive data longer than intended

### High-signal review questions

- Does this path read, write, log, upload, or echo secrets?
- Could an error path expose data that the success path hides?
- Do docs, examples, or prompts include real keys or production URLs?
- Are CI artifacts or diagnostic bundles filtered before upload?
- Are secret classes distinguished, or is everything treated as low-sensitivity text?

### Strong evidence patterns

- direct logging of tokens, passwords, env vars, auth headers, cookies, or private keys
- workflow step uploads `.env`, config directories, or raw debug dumps
- prompt or hook text instructs the agent to print secrets or copy them into reports
- examples in tracked files contain live credentials or internal-only endpoints

### Common false positives

- secret placeholders clearly marked as placeholders
- redacted or hashed values with no recovery path
- debug logs gated to local-only mode and excluding secret-bearing fields

### Positive observations

- explicit redaction helpers
- allowlisted artifact contents
- docs that show placeholder formats instead of real values
- deny rules or ignore files that block secret-path reads
