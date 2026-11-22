# Git commit message standard

A commit message has a header, an optional body, and an optional
`BREAKING CHANGE:` footer, in that order. Separate the parts with one blank
line.

## Inputs

A drafting tool fills in the two fields below. If a field still shows its
placeholder in braces, read the branch with `git branch --show-current` and
inspect the requested changes in the checkout.

Branch: {branch}

Code changes:

{diff}

## Branch prefix

Use the captured digits as the issue number when the branch matches this
pattern.

```text
^(feat|fix|chore|refactor|docs|test|perf|build|ci|security)/([0-9]+)([-_].*)?$
```

| Branch | Header prefix |
| --- | --- |
| `feat/123`, `fix/482-quote-paths`, `feat/91_drift_cache` | `#123 `, `#482 `, `#91 ` respectively |
| `main`, `feat/no-number`, `feat/123abc`, `release/1.4` | None |
| Empty (detached HEAD) or unavailable | None |

The branch supplies only the issue number. The changes supply the type, scope,
and subject, so a `feat/` branch can carry a `fix` or `test` commit. Never
infer an issue number from the diff or commit history.

## Header

Use `type(scope): subject`. Prepend `#<digits> ` when the branch rule applies.
For a breaking public contract, add `!` before the colon and add the footer
described below. With both, the header is `#<digits> type(scope)!: subject`.

Keep the entire header at 72 characters or fewer, counting the prefix and the
`!` when present. If it runs over, shorten the subject and keep the prefix,
type, and scope.

### Type and scope

Choose the type by the effect of the primary change.

| Type | Use for |
| --- | --- |
| `feat` | A new capability |
| `fix` | A correction to existing behaviour, including instructions that change how an agent acts |
| `security` | A vulnerability fix or a tighter safety control |
| `perf` | A measured speed or resource gain that preserves results |
| `refactor` | Restructuring that preserves observable behaviour |
| `docs` | Documentation changes that preserve product and agent behaviour |
| `test` | Changes limited to tests for existing behaviour |
| `build` | Build dependencies, toolchains, or packaging |
| `ci` | Continuous integration configuration or workflows |
| `chore` | Other routine maintenance |

A regression test that accompanies a fix belongs to the `fix`.

Use the most specific subsystem as the scope, in lowercase kebab-case: the
module, package, service, or feature the change belongs to. For example, use
`installer` for a hook installer fix. Reuse a specific scope from the commit
history when one fits. When a change spans subsystems, use the one the primary
change serves. Avoid catch-all scopes such as `core` or `misc` and scopes
based on file kinds.

### Subject

- Use one imperative phrase that completes `If applied, this commit will ___`.
- Name one observable change and the behaviour, identifier, setting, or version
  it affects. When the commit holds several changes, name the primary one and
  put the others in the body. Leave out words the scope already says.
- Start the subject in lowercase unless it opens with a proper noun, an API
  name, or an identifier. Backticks around identifiers are allowed. Omit the
  final period.
- Use a verb that describes the edit, such as `add`, `remove`, `replace`,
  `rename`, `deny`, `cache`, `retry`, or `bump`. Avoid vague verbs such as
  `enhance`, `improve`, and `update`.

## Body and breaking changes

Add a body when the reader needs the reason for the change, when the commit
touches several behaviours, or when compatibility, migration, security,
platform, or performance context matters. Otherwise the header is the whole
message.

- Open with the reason or constraint when the evidence supports it. If the
  reason is unknown, describe the observed effect and omit guesses about
  motivation.
- Use up to six bullets when distinct supporting details help. Put the list
  directly under the opening prose, with no blank line between them. Start
  each bullet with `- ` and a capital letter, and end it with a period.
- Put the most important bullet first and keep one fact per bullet. Name
  affected behaviours or surfaces. Use `old -> new` for value changes when
  both values matter.
- Wrap prose at 72 columns. Indent continuation lines in bullets two spaces.
  Keep paths, identifiers, and URLs intact if wrapping would split them.
- Use concrete prose. Cut boilerplate such as `This commit`, restatements of
  the subject, and bare file lists. Quote only the essential error line.
- Ground claims in the diff or supplied context. Describe moves as moves.
  Report measured gains and check results only when the evidence records them.

For a breaking public contract, end the message with a `BREAKING CHANGE:`
footer. Name the contract, who or what is affected, and how to migrate.

## Content and drafting

- Use repository-relative paths and plain ASCII punctuation. Use straight
  quotes and spaced hyphens in place of typographic quotes and em dashes.
- Omit secrets, credentials, tokens, connection strings, and machine-local
  absolute paths.
- Omit references a reader of the repository cannot resolve, such as ignored
  or untracked local files, private planning labels, and drafting-session
  names.
- Omit self-narration, emoji, and gitmoji. Include tool or co-author footers
  only when project instructions require them.
- For a draft request, use the requested language, with English as the default.
  Return one plain commit message without fences or commentary.

## Worked examples

Illustrative fix on `fix/482-quote-paths`.

```text
#482 fix(installer): quote path expansions

The installer failed on paths with spaces because $TARGET was unquoted.
- Add a regression test for paths with spaces.
```

Illustrative breaking change on `main`.

```text
feat(export)!: select reports by ID

Report IDs let scripts target the same report after the list changes
order.

BREAKING CHANGE: --report takes a report ID. Replace list positions in
scripts with their corresponding report IDs.
```

Illustrative header-only commit on `main`.

```text
test(parser): cover empty input
```
