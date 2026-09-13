# Git commit message standard

## Requirements for the commit message

### Branch-derived prefix

Read the branch with `git branch --show-current` and match the output against:

```
^(feat|fix|chore|refactor|docs|test|perf|build|ci|security)/([0-9]+)([-_].*)?$
```

| Branch output | Action |
| ------------- | ------ |
| Matches the pattern (`feat/123`, `fix/482-quote-paths`, `feat/91_drift_cache`) | Prefix the subject: `#<digits> type(scope): subject` |
| Does not match (`main`, `feat/no-number`, `feat/123abc`, `release/1.4`) | No prefix |
| Empty (detached HEAD: rebase, bisect, CI checkout) | No prefix |

Empty output means no prefix. Do not infer one from history, recent commits, or the diff.

### Message shape

```
#123 type(scope): subject

Body explaining why the change is needed.
- one fact per bullet, naming real files, behaviours, APIs, commands, or versions
```

### Subject rules

Subject lines are optimised for `git log`, changelogs, and bisect notes.

- Imperative mood. Test: the subject must complete the sentence "If applied, this commit will
  ___".
- One line, as short as it can be while still naming the observable change, and never longer
  than 72 characters including any `#<digits> ` prefix.
- Lowercase after the colon unless the word is a proper noun, identifier, or API name.
- No trailing period.
- Name the observable change, not the quality aspiration.
- One observable change per subject; secondary axes go in the body.
- Backticks around identifiers are permitted.

A verb is too weak when it only reports that something changed: *enhance, improve, streamline,
clarify, polish, tweak*. Use a verb that names the actual edit: *add, remove, replace, rename,
fix, deny, allow, gate, skip, cache, invalidate, log, retry, bump*. `update` earns its
place only when the change is literally the update of a pinned value, and `bump` usually says
that better.

## Body rules

Write a body when the subject alone does not explain the decision. Common cases:

- The motivation is not obvious from the diff.
- The change touches multiple behaviours under one scope.
- Compatibility, security, migration, platform, or performance context matters.
- A version bump, dependency change, or rename would be hard to understand from the subject
  alone.

The body explains why the change exists and names the real affected surfaces. Do not restate the
diff mechanically.

- Wrap body prose at 72 columns.
- Open with the reason or constraint, not an announcement: no "This commit", "This change",
  "This PR".
- The weak-verb rule applies to bodies too.
- Match claims to evidence: no "significantly improves robustness" padding, no hedging verified
  facts with "should", and never claim a check passed unless it ran.
- One fact per bullet. Cut bullets that restate the subject or the diff.
- Quote the essential line of an error message, not the whole dump.

```
BAD:  This commit significantly improves installer reliability by enhancing path handling
      and making various robustness improvements.

GOOD: The installer failed on paths with spaces because $TARGET was unquoted.
      - quote all path expansions in the hook installer
      - add a regression test using a spaced tmpdir
```

## Never include

- Secrets, tokens, credentials, or connection strings - in any line, including examples.
- Machine-local absolute paths (`/home/...`, `C:\Users\...`). Repository-relative paths are
  encouraged.
- Agent self-narration: "as requested", "per the instructions", "I have updated".
- Tool advertisements, generated-by footers, or co-author lines, unless the project's agent
  instructions declare them.
- Em dashes (U+2014), typographic quotes, emoji, or gitmoji. Use a spaced hyphen (` - `),
  straight quotes, and plain ASCII punctuation.

## Worked example

```
fix(installer): quote path expansions in the hook installer

The installer failed on paths containing spaces because $TARGET was
expanded unquoted at three call sites.
- quote all path expansions in workflow/install-hooks.sh
- add a regression test using a spaced tmpdir
```
