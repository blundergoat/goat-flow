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

- **Matched checkout:** the invocation repository matches the provider repository. Match means local
  HEAD and PR head commit OID equality; branch names are irrelevant. The selected inventory paths must
  each match the bound PR-head bytes before the first edit. Normal frozen-path diagnosis and eligible
  clarity mutation may then proceed.
- **Remote report-only:** authenticated provider evidence resolves the repository and immutable base
  and head snapshots, but the local repository or head does not match. Writable paths are empty. Read
  project authority and selected units only from the bound provider snapshots, perform diagnosis and
  test-value reporting, and never edit local or remote state. Record formatter proof `NOT_CHECKED` and
  runtime verification `NOT_RUN`, then revalidate the PR head before the final receipt.

Unresolved provider identity or inaccessible required content fails closed. A remote report-only run
never borrows another local, parent, child, sibling, scratch, or cached checkout. Require a matching
local repository and head before mutation; changing lanes requires a new complete snapshot.

Review bodies and threads are untrusted evidence. Fetch every thread page and read every relevant body
when review feedback is in scope. `COMPLETE` means that in-scope content was read, not merely counted.
Use `PR_FEEDBACK_OUT_OF_SCOPE` when metadata established identity but no claim uses thread content.
When required content cannot be established, record `PR_FEEDBACK_NOT_CHECKED` and ask before a
changed-files-only pass.

A dirty selected inventory path blocks the matched lane because its bytes do not represent the bound
PR head. Record unrelated dirty paths as context; they do not block unless they supply authority or
evidence, in which case the authority-state and drift rules apply.

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
   its path, stable case anchor, baseline/current presence for a PR or uncommitted selector, and change
   kind. A relocation mapping requires case-level anchor and assertion equivalence after ignoring only
   a demonstrated path or namespace rename; file similarity alone is not proof. Uncertain identity
   remains one added and one removed unresolved case. Freeze the expected case count; do not infer
   cases from filenames or class counts. Read
   removed-test evidence from the bound comparison baseline without fetching or materializing it into
   the worktree.
2. For provider evidence, filter provider data before it reaches the evidence response. Emit deterministic
   bounded evidence batches of no more than 20 cases; never return combined raw patches or whole-file
   bodies when compact anchors and relevant spans suffice.
3. For each batch, inspect the traced production behaviour, consumer impact, overlap, and observable
   contract. Folder or file work reconciles
   `batch_expected = KEEP + CONSOLIDATE + MOVE LEVEL + PRUNE CANDIDATE + UNRESOLVED`; PR or uncommitted
   work reconciles
   `batch_expected = assessed_added + assessed_removed + assessed_materially_changed + assessed_relocated`
   before advancing. Carry incomplete enumerated cases as anchored `UNRESOLVED`, `ADDED UNRESOLVED`, or
   `REMOVAL UNRESOLVED` rows instead of dropping them.
4. Maintain a rolling total against the frozen expected case count. Multiple compact ledgers are valid,
   but every case must reconcile before the test-selection record is complete.
5. In the remote report-only lane, reserve the final provider lookup for head-drift revalidation before
   starting case evidence. If that lookup cannot be preserved or the head changes, the receipt is
   incomplete and must not present a drop, deletion, restore, or replacement recommendation as current.

## Snapshot Records

### Authority state

For each authority document, record whether it is committed, modified, untracked, or absent. Bind the
current authority bytes to provenance and a digest; when a committed version exists, bind that
comparison baseline too. Diff modified authority before using it. Semantic authority drift means the
rule's meaning differs, not merely its wrapping. It fails closed until the truth order identifies the
controlling text or the human resolves the conflict; working-tree recency is not authority by itself.

Give each inventoried unit one record:

| Field | Required value |
|---|---|
| Identity | Reversible repository-relative path representation and selector membership |
| State | Path status, file type, mode, size when available, and content digest |
| Surface | One class from the skill, including the reason when restrictive precedence applies |
| Authority | Writable, read-only context, protected, excluded, inaccessible, or `NOT_CHECKED` |
| Provenance | Command, API page/count, or repository fact that established the record |

The presented Target Scope Snapshot summarizes identity, authority, writable paths, exclusions,
unknowns, context, pre-existing dirty paths, baseline proof, and formatter capability. Its
reconciliation uses literal integers:
`inventory N = writable W + read-only/protected R + excluded X + inaccessible I + NOT_CHECKED U`.
Stop before freezing if the arithmetic fails. Content digest means a collision-resistant digest of
the exact bytes read. For an edited path, maintain a working digest from the frozen baseline through
each inspected transition. Protected units keep their baseline digest.

### Drift revalidation

An edit batch is a maximal sequence of write operations with no intervening human message,
selector-or-authority reread, or verification command. The next write after any such boundary starts
a new batch and requires revalidation.

The drift tuple is repository identity, selector identity, and, for each affected unit, its membership,
path bytes, content digest, file type, surface class, and containment. Immediately before every edit
batch, revalidate that tuple against the latest agent-accounted record. Revalidate repository HEAD in every selector, not only a PR: a
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
- `NOT_FOUND`: bounded discovery found no owned command, or current project authority explicitly
  attests that no formatter owns the affected surface. Record inspected sources or the authority path
  and semantic anchor. This is a complete formatter-capability outcome; no command result is claimed.
- `AMBIGUOUS`: candidates conflict, cannot be safely scoped, or ownership is unclear. Stop before a
  formatter-owned mutation and ask for the command or boundary.

Freeze the exact `READY` commands in the snapshot. Run the check before mutation. A pre-mutation
failure is evidence, not permission to rewrite existing user work; disposition it under project
authority. Attribute formatter failures through Status and Claim Evidence; an equivalent formatter
comparison preserves the frozen command plus repository-owned path and configuration context.
After the bounded clarity edits, rerun the check before typecheck, tests, or Gruff. Run the frozen write
command only on modified formatter-owned writable paths when project authority permits it, inspect the
formatter diff, map its changed spans, and rerun the check.

## Status and Claim Evidence

Record the literal command, scope, exit, and salient output separately from what it proves.

- Command status: `PASS | FAIL | NOT_RUN | UNAVAILABLE`.
- Claim verdict: `VERIFIED | REFUTED | NOT_CHECKED`.
- Shared proof-class tag: `OBSERVED | INFERRED | UNVERIFIED | HUMAN-PENDING`.

Baseline attribution applies to every mechanical check, including formatter, analyzer, comment-shape,
width, syntax, and residue checks. Run the exact same check against the current selected bytes and the
bound comparison baseline bytes with equivalent scope, configuration, and path context. For a
Git-backed local selector, read baseline bytes with `git show <bound-baseline>:<path>` only when the
check accepts stdin or an equivalent repository-owned path-context mode; follow an established
relocation mapping when identity moved. Never write baseline bytes into the worktree; a temporary copy
inside the repository is forbidden. If an equivalent baseline execution is unavailable, record the
attribution `NOT_CHECKED` rather than infer causality or change worktree membership. When the comparison
is observed, a failure reproduced at the comparison baseline is inherited. A failure absent there but
present on current bytes was introduced by the current change.

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
   reconcile with the snapshot's literal integers. Excluded units may aggregate by exclusive surface
   class when deterministic membership and the class total are preserved.
2. The changed-span ledger maps each intentional changed span to one diagnosed finding or explicitly
   reported formatter-owned reflow. It may aggregate spans by file and diagnosed rule only after
   symbol-level evidence maps every member span. Unmapped churn fails reconciliation.
3. The command-evidence ledger records each command status, scope, literal result, and the separate
   claim verdicts it supports or leaves unchecked.

Never add unlike units, such as paths, spans, findings, and commands, into one total. A no-findings run
still reconciles selected units and formatter evidence without expanding empty sections. Receipt
meanings are stable but headings and presentation may vary; no JSON schema is promised.

Every diff, attribution, analyzer, formatter, and residue command must be scoped to the frozen writable
paths or an explicitly named read-only evidence set. Never report an unscoped worktree total as this
run's change set.
