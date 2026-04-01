---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, compliance auditing, and dependency vulnerability scanning."
goat-flow-skill-version: "0.9.4"
---
# /goat-security

## Shared Conventions

- **Severity:** SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- **Evidence:** Every finding needs `file:line`. Tag as OBSERVED (verified) or INFERRED (state what's missing). MUST NOT fabricate.
- **Gates:** BLOCKING GATE = must stop for human. CHECKPOINT = report status, continue unless interrupted.
- **Adaptive Step 0:** If context already provided, confirm it - don't re-ask. Bare invocation with no arguments = zero context = ask structural questions and WAIT. Auto-detect pre-fills - it does not replace confirmation.
- **Stuck:** 3 reads with no signal → present what you have, ask to redirect.
- **Flush:** 10+ tool calls without a gate/checkpoint → write 3-sentence status to `.goat-flow/tasks/handoff.md`, ask to continue/compact/redirect.
- **Learning Loop:** Behavioural mistake → create a new markdown entry in `ai/lessons/` or `.goat-flow/lessons/`. Architectural trap → create a new markdown entry in `docs/footguns/` or `.goat-flow/footguns/`.
- **Closing:** FIRST: if `.goat-flow/logs/sessions/` exists, write session summary there (date, skill, complexity, turns, incidents). THEN: if incomplete → write `.goat-flow/tasks/handoff.md`. Check learning loop. Suggest next skill.

## When to Use

Use when assessing security posture, checking compliance, or auditing dependencies.

**Mode routing:**
- Security assessment / pentest / before deploy → **Threat model mode** (Phases T1-T4)
- HIPAA / GDPR / PHI / compliance audit → **Compliance mode** (Phases C1-C3)
- CVEs / outdated packages / supply chain → **Dependency audit mode** (Phases D1-D3)

**NOT this skill:**
- General code quality sweep → /goat-review (audit mode)
- Reviewing a specific diff → /goat-review
- Diagnosing a specific vulnerability → /goat-debug

## Step 0 - Gather Context

**Structural questions (always ask or confirm):**
1. What's the goal? (security assessment, compliance audit, dependency scan)
2. What's the threat model? (user-facing web app, internal tool, CLI, library, API)
3. What framework? (I'll check built-in security features)

**Auto-detect:** Read package.json/composer.json/go.mod to identify framework. Check for PHI/compliance signals in README, docs/architecture.md.

**Footgun check:** If `docs/footguns/` or `.goat-flow/footguns/` exists, read entries mentioning the target area from both locations. If a match is found, present it: "This area has a known issue: [footgun]. Relevant?"

**Before proceeding:** present mode, threat model, framework, and scope. Wait for confirmation.

---

## Threat Model Mode (Phases T1-T4)

### Phase T1 - Threat Surface Scan

Scan against the checklist. **Skip categories that don't apply** based on threat model.

| Category | Check | Skip If |
|----------|-------|---------|
| Input validation | User input reaches backend unsanitized | No user input |
| Auth/authz | Missing or bypassable auth on sensitive routes | No HTTP endpoints |
| Secret handling | Hardcoded secrets, .env committed, secrets in logs | No secrets |
| SQL injection | User input in raw queries | No database |
| XSS | User input rendered without escaping | No HTML output |
| Command injection | User input in shell commands | No shell execution |
| Path traversal | User input in file paths | No file system access |
| Dependency CVEs | Known vulnerabilities in dependencies | — |
| CORS/CSP | Misconfigured cross-origin policies | No HTTP server |
| Permission escalation | Role/privilege checks missing | Single-role system |

Log every finding with `file:line` evidence.

### Phase T2 - Framework-Aware Verification

For EACH Phase T1 finding, check if the framework already mitigates it. Attempt to DISPROVE each finding.

**Verification protocol:** Is the mitigation (a) installed, (b) configured, (c) applied to the specific route? Flag partial mitigation.

Remove confirmed false positives. Flag partial mitigations as findings.

**BLOCKING GATE:** Present verified findings. Offer: (a) verify a finding, (b) check different surface, (c) test edge case, (d) proceed to ranking

### Phase T3 - Exploitability Ranking

- **Critical:** Exploitable without authentication. Immediate action.
- **High:** Exploitable with low-privilege access. Fix before deploy.
- **Medium:** Exploitable with specific conditions or chained.
- **Low:** Theoretical, mitigated by other controls.

For Critical and High: one-sentence attack scenario: "An [attacker] can [action] via [vector], resulting in [impact]."

### Phase T4 - Self-Check

Re-read each `file:line` for Critical and High findings. Does the code match the claim? Is the attack scenario realistic? Remove findings that don't survive.

**BLOCKING GATE:** Present final report.

---

## Compliance Mode (Phases C1-C3)

Activated for HIPAA, GDPR, PHI, PCI-DSS, or other regulatory compliance.

### Phase C1 - Regulatory Scope

Identify which regulations apply and what they require:

| Regulation | Key Requirements | Check Areas |
|-----------|-----------------|-------------|
| HIPAA | PHI protection, audit trails, access controls | Logs, error messages, queries, storage |
| GDPR | Consent, data minimization, right to erasure | User data flows, retention, exports |
| PCI-DSS | Cardholder data protection, encryption | Payment flows, storage, transmission |

### Phase C2 - Compliance Scan

For each applicable requirement:

1. **PHI/PII in logs:** Grep for logging statements that could include patient data, names, emails, SSNs. Check error handlers.
2. **Unscoped tenant queries:** Check that all database queries are scoped by tenant/organization. Flag queries without tenant filter.
3. **Unencrypted PII at rest:** Check database columns, file storage, cache entries for plaintext sensitive data.
4. **Missing audit trails:** Check that sensitive operations (data access, modification, deletion) are logged with who/what/when.
5. **Consent mechanisms:** Check that data collection has consent flows, opt-out paths, and deletion capabilities.

For each finding: `file:line`, regulation reference, current state, required state.

### Phase C3 - Compliance Report

Map findings to specific regulatory requirements. Rank by risk of regulatory action.

**BLOCKING GATE:** Present compliance report. Offer: (a) drill into specific regulation, (b) check additional area, (c) close

---

## Dependency Audit Mode (Phases D1-D3)

Activated for CVE scanning, outdated packages, or supply chain assessment.

### Phase D1 - Run Audit Tools

Run the project's package manager audit:
```bash
npm audit              # Node.js
pip-audit              # Python
cargo audit            # Rust
composer audit          # PHP
bundler-audit check    # Ruby
dotnet list package --vulnerable  # .NET
```

Also check: `npm outdated` / `composer outdated` / equivalent for major version gaps.

### Phase D2 - Contextualize Findings

For each vulnerability found:
1. **Is the vulnerable code path actually used?** Read how the dependency is imported and used in THIS project.
2. **Is it a direct or transitive dependency?** Direct = higher priority.
3. **Is there a fix available?** Check if a patched version exists.
4. **What's the upgrade risk?** Major version bump = breaking changes. Minor = likely safe.

Filter out: vulnerabilities in dev-only dependencies not exposed in production, vulnerabilities in code paths the project doesn't use.

### Phase D3 - Dependency Report

Present findings ranked by: exploitability × usage × fix availability.

| Package | Vulnerability | Severity | Direct? | Used Code Path | Fix Available | Upgrade Risk |
|---------|--------------|----------|---------|---------------|--------------|-------------|

**Known malicious packages:** Flag any dependency that appears in known-malicious registries or has been recently transferred to a new maintainer.

**BLOCKING GATE:** Present report. Offer: (a) investigate specific CVE, (b) check transitive deps, (c) close

---

## Constraints

Conversational: present findings by severity tier, pause between tiers. Let the human drill in.

- MUST NOT flag framework-mitigated issues as vulnerabilities (threat model mode)
- MUST include attack scenario for Critical and High findings (threat model mode)
- MUST run dependency audit using project's package manager
- MUST skip irrelevant categories based on threat model
- MUST map compliance findings to specific regulations (compliance mode)
- MUST check if vulnerable code paths are actually used (dependency mode)
- MUST re-verify Critical and High findings before presenting
- MUST NOT fabricate file paths or function names

## Output Format

See mode-specific phases above for output structure. All modes produce findings with `file:line` evidence tagged OBSERVED/INFERRED.

## Chains With

- /goat-review - security findings feed into change review
- /goat-debug - specific vulnerability needs deeper diagnosis
- /goat-test - verify security mitigations with test plan

**Handoff shape:** `{mode, threat_model?, findings_by_exploitability?, compliance_gaps?, dependency_audit_results?}`
