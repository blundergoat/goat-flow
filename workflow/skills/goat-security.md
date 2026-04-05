---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, and concrete dependency auditing."
goat-flow-skill-version: "1.0.0"
---
# /goat-security

<!-- Shared Conventions: inline from workflow/skills/reference/shared-preamble.md during setup.
     Setup agents: read shared-preamble.md and include its content as "## Shared Conventions" at the top of the installed SKILL.md. -->

## When to Use

Use when assessing security posture: before deployment, after adding auth/input
handling, when touching secrets/credentials, or for a security-focused audit.

**NOT this skill:**
- General code quality sweep → /goat-review (audit mode)
- Reviewing a specific diff for issues → /goat-review
- Diagnosing a specific vulnerability → /goat-debug
- Understanding code before securing it → /goat-debug (investigate mode)

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. Which component or area? (or I'll scan the full project)
2. What's the deployment context? (user-facing web app, internal tool, CLI, library, API)
3. Any specific threat concern? (injection, auth bypass, data exposure - or "general audit")

**Illustrative questions (adapt):**
4. <!-- ADAPT: "What auth boundaries exist? (OAuth, JWT, session, API key, none)" -->
5. <!-- ADAPT: "Any known vulnerabilities to skip? (already tracked, being fixed separately)" -->
6. What framework are you using? (I'll check its built-in security features in Phase 2)

<!-- ADAPT: Dynamic context injection (optional). These run at skill load time:
**Dependencies:** !`cat package.json 2>/dev/null | jq -r '.dependencies + .devDependencies | keys[]' | head -15`
**Framework:** !`cat composer.json 2>/dev/null | jq -r '.require | keys[]' | head -10`
-->

**Escape hatch:** If the user says "just scan everything" or provides minimal info, auto-detect framework from package files and run a broad threat surface scan.

**Auto-detect:** Read package.json/composer.json/go.mod to identify framework.
Present: "This is a [framework] project. I'll check [framework]'s built-in
security features during verification."

**Footgun check:** If `ai-docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Contradiction check:** If the user's stated complexity doesn't match the actual scope, flag it:
- "hotfix" but 5+ files affected → likely Standard or System
- "small feature" but crosses 3+ boundaries → likely System
- "quick test" but 20+ functions in target → warn scope is larger than implied
Surface the mismatch, suggest re-classification. Don't silently proceed.

**Before proceeding:** present what you know (threat model, framework, auth boundaries) and what you still need. Wait for the user to confirm before entering Phase 1.

## Phase 1 - Threat Surface Scan

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
| Dependency CVEs | Known vulnerabilities in dependencies | - | Run audit command below |
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

## Phase 2 - Framework-Aware Verification

**THIS IS THE KEY DIFFERENTIATOR.** For EACH Phase 1 finding, check if the
framework already mitigates it. Attempt to DISPROVE each finding - the adversarial
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

## Phase 3 - Exploitability Ranking

Rank verified findings by exploitability, not just severity:

- **Critical:** Exploitable without authentication. Immediate action required.
- **High:** Exploitable with low-privilege access. Should fix before deployment.
- **Medium:** Exploitable with specific conditions or chained with another issue.
- **Low:** Theoretical risk, mitigated by other controls or very hard to exploit.

For each **Critical** and **High** finding, write a one-sentence attack scenario:
"An [attacker profile] can [action] via [vector], resulting in [impact]."

Example: "An unauthenticated user can extract the users table by submitting
`' OR 1=1--` in the search field at `src/api/search.ts:42`."

## Phase 4 - Self-Check

Re-read each cited `file:line` for Critical and High findings.
- Does the code actually do what the finding claims?
- Did the framework verification in Phase 2 actually check the right thing?
- Is the attack scenario realistic given the deployment context?

Remove findings that don't survive re-verification.

**BLOCKING GATE:** Present final report using the Output Format template below.

---

## Compliance Mode

<!-- EVOLVING: This mode will be expanded as compliance standards are added -->

Activated when Step 0 identifies a regulatory compliance concern (HIPAA, GDPR, SOC2, PCI-DSS).

### Phase C1 - Regulation Detection

Identify which regulations apply from project context:
- HIPAA: PHI/healthcare data, patient records, health APIs
- GDPR: EU user data, consent flows, data subject rights
- SOC2: Enterprise SaaS, audit logging, access controls
- PCI-DSS: Payment processing, card data, tokenization

If unclear, ask: "Which regulatory framework applies? (HIPAA, GDPR, SOC2, PCI-DSS, or tell me more)"

Load relevant coding standards if they exist: `ai-docs/coding-standards/security.md` and framework-specific security files.

### Phase C2 - Compliance Scan

For each applicable regulation, check against its core requirements using the Phase 1 threat surface categories as a base. Add regulation-specific checks:
- **HIPAA:** minimum necessary principle, tenant scoping, audit trail, PHI in logs (see `workflow/coding-standards/security/phi-compliance.md` for reference)
- **GDPR:** consent mechanisms, data subject access/deletion, data processing agreements, cross-border transfer
- **SOC2:** access control logging, change management, incident response procedures
- **PCI-DSS:** cardholder data isolation, encryption at rest/transit, key management

Log findings with `file:line` evidence and regulation citation.

### Phase C3 - Gap Report

Present compliance gaps ordered by risk:
- **Non-compliant:** Direct violation of a regulatory requirement. Cite the specific regulation clause.
- **Partially compliant:** Implementation exists but is incomplete or misconfigured.
- **Not assessed:** Requires access/context the agent doesn't have (e.g., infrastructure config, vendor agreements).

**BLOCKING GATE:** Present compliance report. Offer:
(a) drill into a specific finding
(b) check a different regulation
(c) proceed to exploitability ranking (Phase 3) for technical findings
(d) close

---

## Common Failure Modes

1. **Generic OWASP checklist** - agent runs through web categories on a CLI tool. The skip conditions in Phase 1 prevent this.
2. **False positives from framework ignorance** - agent flags "no input sanitization" in a Rails app where strong params handle it. Phase 2 catches this.
3. **Missing dependency audit** - agent scans code but skips `npm audit`. The concrete commands in Phase 1 prevent this.

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
- **[title]** - `file:line`
  **Attack scenario:** An [attacker] can [action] via [vector], resulting in [impact]
  **Framework mitigation:** [not mitigated | mitigated by X - downgraded]

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

- /goat-review - security findings feed into change review
- /goat-debug - specific vulnerability needs deeper diagnosis
- /goat-review - security scan reveals broader quality issues → audit mode

**Handoff shape:** `{threat_model, findings_by_exploitability, framework_mitigations, dependency_audit_results}`
