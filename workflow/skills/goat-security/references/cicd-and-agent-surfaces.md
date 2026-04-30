---
goat-flow-reference-version: "1.3.2"
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

## Review shorthand

- CI/CD issues often map straight to `Critical` or `High` because they sit on privileged surfaces.
- Agent-surface issues deserve the same weight as auth or secrets findings when they can exfiltrate, escalate, or disable safeguards.
