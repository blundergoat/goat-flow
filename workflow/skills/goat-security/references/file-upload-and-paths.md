---
goat-flow-reference-version: "1.17.0"
---
# goat-security reference: file upload and paths

Use this pack for uploads, archives, temp files, export/import jobs, filesystem writes, or user-controlled paths.

## Common failure classes

- path traversal via filename, archive entry, or symlink
- trusting MIME type or extension without content validation
- writing user-controlled paths outside the intended root
- unsafe temp-file naming or reuse
- archive extraction without zip-slip checks
- zip/XML bombs, parser abuse, and missing post-decompression limits
- storage quotas or download amplification left unbounded
- serving uploaded content from an executable or privileged location
- symlink and TOCTOU races between validation and filesystem access

## High-signal review questions

- Is the final filesystem path derived from user input?
- Is the path normalized and checked against an allowlisted root?
- Are archives or nested paths extracted safely?
- Are upload, expanded-size, file-count, storage quotas, and download-rate limits enforced?
- Can an attacker overwrite an existing file, config, or hook?
- Is uploaded content later rendered or executed?
- Are authentication, authorization, and CSRF protection enforced before upload or mutation?

## Strong evidence patterns

- string concatenation into filesystem paths without normalization
- missing `realpath` / canonical-root check after join/normalize
- archive extraction code that trusts entry names directly
- upload handlers that allow HTML, SVG, JS, or script-like content into served directories
- temp files created in predictable locations with attacker-controlled names
- validation followed by a separate path open that permits a symlink swap

## Storage and content controls

- Prefer server-generated random names mapped to metadata; never trust the client filename as storage identity.
- Store content outside the webroot or on a separate host; serve through an authorization-aware handler with safe disposition and content type.
- Apply allowlisted extensions plus content/signature validation, and use antivirus, sandbox, or CDR when the threat model and data policy permit it. External scanners create a data-egress boundary.
- Enforce request, file-count, archive-entry, post-decompression, storage, processing-time, and download limits before expensive work.
- Use least-privilege filesystem ownership and prohibit execution in upload storage.

## Race-safe path handling

Normalization and `realpath` checks are useful but do not close races or safely create a path that does not exist. Prefer a platform safe-open primitive anchored to an already-open trusted directory, reject symlinks where required, use exclusive creation/no-follow semantics, and verify the opened object rather than only its path string.

## Common false positives

- path is entirely server-generated and input never influences it
- uploaded files are stored outside execution paths and served with safe content disposition
- framework utility rejects traversal and the reviewed call path uses it before filesystem access

## Verification prompts

- prove the write root cannot be escaped
- prove overwrite semantics are safe
- prove validation and use cannot be separated by a symlink or rename race
- prove archive expansion, storage, processing, and retrieval stay within quotas
- prove uploaded content is not executed, interpreted, or reflected unsafely
