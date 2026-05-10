---
goat-flow-reference-version: "1.6.0"
---
# goat-security reference: CI/CD and agent surfaces

Use this pack for GitHub Actions, shell scripts, hooks, prompts, instruction files, skill files, and agent configuration.

## CI/CD red flags

- `pull_request_target` on untrusted code paths
- unpinned third-party actions
- dangerous `${{ github.event.* }}` interpolation into shell
- `curl | bash`, `wget | sh`, or base64-decoded execution
- overly broad workflow or job permissions
- secrets or env vars passed into untrusted steps
- artifact upload / download steps that trust unreviewed content

## Shell and installer red flags

- unquoted variables in privileged commands
- user-controlled paths passed to `rm`, `cp`, `mv`, `tar`, `chmod`, or `chown`
- installers that overwrite tracked config silently
- verification scripts that claim success without checking exit codes

## Local server and PTY red flags

- local HTTP servers binding wider than localhost without an explicit trust model
- missing Host or Origin validation on browser and WebSocket requests
- predictable or absent session IDs on terminal, WebSocket, or PTY channels
- browser-controlled input reaching shell, PTY, or terminal runners without confirmation and workspace scoping
- cwd/workspace boundaries that allow one project session to read or execute in another project

## Agent-surface red flags

- malicious or over-permissive instructions in `AGENTS.md`, prompt files, or skill files
- hooks that broaden permissions or leak secrets
- skill or prompt text that asks for escalation, secrecy, or social engineering
- third-party templates copied into `.github/`, `.agents/`, `.claude/`, or other agent-runtime/template directories without review

## Positive observations

- least-privilege workflow permissions
- pinned action versions or digests
- hooks that fail closed on dangerous commands
- local servers restricted to localhost with checked WebSocket/session provenance
- instruction files that clearly separate trusted repo policy from untrusted artifact content

## Active-testing authorization gate

Before invoking any tool that performs active exploitation, mutative scans, or live-traffic fuzzing (e.g. Shannon-style autonomous pentesters, sqlmap, ZAP active scan, Burp scanner, custom exploit chains), confirm three things in order. Skip none. Display the gate before every run; if the user already confirmed in this session, a one-line reminder is enough.

1. **Authorization.** Ask: "Do you have explicit written authorization to actively test this target?" If the user is unsure, stop and explain that written permission from the system owner is required. Authorization is a prerequisite, not a checkbox.
2. **Environment.** Confirm the target is local, staging, or sandboxed. **Never run against production.** A staging URL that proxies production traffic counts as production.
3. **Scope.** Clarify the categories the user wants tested (full pentest vs targeted: injection, xss, ssrf, auth, authz, etc.) and the time/cost budget. Tools that quote runtime in hours or non-trivial dollar costs MUST surface those numbers up front.

When the gate passes, surface a banner that names the mutative-effect risk:

```
⚠  Active testing performs REAL ATTACKS with mutative effects.
├─ Targets: systems the user OWNs or has WRITTEN AUTHORIZATION to test
├─ Never: production environments, third-party services without authorization
├─ Output: requires human review — tool output may include hallucinated findings
└─ Liability: the operator complies with all applicable laws
```

Stop conditions (any of these): authorization is missing or ambiguous; the target resolves to a production hostname/IP; the tool needs credentials beyond the user's stated test account; the runtime/cost estimate breaches the user's budget; the tool requires Docker, system packages, or network egress that the user has not approved. On stop, name what was missing and offer one alternative (passive review, code-only audit, or an ask for written authorization).

This gate sits above the existing review-mode work — `goat-security` defaults to passive review (`Quick Scan Path` / `Full Assessment Path`); active testing is an opt-in escalation that requires this gate to fire first.

## Review shorthand

- CI/CD issues often map straight to `Critical` or `High` because they sit on privileged surfaces.
- Agent-surface issues deserve the same weight as auth or secrets findings when they can exfiltrate, escalate, or disable safeguards.
