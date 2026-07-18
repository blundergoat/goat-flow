---
goat-flow-reference-version: "1.14.0"
---
# Automated-Review Overlap Protocol

Loaded by `/goat-review` in PR mode. Defines how to ingest existing
automated-reviewer findings (Copilot, CodeQL/github-advanced-security,
claude[bot], or any other repo bot) after Pass 2 records local findings,
and how to report the human-vs-automated split in Review Integrity.

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

For each automated finding, record `{ reviewer, file, line?, brief }`,
where `brief` is the first 80 chars of the inline comment body. Preserve the
comment URL when available so a disputed overlap can be checked.

If the inline-comments response succeeds with no bot-authored entries and no
known bot review claims findings, record `no-automated-review-present` in
Review Integrity and skip overlap tagging.

If the endpoint fails, pagination is incomplete, parsing loses path/body fields,
or a known bot review claims findings but no usable inline entries are returned,
flag `automated-review-uningested` in Review Integrity.

## Post-Pass-2 Overlap Tagging

Compare the recorded local findings list with the automated-review index and tag each finding:

- `[overlap:<reviewer>]` - this human finding matches a known finding in
  the automated-review index (same file, semantically similar brief).
  Example: `[overlap:copilot-pull-request-reviewer]`.
- `[new]` - this human finding does not appear in the index. Net-new
  signal from this review.

Semantic match heuristics: same `file` + Jaccard token overlap > 0.4 on
the brief, OR same `file + line` exact. False matches favor `[new]` -
better to over-attribute as net-new than to silently absorb an
automated-only finding.

## Review Integrity Surface Extension

Extend the Review Integrity surface defined in SKILL.md with this line
when in PR mode:

```
- Automated-reviewer overlap: <K> overlap with <reviewer-list>, <M> net-new
```

When no automated review: `Automated-reviewer overlap: no-automated-review-present`.
When fetch failed: include `automated-review-uningested` in Degradation flags.
Outside PR mode: omit the line entirely or write `n/a`.

## Degradation Flag

`automated-review-uningested` joins the existing flags list. Trigger when the
inline-comments endpoint or parser did not produce a complete path-bearing bot
finding index. Distinct from `no-automated-review-present`, which is the
legitimate "no bot has commented yet" state.

## Why This Surface Exists

When automated review and human/skill review run in sequence, the human
reviewer's value is the *delta*: findings the automated tools missed. A
review that silently re-flags the same Copilot findings duplicates work
and inflates the apparent review yield without adding signal.

The overlap surface makes the delta explicit. It also rewards the
automated reviewer for accurate findings (`[overlap]` is a positive
signal, not a demotion) and surfaces gaps in automated coverage that the
human review filled (`[new]` count is the per-PR review value).

## Anti-Patterns

- **Read bot conclusions before both local passes finish.** Contaminates the
  blind review and makes the local delta unknowable.
- **Silently omit overlap reporting when automated review exists.**
  Defeats the surface; presents human review as if it were standalone.
- **Mark every finding `[new]` to inflate yield.** The semantic-match
  heuristic should err toward `[new]`, but obvious overlap (same
  file+line, same word-for-word brief) is `[overlap]`.
- **Refuse to run a finding because Copilot already flagged it.**
  `[overlap]` is a tagging signal, not a suppression signal. Surface
  the finding with the tag; the reviewer's confirmation independently
  validates the automated finding.
- **Treat `automated-review-uningested` as `no-automated-review-present`.**
  They are different states with different implications.
