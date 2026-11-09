# Git commit message standard

## Generation

- Draft only: never run `git commit` or `git push`.
- Use the selected diff, current branch and supplied context; exclude unrelated changes.
- Never invent motivation, issue numbers, benchmark results or test outcomes.
- Write in the requested language, defaulting to English; preserve identifiers and format tokens.
- Output only the commit message, without Markdown fences, commentary or generated-by text.
- If the diff contains unrelated changes, ask which logical change to draft first.

## Header

Use `type(scope): subject`, or `type(scope)!: subject` for a breaking public contract.
Read the branch with `git branch --show-current` and match it against:

```
^(feat|fix|chore|refactor|docs|test|perf|build|ci|security)/([0-9]+)([-_].*)?$
```

When it matches, prepend `#<digits> ` using only its captured digits.
Otherwise, including empty output for detached HEAD, use no prefix.
Never infer the prefix from history or the diff.

Choose the type from the whole change's effect, not the file extensions:

| Type | Use for |
| --- | --- |
| `feat` | A new capability |
| `fix` | Corrected behaviour, including errors and instructions an agent follows |
| `perf` | Measured speed or resource gains without changing results |
| `refactor` | Internal restructuring that preserves externally observable behaviour |
| `security` | Closing a vulnerability or tightening a safety control |
| `docs` | Documentation-only changes without changed product or agent behaviour |
| `test` | Tests for behaviour that already shipped |
| `build`, `ci`, `chore` | Packaging, pipelines or other maintenance |

Tests may change with a refactor; assertions must still protect the same external behaviour.
Tests added or tightened alongside a fix belong to that `fix`, not a separate `test` commit.
The scope names a searchable subsystem, such as `installer` or `parser`, not `misc` or a file kind.

## Subject

- Use imperative mood: complete "If applied, this commit will ...".
- Name one concrete change; never longer than 72 characters, including the prefix and `!`.
- Lowercase after the colon except proper nouns or identifiers; no trailing period.
- Prefer specific verbs: add, remove, replace, rename, deny, allow, cache, retry or bump.
- Avoid vague enhance/improve/update subjects and nouns like handling or coverage without the actual change.
- Backticks around identifiers are permitted.

## Body and breaking changes

- Add a body when the reason is unclear, related effects need explanation, or compatibility,
  security, migration, platform, dependency or performance context matters.
- Leave a blank line after the header. Explain the problem, reason and relevant before/after behaviour.
- Use `- ` bullets, one fact per bullet; do not repeat the subject, list files or narrate your work.
- Wrap at 72 columns; indent continued bullet lines two spaces; keep paths, identifiers and URLs unbroken.
- Claim a check passed only when it ran; keep measured results and uncertainty accurate.
- For a breaking public contract, use `!` in the header and a `BREAKING CHANGE:` footer.
- Separate the footer with a blank line; explain the affected contract, impact and migration steps.

## Never include

- Secrets, tokens, credentials or connection strings, even in examples.
- Machine-local absolute paths, gitignored plan references, milestone IDs or session labels.
- Tool advertisements or co-author lines unless project instructions require them.
- Em dashes (use ` - ` instead), typographic quotes, emoji or gitmoji; use plain ASCII punctuation.

## Examples

Subject rewrite: `test(review): add authority validation coverage` -> `fix(review): name the converting path in snapshot refusals`.

Illustrative placeholder; this installer scenario is not repository evidence.

```text
fix(installer): quote path expansions in the hook installer

- The installer failed on paths with spaces because $TARGET was unquoted
- Quote all path expansions in the hook installer.
```
