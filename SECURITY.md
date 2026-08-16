# Security Policy

## Scope

GOAT Flow is a documentation framework for AI coding agent workflows. It consists of Markdown docs, Bash scripts, and a local auditor CLI. There is no GOAT Flow hosted service or telemetry collection; audit data stays local unless the user sends or persists it elsewhere. Installing or launching through npm/npx may contact the configured package registry. The optional dashboard (`goat-flow dashboard`) loads Tailwind CSS, Alpine.js, and xterm.js from jsDelivr CDN, and its embedded terminal or agent launchers can run user-selected tools with their own network behavior.

Security concerns here are primarily about:
- Workflow recommendations that could lead to unsafe agent behaviour
- Shell scripts that run locally on your machine, including the deny hooks

## Target Checkout Execution

Audit, setup-prompt generation, quality-prompt generation, and dashboard audit routes inspect target hook configuration statically by default. Static inspection may invoke fixed local tooling such as Git or `bash -n`, but it does not run the checkout's configured hook launcher or managed hook self-tests.

`--trusted-target` enables that checkout-controlled runtime proof for a selected agent. The configured launcher may pass through `bash -c`, so treat this flag as permission to execute code from the selected checkout. `hooks verify` also requires `--trusted-target` before it starts hook code; omission returns unsupported evidence. The deprecated `--untrusted-target` flag remains a static alias throughout v1.16.x and cannot be combined with `--trusted-target`.

## Reporting a Vulnerability

If you discover a security issue, report it privately through one of these channels:

- **Email:** hello@blundergoat.com
- **GitHub Security Advisories:** Use the "Report a vulnerability" button on the [Security tab](../../security/advisories/new)

Please do **not** open a public issue for security vulnerabilities.

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | Best effort |
