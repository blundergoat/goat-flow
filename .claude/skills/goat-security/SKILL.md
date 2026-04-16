---
name: goat-security
description: "Threat-model-driven security assessment with framework-aware verification, exploitability ranking, and confidence classification."
goat-flow-skill-version: "1.1.0"
---
# /goat-security

## Shared Conventions

Read `.goat-flow/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-conventions.md`.

## When to Use

Use when assessing security posture: before deployment, after adding auth/input handling, when touching secrets/credentials, or for a security-focused audit.

**NOT this skill:** Code quality/design issues → /goat-review.

## Step 0 - Choose Depth

> "Assessing [X] -- quick scan, or full assessment with threat model, framework verification, and confidence classification?"

- If user already names depth/concern, confirm and continue.
- If arriving from the dispatcher with depth already chosen, skip the depth question.
- If vague, ask one follow-up covering: component, threat concern, deployment context, framework.
- Auto-detect framework from package files and state it briefly.

**Footgun check:** Read `.goat-flow/footguns/` for entries mentioning the target area. Present matches.

## Quick Scan Path

1. Identify the framework and its built-in mitigations.
2. Scan by severity: auth/secrets first, then injection, then config/exposure.
3. For each finding, check if the framework already mitigates it - remove false positives.
4. Present findings ordered by severity with `file:line` evidence.
5. Note what wasn't checked.

## Full Assessment Path

### Phase 1 - Threat Surface Scan

Scan applicable categories (validation/auth/input, secret handling, injections, CVEs) and log each finding with `file:line`.

### Phase 2 - Framework-Aware Verification

For each finding, re-check framework mitigations and remove false positives. Flag partial mitigation and unresolved exposure.

**BLOCKING GATE:** Present verified findings, then pause.

### Phase 3 - Confidence Classification

- **CONFIRMED** - traced entry-to-sink path, OBSERVED
- **PROBABLE** - plausible issue, missing/unclear source trace, INFERRED
- **THEORETICAL** - policy/control gap without exploit path, INFERRED

### Phase 4 - Exploitability Ranking

Critical (no auth) > High (low-privilege) > Medium (specific conditions) > Low (theoretical). For Critical/High, write attack scenario: "An [attacker] can [action] via [vector], resulting in [impact]."

### Phase 5 - Self-Check

Re-read `file:line` for Critical/High. Does code match the finding? Is the scenario realistic? Remove failures.

**Dependency audit:** If the project uses dependency management (npm, pip, cargo, composer, etc.), check for known vulnerabilities using the project's audit tool. If the audit tool isn't installed (e.g., `pip-audit` for Python), note it as a gap: "Dependency audit skipped - [tool] not available. Install with [command] for future scans." Do NOT fabricate audit results.

**BLOCKING GATE:** Present final report. If PROBABLE > CONFIRMED, run `/goat-sbao` cross-examination.

## Compliance Mode

For compliance checks, present gaps as: non-compliant, partially compliant, or not assessed. Include direct citations to relevant clauses where possible.

## Constraints

- MUST NOT flag framework-mitigated issues as vulnerabilities
- MUST include attack scenario for Critical and High findings
- Universal constraints from skill-preamble.md apply.
- MUST re-verify Critical and High findings before presenting
- MUST classify every finding as CONFIRMED, PROBABLE, or THEORETICAL
- MUST show data flow path for CONFIRMED findings
- MUST default to confirmed-only report unless user requests full

## Output Format

```markdown
## TL;DR / Threat Surface / Findings
## CONFIRMED / PROBABLE / THEORETICAL
## What I Didn't Check
```
