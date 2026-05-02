---
goat-flow-reference-version: "1.4.0"
---
# goat-security reference: auth and authz

Use this pack for login, session, token, password reset, role, tenant, or object-access paths.

## Common failure classes

- authentication mistaken for authorization
- missing object ownership checks on ids from path, query, form, or body
- role checks present on UI only, not on the server path
- password-reset or invite flows missing actor validation
- token or session audience / scope mismatch
- admin or support tooling reusing normal user paths without stricter checks

## High-signal review questions

- Who is allowed to act on this object?
- Where is that rule enforced server-side?
- Can an authenticated low-privilege actor swap the target id?
- Does the code trust client-supplied tenant, role, or user ids?
- Does a background job or webhook bypass the same guardrails?

## Strong evidence patterns

- endpoint reads `userId`, `accountId`, `tenantId`, or `orgId` from input without matching it to the session principal
- object lookup happens before authorization and the returned object is used directly
- password reset, MFA reset, or email change accepts attacker-chosen target identifiers
- staff-only action guarded only by `isAuthenticated`, `@login_required`, or equivalent

## Common false positives

- route is public by design and the action is read-only, low-sensitivity, and documented
- framework policy layer already enforces object ownership on the exact path
- the target id is derived exclusively from the session or a trusted backend token, not user input

## Attack-scenario shorthand

- "Any authenticated user can act on another tenant's object by swapping `<id>` in `<path>`."
- "A low-privilege user can trigger `<admin action>` because the endpoint checks login but not role/ownership."

## Related surfaces

- session fixation / cookie scope
- JWT audience, issuer, and scope validation
- support impersonation tooling
- audit logs for privileged actions
