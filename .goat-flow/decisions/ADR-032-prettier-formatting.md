# ADR-032: Prettier for code formatting

**Status:** Accepted
**Date:** 2026-04-09

## Context

The codebase had inconsistent formatting across TypeScript, JavaScript, and HTML files. Indentation depth varied (some files used 4-space nesting for HTML partials, others used 2-space), and attribute wrapping was inconsistent. The `.editorconfig` was added to define the standard (2-space, UTF-8, LF), but editors only apply it to new edits - existing files stay inconsistent until explicitly reformatted.

Running the IDE formatter (Ctrl+Shift+L) on individual files produced large diffs that mixed formatting noise with real changes, making reviews harder.

## Decision

**Add Prettier as a dev dependency.** It reads `.editorconfig` automatically (no separate `.prettierrc` needed) and normalizes all source files to a single style.

- `npm run format` - write-mode, for local use
- `npm run format:check` - check-mode, for CI/preflight
- `scripts/prettier.sh` and `scripts/prettier-check.sh` - shell wrappers
- `preflight-checks.sh` runs the format check as a gate

Markdown files are excluded via `.prettierignore` - the project has 60+ markdown files with intentional formatting (tables, code blocks, frontmatter) that Prettier would rewrite aggressively.

## Consequences

- One-time large formatting commit touches most `.ts`, `.js`, and `.html` files. Use `git blame --ignore-rev` to skip it in blame history.
- Quote style standardized to double quotes (Prettier default). One contract test that matched single-quoted source code needed updating.
- The `SCHEMA_VERSION` grep in `preflight-checks.sh` was updated to handle both quote styles, since Prettier normalizes `'3'` to `"3"`.
- No runtime hook - formatting runs at preflight, not on every edit. This avoids per-edit latency and noisy mid-session diffs.
