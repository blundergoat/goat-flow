---
goat-flow-reference-version: "1.8.0"
---
# Code Comments

Use this when writing or editing source code in any language, before deciding whether to add a comment, docstring, or annotation. This playbook covers HOW to write the small number of comments that earn their place in source files - so the next human maintainer can follow the code and modify it safely.

The playbook is portable across TypeScript, Python, Go, Rust, and shell. It defers to each language's docstring conventions for SYNTAX (JSDoc, PEP 257, godoc, rustdoc) and owns only the WHEN and WHY decision.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- About to write a comment, docstring, or annotation inside a source file.
- Editing existing code that contains comments - to decide keep / rewrite / delete.
- Authoring a TODO / FIXME / HACK marker.
- Reviewing a diff that adds or changes comments.

No CLI check applies; correctness is verified at review time using the playbook's rules, not by running a command.

## Intent

When a human maintainer opens a file you wrote, what helps them follow the code? That's the only question this playbook answers.

The project default is: no comment unless the WHY is non-obvious. Most "explanatory" comments are restating what the code already says, or recording details that will rot the moment the surrounding code shifts.

This playbook covers what to do when the WHY *is* non-obvious - how to write the small number of comments that earn their place, and how to recognise the much larger number that don't. Audience is coding agents; customer is the human who has to follow and extend the code six months later.

If uncertain whether a comment materially helps the next maintainer, omit it. Slightly under-commented code is easier to work with than narrated code.

If a comment no longer matches the code, delete or rewrite it immediately. An incorrect comment is worse than a missing one - the next reader will trust it and act on it.

## Rewrite First

Before reaching for a comment, walk this ladder:

1. **Rename.** Can a better identifier carry the meaning? `t` → `timeoutMs`. `processData` → `stripPiiFromInbound`. Most "explanatory" comments dissolve under a single rename.
2. **Extract.** Can a named function carry the meaning? A ten-line block that wants a header comment usually wants to be its own function with that header text as the name.
3. **Simplify.** Can the control flow be untangled? Early returns, guard clauses, and flattening usually beat a comment explaining the nesting.
4. **Then comment.** If intent still isn't visible after the three above - write the comment.

The clearest comment is often the rename that made it unnecessary.

A good comment survives a reasonable refactor. If renaming a variable or reordering functions would invalidate the comment, the comment is describing implementation detail, not intent - and it should be code, not prose.

### The ladder in action

Bad:
```ts
// Skip admin users.
for (const u of users) {
  if (u.role === "admin") continue;
  notify(u);
}
```

Good (extract + rename, no comment needed):
```ts
const nonAdminUsers = users.filter(u => u.role !== "admin");
for (const user of nonAdminUsers) notify(user);
```

The original comment was a naming failure. Step 1 of the ladder (rename + extract) does the same work without the prose, and the result can't drift.

## WHY, not WHAT

The code already says what. Comments say why.

Bad:
```ts
// loop through users and send each an email
for (const user of users) sendEmail(user);
```

Good (same code, comment names what the reader can't see):
```ts
// Vendor API rate-limits at 100 req/s; batch size upstream guarantees we stay under.
for (const user of users) sendEmail(user);
```

The first restates the loop. The second names a constraint visible nowhere in the code.

## Docstring vs Inline

Docstrings document the contract a caller sees (inputs, outputs, errors, invariants). Inline comments document rationale invisible from the signature (why this branch, why this constant, why this workaround).

Docstring:
```python
def parse_iso_date(value: str) -> date:
    """Parse an ISO 8601 date. Raises ValueError on malformed input."""
    return date.fromisoformat(value)
```

Inline:
```python
def schedule_retry(attempt: int) -> float:
    # Upstream API throttles aggressively after the third retry; cap backoff at 30s.
    base = 0.5 * (2 ** attempt)
    return min(base, 30.0)
```

## When a Comment Helps the Next Reader

Four cases. If a comment fits one of these, it's earning its place.

### Hidden constraint

Something the code can't encode about its environment - rate limits, vendor API contracts, regulatory rules, hardware quirks.

Bad:
```python
# parse the date
parsed = datetime.strptime(value, "%Y-%m-%d")
```

Good:
```python
# Vendor exports omit the timezone; treat as source-local by contract.
parsed = datetime.strptime(value, "%Y-%m-%d")
```

The bad one restates `strptime`. The good one names the upstream contract.

### Subtle invariant

A condition the code depends on but doesn't enforce.

Bad:
```python
def median_response_time(samples: list[float]) -> float:
    # find the middle element
    return samples[len(samples) // 2]
```

Good:
```python
def median_response_time(samples: list[float]) -> float:
    # Caller sorts; sorting here would dominate the hot path.
    return samples[len(samples) // 2]
```

The bad one paraphrases the index expression. The good one names the load-bearing assumption the signature doesn't show.

### Workaround

Strange code that exists because of a bug or constraint elsewhere. Include enough context that the workaround can be removed once the cause is gone.

Bad:
```ts
// fix the thing
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
```

Good:
```ts
// Double rAF forces a layout flush before measuring. Single rAF returns stale
// values on Safari 17. Remove when Safari ≥ 18 is the baseline.
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
```

The bad one says nothing. The good one names the cause and the removal condition.

### Surprising behaviour

Code that does the right thing but doesn't look like it - code the next reader will be tempted to "fix" because it looks dangerous.

Bad:
```ts
// in-place
normalizeInPlace(buffer);
```

Good:
```ts
// Intentionally mutates the input buffer.
// Copying doubles memory usage on 2GB+ exports.
normalizeInPlace(buffer);
```

The bad one is decoration. The good one tells the next reader "this looks wrong, but here's why it's intentional" - defending the code against a well-meaning later refactor.

## TODO / FIXME / HACK Markers

Every marker carries:

- **Expiry** - a date (`TODO: 2026-09 remove after Symfony 7.2`) or a trigger (`TODO: remove after the auth migration ships`).
- **Issue link** when one exists (`FIXME: #142 retry logic loses events under network partition`).
- **Owner tag optional** - reserve `TODO(name):` for multi-contributor work. Solo, drop the tag.

Bare markers create future bugs.

Bad: `// TODO: clean this up later.`
Good: `// TODO: 2026-08 remove this fallback once the new auth flow ships.`

The bad one will be there in three years.

## Antipatterns

The next reader can't use these. Don't write them; if you see them while you're already editing the surrounding code, delete or fix.

- **Restating the code.** `i++; // increment i.` The reader can see the increment.
- **Commented-out code.** Git remembers. Delete.
- **Tombstones.** `// removed the old caching layer.` The diff records the removal; the comment confuses the next reader.
- **Archaeological comments.** `// legacy.` `// temporary.` `// migrated from X.` `// new implementation.` Six months on, nobody knows what "new" meant. Explain the current constraint, not the history.
- **Position references.** `// see function below.` `// the loop above handles X.` Lines and order shift; the reference rots. Refer by symbol name.
- **Line-number references.** Same rot mechanism. See ADR-024 in the local `.goat-flow/decisions/` directory.
- **Suppression markers without rationale.** `// eslint-disable-next-line` alone is noise. The rule is the rationale, not the suppression.
- **Ephemeral task / PR / issue references.** `// fixed in PR #234.` PR numbers age out of useful context. If the link matters, it belongs in the commit message.

## Special Contexts

**Test code.** Same default-no-comment stance - the test name carries the why. Carve-outs: regression references (`// reproduces FG-1`), structural markers only when the test body can't encode the setup. If every test has `// arrange / act / assert` labels, extract helpers instead.

**Generated code.** A header marking the file as generated is mandatory, not optional:

```text
// AUTO-GENERATED FROM <source> - DO NOT EDIT
```

The next maintainer needs to know not to fix bugs in the wrong file.

**Suppression with rationale.** Legitimate pattern. The comment carries the WHY:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
//   SDK response is dynamically typed at this boundary; narrowing happens in the next call.
const raw: any = await client.invoke(params);
```

## Multi-Language Stance

The WHEN and WHY rules above are portable across languages. SYNTAX is not - defer to each language's conventions for format:

- **TypeScript / JavaScript.** JSDoc when documenting contracts; plain `//` inline.
- **Python.** PEP 257 for docstrings; `#` inline.
- **Go.** godoc for exported identifiers; `//` inline. Go's documentation culture is more permissive than this playbook's default - apply the rules here, not Go's defaults.
- **Rust.** rustdoc for items (`///` and `//!` are doc comments); `//` inline.
- **Shell.** `#` only. No standardised docstring; put contract details in a heredoc help block at the top of the script.

## Security

Comments ship with the code and get indexed.

Never include in a comment:
- Secrets, tokens, API keys, anything that authenticates.
- Customer or patient identifiers, even synthetic-looking ones.
- Internal-only URLs that reveal infrastructure topology.
- Production hostnames or account IDs.

If you find any of these in existing comments while editing, redact - don't leave them because they look old.

## Troubleshooting

**The linter wants a docstring but the rule says no.** Either suppress with rationale on that line, or write a one-line contract docstring naming the inputs and outputs. Don't pad to satisfy the linter.

**An existing comment violates the playbook. Rewrite or leave?** Leave, unless you're already editing the surrounding code. The playbook is forward-looking; it doesn't mandate a cleanup pass.

**A marker has no expiry or issue link.** Flag, don't autofix. The author may have context worth recovering.

**A reviewer wants more comments than the playbook allows.** Show them the playbook. The default-no-comment stance is the project rule, not personal preference.

**An AI agent keeps adding block-by-block comments anyway.** Cite this playbook in the prompt context. The rules only work if the agent has read them.

## Verification Gate

Before claiming a code change is done, walk the new and changed comments against these checks:

1. **Each comment satisfies one of the four valid reasons** (hidden constraint, subtle invariant, workaround, surprising behaviour). If you can't name which, delete the comment.
2. **Each comment would survive renaming a variable or reordering functions** in the surrounding code. If a refactor would invalidate it, the content belongs in code, not prose.
3. **Each TODO / FIXME / HACK marker carries an expiry** (date or trigger) and an issue link when one exists. Bare markers are future bugs.
4. **No comment contains secrets, customer identifiers, internal URLs, or production hostnames.** Comments ship with the code.
5. **Existing comments edited or left untouched are still accurate.** A stale comment from before your edit is now your responsibility if you noticed it.

If a comment fails any of these, fix it before merging.

## Related References

- `observability.md` - sibling discipline playbook; same documentary structure.
- `.goat-flow/decisions/ADR-024-semantic-anchors-over-line-numbers.md` - the durability principle (line numbers and ephemeral positions rot) applies to comments too.
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) - may declare a comment-policy section that points here as the canonical source. This playbook expands on whatever default the project's instruction file sets.
- `conventional-comments.md` (when it exists) - review-comment taxonomy for PR threads. Different audience, different surface; do not confuse with this playbook, which is about comments inside source files.
