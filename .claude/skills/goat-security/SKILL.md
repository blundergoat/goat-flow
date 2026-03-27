---
name: goat-security
description: "Assess security posture with threat-model-driven, framework-aware verification"
goat-flow-skill-version: "0.7.0"
---
# /goat-security

Security-focused assessment. Differs from goat-audit: audit = broad quality sweep, security = threat-model-driven, OWASP-aware, framework-specific verification.

---

## When to Use

Use when assessing security posture: before deployment, after adding auth/input handling, when touching secrets/credentials, or as part of a security-focused audit.

---

## Step 0 — Gather Context

Ask the user before scanning:

1. **What's the threat model?** (user-facing app, internal tool, library, API)
2. **What auth/security boundaries exist?**
3. **Any known vulnerabilities to skip?**
4. **What framework security features are already in place?**

Do NOT start scanning until the user has answered.

---

## Phase 1 — Threat Surface Scan

Scan against checklist: input validation, auth boundaries, secret handling, injection vectors (SQL/XSS/command/path), dependency CVEs, permission escalation, CORS/CSP. Log every finding with file:line.

Report: "Phase 1 complete. Found [N] potential findings. Starting framework verification."

---

## Phase 2 — Framework-Aware Verification

For EACH Phase 1 finding, check if the framework already mitigates it. Remove false positives. Flag partial/misconfigured mitigation.

THIS IS THE KEY DIFFERENTIATOR — goat-audit doesn't have this pass.

**HUMAN GATE:** Present verified findings. Ask: "Want me to:
  (a) verify a specific finding against the framework
  (b) check a different attack surface
  (c) test an edge case
  (d) proceed to ranking"

Do NOT auto-advance. Let the human drill into specific findings or redirect.

---

## Phase 3 — Rank by Exploitability

- **Critical**: exploitable without auth, data loss/exposure
- **High**: exploitable with auth, privilege escalation
- **Medium**: requires specific conditions, defense-in-depth gap
- **Low**: theoretical, mitigated by other controls

Use severity scale: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

---

## Phase 4 — Self-Check

Same fabrication gate as goat-audit. Re-read file:line refs. Remove unverifiable findings. Flag low-confidence.

Present findings. Ask: "Want me to dig deeper on any of these? Any that look like false positives?"

Do NOT auto-advance. Do NOT propose fixes.

---

## Constraints

- MUST gather threat model before scanning (Step 0)
- MUST check framework mitigation for every finding (Phase 2)
- MUST rank by exploitability, not just severity (Phase 3)
- MUST self-check all file:line references (Phase 4)
- MUST NOT propose fixes — security audit reports only
- MUST NOT flag framework-mitigated issues as vulnerabilities

## Output Format

```
## Security Assessment: [scope]

### Summary
- Phase 1: [N] potential findings
- Phase 2: [N] after framework verification (-[N] mitigated)
- Phase 4: [N] after self-check (-[N] removed)

### Critical
- **[title]** - [file:line] - [description + exploitability]

### High
- **[title]** - [file:line] - [description + exploitability]

### Medium
- **[title]** - [file:line] - [description + conditions]

### Low
- **[title]** - [file:line] - [description + mitigating factors]
```

---

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → `docs/lessons.md`
- Architectural trap with file:line evidence → `docs/footguns.md`

---

## Chains With

- goat-debug — investigate a vulnerability further
- goat-review — security-specific PR review
