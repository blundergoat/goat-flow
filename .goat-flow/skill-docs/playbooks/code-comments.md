---
goat-flow-reference-version: "1.15.1"
---
# Code Comments

Use this before naming an identifier or adding/editing a comment, docstring, or annotation. Write for the coding agent and the maintainer who later reads the code cold. Use plain English from the reader's perspective: what they did, see, or get next, never mechanics already shown by code.

House style is mandatory. It applies across TypeScript, Python, Go, Rust, PHP, and shell: defer to each language's docstring syntax, while this playbook owns when/why to comment plus tag separators, blank lines before tags, and ~110-char wrapping.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- About to write a comment, docstring, annotation, or TODO / FIXME / HACK marker.
- Naming or renaming a variable, method, or class.
- Editing code with existing comments - keep / tighten / rewrite / delete - or reviewing a diff that changes them.

Enforcement is partial: static tools may flag mechanical items, not `[judge]` semantic checks. Do not claim more enforcement than the project runs.

## Pick the Reader First

Every rule here writes from the reader's perspective, and that reader is not always looking at a
screen. Choose the row first; choosing wrong makes an agent invent a user the code lacks.

| Surface | Whose perspective |
|---|---|
| Product code behind a UI | The person using the screen: what they did, see, or get next |
| CLI, library, SDK, framework | The developer calling it: what they pass, get back, and must handle |
| Daemon, job, migration, infrastructure | The operator reading the log or holding the pager |

With no UI, "the user's vocabulary" is the calling developer's or the operator's. A comment describing
a screen a CLI cannot render is fabrication, not translation.

## The Comment Standard

These are the comments we want, all in plain English from the reader chosen in Pick the Reader First. Rules 1-4 are mandatory whenever their construct exists and are **not** subject to any "omit by default" rule. Rule 5 is mandatory at flow entry points and hard-to-reconstruct junctions, but not on every method. If you are unsure whether one of the first four applies, it does.

1. **Doc comment on every file/module or class boundary (3-8 lines) and every method (1-3 lines).**
   Say what it does, **when to use it from the reader's perspective**, and how it fits the bigger
   process. A class/file boundary also names the screen, flow, or capability it serves.
   For PHP class files, the class PHPDoc is the file/class boundary comment; do not also add a
   separate top-of-file PHPDoc above `declare`, `namespace`, or `use`.
2. **Self-documenting names in the user's vocabulary.** Every variable and method named for what the user sees and does - `$data` -> `$overdueInvoices`, `handleSubmit` -> `sendRebookingRequest` - not internal mechanics. If the UI says "appointment", the code does not say "booking".
3. **A context line above every `if`, every loop (`for` / `foreach` / `while`), and every null/empty check.** One brief plain-English line: what is happening here and what it means for the user.
4. **Null/empty meaning on every `@param` and `@returns` / `@return`.** Say what an absent, null, or empty value means for the reader - "no folder chosen yet", "the user sees the empty state, not an error" - since the signature cannot.
5. **A user-journey anchor at flow entry points and non-obvious triggers.** Add a concrete example of what the user did to arrive here when the trigger is hard to reconstruct.

Also: tighten verbose comments without deleting `@param` / `@returns`, use verified rationale only, and wrap ~110 chars (hard max 120). Delete or rewrite stale comments on sight - incorrect is worse than missing.

```text
File/module, class, or method?      -> doc comment (3-8 / 1-3 lines): what, when-to-use, bigger-picture fit
if / for / foreach / while / null-empty check?  -> context line: what happens + what it means for the reader
@param / @returns?                  -> real meaning + what null/empty/absent means for the reader
Naming anything?                    -> self-documenting, in the words the reader uses
Flow entry or non-obvious trigger?  -> user-journey anchor: what did the user do to get here
Any OTHER inline comment?           -> rename / extract / simplify / enforce first; then only for a hidden
                                       constraint, invariant, workaround, or surprise
```

## The Standard in One Method

Everything together, in a bulk action triggered from a list screen:

```php
/**
 * Send a payment reminder for each overdue invoice the practitioner selected.
 * Use from the "Outstanding invoices" screen when the user chases unpaid visits in bulk.
 *
 * @param Practice $practice - practice whose debtors are chased; decides which patients are contactable
 * @param int[] $selectedInvoiceIds - invoices the user ticked; empty means they pressed "Email all" with
 *   nothing selected, so nothing is sent and the list is left as it was
 * @return BatchResult - sent/skipped tallies the UI shows as a summary toast; zero sent means every
 *   selected invoice was already paid or the patient had no email on file
 */
public function emailOverdueInvoiceReminders(Practice $practice, array $selectedInvoiceIds): BatchResult
{
    // e.g. the practitioner opened Reports > Outstanding invoices, ticked three rows, and clicked "Email all".
    $result = new BatchResult();

    // Nothing was ticked, so there is no one to chase and the screen stays as it was.
    if (empty($selectedInvoiceIds)) {
        return $result;
    }

    // One reminder per selected invoice, in the order the user sees them listed.
    foreach ($this->overdueInvoices($practice, $selectedInvoiceIds) as $invoice) {
        // No email on file, so this one is skipped and later shown as "needs a posted letter".
        if ($invoice->patient->email === null) {
            $result->skip($invoice);
            continue;
        }

        $this->mailer->sendReminder($invoice);
        $result->markSent($invoice);
    }

    return $result;
}
```

## Doc Comments and Tags (tiers 1 and 4)

Every function/method and every file/module or class boundary carries one - trivial and private
units included. Size to the unit: 1-3 lines for a method, 3-8 for a file/module or class boundary
(tags excluded). The description orients a product-minded reader: what this does, when to use it
(and when not to), and where it sits in the reader's flow.

PHP class files are the exception to "file plus class": the class PHPDoc carries both, and a separate
file PHPDoc is used only for PHP files without a class - procedural scripts, bootstrap/config files,
generated entry files. TypeScript, JavaScript, Python, Go, Rust, and similar module-oriented files may
still carry a file/module comment when the file is the useful boundary, holding several functions,
exports, or classes.

Even private one-liners need this verification surface: stated intent lets a reviewer compare promise with implementation.

- **Real descriptions, not restated types**, in the language's structured form (JSDoc, PHPDoc, PEP 257, godoc, rustdoc). Every `@param` / `@returns` carries meaning **and** its null/empty/absent consequence for the user.
- **Hyphen-separate each tag's subject from its description** (`@param value - parsed JSON ...`), with a **blank ` *` line between the description block and the tags**.

When a doc comment is verbose, tighten it to plain English and the sizes above - but a `@param` or `@returns` line is never the thing you cut. Trim its prose instead.

Fixing a mechanical comment (name and doc describe mechanics, null path silent, no when-to-use):

```ts
/** Trim the trailing slash from a directory path. */
function trimDir(path: string | undefined): string | null {
  if (!path) return null;
  return path.replace(/\/$/, "");
}
```

After - renamed into the user's terms, with when-to-use and null meaning:

```ts
/**
 * Normalize a directory path before the UI shows it or uses it for navigation.
 * Use when a user-selected or discovered project path may have a trailing slash.
 *
 * @param directoryPath - directory chosen by the user or found in config; `undefined` or empty
 *                      means there is no path for the UI to show or open yet
 * @returns the directory without one trailing slash; `null` means no usable path exists and the
 *          UI should skip path-based actions
 */
function trimTrailingDirectorySlash(directoryPath: string | undefined): string | null {
  // No directory is available yet, so the UI should skip path-based actions.
  if (!directoryPath) return null;

  return directoryPath.replace(/\/$/, "");
}
```

## Context Comments (tier 3)

Above every `if`, loop (`for` / `foreach` / `while`; also chained `.filter().map()`), and null/empty fallback (`?? default`, `empty()`, early return on missing data), write one brief line: what happens and what it means to the user. Equivalent constructs (`else`, `switch` / `case`, `match`, ternary, default return) follow the same rule when they choose a user-visible path.

The line must translate, not restate. `// check if invoice is paid` is banned; "Paid invoices are locked - the user gets a read-only view instead of the edit form" earns its place because that consequence is visible nowhere in the condition.

The consequence is the requirement; the sentence shape is not. `[condition], so the UI [does X]` is one
way to write it, never the house template - a file whose context lines all run one movement reads as
generated however accurate each line is. Vary the construction; let length follow how much there is to
say. The branch whose intent is least visible earns the longest line; one whose returned name already
states the outcome earns four words.

In an `if` chain, each branch gets its own line. Here the comments carry what the returned class names
cannot - where each state comes from, and why two of them share a badge:

```js
/**
 * Choose the badge style shown beside a saved project in the Projects view.
 * Use when a user scans the project list and needs the recommended next step to read visually.
 *
 * @param projectRow - saved dashboard project; missing or empty `action` means the UI has no specific next step yet
 * @returns CSS badge class for the project action, or a muted badge for an action with no badge of its own
 */
projectActionBadgeClass(projectRow) {
  // Set up and current; the audit is only the deeper per-agent check.
  if (projectRow.action === 'audit') return 'gf-badge-pass';

  // Installed, but behind the current release.
  if (projectRow.action === 'upgrade') return 'gf-badge-warn';

  // Pre-1.0 layout with retired skill names; a plain setup run would leave them in place.
  if (projectRow.action === 'migration') return 'gf-badge-high';

  // A half-finished install, or another agent's instructions with no goat-flow beside them.
  if (projectRow.action === 'setup') return 'gf-badge-ap';

  // Not repair work: the manifest probe threw, so the real state is unknown rather than bad.
  // Shares the setup badge - both mean act on the row before trusting what it says.
  if (projectRow.action === 'fix') return 'gf-badge-ap';

  // Also where 'incomplete' lands - a current project missing pieces, with no badge of its own.
  return 'gf-badge-muted';
},
```

Validation, permission, and compliance branches follow the same rule - name the product rule and the user-facing outcome, not just "validate input".

## Discretionary Inline Comments (tier 5)

Beyond the mandatory tiers, an extra inline comment is a last resort. First make it unnecessary: **rename** (a user-vocabulary identifier often dissolves it), **extract** (a block wanting a header comment wants to be a named function), **simplify** (early returns beat prose explaining nesting), **enforce** (an assertion fails loudly; a comment cannot). If intent still is not visible, four cases earn one, placed immediately above the line - prefer user/business/domain/legal/vendor rationale, shaped as **because [constraint], we do [choice]; prevents [failure], removable when [condition]**:

- **Hidden constraint** the code cannot encode - rate limit, vendor contract, regulation, hardware quirk.
  `# Vendor exports omit the timezone; treat as source-local by contract.`
- **Subtle invariant** the code relies on but does not enforce, including hidden coupling - name the other side and the breakage from changing only one.
  `// Must match the mobile app timeout; changing only this side can double-submit payments.`
- **Workaround** for a bug or constraint elsewhere - name the cause and the removal trigger.
  `// Double rAF flushes layout before measuring; single rAF is stale on Safari 17. Remove at Safari >= 18.`
- **Surprising behaviour** that is correct but looks wrong.
  `// Intentionally mutates the input buffer; copying doubles memory on 2GB+ exports.`

**Half-Life Test:** a good comment survives renames, extraction, and movement. Anchor it to a durable constraint (user outcome, vendor contract, regulation, invariant, removal trigger), not a person, ticket, or review thread. Translate provenance into the current product/user reason - not `# medium per ticket`, but `# medium so short utterances ("yes", OTP digits) count as prompt events; low made callers repeat themselves.`

## TODO / FIXME / HACK Markers

Every marker carries an expiry (`YYYY-MM-DD` date or a concrete trigger). Add a tracking reference only when it is the durable owner, removal trigger, or verification path; otherwise write the current product/user reason.

Bad: `// TODO: clean this up later.`
Good: `// TODO: 2026-08-01 remove this fallback once the new auth flow ships.`

## Antipatterns

The next reader cannot use these. Do not write them; if you are already editing the surrounding code, fix them.

- **Restating the mechanics.** `i++; // increment i`, `// check if invoice is paid`. Context lines must add reader meaning, not narrate syntax.
- **One sentence template for every line.** Six branches sharing `[state], so the UI [does X]` are one sentence six times. Vary the shape; drop the half the code states.
- **Stripping tags while tightening.** Concision never removes `@param` / `@returns` lines - trim their prose instead.
- **Codebase jargon.** A comment that only makes sense after reading the module has not reached the user's perspective.
- **Unverified rationale.** `// for performance`, `// probably safe`. Verify the reason or omit it.
- **Commented-out code, tombstones, archaeology.** Git records removals; comments explain current constraints.
- **Position or line-number references.** `// see function below`, `// line 142`. Refer by symbol name.
- **Bare suppression markers.** `// eslint-disable-next-line` with no reason is noise.
- **Non-load-bearing provenance.** PRs, issues, ADRs, task IDs, review notes - unless the reference is the durable contract, removal trigger, or verification path.
- **Decorative density.** Comment count or presence alone is never evidence of quality.
- **Markdown, emoji, and session artifacts.** Code comments are plain prose, not chat history.

## Special Contexts

**Test code.** Naming and doc-comment rules apply; a descriptive test name plus a one-line doc is usually enough. The context-line mandate relaxes to omit-by-default inside test bodies - the name and assertions carry the user story.

**Generated code.** Mark generated files at the top: `// AUTO-GENERATED FROM <source> - DO NOT EDIT`.

**Suppression with rationale.** Use the linter's native reason syntax so a checker can verify a reason is present:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response is dynamic; narrowed in the next call.
const raw: any = await client.invoke(params);
```

## Multi-Language Stance

The WHEN and WHY rules are portable; syntax is not. Defer to each language, then apply the house layout.

- **TypeScript / JavaScript.** JSDoc for contracts; plain `//` inline.
- **PHP.** PHPDoc (`/** ... */`) for contracts, with null/empty meaning on `@param` / `@return`;
  `//` inline. In class files the class PHPDoc carries the file/class description.
- **Python.** PEP 257 docstrings; `#` inline.
- **Go.** godoc syntax for exported AND private identifiers; `//` inline.
- **Rust.** rustdoc (`///` and `//!`) for public AND private items; `//` inline.
- **Shell.** `#` only; put contract details in a heredoc help block at the top of the script.

## Security

Comments ship with code and get indexed. Never include secrets, tokens, API keys, customer/patient identifiers, internal URLs, production hostnames, account IDs, or infrastructure topology; redact any found while editing. User-journey anchors describe generic users, never real people.

## Troubleshooting

**A linter rejects the house doc format.** Keep `@param name - desc` / `@returns value - desc`; suppress the specific rule with rationale rather than restating types.

**A context line on every branch feels like noise.** State the reader consequence. A branch with no meaning for the reader is a naming or design smell, not permission to restate mechanics.

## Verification Gate

Before claiming a code change is done, check names and comments. **[static]** = mechanical, linter-checkable; **[judge]** = semantic, for a review-judge or human reviewer.

1. **[static]+[judge] Every file/module or class boundary (3-8 lines) and method (1-3 lines) has a
   doc comment.** Sizes and the blank separator line are mechanical; when-to-use, bigger-picture
   fit, real parameter/return meaning, and non-restated types are semantic. PHP class files must
   not duplicate a top-of-file PHPDoc and a class PHPDoc for the same boundary.
2. **[static]+[judge] Every `if`, loop, and null/empty check has one brief context line above it** that translates the moment into reader meaning rather than restating mechanics, and the file's context lines do not all run one sentence template.
3. **[judge] Every `@param` / `@returns` states what null/empty/absent means for the user**, and no tag was deleted while tightening a verbose comment.
4. **[judge] Names are self-documenting in the product's vocabulary** - identifiers match the words the user sees wherever a UI exists.
5. **[judge] Flow entry points carry a user-journey anchor where the trigger is hard to reconstruct.**
6. **[judge] Discretionary inline comments satisfy one of the four valid reasons**, sit at the decision point, and prefer user/business/domain/legal/vendor rationale over reconstructible implementation rationale.
7. **[judge] Rationale is verified, not fabricated or hedged**, and passes the Half-Life Test.
8. **[static] TODO / FIXME / HACK markers carry an expiry** and only load-bearing tracking references.
9. **[static] No secrets, internal URLs, or production hostnames**; customer/patient identifiers may need **[judge]** review.
10. **[judge] Existing comments touched or noticed are still accurate.** A stale comment you noticed is now part of the change.
11. **[static] Comment lines wrap around 110 characters** and never run past 120.

If a comment fails any check, fix it before merging.

## Related References

- `writing-style.md` - comments and docstrings follow this playbook; other human-read prose follows `writing-style.md`.
- Sibling playbooks share the same scaffold; project instruction files may point here as the canonical comment policy.
