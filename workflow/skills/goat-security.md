# Prompt: Create /goat-security Skill

Paste this into your coding agent to create the `/goat-security` skill for your project.

---

## The Prompt

```
Create the /goat-security skill for this project.

## When to Use

Use when assessing security posture: before deployment, after adding auth/input
handling, when touching secrets/credentials, or as part of a security-focused audit.
Differs from goat-audit: audit = broad quality sweep, security = threat-model-driven,
OWASP-aware, framework-specific verification.

Write the skill file to: .claude/skills/goat-security/SKILL.md
(For Codex/Gemini: .agents/skills/goat-security/SKILL.md)

## Step 0 — Gather Context

Ask the user before scanning:

1. What's the threat model? (user-facing app, internal tool, library, API)
2. What auth/security boundaries exist?
3. Any known vulnerabilities to skip?
4. What framework security features are already in place?

Do NOT start scanning until the user has answered.

The skill follows a strict 4-phase process:

Phase 1 — Threat Surface Scan:
- Scan against checklist: input validation, auth boundaries, secret handling,
  injection vectors (SQL/XSS/command/path), dependency CVEs, permission
  escalation, CORS/CSP
- Log every finding with file:line evidence

Phase 2 — Framework-Aware Verification:
- For EACH Phase 1 finding, check if the framework already mitigates it
- Remove false positives. Flag partial/misconfigured mitigation
- THIS IS THE KEY DIFFERENTIATOR — goat-audit doesn't have this pass

HUMAN GATE: Present verified findings. Ask "Want me to:
  (a) verify a specific finding against the framework
  (b) check a different attack surface
  (c) test an edge case
  (d) proceed to ranking"
Do NOT auto-advance.

Phase 3 — Rank by Exploitability:
- Critical: exploitable without auth, data loss/exposure
- High: exploitable with auth, privilege escalation
- Medium: requires specific conditions, defense-in-depth gap
- Low: theoretical, mitigated by other controls
Use severity scale: SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Phase 4 — Self-Check:
- Same fabrication gate as goat-audit. Re-read file:line refs
- Remove unverifiable findings. Flag low-confidence
- Present findings. Ask: "Want me to dig deeper on any of these?"
- Do NOT auto-advance. Do NOT propose fixes.

The skill MUST:
- Gather threat model before scanning (Step 0)
- Check framework mitigation for every finding (Phase 2)
- Rank by exploitability, not just severity (Phase 3)
- Self-check all file:line references (Phase 4)

The skill MUST NOT:
- Propose fixes — security audit reports only
- Flag framework-mitigated issues as vulnerabilities
- Skip the self-check pass

VERIFICATION:
- Verify skill file exists at the correct path
- Verify Step 0 context gathering is present
- Verify 4-phase structure with framework-aware verification
- Verify hard gate between Phase 2 and Phase 3
- Verify output format template is included

## Learning Loop

If this run uncovered a lesson or footgun, update the relevant doc before closing:
- Behavioural mistake → docs/lessons.md
- Architectural trap with file:line evidence → docs/footguns.md

## Chains With

- goat-debug — investigate a vulnerability further
- goat-review — security-specific PR review

## Output

Structured security assessment with threat surface findings, framework verification results, exploitability ranking — presented for human review. No fixes proposed.
```
