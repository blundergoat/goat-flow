---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, and concrete dependency auditing."
goat-flow-skill-version: "0.7.0"
---
# /goat-security

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it — don't re-ask. Only hard-block with zero context.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Learning Loop:** Behavioural mistake → `docs/lessons.md`. Architectural trap → `docs/footguns.md`.
- **Closing:** Commit or note working artifacts. Check learning loop. Suggest next skill.

## When to Use

Use when assessing security posture: before deployment, after adding auth/input
handling, when touching secrets/credentials, or for a security-focused audit.

**NOT this skill:**
- General code quality sweep → /goat-audit
- Reviewing a specific diff for issues → /goat-review
- Diagnosing a specific vulnerability → /goat-debug
- Understanding code before securing it → /goat-investigate

## Step 0 — Gather Context

**Structural questions (always ask or confirm):**
1. What's the threat model? (user-facing web app, internal tool, CLI, library, API)
2. What framework are you using? (I'll check its built-in security features in Phase 2)

**Illustrative questions (adapt):**
3. <!-- ADAPT: "What auth boundaries exist? (OAuth, JWT, session, API key, none)" -->
4. <!-- ADAPT: "Any known vulnerabilities to skip? (already tracked, being fixed separately)" -->

**Auto-detect:** Read package.json/composer.json/go.mod to identify framework.
Present: "This is a [framework] project. I'll check [framework]'s built-in
security features during verification."

## Phase 1 — Threat Surface Scan

Scan against the checklist below. **Skip categories that don't apply** based
on Step 0 threat model (a CLI tool doesn't need CORS/CSP checks).

<!-- ADAPT: Remove categories irrelevant to your stack -->

| Category | Check | Skip If | Example |
|----------|-------|---------|---------|
| Input validation | User input reaches backend without sanitization | No user input (library) | `req.body.name` passed directly to SQL |
| Auth/authz | Missing or bypassable authentication on sensitive routes | No HTTP endpoints | Session token in URL, missing CSRF on POST |
| Secret handling | Hardcoded secrets, .env committed, secrets in logs | No secrets in codebase | API key in source, token in error message |
| SQL injection | User input in raw queries without parameterization | No database | `db.query("SELECT * FROM users WHERE id=" + id)` |
| XSS | User input rendered without escaping | No HTML output | `innerHTML = userInput`, unescaped template |
| Command injection | User input in shell commands | No shell execution | `exec("convert " + filename)`, unsanitized args |
| Path traversal | User input in file paths | No file system access | `fs.readFile(basePath + userInput)` |
| Dependency CVEs | Known vulnerabilities in dependencies | — | Run audit command below |
| CORS/CSP | Misconfigured cross-origin policies | No HTTP server | `Access-Control-Allow-Origin: *` |
| Permission escalation | Role/privilege checks missing or bypassable | Single-role system | Admin routes without role check |

**Dependency audit commands:**
<!-- ADAPT: Use your project's package manager -->
```bash
npm audit              # Node.js
pip-audit              # Python
cargo audit            # Rust
composer audit          # PHP
bundler-audit check    # Ruby
dotnet list package --vulnerable  # .NET
```

Log every finding with `file:line` evidence.

## Phase 2 — Framework-Aware Verification

**THIS IS THE KEY DIFFERENTIATOR.** For EACH Phase 1 finding, check if the
framework already mitigates it. Attempt to DISPROVE each finding — the adversarial
framing catches more false positives than "check if it's handled."

**Framework verification examples:**
<!-- ADAPT: Replace with your framework's security features -->

| Framework | Feature | What it mitigates | How to verify |
|-----------|---------|-------------------|---------------|
| Express | `helmet()` middleware | XSS, clickjacking, MIME sniffing | Check `app.use(helmet())` exists AND is before route handlers |
| Express | `csurf` / `csrf()` | CSRF attacks | Check middleware registered on state-changing routes |
| Django | ORM queries | SQL injection | Check no `.raw()` or `.extra()` with user input |
| Django | `CsrfViewMiddleware` | CSRF | Check not in `CSRF_EXEMPT` for sensitive views |
| Rails | `strong_parameters` | Mass assignment | Check `params.require(:model).permit(...)` on controllers |
| Rails | Auto-escaping in ERB | XSS | Check no `raw()` or `.html_safe` on user content |
| React | JSX auto-escaping | XSS | Check no `dangerouslySetInnerHTML` with user content |
| Next.js | Server actions | CSRF, input validation | Check server actions validate input, don't trust client |
| Symfony | CSRF token component | CSRF | Check forms include `csrf_token()` |
| Spring | Security filter chain | Auth bypass | Check `SecurityFilterChain` covers the route |

**Verification protocol:**
For each finding: Is the mitigation (a) installed, (b) configured, (c) applied
to the specific route/endpoint? Flag partial mitigation: "helmet() is installed
but `contentSecurityPolicy` is disabled."

Remove confirmed false positives. Flag partial mitigations as findings.

**BLOCKING GATE:** Present verified findings. Offer:
(a) verify a specific finding against the framework
(b) check a different attack surface
(c) test an edge case
(d) proceed to ranking

## Phase 3 — Exploitability Ranking

Rank verified findings by exploitability, not just severity:

- **Critical:** Exploitable without authentication. Immediate action required.
- **High:** Exploitable with low-privilege access. Should fix before deployment.
- **Medium:** Exploitable with specific conditions or chained with another issue.
- **Low:** Theoretical risk, mitigated by other controls or very hard to exploit.

For each **Critical** and **High** finding, write a one-sentence attack scenario:
"An [attacker profile] can [action] via [vector], resulting in [impact]."

Example: "An unauthenticated user can extract the users table by submitting
`' OR 1=1--` in the search field at `src/api/search.ts:42`."

## Phase 4 — Self-Check

Re-read each cited `file:line` for Critical and High findings.
- Does the code actually do what the finding claims?
- Did the framework verification in Phase 2 actually check the right thing?
- Is the attack scenario realistic given the deployment context?

Remove findings that don't survive re-verification.

**BLOCKING GATE:** Present final report using the Output Format template below.

## Common Failure Modes

1. **Generic OWASP checklist** — agent runs through web categories on a CLI tool. The skip conditions in Phase 1 prevent this.
2. **False positives from framework ignorance** — agent flags "no input sanitization" in a Rails app where strong params handle it. Phase 2 catches this.
3. **Missing dependency audit** — agent scans code but skips `npm audit`. The concrete commands in Phase 1 prevent this.

## Constraints

<!-- FIXED: Do not adapt these -->
- MUST NOT flag framework-mitigated issues as vulnerabilities
- MUST include attack scenario for Critical and High findings
- MUST run dependency audit using project's package manager
- MUST skip irrelevant categories based on threat model
- MUST NOT fabricate file paths or function names
- MUST re-verify Critical and High findings before presenting

## Output Format

```markdown
## TL;DR
<!-- 3 sentences: threat model, key findings, posture assessment -->

## Threat Surface
| Category | Status | Skip Reason |
|----------|--------|-------------|
| Input validation | Scanned / Skipped | [if skipped: why] |
| Auth/authz | ... | ... |
| Secret handling | ... | ... |
| SQL injection | ... | ... |
| XSS | ... | ... |
| Command injection | ... | ... |
| Path traversal | ... | ... |
| Dependency CVEs | ... | ... |
| CORS/CSP | ... | ... |
| Permission escalation | ... | ... |

## Findings (by exploitability)

### Critical (exploitable without auth)
- **[title]** — `file:line`
  **Attack scenario:** An [attacker] can [action] via [vector], resulting in [impact]
  **Framework mitigation:** [not mitigated | mitigated by X — downgraded]

### High / Medium / Low

## Framework Mitigations Verified
| Feature | Installed | Configured | Applied to routes |
|---------|-----------|------------|-------------------|

## What I Didn't Check
<!-- Threat surfaces skipped and why -->

## Dependency Audit
<!-- Output of npm audit / pip-audit / cargo audit / etc. -->
```

## Chains With

- /goat-review — security findings feed into change review
- /goat-debug — specific vulnerability needs deeper diagnosis
- /goat-audit — security scan reveals broader quality issues → codebase sweep

**Handoff shape:** `{threat_model, findings_by_exploitability, framework_mitigations, dependency_audit_results}`
