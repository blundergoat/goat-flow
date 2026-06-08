---
goat-flow-reference-version: "1.10.1"
---
# goat-security reference: file upload and paths

Use this pack for uploads, archives, temp files, export/import jobs, filesystem writes, or user-controlled paths.

## Common failure classes

- path traversal via filename, archive entry, or symlink
- trusting MIME type or extension without content validation
- writing user-controlled paths outside the intended root
- unsafe temp-file naming or reuse
- archive extraction without zip-slip checks
- serving uploaded content from an executable or privileged location

## High-signal review questions

- Is the final filesystem path derived from user input?
- Is the path normalized and checked against an allowlisted root?
- Are archives or nested paths extracted safely?
- Can an attacker overwrite an existing file, config, or hook?
- Is uploaded content later rendered or executed?

## Strong evidence patterns

- string concatenation into filesystem paths without normalization
- missing `realpath` / canonical-root check after join/normalize
- archive extraction code that trusts entry names directly
- upload handlers that allow HTML, SVG, JS, or script-like content into served directories
- temp files created in predictable locations with attacker-controlled names

## Common false positives

- path is entirely server-generated and input never influences it
- uploaded files are stored outside execution paths and served with safe content disposition
- framework utility rejects traversal and the reviewed call path uses it before filesystem access

## Verification prompts

- prove the write root cannot be escaped
- prove overwrite semantics are safe
- prove uploaded content is not executed, interpreted, or reflected unsafely
