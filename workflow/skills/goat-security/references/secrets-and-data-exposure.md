---
goat-flow-reference-version: "1.3.3"
---
# goat-security reference: secrets and data exposure

Use this pack for logs, telemetry, error handling, prompts, artifacts, debug endpoints, or credential storage.

## Common failure classes

- secrets logged in plaintext
- credentials or tokens committed to config, examples, or templates
- verbose errors exposing internal paths, queries, or secrets
- build or CI artifacts containing environment data
- prompts or agent instructions that encourage exfiltration or unsafe disclosure
- caches, reports, or screenshots persisting sensitive data longer than intended

## High-signal review questions

- Does this path read, write, log, upload, or echo secrets?
- Could an error path expose data that the success path hides?
- Do docs, examples, or prompts include real keys or production URLs?
- Are CI artifacts or diagnostic bundles filtered before upload?
- Are secret classes distinguished, or is everything treated as low-sensitivity text?

## Strong evidence patterns

- direct logging of tokens, passwords, env vars, auth headers, cookies, or private keys
- workflow step uploads `.env`, config directories, or raw debug dumps
- prompt or hook text instructs the agent to print secrets or copy them into reports
- examples in tracked files contain live credentials or internal-only endpoints

## Common false positives

- secret placeholders clearly marked as placeholders
- redacted or hashed values with no recovery path
- debug logs gated to local-only mode and excluding secret-bearing fields

## Positive observations

- explicit redaction helpers
- allowlisted artifact contents
- docs that show placeholder formats instead of real values
- deny rules or ignore files that block secret-path reads
