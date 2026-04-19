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

## Agent-surface red flags

- malicious or over-permissive instructions in `AGENTS.md`, prompt files, or skill files
- hooks that broaden permissions or leak secrets
- skill or prompt text that asks for escalation, secrecy, or social engineering
- third-party templates copied into `.github/`, `.agents/`, `.claude/`, or other agent-runtime/template directories without review

## Positive observations

- least-privilege workflow permissions
- pinned action versions or digests
- hooks that fail closed on dangerous commands
- instruction files that clearly separate trusted repo policy from untrusted artifact content

## Review shorthand

- CI/CD issues often map straight to `Critical` or `High` because they sit on privileged surfaces.
- Agent-surface issues deserve the same weight as auth or secrets findings when they can exfiltrate, escalate, or disable safeguards.
