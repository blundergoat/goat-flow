---
goat-flow-reference-version: "1.13.1"
---
# Code Comments

Use this when writing or editing source code in any language, before naming an identifier or adding a comment, docstring, or annotation. The primary reader is the coding agent doing the work; the beneficiary is the human maintainer who later reads the code cold - often someone who knows the product well and the codebase not at all. Write every comment and name in plain English from the UI/user perspective: say what the user did, sees, or gets next, never restate the mechanics the code already shows.

This project wants a specific, consistent set of comments - the standard below is not a menu to weigh but the house style every file meets. Portable across TypeScript, Python, Go, Rust, PHP, and shell: defer to each language's docstring SYNTAX (JSDoc, PHPDoc, PEP 257, godoc, rustdoc), while this playbook owns the WHEN/WHY decision plus the house layout conventions (tag separator, blank line before tags, ~110-char wrap) that override language defaults.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- About to write a comment, docstring, or annotation in a source file.
- Naming or renaming a variable, method, or class.
- Editing existing code that contains comments - to decide keep / tighten / rewrite / delete.
- Authoring a TODO / FIXME / HACK marker, or reviewing a diff that changes comments.

Enforcement is partial: static tools may flag mechanical items (missing doc comments, marker expiry) but not the `[judge]` semantic checks. The gate below is the spec; do not claim more enforcement than the project runs.

## The Comment Standard

These are the comments we want, all in plain English from the UI/user perspective. Rules 1-4 are mandatory whenever their construct exists and are **not** subject to any "omit by default" rule. Rule 5 is mandatory at flow entry points and hard-to-reconstruct junctions, but not on every method. If you are unsure whether one of the first four applies, it does.

1. **Doc comment on every file/module or class boundary (3-8 lines) and every method (1-3 lines).**
   Say what it does, **when to use it from the user's perspective**, and how it fits the bigger
   user-facing process. A class/file boundary also names the screen, flow, or capability it serves.
   For PHP class files, the class PHPDoc is the file/class boundary comment; do not also add a
   separate top-of-file PHPDoc above `declare`, `namespace`, or `use`.
2. **Self-documenting names in the user's vocabulary.** Every variable and method named for what the user sees and does - `$data` -> `$overdueInvoices`, `handleSubmit` -> `sendRebookingRequest` - not internal mechanics. If the UI says "appointment", the code does not say "booking".
3. **A context line above every `if`, every loop (`for` / `foreach` / `while`), and every null/empty check.** One brief plain-English line: what is happening here and what it means for the user.
4. **Null/empty meaning on every `@param` and `@returns` / `@return`.** Say what an absent, null, or empty value means on screen - "no folder chosen yet", "the user sees the empty state, not an error" - since the signature cannot.
5. **A user-journey anchor at flow entry points and non-obvious triggers.** Add a concrete example of what the user did to arrive here when the trigger is hard to reconstruct.

Alongside these: **tighten** verbose comments to plain English but **never delete a `@param` / `@returns`** while doing so (trimming cuts words, not contract); **verified rationale only** (no guessed "for performance", no hedging like `probably` / `should be fine`); wrap ~110 chars (hard max 120); a `YYYY-MM-DD` date or trigger on every TODO / FIXME / HACK; and never write markdown/emoji, commented-out code, secrets, or line-number references. A comment that no longer matches the code is deleted or rewritten on sight - incorrect is worse than missing.

```text
File/module, class, or method?      -> doc comment (3-8 / 1-3 lines): what, UI when-to-use, bigger-picture fit
if / for / foreach / while / null-empty check?  -> context line: what happens + what it means for the user
@param / @returns?                  -> real meaning + what null/empty/absent means on screen
Naming anything?                    -> self-documenting, in the words the user sees
Flow entry or non-obvious trigger?  -> user-journey anchor: what did the user do to get here
Any OTHER inline comment?           -> rename / extract / simplify / enforce first; keep only for a hidden
                                       constraint, subtle invariant, workaround, or surprising behaviour
```

## The Standard in One Method

Everything the standard asks for, together - a bulk action a practitioner triggers from a list screen:

```php
/**
 * Send a payment reminder for each overdue invoice the practitioner selected.
 * Use from the "Outstanding invoices" screen when the user chases unpaid visits in bulk, so a
 * busy practice clears its debtors list in one action instead of invoice by invoice.
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

The doc says what it does, when to use it, and why it matters to a busy practice; the name and its arguments read in the user's words; every tag says what empty/null means on screen; a journey anchor shows how the user got here; and each `if`, the `foreach`, and the null check carry their user meaning.

## Doc Comments and Tags (tiers 1 and 4)

Every function/method and every file/module or class boundary carries one - trivial and private
units included. Size to the unit: 1-3 lines for a method, 3-8 for a file/module or class boundary
(tags excluded). The description orients a product-minded reader: what this does, when to use it
(and when not to) from the UI/user perspective, and where it sits in the user's flow.

PHP class files are the exception to "file plus class": do not write both. In a normal one-class
PHP file, the class PHPDoc carries the file-level description and the class contract together. A
separate file PHPDoc is used only for PHP files without a class, such as procedural scripts,
bootstrap/config files, or generated entry files. TypeScript, JavaScript, Python, Go, Rust, and
similar module-oriented files may still have a file/module comment when the file itself is the
useful boundary, especially when it contains several functions, exports, or classes.

Why mandatory even on a private one-liner: the doc comment is a verification surface. An agent can produce code that superficially works while misunderstanding the requirement; stated intent lets a reviewer diff promise against implementation - a doc that promises a sort the body never performs is a review signal.

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

After - renamed into the user's terms, with when-to-use and the null meaning stated:

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

Above every `if`, every loop (`for` / `foreach` / `while`; one line above a chained `.filter().map()` pipeline too), and every null/empty check or fallback (`?? default`, `empty()`, early return on missing data), write one brief plain-English line: what is happening, and what it means from the UI/user perspective. Equivalent branch/default constructs (`else`, `switch` / `case`, `match`, ternary, default return) follow the same rule when they choose a user-visible path.

The line must translate, not restate. `// check if invoice is paid` is banned; "Paid invoices are locked - the user gets a read-only view instead of the edit form" earns its place because that consequence is visible nowhere in the condition. In an `if` chain, each branch gets its own line - here, what each project state tells the user to do next:

```js
/**
 * Choose the badge style shown beside a saved project in the Projects view.
 * Use when a user scans the project list and needs the recommended next step to read visually.
 *
 * @param projectRow - saved dashboard project; missing or empty `action` means the UI has no specific next step yet
 * @returns CSS badge class for the project action, or a muted badge when the action is unknown
 */
projectActionBadgeClass(projectRow) {
  // Ready to audit, so the UI shows a positive next-step badge.
  if (projectRow.action === 'audit') return 'gf-badge-pass';

  // A newer version exists, so the UI nudges the user with a warning badge.
  if (projectRow.action === 'upgrade') return 'gf-badge-warn';

  // Migration work is outstanding, so the UI raises the attention level.
  if (projectRow.action === 'migration') return 'gf-badge-high';

  // Setup is incomplete, so the UI points the user at the setup flow.
  if (projectRow.action === 'setup') return 'gf-badge-ap';

  // The audit found repair work, so the UI highlights an actionable fix state.
  if (projectRow.action === 'fix') return 'gf-badge-ap';

  // The action is unknown, so the UI stays neutral instead of inventing a next step.
  return 'gf-badge-muted';
},
```

Validation, permission, and compliance branches follow the same rule - name the product rule and the user-facing outcome, not just "validate input".

## Discretionary Inline Comments (tier 5)

Beyond the mandatory tiers, an extra inline comment is a last resort. First try to make it unnecessary: **rename** (a user-vocabulary identifier often dissolves it), **extract** (a block wanting a header comment wants to be a named function), **simplify** (early returns beat prose explaining nesting), **enforce** (an assertion fails loudly; a comment cannot). If intent still is not visible, four cases earn one, placed immediately above the line - prefer user/business/domain/legal/vendor rationale, shaped as **because [constraint], we do [choice]; prevents [failure], removable when [condition]**:

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

- **Restating the mechanics.** `i++; // increment i`, `// check if invoice is paid`. Context lines must add user meaning, not narrate syntax.
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
  `//` inline. In class files, put the 3-8 line file/class description on the class PHPDoc only.
  Use a top-of-file PHPDoc only for PHP files without a class.
- **Python.** PEP 257 docstrings; `#` inline.
- **Go.** godoc syntax for exported AND private identifiers; `//` inline.
- **Rust.** rustdoc (`///` and `//!`) for public AND private items; `//` inline.
- **Shell.** `#` only; put contract details in a heredoc help block at the top of the script.

## Security

Comments ship with code and get indexed. Never include secrets, tokens, API keys, customer or patient identifiers, internal-only URLs, production hostnames, account IDs, or infrastructure topology; redact any found while editing. User-journey anchors describe a generic user ("the practitioner"), never a real one.

## Troubleshooting

**A linter rejects the house doc format.** Keep `@param name - desc` / `@returns value - desc`; suppress the specific rule with rationale rather than restating types.

**A context line on every branch feels like noise.** The cure is better content, not omission: state the user consequence. A branch with no stateable user meaning is a naming or design smell worth surfacing - not a licence to restate mechanics.

**No UI exists (library, daemon, build tool).** Use the nearest consumer's perspective - the developer calling the API, the operator reading the log - in the same plain-English, outcome-focused register.

## Verification Gate

Before claiming a code change is done, check names and comments. **[static]** = mechanical, linter-checkable; **[judge]** = semantic, for a review-judge or human reviewer.

1. **[static]+[judge] Every file/module or class boundary (3-8 lines) and method (1-3 lines) has a
   doc comment.** Sizes and the blank separator line are mechanical; UI when-to-use, bigger-picture
   fit, real parameter/return meaning, and non-restated types are semantic. PHP class files must
   not duplicate a top-of-file PHPDoc and a class PHPDoc for the same boundary.
2. **[static]+[judge] Every `if`, loop, and null/empty check has one brief context line above it** that translates the moment into user meaning rather than restating mechanics.
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

- Sibling playbooks installed alongside this one share the same scaffold.
- Project instruction files may point here as the canonical comment policy.
