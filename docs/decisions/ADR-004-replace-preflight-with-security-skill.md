# ADR-004: Replace goat-preflight skill with goat-security

**Date:** 2026-03-22
**Status:** Accepted

## Context

The GOAT Flow skill system has 7 skills. goat-preflight was consistently rated the weakest by 6 independent agent reviews (avg score 72/100, range 45-90). The core criticism: it's a shell script wrapper — `scripts/preflight-checks.sh` already does everything the skill does. The scanner already checks for the preflight script (check 2.2.5). The skill adds "fix and re-run" logic, but that's the only value over running the script directly.

Meanwhile, security review was identified as the #1 missing capability. 5 of 6 projects have security-sensitive code (rampart is a security platform, sus-form-detector is a security library, all projects have auth boundaries). No current skill prevents the specific failure mode where agents flag framework-mitigated vulnerabilities as real issues (e.g., SQL injection on parameterized queries).

Multi-agent review consensus:
- "A glorified shell script" (Codex)
- "A shell script could replace it entirely" (Gemini)
- "Least skill-like of the set — more of a checklist" (Claude Code)
- "Its value is as a convenience alias, not as a reasoning framework" (Claude Code)

## Decision

Remove goat-preflight from the expected skills list. Add goat-security as its replacement.

- The preflight *script* (`scripts/preflight-checks.sh`) stays — it's the real enforcement mechanism
- The preflight *skill* (`.claude/skills/goat-preflight/`, `.agents/skills/goat-preflight/`) is removed from the expected list but files are not deleted (projects may still use it)
- goat-security is a new skill with a 4-phase structure: threat model → OWASP scan → framework-aware verification → rank by exploitability
- The expected skills list changes from 7 to 7 (swap, not reduction)

## Consequences

- Scanner check 2.2.5 (preflight script exists) continues to enforce the mechanical verification gate
- The skill quality checks (Step 0, human gates, constraints, phases, conversational) now apply to goat-security instead of goat-preflight
- Projects that already have goat-preflight skill files can keep them — they just won't be scored
- The framework-aware verification pass (Phase 2) in goat-security is the key differentiator — it prevents agents from flagging mitigated vulnerabilities, which is the most common false-positive pattern in security audits
- goat-security needs to be created for all 6 projects (M2.8 task)
