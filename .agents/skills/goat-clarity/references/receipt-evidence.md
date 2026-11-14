---
goat-flow-reference-version: "1.19.0"
---
# Receipt Evidence

## Status and Claim Evidence

Record the literal command, scope, exit, and salient output separately from what it proves.

- Command status: `PASS | FAIL | NOT_RUN | UNAVAILABLE`.
- Claim verdict: `VERIFIED | REFUTED | NOT_CHECKED`.
- Shared evidence quality: `OBSERVED | INFERRED | UNVERIFIED | HUMAN-PENDING`.
- Shared proof class: `RUNTIME | CONTRACT-GREP | STATIC | NOT-REPRODUCED`.

Evidence quality states how certain the evidence is; proof class states the method that produced
it. A claim carries both.

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
`VERIFIED` only when the command or inspected evidence directly tests it and the evidence quality is
`OBSERVED`; it is `REFUTED` when direct observed evidence contradicts it. Use `NOT_CHECKED` when
required evidence is absent or indirect, paired with `INFERRED`, `UNVERIFIED`, or `HUMAN-PENDING` as
the shared preamble requires.

## Like-unit Receipt Ledgers

Keep three separate ledgers.

1. The selected-unit ledger retains surface and write classification, then gives every inventoried unit exactly one terminal outcome.
   Write-classification totals and terminal-outcome totals independently equal the same inventory; they are separate axes, not matching label buckets.
   Excluded units may aggregate only when deterministic membership and their exclusive class total remain recorded.
2. The changed-span ledger maps each intentional changed span to one diagnosed finding or explicitly
   reported formatter-owned reflow. It may aggregate spans by file and diagnosed rule only after
   symbol-level evidence maps every member span. Unmapped churn fails reconciliation.
3. The command-evidence ledger records each command status, scope, literal result, proof class, and
   the separate claim verdicts it supports or leaves unchecked.

| Terminal outcome | Required evidence and eligible membership |
|---|---|
| Modified | An authorized diagnosed edit in a writable unit |
| Compliant unchanged | Compliant unchanged requires an applicable clarity assessment with no finding; read-only human prose may be assessed without write permission |
| Deferred | A supported finding whose remedy requires permission or another workflow; selected read-only human prose may carry findings |
| Preserved protected | Preserved protected requires a byte comparison; clarity assessment stays `NOT_CHECKED`; applies to protected or context-only units |
| Excluded | Excluded membership only; never substitute this for selected read-only/protected units |
| Inaccessible | The selected unit could not be read |
| `NOT_CHECKED` | Required assessment, identity or preservation evidence is incomplete; name the gap instead of implying compliance |

Never add unlike units, such as paths, spans, findings, and commands, into one total. A no-findings run
still reconciles selected units and formatter evidence without expanding empty sections. Receipt
meanings are stable but headings and presentation may vary; no JSON schema is promised.

Every diff, attribution, analyzer, formatter, and residue command must be scoped to the frozen writable
paths or an explicitly named read-only evidence set. Never report an unscoped worktree total as this
run's change set.

Qualifying modified human-prose units map once to the existing `Meaning audit:` field; detailed comparisons stay in the current unit/change ledgers. Minimal edits and unchanged prose require no detailed audit.
