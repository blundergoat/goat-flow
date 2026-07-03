# Git Commit Message Standard

This standard covers commit message text only. It does not define branch naming, staging, when to
commit, release workflow, quality gates, or which files belong in a commit.

## Message Format

Preferred subject format:

```
type(scope): subject
```

If a project uses ticket or issue prefixes, place the real project identifier before the
conventional subject:

```
ABC-123 type(scope): subject
#123 type(scope): subject
```

Do not invent issue numbers, ticket keys, or tracking identifiers. If the project omits scopes, use
`type: subject` and keep the same subject-line rules.

Full message shape:

```
type(scope): subject

Body explaining why the change is needed.
- bullet each distinct behaviour, file family, or compatibility concern
- name files, behaviours, APIs, commands, or versions by their real identifiers
```

Separate the subject from the body with a blank line.

## Types

| Type | Use for |
| ---- | ------- |
| `feat` | New user-visible or system-visible behaviour |
| `fix` | Bug fix, regression fix, or incorrect behaviour |
| `docs` | Documentation-only changes |
| `refactor` | Internal restructuring with no intended behaviour change |
| `test` | Adding, changing, or repairing tests only |
| `perf` | Performance change with no intended behaviour change |
| `build` | Build system, packaging, or generated artifact flow |
| `ci` | Continuous integration or automation config |
| `chore` | Maintenance work that does not fit another type |
| `security` | Security hardening, policy, or sandbox change |
| `revert` | Reverting an earlier change |

## Scope

Pick the scope from the area a reader would search for: `auth`, `api`, `ui`, `cli`, `docs`, `deps`,
`ci`, `config`, or the project-specific subsystem name.

Use one scope per message. When the change spans several areas, choose the most useful domain-level
scope and put the details in the body.

## Subject Rules

Subject lines are optimized for `git log`, changelogs, and bisect notes.

- Use imperative mood: `add`, `remove`, `fix`, `rename`, `replace`.
- Keep the subject at 72 characters or less.
- Use lowercase after the colon unless the word is a proper noun, identifier, or API name.
- Do not end the subject with a period.
- Name the observable change, not the quality aspiration.
- Keep the subject to one observable change; put secondary axes in the body.

Avoid weak verbs that paraphrase the diff: *enhance, improve, streamline, clarify, update, tweak,
polish*. They usually say that something changed without saying what changed.

Prefer concrete verbs that name the actual edit: *add, remove, replace, rename, fix, deny, allow,
gate, skip, harden, cache, invalidate, log, retry, bump*.

## Rewrites

These rewrites preserve the intent of real weak subjects while making the message useful without
opening the diff.

```
BAD:  feat(guardrails): enhance command checks for combined shell flags and git push scenarios
GOOD: feat(guardrails): deny `bash -lc` chains and protected-branch git push

BAD:  refactor(docs): streamline artifact routing instructions and enhance clarity
GOOD: refactor(docs): move artifact routing rules to artifact-routing.md

BAD:  chore(version): update reference version to 1.3.1 across documentation and scripts
GOOD: chore(version): bump reference version to 1.3.1 in docs and scripts
```

## Body Rules

Write a body when the subject alone does not explain the decision. Common cases:

- The motivation is not obvious from the diff.
- The change touches multiple behaviours under one scope.
- Compatibility, security, migration, platform, or performance context matters.
- A version bump, dependency change, or rename would be hard to understand from the subject alone.

The body should explain why the change exists and name the real affected surfaces. Do not restate
the diff mechanically.
