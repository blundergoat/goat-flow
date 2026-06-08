---
goat-flow-reference-version: "1.10.1"
---
# Automated-Review Overlap Protocol

Loaded by `/goat-review` in PR mode. Defines how to ingest existing
automated-reviewer findings (Copilot, CodeQL/github-advanced-security,
claude[bot], or any other repo bot) before Pass 1, and how to report
the human-vs-automated finding split in Review Integrity.

Borrowed from awslabs/cli-agent-orchestrator PR #245 review pattern, where
the human reviewer posted a Copilot/Manual finding tally that made the
review accountable ("Copilot 11, Manual 3, accuracy 100%").

## Ingestion

The Step 0 `gh pr view` already includes `reviews,comments` in its `--json`
field list. Parse the returned payload:

- `reviews[]` - structured review submissions; check `author.login` for
  the bot inventory below.
- `comments[]` - issue-comment-style entries on the PR; same author check.

Treat findings authored by any of these as the **automated-review index**:

- `copilot-pull-request-reviewer`
- `github-advanced-security`
- `claude[bot]` (Anthropic GitHub App)
- any other repo-specific bot the user names

For each automated finding, record `{ reviewer, file, line?, brief }`
where `brief` is the first 80 chars of the finding body. The index is the
authoritative known-findings set for the rest of the review.

If no automated reviewers commented, record `no-automated-review-present`
in Review Integrity and skip overlap tagging.

If `gh pr view` fetched the payload but parsing failed (rate-limited,
schema change, or no parsable bot entries), flag
`automated-review-uningested` in Review Integrity.

## Pass 2 Overlap Tagging

After Pass 2 produces its findings list, tag each finding:

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

`automated-review-uningested` joins the existing flags list. Trigger when
`gh pr view` returned `reviews,comments` but parsing did not produce a
usable bot finding index. Distinct from `no-automated-review-present`
which is the legitimate "no bot has commented yet" state.

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
