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
#<digits> type(scope): subject

Body explaining why the change is needed.
- One fact per bullet, naming real files, behaviours, APIs, commands, or versions.
```

`#<digits> ` appears only when the branch matched above, and the digits are the branch's own.
The `123` in the table is a sample branch number, never a value to copy into a message.

`type` is one of the ten names in the branch pattern. `scope` names the subsystem a reader would
search for (`installer`, `auth`, `parser`), not the artefact kind the type already states (`test`,
`docs`) and not a catch-all (`core`, `misc`).

Choose `type` from what the whole diff does to the product, never from the kinds of files it
touches. If a user, an agent, or a test can observe the difference, the commit is not a `refactor`.

| `type` | Use when the commit |
| ------ | ------------------- |
| `feat` | gives the product a capability it did not have |
| `fix` | makes existing behaviour correct, including a clearer error or a corrected instruction an agent follows |
| `perf` | changes measured speed or resource use without changing results |
| `refactor` | changes structure only; every observable behaviour and every test assertion stays the same |
| `security` | closes a vulnerability or tightens a safety control |
| `docs` | changes nothing but documentation |
| `test` | changes nothing but tests, and the behaviour they prove already shipped |
| `build`, `ci`, `chore` | changes packaging, pipelines, or maintenance that no user observes |

An assertion tightened as part of a fix belongs to the `fix`. Two unrelated changes mean two
commits, not a compromise type.

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
clarify, polish, tweak, align, adjust, revise, extend, refine, rework*. The test: if the same verb
would describe any other change to that file, the reader cannot predict the diff from it. Use a
verb that names the actual edit: *add, remove, replace, rename, fix, deny, allow, gate, skip,
cache, invalidate, log, retry, bump*. `update` earns its
place only when the change is literally the update of a pinned value, and `bump` usually says
that better.

A noun is too weak when it names a category of work instead of the behaviour: *coverage, support,
handling, logic, improvements, changes, updates*. A fix whose existing tests were tightened is
still a fix, and its subject names what the product now does:

```
BAD:  test(review): add authority validation coverage
GOOD: fix(review): name the converting path in snapshot refusals
```

## Body rules

Write a body when the subject alone does not explain the decision. Common cases:

- The motivation is not obvious from the diff.
- The change touches multiple behaviours under one scope.
- Compatibility, security, migration, platform, or performance context matters.
- A version bump, dependency change, or rename would be hard to understand from the subject
  alone.

The body explains why the change exists and names the real affected surfaces. Do not restate the
diff mechanically.

- Wrap body prose at 72 columns. Never break a path or identifier to fit; let that one line run
  over.
- Open with the reason or constraint, not an announcement: no "This commit", "This change",
  "This PR".
- A reason that only says the change "needs coverage" or "spans" several areas restates the
  subject ("Hook provider capture changes need integration coverage and documented support
  evidence."). State the defect or constraint, or drop the body.
- The weak-verb and weak-noun rules apply to bodies too.
- Match claims to evidence: no "significantly improves robustness" padding, no hedging verified
  facts with "should", and never claim a check passed unless it ran.
- One fact per bullet, written as a sentence: capital first letter, full stop at the end. Cut
  bullets that restate the subject or the diff.
- Every bullet supports the subject. A bullet describing an unrelated change means the commit
  should be split.
- Quote the essential line of an error message, not the whole dump.

```
BAD:  This commit significantly improves installer reliability by enhancing path handling
      and making various robustness improvements.

GOOD: The installer failed on paths with spaces because $TARGET was unquoted.
      - Quote all path expansions in the hook installer.
      - Add a regression test using a spaced tmpdir.
```

A body that lists the changed files restates `git show --stat`. Say what each change makes true:

```
BAD:  Keep the review validator, integration tests, and skill guidance aligned.
      - Adjust validation in src/cli/review-validate-anchors.ts.
      - Extend test/integration/review-validate-authority.test.ts.

GOOD: `review snapshot` refused `worktree` captures in Git LFS and
      `text=auto` repositories without naming the file or setting that
      converted content, so reviewers stopped instead of re-selecting.
      - Name the first converting path and attribute, or the
        `core.autocrlf` value, in the refusal.
      - Route goat-review to `staged` or explicit `paths` on that refusal.
```

## Never include

- Secrets, tokens, credentials, or connection strings - in any line, including examples.
- Machine-local absolute paths (`/home/...`, `C:\Users\...`). Repository-relative paths are
  encouraged.
- References that only resolve against a local or gitignored planning file: milestone IDs
  (`M08`), sprint names, session or hand-off labels. The plan is not in the repository, so the
  reference tells a `git log` reader nothing; name the behaviour instead. Rewrite
  `feat(quality): track concern counts and fix evidence for M08` as
  `feat(quality): track concern counts and fix evidence`.
- Agent self-narration: "as requested", "per the instructions", "I have updated".
- Tool advertisements, generated-by footers, or co-author lines, unless the project's agent
  instructions declare them.
- Em dashes (U+2014), typographic quotes, emoji, or gitmoji. Use a spaced hyphen (` - `),
  straight quotes, and plain ASCII punctuation.

## Worked example

Illustrative placeholder: the installer script and its test are not real files.

```
fix(installer): quote path expansions in the hook installer

The installer failed on paths containing spaces because $TARGET was
expanded unquoted at three call sites.
- Quote all path expansions in scripts/install-hooks.sh.
- Add a regression test using a spaced tmpdir.
```
