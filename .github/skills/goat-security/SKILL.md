---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, and confidence classification."
goat-flow-skill-version: "1.1.0"
---
# /goat-security

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.
If unavailable, use these essentials:
- Severity: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE
- Evidence: every finding MUST include file or file:line, tag OBSERVED vs INFERRED
- Learning loop: check .goat-flow/lessons/ and .goat-flow/footguns/ after completion
- Gates: BLOCKING GATE = stop and wait. CHECKPOINT = continue unless interrupted.

## When to Use

Use when assessing security posture: before deployment, after adding auth/input handling, when touching secrets/credentials, or for a security-focused audit.

**Boundary:** goat-security owns threat models, compliance, dependency CVEs, auth/authz boundaries. goat-review owns code quality, style, correctness. If you find a code quality issue, flag it and suggest `/goat-review`.

**NOT this skill:** Code quality sweep → /goat-review. Reviewing a diff → /goat-review. Diagnosing a vulnerability → /goat-debug. Planning milestones → /goat-plan. Feature briefs → dispatcher Planning Route.

## Step 0 - Choose Depth

> "Assessing [X] -- quick scan, or full assessment with threat model, framework verification, and confidence classification?"

- If user already says "quick", "full", or names a threat concern, confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: component, threat concern, deployment context, framework.
- Auto-detect framework from package files (package.json, go.mod, etc.). Present: "This is a [framework] project."

**Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the target area. Present matches.

## Quick Scan Path

Identify framework, run threat surface scan, call out highest-risk findings. Keep moving unless user interrupts.

## Full Assessment Path

### Phase 1 - Threat Surface Scan

Scan these categories. **Skip categories that don't apply** based on threat model. Log every finding with `file:line`.

Input validation (skip: no user input) | Auth/authz (skip: no HTTP) | Secret handling | SQL injection (skip: no DB) | XSS (skip: no HTML) | Command injection (skip: no shell) | Path traversal (skip: no FS) | Dependency CVEs (run `npm audit`/`pip-audit`/`cargo audit`/equivalent) | CORS/CSP (skip: no HTTP server) | Permission escalation (skip: single-role)

### Phase 2 - Framework-Aware Verification

**Key differentiator.** For EACH finding, check if the project's framework already mitigates it. Attempt to DISPROVE each finding. Is the mitigation installed, configured, and applied to the specific route/endpoint? Remove false positives. Flag partial mitigations.

**BLOCKING GATE:** Present verified findings, then pause.

### Phase 3 - Confidence Classification

- **CONFIRMED** - input traced entry to sink. Show: `[entry] -> ... -> [sink]`. Tag: OBSERVED.
- **PROBABLE** - vulnerable pattern, input source unclear. Identify missing trace. Tag: INFERRED.
- **THEORETICAL** - best-practice gap, no exploit path. Show what controls must fail. Tag: INFERRED.

Standard report: CONFIRMED + PROBABLE in "Needs Verification". Full report: all findings.

### Phase 4 - Exploitability Ranking

Critical (no auth) > High (low-privilege) > Medium (specific conditions) > Low (theoretical). For Critical/High, write attack scenario: "An [attacker] can [action] via [vector], resulting in [impact]."

### Phase 5 - Self-Check

Re-read `file:line` for Critical/High. Does code match the finding? Is the scenario realistic? Remove failures.

**Dependency audit:** If the project uses dependency management (npm, pip, cargo, composer, etc.), check for known vulnerabilities using the project's audit tool. If the audit tool isn't installed (e.g., `pip-audit` for Python), note it as a gap: "Dependency audit skipped — [tool] not available. Install with [command] for future scans." Do NOT fabricate audit results.

**BLOCKING GATE:** Present final report. If PROBABLE findings outnumber CONFIRMED, consider `/goat-sbao` to cross-examine PROBABLE findings before presenting to human.

## Compliance Mode

Compliance checks are opt-in. Only activate when the user explicitly mentions HIPAA, GDPR, SOC2, PCI-DSS, or regulatory compliance. Run the standard assessment first, then layer regulation-specific checks on top. Present gaps as non-compliant / partially compliant / not assessed with regulation clause citations.

## Constraints

- MUST NOT flag framework-mitigated issues as vulnerabilities
- MUST include attack scenario for Critical and High findings
- MUST run dependency audit using project's package manager
- MUST skip irrelevant categories based on threat model
- Universal constraints from skill-preamble.md apply.
- MUST re-verify Critical and High findings before presenting
- MUST classify every finding as CONFIRMED, PROBABLE, or THEORETICAL
- MUST show data flow path for CONFIRMED findings
- MUST default to standard report (CONFIRMED only) unless user requests full

## Quick Output Format

TL;DR → top findings → framework mitigations.

## Output Format

```markdown
## TL;DR  <!-- threat model, key findings, posture -->
## Threat Surface - | Category | Status | Skip Reason |
## Findings (exploitability x confidence)
### Critical - **[CRITICAL/CONFIRMED] [title]** `file:line` | Data flow | Attack scenario | Framework mitigation
### High / Medium / Low
## Needs Verification - **[sev/PROBABLE] [title]** `file:line` | Pattern | Missing trace
## Framework Mitigations Verified - | Feature | Installed | Configured | Applied |
## What I Didn't Check
```
