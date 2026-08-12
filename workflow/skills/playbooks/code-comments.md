---
goat-flow-reference-version: "1.15.1"
---
# Code Comments

Use this before naming an identifier or adding/editing a comment, docstring, or annotation. Write for the coding agent and the maintainer who later reads the code cold. Use plain English from the reader's perspective: what they did, see, or get next, never mechanics already shown by code.

House style is mandatory across TypeScript, Python, Go, Rust, PHP, and shell. Defer to each language's docstring syntax; this playbook owns when and why to comment, tag separators, block shape, and the hard maximum of 150 characters.

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

Tighten verbose comments without deleting `@param` / `@returns`, use verified rationale only, and delete stale comments on sight. Use the available width without exceeding 150: do not split one point at 100 characters merely to continue it. Before a width-based sweep, measure the longest existing comment line; a large over-width count is evidence the assumed limit may be wrong.

## The Standard in One Method

**Illustrative shape example (not incident evidence).** Everything together in a bulk action triggered from a list screen:

```php
/**
 * Send a payment reminder for each overdue invoice the practitioner selected.
 * Use from the "Outstanding invoices" screen when the user chases unpaid visits in bulk.
 *
 * @param Practice $practice - practice whose debtors are chased; decides which patients are contactable
 * @param int[] $selectedInvoiceIds - invoices ticked; empty means nothing is sent and the list stays unchanged
 * @return BatchResult - summary counts; zero sent means all selected invoices were paid or lacked an email
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

Every function/method and every file/module or class boundary carries one, including trivial and private units. Use 1-3 description lines for a method and 3-8 for a file/module or class boundary (tags excluded): what it does, when to use it, and where it fits the reader's flow.

For a PHP class file, the class PHPDoc carries the file and class contract; reserve file PHPDoc for classless scripts, bootstrap/config, or generated entry files. Module-oriented languages use a file/module comment when that is the useful boundary.

Even private one-liners need this verification surface: stated intent lets a reviewer compare promise with implementation.

- **Real descriptions, not restated types**, in the language's structured form (JSDoc, PHPDoc, PEP 257, godoc, rustdoc). Every `@param` / `@returns` carries meaning **and** its null/empty/absent consequence for the user.
- **Hyphen-separate each tag's subject from its description** (`@param value - parsed JSON ...`), with a **blank ` *` line between description and tags**. Use one physical line per tag. Only when the prefix passes column 100 and a meaningful description cannot fit may it use one aligned continuation line, for two physical lines maximum. Keep the complete tag subject on line one; never create a dash-only line or dangling name.
- **Pure dependency-injection constructors** still need their intent documented, but per-dependency tags may be omitted for obvious non-null services. A scalar, optional, configured, or side-effectful input is not pure DI and keeps its tag.

When a doc comment is verbose, tighten it to plain English and the sizes above - but a `@param` or `@returns` line is never the thing you cut. Trim its prose instead.

**Illustrative shape example (not incident evidence).** A mechanical name and doc hide the null path and when-to-use:

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
 * @param directoryPath - chosen or discovered directory; `undefined` or empty means the UI has no path yet
 * @returns directory without one trailing slash; `null` means the UI should skip path-based actions
 */
function trimTrailingDirectorySlash(directoryPath: string | undefined): string | null {
  // No directory is available yet, so the UI should skip path-based actions.
  if (!directoryPath) return null;

  return directoryPath.replace(/\/$/, "");
}
```

## Shape of a Comment Block

Description budgets remain 3-8 content lines for a class and 1-3 for a method; tags are separate. Bullets count as content, while blank separator lines do not. Including separators, allow at most 10 physical lines for a class and 4 physical lines for a method.

- Put one point per line and run it toward 150 characters; cut a qualifying clause rather than split one thought across short lines.
- Never use more than three consecutive prose lines. Separate distinct prose groups with a blank line.
- Use bullets only when points are genuinely enumerable. A longer block may use one or two lead lines, a blank, then one lead line and 3-5 bullets.
- Shape serves meaning: never cut a qualifier, limitation, tenancy rule, or user consequence to meet the layout.

## Context Comments (tier 3)

Above every `if`, loop (`for` / `foreach` / `while`; also chained `.filter().map()`), and null/empty fallback (`?? default`, `empty()`, early return on missing data), write one brief line: what happens and what it means to the user. Equivalent constructs (`else`, `switch` / `case`, `match`, ternary, default return) follow the same rule when they choose a user-visible path.

The line must translate, not restate. `// check if invoice is paid` is banned; "Paid invoices are locked - the user gets a read-only view instead of the edit form" earns its place because that consequence is visible nowhere in the condition.

The consequence is the requirement; the sentence shape is not. `[condition], so the UI [does X]` is one
way to write it, never the house template - a file whose context lines all run one movement reads as
generated however accurate each line is. Vary the construction; let length follow how much there is to
say. The branch whose intent is least visible earns the longest line; one whose returned name already
states the outcome earns four words.

An `if` chain does not need decorative repetition. When values already carry meaning at their declaration, comment only compound conditions, the default, and any fail-closed path; repeating a constant's own comment beside its use adds nothing. Validation, permission, and compliance branches still name the product rule and user outcome, not merely "validate input".

## Catch Comments

A catch comment explains a traceable cause, not the catch syntax: a nullable getter, a throwing dependency, missing configuration, or a vendor failure allowed by contract or observed in evidence. “Could not be read” and “service unavailable” merely restate the catch. If the cause is unknown, open the call and trace what breaks before writing the line.

An intentionally unlogged catch must state why another local log adds no signal, such as an owning boundary already recording the same failure once. Silence is a reviewed choice, never an implication.

## Verify Before You Assert

Before describing code behaviour, open it. Read a query's predicate before claiming its scope; compare the native type, doc comment, and property or setter before claiming nullability; walk the branch through its return; and count a list before writing a number.

Tightening inherited prose turns it into an assertion you own. Verify it before making it more confident: concise false prose is more convincing, not safer. A fluent false comment is worse than a missing one because tests and analyzers may never challenge its meaning.

## Discretionary Inline Comments (tier 5)

Extra inline comments are a last resort. First **rename**, **extract**, **simplify**, or **enforce**. If intent remains hidden, one of four reasons earns a line immediately above the code. Prefer user/business/domain/legal/vendor rationale and name the constraint, choice, prevented failure, and removal trigger.

- **Hidden constraint** the code cannot encode - rate limit, vendor contract, regulation, hardware quirk.
  `# Vendor exports omit the timezone; treat as source-local by contract.`
- **Subtle invariant** the code relies on but does not enforce, including hidden coupling - name the other side and the breakage from changing only one.
  `// Must match the mobile app timeout; changing only this side can double-submit payments.`
- **Workaround** for a bug or constraint elsewhere - name the cause and the removal trigger.
  `// Double rAF flushes layout before measuring; single rAF is stale on Safari 17. Remove at Safari >= 18.`
- **Surprising behaviour** that is correct but looks wrong.
  `// Intentionally mutates the input buffer; copying doubles memory on 2GB+ exports.`

**Half-Life Test:** a good comment survives renames, extraction, and movement. Anchor it to a durable constraint, not a person, ticket, or review thread; translate provenance into the current reader reason.

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
- **Counts of adjacent mutable collections.** Describe what a list or branch family is for; the reader can count it. A schema- or test-enforced count remains a valid contract.
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

**A linter rejects the house doc format.** Prefer the language's or project's native syntax. Suppress only a documented false positive, with rationale, rather than restating types.

**A context line on every branch feels like noise.** State the reader consequence. A branch with no meaning for the reader is a naming or design smell, not permission to restate mechanics.

## Verification Gate

Before claiming a code change is done, check names and comments. **[static]** is mechanical; **[judge]** requires semantic review.

1. **[static]+[judge] Every file/module or class boundary (3-8 lines) and method (1-3 lines) has a doc comment.** Size and separators are mechanical; when-to-use, bigger-picture fit, parameter/return meaning, and non-restated types are semantic. PHP class files do not duplicate file and class PHPDoc.
2. **[static]+[judge] Every `if`, loop, and null/empty check has one brief context line above it** that translates the moment into reader meaning rather than restating mechanics, and the file's context lines do not all run one sentence template.
3. **[judge] Every `@param` / `@returns` states what null/empty/absent means for the user**, and no tag was deleted while tightening a verbose comment.
4. **[judge] Names are self-documenting in the product's vocabulary** - identifiers match the words the user sees wherever a UI exists.
5. **[judge] Flow entry points carry a user-journey anchor where the trigger is hard to reconstruct.**
6. **[judge] Discretionary inline comments satisfy one valid reason**, sit at the decision, and prefer reader-relevant rationale over reconstructible mechanics.
7. **[judge] Rationale and code-behaviour claims are verified**, including query scope, nullability, branches, counts, and inherited prose; they also pass the Half-Life Test.
8. **[static] TODO / FIXME / HACK markers carry an expiry** and only load-bearing tracking references.
9. **[static] No secrets, internal URLs, or production hostnames**; customer/patient identifiers may need **[judge]** review.
10. **[judge] Existing comments touched or noticed are still accurate.** Tightening an inherited claim transfers ownership.
11. **[static] Comment lines use the available width and never exceed the hard maximum of 150 characters.** Tags and description blocks meet their physical-line limits.

If a comment fails any check, fix it before merging.

## Related References

- `writing-style.md` - comments and docstrings follow this playbook; other human-read prose follows `writing-style.md`.
- Sibling playbooks share the same scaffold; project instruction files may point here as the canonical comment policy.
