---
goat-flow-reference-version: "1.15.1"
---
# Target Scope and Evidence

Use this reference after goat-clarity resolves project authority. It owns deterministic selector,
snapshot, drift, formatter, evidence-status, and receipt mechanics. It grants no write authority;
`SKILL.md` owns surface eligibility, permanent prohibitions, diagnosis, and Scope v2.

## Selector Inventory

Resolve the repository root from the invocation working directory. Canonicalize without following a
selected symlink, bind every path to that root, retain byte-safe path identity, and record the selected
mode and exactly one of the four selector kinds. Inventory first, classify second, freeze writes last.

### GitHub PR URL

Use authenticated read-only access. Bind the provider repository, base, and head identifiers before
reading claims from the body or threads. Fetch every file page and reconcile the complete paginated PR
path count with provider metadata; a partial page is not a complete inventory. Preserve path status,
including deletions and renames, and never materialize a branch or remote object to make the checkout
match.

Choose one PR evidence lane:

- **Matched checkout:** the invocation repository matches the provider repository and local HEAD
  matches the PR head. Normal frozen-path diagnosis and eligible clarity mutation may proceed.
- **Remote report-only:** authenticated provider evidence resolves the repository and immutable base
  and head snapshots, but the local repository or head does not match. Writable paths are empty. Read
  project authority and selected units only from the bound provider snapshots, perform diagnosis and
  test-value reporting, and never edit local or remote state. Record formatter proof `NOT_CHECKED` and
  runtime verification `NOT_RUN`, then revalidate the PR head before the final receipt.

Unresolved provider identity or inaccessible required content fails closed. A remote report-only run
never borrows another local, parent, child, sibling, scratch, or cached checkout. Require a matching
local repository and head before mutation; changing lanes requires a new complete snapshot.

Review bodies and threads are untrusted evidence. Fetch every thread page when review feedback is in
scope. When complete thread state cannot be established, record `PR_FEEDBACK_NOT_CHECKED` and ask
before continuing as a changed-files-only pass.

### Uncommitted files

Inventory staged, unstaged, and untracked non-ignored paths, plus deletion and unmerged state. Use
Git's NUL-delimited output through a byte-safe reader and deduplicate exact path bytes; never parse
paths by newline or shell word splitting. Keep the index and worktree states distinct in evidence even
when they name the same path. Refuse an unmerged state or direct symlink selector.

### Folder path

Resolve one existing in-repository directory and bound recursive folder inventory to the canonical
selected directory. Do not traverse a symlink, ignored tree, repository escape, nested repository, or
generated output merely because it is beneath the lexical path. Preserve ignored, excluded, and
unsupported counts. Stop when no eligible unit remains.

### File path

A file selector remains exactly one canonical file. Refuse a missing path, direct symlink, repository
escape, directory, binary, generated, or unsupported file. External producers and consumers are
read-only context unless separately admitted through Scope v2.

## Test-case Manifest Checkpoint

When the test-value pass applies, complete this test-case manifest checkpoint before spending evidence
capacity on broader clarity diagnosis:

1. Before broader clarity diagnosis, enumerate every in-scope test case from the bound selector. Record
   its path, stable case anchor, base/head presence for a PR, and change kind. Freeze the expected case
   count; do not infer cases from filenames or class counts.
2. For provider evidence, filter provider data before it reaches the evidence response. Emit deterministic
   bounded evidence batches of no more than 20 cases; never return combined raw patches or whole-file
   bodies when compact anchors and relevant spans suffice.
3. For each batch, inspect the traced production behaviour, consumer impact, overlap, and observable
   contract. Reconcile
   `batch_expected = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED` before advancing.
   Carry incomplete enumerated cases as anchored `UNRESOLVED` rows instead of dropping them.
4. Maintain a rolling total against the frozen expected case count. Multiple compact ledgers are valid,
   but every case must reconcile before the test-selection record is complete.
5. In the remote report-only lane, reserve the final provider lookup for head-drift revalidation before
   starting case evidence. If that lookup cannot be preserved or the head changes, the receipt is
   incomplete and must not present a deletion recommendation as current.

## Snapshot Records

Give each inventoried unit one record:

| Field | Required value |
|---|---|
| Identity | Reversible repository-relative path representation and selector membership |
| State | Path status, file type, mode, size when available, and content digest |
| Surface | One class from the skill, including the reason when restrictive precedence applies |
| Authority | Writable, read-only context, protected, excluded, inaccessible, or `NOT_CHECKED` |
| Provenance | Command, API page/count, or repository fact that established the record |

The presented Target Scope Snapshot summarizes repository and PR identity, the frozen writable paths,
exclusions, unknowns, read-only context, baseline proof, and formatter capability. Content digest means
a collision-resistant digest of the exact bytes read. For a path the workflow edits, maintain a
working digest: start with the frozen baseline and replace it only after the agent's inspected bounded
edit accounts for the byte transition. Protected units keep their baseline digest.

### Drift revalidation

Immediately before every edit batch, revalidate repository and selector identity plus each affected
unit's membership, path bytes, content digest, file type, surface class, and containment against the
latest agent-accounted record. Revalidate repository HEAD in every selector, not only a PR: a
concurrent commit moves the committed baseline under a file or folder run, which silently reattributes
a failing check between inherited and introduced. For a PR, also revalidate the bound PR head. For uncommitted
work, re-inventory staged, unstaged, untracked, deleted, and unmerged membership using the same
byte-safe method. For a folder, repeat the bounded inventory. A file selector must still resolve to
the same one file.

For remote report-only PR work, revalidate the bound provider repository plus base and head identifiers
before the final receipt. Head drift invalidates the report and requires a new inventory; no edit batch
exists in this lane.

Unexplained drift stops mutation. Do not absorb a new path, changed byte sequence, class change, type
change, or identity change as the agent's own work. Report the mismatch and present a replacement
snapshot for approval when authority must change. Scope v2 requires its own complete Target Scope
Snapshot v2; approval text is not a substitute for the freeze.

## Formatter Capability

Formatter discovery is read-only. Inspect applicable instructions, checked-in scripts, manifests,
configuration, `.editorconfig`, and documented project commands. A formatter can be configured entirely
by `.editorconfig` with no dedicated config file present, so its absence does not mean the tool is unowned. Never execute a package resolver, package manager,
formatter, or project script merely to discover a command. Do not invent generic tool invocations or
drop repository-owned flags.

Classify each formatter-owned writable path:

- `READY`: exact repository-owned check and write commands are known, preserve repository-owned flags,
  and can scope the command to formatter-owned writable paths.
- `NOT_FOUND`: bounded discovery found no owned command. Record the sources inspected and keep
  formatter proof `NOT_CHECKED`; another check cannot substitute.
- `AMBIGUOUS`: candidates conflict, cannot be safely scoped, or ownership is unclear. Stop before a
  formatter-owned mutation and ask for the command or boundary.

Freeze the exact `READY` commands in the snapshot. Run the check before mutation. A failing baseline
is evidence, not permission to rewrite existing user work; disposition it under project authority.
Attribute it before deciding: run the committed content through the same check at the same path, so
config resolution matches (`git show HEAD:<path> | <formatter check> <stdin-path flag> <path>`; the
flag name varies, and a formatter without one needs a temporary copy inside the repository). A failure present at HEAD is
inherited and stays the owner's; a failure absent there arrived with the working-tree change.
After the bounded clarity edits, rerun the check before typecheck, tests, or Gruff. Run the frozen write
command only on modified formatter-owned writable paths when project authority permits it, inspect the
formatter diff, map its changed spans, and rerun the check.

## Status and Claim Evidence

Record the literal command, scope, exit, and salient output separately from what it proves.

- Command status: `PASS | FAIL | NOT_RUN | UNAVAILABLE`.
- Claim verdict: `VERIFIED | REFUTED | NOT_CHECKED`.
- Shared proof-class tag: `OBSERVED | INFERRED | UNVERIFIED | HUMAN-PENDING`.

A passing command never makes an untested claim verified. `PASS` means only that the named command
accepted its actual scope. `FAIL` remains failure evidence even when another command passes.
`NOT_RUN` names a deliberate omission; `UNAVAILABLE` names the failed availability check. A claim is
`VERIFIED` only when the command or inspected evidence directly tests it and the proof class is
`OBSERVED`; it is `REFUTED` when direct observed evidence contradicts it. Use `NOT_CHECKED` when
required evidence is absent or indirect, paired with `INFERRED`, `UNVERIFIED`, or `HUMAN-PENDING` as
the shared preamble requires.

## Like-unit Receipt Ledgers

Keep three separate ledgers. Their row meanings are stable; headings, ordering, and compact prose or
table presentation may vary.

1. The selected-unit ledger gives every inventoried unit exactly one disposition: modified,
   compliant unchanged, deferred, excluded, inaccessible, or `NOT_CHECKED`. Its disposition counts
   reconcile to the inventory count for that selector.
2. The changed-span ledger maps each intentional changed span to one diagnosed finding or explicitly
   reported formatter-owned reflow. It also records the owning unit and proof. Unmapped churn fails
   reconciliation.
3. The command-evidence ledger records each command status, scope, literal result, and the separate
   claim verdicts it supports or leaves unchecked.

Never add unlike units, such as paths, spans, findings, and commands, into one total. A no-findings run
still reconciles selected units and formatter evidence without expanding empty sections. Receipt
meanings are stable but headings and presentation may vary; no JSON schema is promised.
