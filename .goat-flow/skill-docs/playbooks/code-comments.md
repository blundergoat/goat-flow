---
goat-flow-reference-version: "1.17.0"
---
# Code Comments

Use this before adding or editing a comment, docstring, or annotation. Start naming and placement work in [`naming-and-placement.md`](./naming-and-placement.md), then return here for prose that remains necessary. Write for the maintainer who later reads the code cold. Use plain English from the reader's perspective: what they did, see, or get next, never mechanics already shown by code.

## Availability Check

This is a discipline reference, not a runnable tool. Load it before writing or reviewing a comment,
docstring, annotation, or TODO / FIXME / HACK marker, after naming work. Static tools cover only
mechanical items, not `[judge]` semantic checks.

## Project Authority

The project standard governs all points it addresses. Playbook defaults apply only when no project
guidance addresses a point; drop a conflicting default. Before editing a block governed by multiple rules, state
the expected final shape and check every applicable rule against it. Record the rule source per changed span.
Explicit current instructions and accepted architecture remain controlling. Project standards and playbook
defaults cannot override safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Pick the Reader First

Choose the interface reader first. That reader is not always looking at a screen, and choosing the
wrong row invents a user the code lacks.

| Interface | Reader |
|---|---|
| Product code behind a UI | The person using the screen: what they did, see, or get next |
| CLI, library, SDK, framework | The developer calling it: what they pass, get back, and must handle |
| Daemon, job, migration, infrastructure | The operator reading the log or holding the pager |

With no UI, "the user's vocabulary" is the calling developer's or operator's. A comment describing a
screen a CLI cannot render is fabrication. A prompt asking for "user/UI perspective" selects a reader;
it never forces the product-UI row onto operator code.

Then apply a separate layer lens. The reader selects who needs the fact; the layer selects which fact is useful.

| Layer | Useful comment subject |
|---|---|
| domain/service | The invariant or business consequence |
| repository/query | The result-set contract or exceptional join rationale |
| infrastructure | The operator consequence and mechanism |

## The Comment Standard

All comments use plain English for the reader and layer selected above. These rules are conditions,
not quotas; apply a rule only when its stated contract exists.

A request to cover every method, branch, loop, catch, or null/empty path means inspect every candidate;
it does not require a comment where no verified hidden reader information exists. A 150-character
layout is a ceiling, not a target: never add filler or merge distinct points to approach it.

1. **Doc comments where project or language canon requires them, for public/exported APIs, and for
   file/module/class boundaries with a non-obvious contract.** Say what the unit does, when to use it,
   and how it fits the reader's process; self-explanatory private/local units need none. When a method
   comment is useful, keep its description to 1-3 lines; use 3-8 for a documented boundary.
   For PHP class files, the class PHPDoc is the file/class boundary comment; do not also add a
   separate top-of-file PHPDoc above `declare`, `namespace`, or `use`.
2. **Naming and placement before compensating prose.** Start naming and placement work in
   [`naming-and-placement.md`](./naming-and-placement.md). This comment route does not authorize a move,
   guard removal, extraction, public rename, or behaviour change; report or defer anything outside scope.
3. **Context for a reader-meaningful branch.** Give an `if`, loop, or null/empty path one local
   sentence when its consequence is not clear from the code. State the trigger plus consequence. A
   branch whose only honest line restates code gets none.
4. **Null/empty meaning only when admitted and semantically visible.** Explain an absent, null, or
   empty value's reader consequence only when the interface can produce that state and the code does
   not reveal its meaning. Never document a null, empty, or absent state the interface cannot produce.
5. **Journey context only when useful.** Add verified arrival context only when it changes the
   reader's interpretation and remains hidden from the code.

Preserve current valid tags. Remove or repair a tag only when it is stale, invalid, or names a removed parameter. Fix stale comments in scope; outside the authorized
scope, report or defer it and do not delete it. The project or language formatter's enforced width governs. Resolve it
from `.editorconfig`, lint, then a formatter that actually reflows comments. When neither defines a
width, 150 characters is the fallback ceiling.
The shortest complete useful comment wins; never split one point across lines merely to stay short.
Before a width sweep, measure the longest existing comment line; many violations can expose a wrong assumed limit.

Plain English removes jargon, not precision. Keep exact verbs (`remove`, `compile`, `mask`), technical
qualifiers (`case-insensitive`) plus a short why, and the code's noun (`seed`, `sidecar`) unless it
misreads as an ordinary verb. Leave a compliant comment verbatim: rewriting requires a diagnosed
defect, and a tie goes to the incumbent.

New or edited comments do not use em dashes as sentence punctuation. Preserve them only in exact
quoted or code material; do not rewrite untouched legacy comments solely for punctuation.

A rewrite needs a report-only diagnosis. Use `STALE`, `FALSE`, `RESTATES`, `TERM`, `METAPHOR`,
`HISTORY`, `REMOTE`, `VERBOSE`, or `MISSING-CONSEQUENCE`.
Record one primary code and optional secondary codes in the ledger or report, never in source comments. Secondary codes describe
overlapping defects; they do not inflate totals.

## The Standard in One Method

**Illustrative shape example (not incident evidence).** This generic library helper shows selective
documentation and one consequence-bearing fallback; all facts are self-contained.

```ts
/**
 * Choose the directory where a caller's export is written.
 * Use after the caller has loaded its configured fallback.
 *
 * @param requestedDirectory - caller-selected directory; empty means use the configured fallback
 * @param fallbackDirectory - configured directory used when the caller supplies none
 * @returns selected or configured directory; never empty
 */
export function resolveExportDirectory(
  requestedDirectory: string | undefined,
  fallbackDirectory: string,
): string {
  if (requestedDirectory) return requestedDirectory;

  // No directory was selected, so the export uses the caller's configured fallback.
  return fallbackDirectory;
}
```

## Doc Comments and Tags (tiers 1 and 4)

Write doc comments where project or language canon requires them, for public/exported APIs, and for
file/module/class boundaries with a non-obvious contract; self-explanatory private/local units need none.
When a comment exists, use 1-3 description lines for a method and 3-8 for a boundary (tags
excluded): what it does, when to use it, and where it fits the reader's flow.

Reserve PHP file-level PHPDoc for classless scripts, bootstrap/config, or generated entry files; module-oriented languages use a file/module comment when that is the useful boundary.

- **Real descriptions, not restated types**, in the language's structured form (JSDoc, PHPDoc, PEP 257, godoc, rustdoc). Each tag names at least one of: what an absent or empty value causes, where the value comes from, what this unit does with it, or the constraint it must satisfy. `@param record - parsed milestone` restates the type and names none. If an admitted null/empty/absent state changes the reader outcome and code hides it, state the consequence; never invent a state.
- **Hyphen-separate each tag's subject from its description** (`@param value - parsed JSON ...`), with a **blank ` *` line between description and tags**. Use one physical line per tag. Only when the prefix passes column 100 and a meaningful description cannot fit may it use one aligned continuation line, for two physical lines maximum. Keep the complete tag subject on line one; never create a dash-only line or dangling name.
- **Pure dependency-injection constructors** may omit tags for obvious non-null services. The exemption removes tags only;
  it never removes a separately required description. A scalar, optional, configured, or side-effectful
  input is not pure DI and keeps its tag.

When a doc comment is verbose, tighten its prose while preserving every current valid tag; repair or remove only tags that no longer describe the code.

## Shape of a Comment Block

Description budgets remain 3-8 content lines for a class and 1-3 for a method; tags are separate. Bullets count as content, while blank separator lines do not. Including separators, allow at most 10 physical lines for a class and 4 physical lines for a method.

- Put one complete point per line when it fits. The applicable formatter or fallback ceiling never rewards filler; cut a nonessential clause before compressing a sentence into a fragment.
- Never use more than three consecutive prose lines. Separate distinct prose groups with a blank line.
- Use bullets only when points are genuinely enumerable. A longer block may use one or two lead lines, a blank, then one lead line and 3-5 bullets.
- Shape serves meaning: never cut a qualifier, limitation, tenancy rule, or user consequence to meet the layout.

## Context Comments (tier 3)

A branch with a reader-meaningful consequence gets one local sentence stating the trigger plus
consequence. This applies to `if`, loops, chained transformations, null/empty fallbacks, `else`,
`switch` / `case`, `match`, ternaries, and default returns. A branch whose only honest line restates
code gets none. Route a naming or placement defect through [`naming-and-placement.md`](./naming-and-placement.md)
and report or defer remedies outside the current authorization.

The line must translate, not restate; `// check if invoice is paid` is banned.
Name the acting component only when ownership or sequence changes how the reader interprets the consequence; omit it
when code already makes the actor clear.

The consequence matters, not sentence shape. Omit a line when a returned name states the outcome.
Scrutinize compound conditions, the default, and fail-closed paths; when prose is warranted, name the
product rule and user outcome instead of repeating a constant or saying "validate input".

## Catch Comments

A catch comment explains a traceable cause - a nullable getter, a throwing dependency, missing configuration, or a vendor failure allowed by contract or observed in evidence - and what the user sees next, never the catch syntax. “Could not be read” merely restates the catch; if the cause is unknown, open the call and trace what breaks before writing the line.

An intentionally unlogged catch must state why another local log adds no signal, such as an owning boundary already recording the same failure once. Silence is a reviewed choice.

## Verify Before You Assert

Before describing code behaviour, open it. Read a query's predicate before claiming its scope; compare the native type, doc comment, and property or setter before claiming nullability; walk the branch through its return; and count a list before writing a number.

Tightening inherited prose turns it into an assertion you own. Verify it before making it more confident: concise false prose is more convincing, not safer. A fluent false comment is worse than a missing one because tests and analyzers may never challenge its meaning.

If prose is false because behaviour is defective, preserve it as
`Deferred (BLOCKED-ON-BEHAVIOUR)` and route the reproduced defect; do not rewrite the bug as intent.

Identifier and placement claims are verified through [`naming-and-placement.md`](./naming-and-placement.md)
before comment work begins. Comments cannot make an unverified claim true.

## Discretionary Inline Comments (tier 5)

Extra inline comments are a last resort after authorized naming and structural work. If intent remains
hidden, one of four reasons earns a line:

- **Hidden constraint** the code cannot encode, such as a vendor or regulatory contract.
- **Subtle invariant** or coupling, naming the other side and breakage from changing only one.
- **Workaround**, naming its cause and checkable removal trigger.
- **Surprising behaviour** that is correct but looks wrong, with its consequence.

**Half-Life Test:** a good comment survives renames, extraction, and movement. Anchor it to a durable constraint, not a person, ticket, or review thread; translate provenance into the current reader reason.

## TODO / FIXME / HACK Markers

Every marker has a `YYYY-MM-DD` date or concrete trigger. Add a tracking reference only when it owns the contract, removal, or verification; otherwise state the current reason.

**Illustrative marker shape (not incident evidence).**
`// TODO: Remove this fallback once the legacy contract is retired.`

## Antipatterns

The next reader cannot use these; fix them when already editing the surrounding code.

- **Restating the mechanics.** `i++; // increment i`, `// check if invoice is paid`. Context lines must add reader meaning, not narrate syntax.
- **One sentence template for every line.** Drop what code already states.
- **Stripping valid tags while tightening.** Concision never removes a tag that still describes the code.
- **Codebase jargon.** Translate it for the selected reader.
- **Compensating prose.** A comment explaining what a better name, type, or structure would show. This
  is compensating prose, not a remedy. Make an already-authorised code change or report or defer the
  defect; the comment pass grants no structural authority.
- **Unverified rationale.** Verify `// for performance` or omit it.
- **Tombstones and non-load-bearing history.** Version deltas live in git. Keep history only when it defines a current compatibility obligation or a checkable removal trigger. Never cite gitignored paths, local state, or removed symbols.
- **Position or line-number references.** Refer by symbol name.
- **Bare suppression markers.** `// eslint-disable-next-line` with no reason is noise.
- **Non-load-bearing provenance.** PRs, issues, ADRs, task IDs, review notes - unless the reference is the durable contract, removal trigger, or verification path.
- **Counts of adjacent mutable collections.** Describe what a list or branch family is for; the reader can count it. A schema- or test-enforced count remains a valid contract.
- **Decorative density.** Comment presence is not quality evidence.
- **Markdown, emoji, and session artifacts.** Code comments are plain prose.

## Special Contexts

**Test code.** Complete applicable naming work through `naming-and-placement.md`; useful-contract doc rules apply. A descriptive test name and assertions
usually carry the story; add a comment only for a non-obvious test contract.

**Generated code.** Mark generated files at the top: `// AUTO-GENERATED FROM <source> - DO NOT EDIT`.

**Suppression with rationale.** Use the linter's native reason syntax so a checker can verify a reason is present:

```ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK response is dynamic; narrowed in the next call.
const raw: any = await client.invoke(params);
```

## Multi-Language Stance

The WHEN and WHY rules are portable; syntax is not. Defer to each language, then apply the house layout:
JSDoc for TypeScript/JavaScript, PHPDoc for PHP, PEP 257 docstrings for Python, godoc for Go and rustdoc
(`///`, `//!`) for Rust, with plain `//` or `#` inline. Shell has `#`
only; put contract details in a heredoc help block at the top of the script.

## Security

Comments ship with code and get indexed. Never include secrets, tokens, API keys, customer/patient identifiers, internal URLs, production hostnames, account IDs, or infrastructure topology; redact any found while editing. User-journey anchors describe generic users, never real people.

## Troubleshooting

**A linter rejects the house doc format.** Prefer the language's or project's native syntax. Suppress only a documented false positive, with rationale, rather than restating types.

**A branch comment feels like noise.** If the code already states the complete outcome, omit it. If a
reader consequence remains hidden, state the verified trigger and consequence once.

## Verification Gate

Before claiming comment work is done, confirm the naming route is complete and check the remaining prose. **[static]** is mechanical; **[judge]** requires semantic review.

1. **[static]+[judge] Required public/exported APIs and non-obvious file/module/class boundaries have useful doc comments.** Project or language canon decides any stronger requirement; PHP class files do not duplicate file and class PHPDoc.
2. **[judge] Consequence-bearing branches have one local trigger-and-consequence sentence; self-evident branches have none.** No context line restates mechanics or repeats one sentence template through a file.
3. **[judge] An admitted and semantically visible null/empty/absent state has its reader consequence**, and no tag invents an impossible state or disappears during tightening.
4. **[judge] Applicable naming and placement checks are complete** under `naming-and-placement.md`; comments do not compensate for a deferred defect.
5. **[judge] Verified arrival context appears only when it changes the reader's interpretation and remains hidden from code.**
6. **[judge] Discretionary inline comments satisfy one valid reason**, sit at the decision, and prefer reader-relevant rationale.
7. **[judge] Rationale and code-behaviour claims are verified**, including query scope, nullability, branches, counts, and inherited prose; they also pass the Half-Life Test.
8. **[static] TODO / FIXME / HACK markers carry an expiry** and only load-bearing tracking references.
9. **[static] No secrets, internal URLs, or production hostnames**; customer/patient identifiers may need **[judge]** review.
10. **[judge] Existing comments touched or noticed are still accurate.** Tightening an inherited claim transfers ownership.
11. **[static] Comment lines meet the project or language formatter's enforced width, or the 150-character fallback ceiling when neither defines one.** Tags and description blocks meet their physical-line limits.
12. **[static] Apply the em-dash rule above without rewriting exempt material.**

Mechanical checks locate candidates; they never override surface classification or semantic review.
A mechanical hit is a lead, not a diagnosis. Machine-readable annotations, generated regions, and
sanctioned bullet shapes are known false-positive classes. Confirm each hit before editing, with
`<width>` set to the resolved ceiling:

```bash
awk 'length><width> && /^[[:space:]]*(\/\/|\/\*|\*|#)/ && !/^[[:space:]]*\*[[:space:]]*@(phpstan|psalm|template)[-a-z]*[[:space:]]/ {print FILENAME":"FNR}' <files>
awk 'FNR==1{n=0} /^[[:space:]]*(\/\/|\*|#)[[:space:]]*([-*+]|@[[:alnum:]-]+)[[:space:]]/{n=0; next} /^[[:space:]]*(\/\/|\*|#)/ && !/^[[:space:]]*(\*\/?|\/\/|#)[[:space:]]*$/{n++; if(n==4) print FILENAME":"FNR; next} {n=0}' <files>
```

Fix a confirmed applicable failure before merging.

## Related References

- [`naming-and-placement.md`](./naming-and-placement.md) - responsibility-first placement and verified identifier claims before comment work.
- `writing-human-facing-prose.md` - comments and docstrings follow this playbook; other human-read prose follows `writing-human-facing-prose.md`.
- Sibling playbooks share the same scaffold; project instruction files may point here as the canonical comment policy.
