---
goat-flow-reference-version: "1.9.1"
---
# Code Comments

Use this when writing or editing source code in any language, before deciding whether to add a comment, docstring, or annotation. It owns two things: which *inline* comments earn their place (a small number), and how to write the doc comments that are mandatory on every function/method and class/file - so the next human maintainer can follow the code and modify it safely.

The playbook is portable across TypeScript, Python, Go, Rust, and shell. It defers to each language's docstring conventions for core SYNTAX (JSDoc, PEP 257, godoc, rustdoc), but owns the WHEN/WHY decision plus a small set of house layout conventions (tag separator, blank line before tags, line width) that override the language default where they differ.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- About to write a comment, docstring, or annotation inside a source file.
- Editing existing code that contains comments - to decide keep / rewrite / delete.
- Authoring a TODO / FIXME / HACK marker.
- Reviewing a diff that adds or changes comments.

Enforcement is partial. Where the gruff analyzer is installed (see `gruff-code-quality.md`) it flags some of the `[static]` items - notably missing doc comments, as `docs.missing-*` findings - but it isn't on every project and doesn't cover the `[judge]` semantic checks. So verify at review time against the Verification Gate below: the gate is the spec, gruff enforces the mechanical slice it can, and a reviewer or review-judge owns the rest. Don't claim more enforcement than the project actually runs.

## Intent

You are a coding agent, and a human who didn't write this code has to read, review, and trust it. This playbook optimises for that - governing AI-generated code so a reviewer can verify it does what was asked - not for minimal human-authored documentation. Your job is to write comments that let that reviewer follow the code and check your intent against your implementation. When a rule here is stricter than a hand-written codebase would need (mandatory doc comments on every unit, the verification gate), that goal is why.

The project default is: no INLINE comment unless the WHY is non-obvious. Most "explanatory" inline comments are restating what the code already says, or recording details that will rot the moment the surrounding code shifts. Doc comments on functions/methods and classes/files are the standing exception - those are always written; see "Docstring vs Inline".

For inline comments, this playbook covers what to do when the WHY *is* non-obvious - how to write the small number that earn their place, and how to recognise the much larger number that don't.

If uncertain whether an *inline* comment materially helps the next maintainer, omit it - slightly under-commented code is easier to work with than narrated code. This omit-by-default applies to inline comments only; doc comments are required regardless.

If a comment no longer matches the code, delete or rewrite it immediately. An incorrect comment is worse than a missing one - the next reader will trust it and act on it.

## Rules at a glance

Apply these directly; the sections below give the examples and rationale.

- **Doc comment REQUIRED** on every function/method and class/file: contract + orientation, 1-5 lines for a function, 3-10 for a class/file, blank ` *` line before the tags.
- **Inline comment ONLY for** a hidden constraint, subtle invariant, workaround, or surprising behaviour - otherwise rewrite (rename / extract / simplify) or omit.
- **Prefer a test or assertion** over a comment when it can carry the invariant (the Enforce rung).
- **Tags:** `@param name - description` / `@returns value - description` - real descriptions, never restated types.
- **Wrap ~110 chars** (hard max 120); **`YYYY-MM-DD`** date or a trigger on every TODO / FIXME / HACK.
- **Never:** markdown/emoji, commented-out code, secrets/PII/hostnames, or position/line-number references.
- **Why it's strict:** the comment is a verification surface - state intent so a reviewer can diff it against the code.

## Rewrite First

Before reaching for a comment, walk this ladder:

1. **Rename.** Can a better identifier carry the meaning? `t` → `timeoutMs`. `processData` → `stripPiiFromInbound`. Most "explanatory" comments dissolve under a single rename.
2. **Extract.** Can a named function carry the meaning? A ten-line block that wants a header comment usually wants to be its own function with that header text as the name.
3. **Simplify.** Can the control flow be untangled? Early returns, guard clauses, and flattening usually beat a comment explaining the nesting.
4. **Enforce.** Can a test or a debug assertion carry the invariant instead of prose describing it? A comment can't protect itself; an assertion can, and it fails loudly when violated.
5. **Then comment.** If intent still isn't visible after the four above - write the comment.

The clearest comment is often the rename that made it unnecessary.

**The Half-Life Test.** A good comment survives variable renames, function extraction, code movement, and reformatting; a bad one dies the moment an implementation detail changes. Anchor every comment to a constraint that will still be true in two years - a vendor contract, a regulation, an invariant - not to a person, ticket, or sprint. If renaming a variable or reordering functions would invalidate it, the comment is describing implementation detail, not intent, and it should be code, not prose.

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

## Comment Decision

One routing tree; the sections below detail each branch. Doc comments are not on the "earn it" path - every unit gets one - so the tree separates that from the rationed inline decision.

```text
Writing a function/method or class/file?
  → A doc comment is REQUIRED. Write contract + orientation. See "Docstring vs Inline".

Considering an INLINE comment inside the body?
  ├─ Can a rename or extract make it unnecessary?   → do that (see "Rewrite First")
  ├─ Can a test or assertion carry the invariant?   → enforce it, no comment
  ├─ Hidden constraint / subtle invariant /
  │  workaround / surprising behaviour?             → write the inline comment
  └─ none of the above                              → no comment
```

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

The second names a constraint visible nowhere in the code.

A useful shape for the WHY: **Because [constraint], we do [choice]; prevents [failure], removable when [condition].** Not every comment needs all four clauses, but the strongest ones name the constraint and the failure they prevent.

Rank the WHY by how hard it is to recover. **Business, domain, legal, compliance, vendor, and operational rationale beats implementation rationale** - the former is impossible to infer from the code, the latter a careful reader can often reconstruct. `// Regulation requires rounding before the tax calculation` earns its place more than `// loop is unrolled for speed`.

## Docstring vs Inline

The default-no-comment stance governs INLINE comments. Doc comments are the standing exception: every function/method and every class/file carries one. They are mandatory, not earn-their-place - the orientation they give is how a maintainer understands a unit without reading its whole body. Size the description block to what it documents: 1-5 lines for a function/method, 3-10 lines for a class/file (which carries more - its role in the system, when to use it, and the broader context). Trivial units (obvious getters, one-line pure helpers) still get a doc comment - keep it to a single tight line stating the contract; the mandate is to always orient, not to pad.

Why mandatory, even on a private one-liner: a doc comment is not only documentation, it is a verification surface. Coding agents routinely produce code that superficially works while misunderstanding the requirement. Forcing the agent to state intent, usage, contract, and failure behaviour in prose gives a reviewer something to check the implementation against - a mismatch between the doc comment and the code is a signal the change needs a deeper look. That is why the rule is strict, and why "keep it tight" is the tension-breaker, not an exemption: a private helper gets a one-line contract (orientation), never a padded block.

What this looks like when it fires:
```ts
/**
 * Returns the user's active subscriptions, sorted by renewal date (soonest first).
 *
 * @param userId - account to look up
 * @returns active subscriptions; empty array when the user has none
 */
function activeSubscriptions(userId: string): Subscription[] {
  return subs.filter(s => s.userId === userId && s.status === "active");
}
```
The doc comment promises a sort by renewal date; the code never sorts. That mismatch is the catch - either the requirement included ordering and the implementation is wrong, or the comment overstates the contract, and either way it is the signal to review before merging. A reviewer reading only the code might assume order wasn't required; the doc comment is what makes the gap visible. That is the verification surface doing its job, and it is why the comment has to state intent even when the code "looks done".

A doc comment does two jobs - state the contract and orient the reader:

- **Contract:** inputs, outputs, errors, invariants - what the caller can rely on.
- **Orientation:** when to use it (and when not to), how it fits the bigger picture, what a null/empty return or unmet precondition means, and the footguns a caller will hit.

Format it consistently:

- **Real descriptions, not restated types.** Document every parameter and return with meaning; prefer the language's structured doc form (JSDoc, PEP 257, godoc, rustdoc) over a bare inline comment.
- **Hyphen-separate each tag's subject from its description**, so the line reads as label then explanation: `@param value - parsed JSON ...`, `@returns true - when value is a non-null object`.
- **Blank ` *` line between the description block and the tags**, so a multi-line description doesn't run straight into the tags as a wall of text.

Inline comments are the part this playbook rations: write one only when the WHY is non-obvious (the four cases below), and only after the rewrite-first ladder. Inline comments document rationale invisible from the signature (why this branch, why this constant, why this workaround).

Wrap every comment line - doc or inline - at about 110 characters. Padding to 50-70 makes a multi-line comment needlessly choppy; 120 is the hard ceiling, so don't run past it.

Docstring:
```python
def parse_iso_date(value: str) -> date:
    """Parse a date-only ISO 8601 string (`YYYY-MM-DD`) from trusted internal input.

    Raises ValueError on anything it can't parse - callers treat that as a hard
    input error, not a missing value. Not a general datetime parser.
    """
    return date.fromisoformat(value)
```

Inline:
```python
def schedule_retry(attempt: int) -> float:
    # Upstream API throttles aggressively after the third retry; cap backoff at 30s.
    base = 0.5 * (2 ** attempt)
    return min(base, 30.0)
```

Full shape (JSDoc) - description block, blank ` *` line, then tags:
```ts
/**
 * What the unit is for, when to use it, how it fits, and the footguns a caller hits -
 * one description block, then the tags.
 *
 * @param value - parsed JSON of unknown shape (e.g. JSON.parse output) to test
 * @returns true - when value is a non-null, non-array object, narrowed to JsonObject
 */
```

Null/empty contract - say what the absent value *means*, since the signature can't:
```ts
/**
 * Look up a user by email.
 *
 * @param email - address to match, case-insensitive
 * @returns the user, or null - null means "no such user" (an expected miss, not an error);
 *   malformed input throws instead
 */
```

## When a Comment Helps the Next Reader

Four cases. If a comment fits one of these, it's earning its place. Put it immediately above the line or block it explains - at the decision point, not floating at the top of the function where the reader can't connect it to the code.

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

The good one names the upstream contract the code can't encode.

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

The good one names the load-bearing assumption the signature doesn't show. An assertion would be more durable than prose (the Enforce rung) - but here `assert samples == sorted(samples)` would re-sort and defeat the very hot-path point the comment makes, so the comment is the right tool. Reach for Enforce only when the check is affordable.

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

The good one names the cause and the removal condition.

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

The good one tells the next reader "this looks wrong, but here's why it's intentional" - defending the code against a well-meaning later refactor.

## TODO / FIXME / HACK Markers

Every marker carries:

- **Expiry** - a machine-parsable `YYYY-MM-DD` date (`TODO: 2026-09-01 remove after Symfony 7.2`) or a trigger (`TODO: remove after the auth migration ships`). Use the full date so a check can flag past-due markers; a trigger is fine when no date fits.
- **Issue link** when one exists (`FIXME: #142 retry logic loses events under network partition`).
- **Owner tag optional** - reserve `TODO(name):` for multi-contributor work. Solo, drop the tag.

Bare markers create future bugs.

Bad: `// TODO: clean this up later.`
Good: `// TODO: 2026-08-01 remove this fallback once the new auth flow ships.`

The bad one will be there in three years.

## Antipatterns

The next reader can't use these. Don't write them; if you see them while you're already editing the surrounding code, delete or fix.

- **Restating the code.** `i++; // increment i.` The reader can see the increment.
- **Commented-out code.** Git remembers. Delete.
- **Tombstones.** `// removed the old caching layer.` The diff records the removal; the comment confuses the next reader.
- **Archaeological comments.** `// legacy.` `// temporary.` `// migrated from X.` `// new implementation.` Six months on, nobody knows what "new" meant. Explain the current constraint, not the history.
- **Position references.** `// see function below.` `// the loop above handles X.` Lines and order shift; the reference rots. Refer by symbol name.
- **Line-number references.** Same rot mechanism - line numbers shift on every edit. Refer by symbol name.
- **Suppression markers without rationale.** `// eslint-disable-next-line` alone is noise. The rule is the rationale, not the suppression.
- **Ephemeral task / PR / issue references.** `// fixed in PR #234.` PR numbers age out of useful context. If the link matters, it belongs in the commit message.
- **Markdown or emoji.** No bold, headers, bullet glyphs, or emoji in code comments - plain prose only. They render as noise in source.
- **Session artifacts.** `// finally works`, `// as discussed`, `// per the prompt`, `// added during refactor`. Celebratory notes, personal voice, and process narration rot on contact. The comment must stand alone in the repo.

## Special Contexts

**Test code.** Same omit-by-default stance for *inline* comments - the test name carries the why. Carve-outs: regression references (`// reproduces FG-1`), structural markers only when the test body can't encode the setup. If every test has `// arrange / act / assert` labels, extract helpers instead. The doc-comment mandate still applies to test functions per the Verification Gate, but a descriptive test name plus a one-line doc is usually enough.

**Generated code.** A header marking the file as generated is mandatory, not optional:

```text
// AUTO-GENERATED FROM <source> - DO NOT EDIT
```

The next maintainer needs to know not to fix bugs in the wrong file.

**Suppression with rationale.** Legitimate pattern. Use the linter's native reason syntax so a checker can verify a reason is present - ESLint puts it after `--` on the directive itself:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response is dynamically typed at this boundary; narrowing happens in the next call.
const raw: any = await client.invoke(params);
```

## Multi-Language Stance

The WHEN and WHY rules above are portable across languages. Core SYNTAX is not - defer to each language's conventions for format, with the house layout conventions from the top of this playbook (tag separator, blank line, line width) layered on top:

- **TypeScript / JavaScript.** JSDoc when documenting contracts; plain `//` inline.
- **Python.** PEP 257 for docstrings; `#` inline.
- **Go.** godoc syntax for all identifiers, exported AND private; `//` inline. Go's culture documents only exported names - but this playbook's doc-comment mandate ("Docstring vs Inline") requires one on every unit, so apply the broader rule, not Go's default.
- **Rust.** rustdoc (`///` and `//!` are doc comments) for all items, public AND private; `//` inline.
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

**A linter rejects the `@param name - desc` / `@returns value - desc` house format** (e.g. eslint-plugin-jsdoc expects a `{type}` or a different shape). Keep the house format and suppress that specific rule with rationale on the line - the description carries the meaning, so don't restate types to satisfy it.

**An existing comment violates the playbook. Rewrite or leave?** Leave, unless you're already editing the surrounding code. The playbook is forward-looking; it doesn't mandate a cleanup pass.

**A comment just restates the code and you're already editing nearby.** Delete it without hesitation - if removing it loses no hidden knowledge (no constraint, invariant, workaround, or surprise), it was never earning its place. `counter++; // increment counter` goes. This applies while you're already in the file; it is not a mandate to sweep the repo.

**A marker has no expiry or issue link.** Flag, don't autofix. The author may have context worth recovering.

**A reviewer wants more *inline* comments than the playbook allows.** Show them the playbook. The omit-by-default stance for inline comments is the project rule, not personal preference. (Doc comments are separate - those are mandatory.)

**An AI agent keeps adding block-by-block comments anyway.** Cite this playbook in the prompt context. The rules only work if the agent has read them.

## Verification Gate

Before claiming a code change is done, walk the new and changed comments against these checks. Each is tagged by the enforcement layer that owns it: **[static]** = mechanical, checkable by a linter; **[judge]** = semantic, for a review-judge or a human reviewer.

1. **[judge] Each INLINE comment satisfies one of the four valid reasons** (hidden constraint, subtle invariant, workaround, surprising behaviour), and when it states a WHY it prefers business/domain/legal/vendor rationale over pure implementation rationale a reader could reconstruct. If you can't name a reason, delete the comment. Doc comments on functions/methods and classes/files are required regardless - this check is for inline comments only.
2. **[judge] Each comment would survive renaming a variable or reordering functions** in the surrounding code (the Half-Life Test). If a refactor would invalidate it, the content belongs in code, not prose.
3. **[static] Each TODO / FIXME / HACK marker carries an expiry** (a `YYYY-MM-DD` date or a trigger) and an issue link when one exists. Bare markers are future bugs.
4. **[static] No comment contains secrets, internal URLs, or production hostnames** (pattern-matchable); customer/patient identifiers may need **[judge]**. Comments ship with the code.
5. **[judge] Existing comments edited or left untouched are still accurate.** A stale comment from before your edit is now your responsibility if you noticed it.
6. **[static] presence + [judge] quality: Every function/method and class/file carries a doc comment** - presence, the blank separator line, and the 1-5 (function) / 3-10 (class/file) line counts are mechanical; whether the orientation (when-to-use, big-picture fit, null/edge context, footguns) and the per-parameter/return descriptions are *real* and not restated types is semantic. Required regardless of the inline four-reasons check, which governs inline comments only.
7. **[static] Each comment line wraps at about 110 characters** - not padded short to 50-70, and not run past 120.

If a comment fails any of these, fix it before merging. This gate is the spec for the two enforcement layers: the **[static]** items map to a linter, the **[judge]** items to a review-judge - keep the tags accurate so the boundary stays clear if those checks are built.

## Related References

- `observability.md` - sibling discipline playbook installed alongside this one; shares the scaffold (Availability Check, Anti-patterns, Verification Gate, Related References) with a topic-specific body.
- Your project's instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) - may declare a comment-policy section that points here as the canonical source. This playbook expands on whatever default they set.
