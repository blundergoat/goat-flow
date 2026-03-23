# Security Policy

## Scope

GOAT Flow is a documentation framework for AI coding agent workflows. It consists of Markdown docs, Bash scripts, and a local scanner CLI. There is no hosted service, no network calls, and no data collection.

Security concerns here are primarily about:
- Workflow recommendations that could lead to unsafe agent behaviour
- Shell scripts that run locally on your machine
- The scanner CLI, which runs locally -- no data leaves your machine

## Reporting a Vulnerability

If you discover a security issue, please report it responsibly:

- **Email:** security@mattyhansen.com
- **GitHub Security Advisories:** Use the "Report a vulnerability" button on the [Security tab](../../security/advisories/new)

Please do **not** open a public issue for security vulnerabilities.

We aim to acknowledge reports within 48 hours and provide a fix or mitigation plan within 7 days.

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest release | Yes |
| Older releases | Best effort |
