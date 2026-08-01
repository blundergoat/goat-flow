---
goat-flow-reference-version: "1.14.0"
---
# Automated-Review Overlap Protocol

Loaded by `/goat-review` in PR mode. Defines how to ingest existing
automated-reviewer findings (Copilot, CodeQL/github-advanced-security,
claude[bot], or any other repo bot) after Pass 2 records local findings,
and how to report human/automated provenance in Review Integrity.

Borrowed from awslabs/cli-agent-orchestrator PR #245 review pattern, where
the human reviewer posted a Copilot/Manual finding tally that made the
review accountable ("Copilot 11, Manual 3, accuracy 100%").

## Post-Pass-2 Ingestion

Record the complete local findings list before fetching automated-review conclusions.
Do not revise or suppress that list after seeing bot output. Step 0 provides the
PR URL and number but deliberately omits review and comment bodies.

After the local list is recorded, fetch review submissions and issue-level comments:

```bash
gh pr view <ref> --json reviews,comments
```

This payload still omits the path-bearing inline review comments needed for overlap.

Resolve `<owner>/<repo>` and `<number>` from the PR URL and number, then
fetch every inline review comment:

```bash
gh api --paginate 'repos/<owner>/<repo>/pulls/<number>/comments?per_page=100'
```

The `pulls/<number>/comments` response is the authoritative known-findings set;
each entry exposes `.user.login`, `.path`, `.line` or `.original_line`,
and `.body`. Use `reviews[]` only to detect reviewer participation or summary
claims; never manufacture file positions from review summaries. Use
`comments[]` only as issue-level context.

Normalize known GitHub identities before matching:

- `Copilot` and `copilot-pull-request-reviewer` -> `copilot-pull-request-reviewer`
- `github-advanced-security[bot]` and `github-advanced-security` -> `github-advanced-security`
- `claude[bot]` -> `claude`
- any other repo-specific bot the user names -> its stable login

For each automated finding, record `{ reviewer, file, line?, brief, symbol?, ruleId?, category?, rootCause? }`,
where `brief` is the first 80 chars of the inline comment body. Preserve the
comment URL when available so a disputed overlap can be checked.

If the inline-comments response succeeds with no bot-authored entries and no
known bot review claims findings, record `no-automated-review-present` in
Review Integrity and skip overlap tagging.

If the endpoint fails, pagination is incomplete, parsing loses path/body fields,
or a known bot review claims findings but no usable inline entries are returned,
flag `automated-review-uningested` in Review Integrity.

## Post-Pass-2 Overlap Tagging

Keep the pre-ingestion local list immutable. Reconcile it with the automated index using four provenance classes:

- `overlap-confirmed:<reviewer>` - a pre-ingestion local finding and bot finding describe the same root cause; keep the local finding and tag the confirming reviewer.
- `local-only` - a local finding has no bot match; report it under "Local findings every bot missed."
- `bot-only-locally-verified:<reviewer>` - no pre-ingestion local match; Pass 2 independently verifies it, so it enters Findings with bot provenance; never present it as independent discovery.
- `disputed-match:<reviewer>` - location or wording overlaps but the evidence cannot prove one root cause; keep both records visible and explain the dispute.

For a bot-only candidate, rerun the normal Pass 2 evidence procedure: open the full file, try to disprove the claim, establish reachability, and assign evidence/proof tags. Only `bot-only-locally-verified` enters Findings. An unverified bot-only item remains in the reconciliation annex; it never becomes a local finding.

### Matching Hierarchy

Compare in this order: symbol, rule ID, category, root cause, line range, then token similarity on the normalized brief. File equality is a prerequisite, not proof of one defect. The same line with different root causes stays two findings. When confidence is insufficient, preserve the existing err-toward-`[new]` bias: use `local-only` plus `disputed-match` rather than merging. Never suppress a finding as overlap.

Report both deltas explicitly: "Automated findings the local review missed" lists verified bot-only IDs; "Local findings every bot missed" lists local-only R-IDs. `overlap-confirmed` is confirmation, not independent local yield.

## Review Integrity Surface Extension

Extend the Review Integrity surface defined in SKILL.md with this line when in PR mode:

```
- Automated-review provenance: overlap-confirmed=<K>, local-only=<L>, bot-only-locally-verified=<B>, disputed-match=<D>; automated findings the local review missed: <IDs|none>; local findings every bot missed: <R-IDs|none>
```

When no automated review: `Automated-review provenance: no-automated-review-present`.
When fetch failed: include `automated-review-uningested` in Degradation flags.
Outside PR mode: omit the line entirely or write `n/a`.

## Degradation Flag

`automated-review-uningested` joins the existing flags list. Trigger when the
inline-comments endpoint or parser did not produce a complete path-bearing bot
finding index. Distinct from `no-automated-review-present`, which is the
legitimate "no bot has commented yet" state.

## Why This Surface Exists

When automated and local review run in sequence, provenance must distinguish independent local discovery from later local verification. The four-way surface exposes both missed-finding sets without hiding confirmed overlap or crediting a bot lead as independent discovery.

## Anti-Patterns

- **Read bot conclusions before both local passes finish.** Contaminates the
  blind review and makes the local delta unknowable.
- **Silently omit overlap reporting when automated review exists.**
  Defeats the surface; presents human review as if it were standalone.
- **Mark every finding `local-only` to inflate yield.** The matcher errs toward separate records when evidence is weak, but a hierarchy-confirmed shared root is `overlap-confirmed`.
- **Refuse to run a finding because Copilot already flagged it.**
  Provenance is not suppression. Verify the claim, then surface it under the matching class.
- **Treat `automated-review-uningested` as `no-automated-review-present`.**
  They are different states with different implications.
