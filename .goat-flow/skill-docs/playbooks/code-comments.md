---
goat-flow-reference-version: "1.10.1"
---
# Code Comments

Use this when writing or editing source code in any language, before deciding whether to add a comment, docstring, or annotation. The primary reader is the coding agent doing the work; the beneficiary is the human maintainer who later reads the code cold. This playbook owns which *inline* comments earn their place, and how to write the doc comments that are mandatory on every function/method and class/file.

The playbook is portable across TypeScript, Python, Go, Rust, and shell. It defers to each language's docstring conventions for core SYNTAX (JSDoc, PEP 257, godoc, rustdoc), but owns the WHEN/WHY decision plus a small set of house layout conventions (tag separator, blank line before tags, line width) that override the language default where they differ.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- About to write a comment, docstring, or annotation inside a source file.
- Editing existing code that contains comments - to decide keep / rewrite / delete.
- Authoring a TODO / FIXME / HACK marker.
- Reviewing a diff that adds or changes comments.

Enforcement is partial. Static tools may flag mechanical items such as missing doc comments, but they do not cover the `[judge]` semantic checks. Verify against the gate below: the gate is the spec, static tools own the mechanical slice, and a reviewer or review-judge owns the rest. Do not claim more enforcement than the project actually runs.

## Intent

You are a coding agent, and a human who did not write this code has to read, review, and trust it. Treat this as an execution playbook, not a style essay: follow the decision gates before adding prose. When a rule is stricter than a hand-written codebase might need (mandatory doc comments, the verification gate), it exists so a reviewer can compare stated intent with implementation.

The project default is: no INLINE comment unless the WHY is non-obvious. Most "explanatory" inline comments are restating what the code already says, or recording details that will rot the moment the surrounding code shifts. Doc comments on functions/methods and classes/files are the standing exception - those are always written; see "Docstring vs Inline".

If uncertain whether an *inline* comment materially helps the next maintainer, omit it - slightly under-commented code is easier to work with than narrated code. This omit-by-default applies to inline comments only; doc comments are required regardless.

Production comments explain the product/user reason or non-obvious behaviour: what user outcome, domain rule, vendor contract, operational constraint, or surprising edge case forced this choice. Never fabricate rationale. If you cannot verify why code exists, preserve the behaviour without inventing "for performance", "for safety", or "because users need it".

If a comment no longer matches the code, delete or rewrite it immediately. An incorrect comment is worse than a missing one - the next reader will trust it and act on it.

## Decision Gate

Apply these directly before writing prose; the sections below give examples.

- **Doc comment REQUIRED** on every function/method and class/file: contract + orientation, 1-5 lines for a function, 3-10 for a class/file, blank ` *` line before the tags.
- **Inline comment ONLY for** a hidden constraint, subtle invariant, workaround, or surprising behaviour - otherwise rewrite (rename / extract / simplify) or omit.
- **Product/user reason first:** comments explain the user impact, product rule, domain constraint, or non-obvious behaviour - not issue history or author provenance.
- **Verified rationale only:** no guessed reasons, no hedging (`probably`, `should be fine`, `I think`), no process narration.
- **Prefer a test or assertion** over a comment when it can carry the invariant (the Enforce rung).
- **Tags:** `@param name - description` / `@returns value - description` - real descriptions, never restated types.
- **Wrap ~110 chars** (hard max 120); **`YYYY-MM-DD`** date or a trigger on every TODO / FIXME / HACK.
- **Never:** markdown/emoji, commented-out code, secrets/PII/hostnames, position/line-number references, or non-load-bearing provenance.
- **Why it's strict:** the comment is a verification surface - state intent so a reviewer can diff it against the code.

```text
Writing a function/method or class/file?
  -> A doc comment is REQUIRED. Write contract + orientation. See "Docstring vs Inline".

Considering an INLINE comment inside the body?
  -> Rename, extract, simplify, or enforce first when that can carry the meaning.
  -> If it is a hidden constraint, subtle invariant, workaround, or surprising behaviour, write it.
  -> Otherwise omit it.
```

## Rewrite First

Before reaching for a comment, walk this ladder:

1. **Rename.** Can a better identifier carry the meaning? `t` → `timeoutMs`. `processData` → `stripPiiFromInbound`. Most "explanatory" comments dissolve under a single rename.
2. **Extract.** Can a named function carry the meaning? A ten-line block that wants a header comment usually wants to be its own function with that header text as the name.
3. **Simplify.** Can the control flow be untangled? Early returns, guard clauses, and flattening usually beat a comment explaining the nesting.
4. **Enforce.** Can a test or a debug assertion carry the invariant instead of prose describing it? A comment can't protect itself; an assertion can, and it fails loudly when violated.
5. **Then comment.** If intent still isn't visible after the four above - write the comment.

The clearest comment is often the rename that made it unnecessary.

**The Half-Life Test.** A good comment survives variable renames, function extraction, code movement, and reformatting. Anchor it to a durable constraint - vendor contract, regulation, invariant, or removal trigger - not to a person, ticket, sprint, ADR, learning-loop entry, or review thread. If a routine refactor would invalidate it, the content belongs in code, not prose.

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

A useful shape for the WHY: **Because [constraint], we do [choice]; prevents [failure], removable when [condition].** Prefer business, domain, legal, compliance, vendor, and operational rationale over implementation rationale a reader can reconstruct. If code rejects the simpler obvious option, deviates from a local pattern, or guards a non-obvious failure mode, put the verified reason at that decision point.

Magic values follow the same ladder: name them away first. If a value cannot be made self-explanatory with a named constant or domain type, comment the durable source or product rule that fixes it. Never write "magic value" as the reason.

### Product/user reason, not provenance

Comments that cite issue numbers, ADRs, learning-loop files, review comments, or milestone IDs usually make the reader chase history instead of understanding the code. Translate the provenance into the current product/user reason or non-obvious behaviour.

Bad:
```yaml
# medium per ticket / ADR / review thread
voice_agent_interrupt_sensitivity: medium
```

Good:
```yaml
# medium so short utterances ("yes", OTP digits) count as prompt events; low made callers repeat themselves.
voice_agent_interrupt_sensitivity: medium
```

## Docstring vs Inline

The default-no-comment stance governs INLINE comments. Doc comments are the standing exception: every function/method and every class/file carries one. They state the contract and orient the reader without requiring them to read the whole body. Size them to the unit: 1-5 lines for a function/method, 3-10 lines for a class/file. Trivial units still get one tight line; the mandate is to orient, not to pad.

Why mandatory, even on a private one-liner: a doc comment is a verification surface. Coding agents can produce code that superficially works while misunderstanding the requirement, so the doc comment gives a reviewer stated intent to compare with implementation. A mismatch is a signal to review before merging.

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
The doc comment promises a sort by renewal date; the code never sorts. Either the implementation is wrong or the comment overstates the contract. The mismatch is exactly what the verification surface is meant to expose.

A doc comment does two jobs - state the contract and orient the reader:

- **Contract:** inputs, outputs, errors, invariants - what the caller can rely on.
- **Orientation:** when to use it (and when not to), how it fits the bigger picture, what a null/empty return or unmet precondition means, and the footguns a caller will hit.

Format it consistently:

- **Real descriptions, not restated types.** Document every parameter and return with meaning; prefer the language's structured doc form (JSDoc, PEP 257, godoc, rustdoc) over a bare inline comment.
- **Hyphen-separate each tag's subject from its description**, so the line reads as label then explanation: `@param value - parsed JSON ...`, `@returns true - when value is a non-null object`.
- **Blank ` *` line between the description block and the tags**, so a multi-line description doesn't run straight into the tags as a wall of text.

Inline comments are the part this playbook rations: write one only when the WHY is non-obvious (the four cases below), and only after the rewrite-first ladder. Inline comments document rationale invisible from the signature (why this branch, why this constant, why this workaround).

Wrap every comment line - doc or inline - at about 110 characters. Padding to 50-70 makes a multi-line comment needlessly choppy; 120 is the hard ceiling.

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

Four inline cases earn their place. Put the comment immediately above the line or block it explains.

### Hidden constraint

Something the code cannot encode about its environment: rate limits, vendor contracts, regulatory rules, hardware quirks.

```python
# Vendor exports omit the timezone; treat as source-local by contract.
parsed = datetime.strptime(value, "%Y-%m-%d")
```

### Subtle invariant

A condition the code depends on but does not enforce. Prefer an assertion when affordable; comment only when the check would be too expensive or change the behaviour.

```python
def median_response_time(samples: list[float]) -> float:
    # Caller sorts; sorting here would dominate the hot path.
    return samples[len(samples) // 2]
```

Hidden coupling is a subtle invariant. Name the other runtime, schema, client, or provider contract and the failure caused by changing only one side.

```ts
// Must match the mobile app timeout; changing only this side can create duplicate submissions.
const PAYMENT_RETRY_TIMEOUT_MS = 8000;
```

### Workaround

Strange code that exists because of a bug or constraint elsewhere. Name the cause and the removal condition.

```ts
// Double rAF forces a layout flush before measuring. Single rAF returns stale
// values on Safari 17. Remove when Safari >= 18 is the baseline.
await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
```

### Surprising behaviour

Code that is correct but looks dangerous, wasteful, or backwards to the next reader.

```ts
// Intentionally mutates the input buffer.
// Copying doubles memory usage on 2GB+ exports.
normalizeInPlace(buffer);
```

Validation, permission, security, and compliance logic earns comments when the product rule or user-facing failure is not obvious from the condition. Comment the policy boundary precisely; do not comment every validation branch.

```ts
// Return null for deleted accounts so billing treats them as closed, not missing.
if (account.deletedAt) return null;
```

## TODO / FIXME / HACK Markers

Every marker carries an expiry (`YYYY-MM-DD` date or a concrete trigger). Add a tracking reference only when it is the durable owner, removal trigger, or verification path; otherwise write the current product/user reason. `TODO(name):` is optional and useful mainly in multi-contributor work.

Bad: `// TODO: clean this up later.`
Good: `// TODO: 2026-08-01 remove this fallback once the new auth flow ships.`

## Antipatterns

The next reader cannot use these. Do not write them; if you are already editing the surrounding code, delete or fix them.

- **Restating the code.** `i++; // increment i.` The reader can see the increment.
- **Unverified rationale.** No fabricated or hedged comments: `// for performance`, `// probably safe`, `// should be fine`. Verify the reason or omit it.
- **Commented-out code, tombstones, and archaeology.** Git records removals; comments should explain current constraints, not history.
- **Position or line-number references.** `// see function below`, `// line 142`. Refer by symbol name.
- **Suppression markers without rationale.** `// eslint-disable-next-line` alone is noise.
- **Non-load-bearing provenance.** PRs, issues, ADRs, learning-loop entries, task IDs, and review notes belong outside production code unless they are the durable contract, removal trigger, or verification path.
- **Decorative density.** Comment count, density, or doc-comment presence alone is never evidence of quality.
- **Markdown, emoji, and session artifacts.** Code comments are plain prose, not chat history or formatted documentation.

## Special Contexts

**Test code.** Same omit-by-default stance for inline comments; the test name carries the why. Use compact regression references only when load-bearing for test intent. The doc-comment mandate still applies, but a descriptive test name plus a one-line doc is usually enough.

**Generated code.** Mark generated files at the top so maintainers do not edit the wrong source:

```text
// AUTO-GENERATED FROM <source> - DO NOT EDIT
```

**Suppression with rationale.** Use the linter's native reason syntax so a checker can verify a reason is present:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response is dynamic at this boundary; narrowing happens in the next call.
const raw: any = await client.invoke(params);
```

## Multi-Language Stance

The WHEN and WHY rules are portable; core syntax is not. Defer to each language's conventions, then apply the house layout conventions from this playbook.

- **TypeScript / JavaScript.** JSDoc for contracts; plain `//` inline.
- **Python.** PEP 257 docstrings; `#` inline.
- **Go.** godoc syntax for exported AND private identifiers; `//` inline.
- **Rust.** rustdoc (`///` and `//!`) for public AND private items; `//` inline.
- **Shell.** `#` only; put contract details in a heredoc help block at the top of the script.

## Security

Comments ship with code and get indexed. Never include secrets, tokens, API keys, customer or patient identifiers, internal-only URLs, production hostnames, account IDs, or infrastructure topology. If you find these in existing comments while editing, redact them.

## Troubleshooting

**A linter rejects the house doc format.** Keep `@param name - desc` / `@returns value - desc`; suppress the specific rule with rationale rather than restating types.

**A tool only checks presence.** Presence is not quality. Write a tight contract or verified rationale; never pad a trivial unit to satisfy count or density.

**An existing comment violates the playbook.** Leave it unless you are already editing the surrounding code. If nearby prose only restates the code, delete it.

**A marker has no expiry or has provenance-only tracking.** Flag it; do not invent the missing trigger.

**An agent or reviewer asks for more inline comments.** Re-run the Decision Gate. Inline comments need one of the four valid reasons; doc comments are mandatory separately.

## Verification Gate

Before claiming a code change is done, check new and changed comments. **[static]** = mechanical, linter-checkable; **[judge]** = semantic, for a review-judge or human reviewer.

1. **[judge] Inline comments satisfy one of the four valid reasons** and prefer product/user/business/domain/legal/vendor rationale over implementation rationale a reader can reconstruct.
2. **[judge] Rationale is verified, not fabricated or hedged.** Performance, safety, compliance, or user-impact claims need support from code, source material, or task context.
3. **[judge] Comments sit at the decision point they explain** for failure modes, hidden coupling, local-pattern deviations, rejected simpler options, workarounds, and surprising behaviour.
4. **[judge] Comments pass the Half-Life Test.** If a routine refactor invalidates the text, the content belongs in code, not prose.
5. **[judge] Production comments avoid issue, PR, ADR, learning-loop, session/task, and review provenance** unless the reference is load-bearing for operating, verifying, or removing the code.
6. **[static] TODO / FIXME / HACK markers carry an expiry** (`YYYY-MM-DD` date or trigger) and only carry load-bearing tracking references.
7. **[static] Comments contain no secrets, internal URLs, or production hostnames**; customer/patient identifiers may need **[judge]** review.
8. **[judge] Existing comments touched or noticed are still accurate.** A stale comment you noticed is now part of the change.
9. **[static] presence + [judge] quality: Every function/method and class/file has a doc comment.** Presence, blank separator line, and 1-5 / 3-10 line counts are mechanical; real orientation, parameter meaning, return meaning, null/edge context, and non-restated types are semantic. Count or density alone never proves quality.
10. **[static] Comment lines wrap around 110 characters** and never run past 120.

If a comment fails any check, fix it before merging. Keep the **[static]** / **[judge]** tags accurate so tooling and review responsibilities stay separate.

## Related References

- Sibling playbooks installed alongside this one may share the same scaffold.
- Project instruction files may point here as the canonical comment policy.
