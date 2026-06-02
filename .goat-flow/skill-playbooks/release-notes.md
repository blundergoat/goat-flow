---
goat-flow-reference-version: "1.9.1"
---
# Release Notes

Use this when writing a per-release narrative aimed at end users: a GitHub release body, a blog post, a marketing email, an in-app "what's new" banner, or any surface where the audience needs to know *why this release matters to them*. This playbook covers HOW to source themes from the changelog, the user-impact lens for prioritising what to highlight, and how to tailor depth across multiple surfaces without contradicting the source.

For the durable in-repo `CHANGELOG.md` discipline (categories, SemVer alignment, write-at-commit cadence, breaking-change markers), see the sibling [`changelog.md`](./changelog.md). The changelog is the source of truth; release notes are a derived view.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Drafting a GitHub release description, blog post, email, or in-app "what's new" surface.
- Composing a release announcement for Slack / Discord / social / internal stakeholders.
- Reviewing release notes a teammate drafted before publish.
- A user asks "what's new in vX.Y.Z?" and the existing announcement is too thin to answer.

No availability command applies (the discipline ships with the playbook, not a tool). Some projects have a validation harness that catches a subset of release-notes defects automatically - draft-file shape checkers, version-mention parity scripts, broken-link detectors. When those exist, run them; they catch mechanical errors but not the substantive ones this playbook protects against, so they augment the **Verification Gate** below, they do not replace it.

## Intent

An end user opens release notes to answer one of three questions:

1. **Should I upgrade?** What do I get if I do, what will break if I do.
2. **Why should I care about this release?** I am evaluating the project and want to know if this release moves it toward or away from my use case.
3. **What is the headline change?** I am a downstream consumer who can only spend 30 seconds on this; tell me what matters.

If your release notes do not answer one of those for someone who has never read your commit history, they are not yet release notes - they are an extract of the changelog with the framing removed.

The customer is a future reader who has none of your context. They cannot read your `CHANGELOG.md` in full, your PR descriptions, or your internal Slack. They have your release notes - and that may be all they read before deciding to upgrade or skip.

## Changelog vs Release Notes

Two artefacts, related but distinct. Get them confused and you'll write either a wall of marketing or an unreadable ledger.

| | `changelog.md` (the file) | Release notes (this playbook) |
|---|---|---|
| Surface | `CHANGELOG.md` in repo | GitHub release body, blog post, email, in-app banner, social |
| Audience | Contributors, downstream maintainers, dependabot, humans diffing versions | End users, evaluators, decision-makers, downstream consumers |
| Lifetime | Permanent, append-only | Per-release; sometimes the same content as the changelog plus framing |
| Voice | Factual, structured, terse | Narrative-allowed, prioritised, can include a "highlights" reel |
| Required | Yes - every release | Sometimes - small patches may not warrant a separate write-up |
| Source of truth | Yes | No - sources from the changelog |
| Categories | Strict (Added / Changed / Fixed / etc.) | Loose (Highlights / Breaking changes / Other) |
| Length | Full, complete | Tailored per surface (3 bullets to 1500 words) |

If you only have time for one, write the changelog entry per [`changelog.md`](./changelog.md). Release notes can be derived from a good changelog; the inverse is much harder.

**Release notes that contradict the changelog are a bug.** Tailoring depth is allowed; tailoring facts is not. If the email says "no breaking changes" and the changelog lists one, you have shipped a documentation incident.

## Audience First

Different release-notes surfaces serve different audiences. The same release ships through multiple surfaces, tailored:

| Surface | Reader | Optimised for | Length |
|---|---|---|---|
| GitHub release body | Devs upgrading the dependency | Same content as changelog plus install snippet; markdown-rendered | Mirror changelog plus install |
| Blog post | Evaluators, late adopters, integrators | One or two themes deep with code examples; story of why this matters | 500-1500 words |
| Marketing email | Existing users on the announce list | Highlights + link to full notes | 3-5 bullets max |
| In-app "what's new" | Existing users inside the product | One headline change + a link | 1-2 sentences |
| Social (Twitter / Mastodon / Bluesky) | Wider community, casual interest | One headline + link | 1 sentence |

The rule: **tailor depth, not facts**. A short surface omits items; it does not contradict the long surface.

For multi-surface publishing, write the changelog entry first as the source. Then derive each release-notes surface by selecting and reframing - never by re-summarising from memory.

## Source: the Changelog, Not Memory

Release notes sit at the bottom of a four-link chain. Each link feeds the next; skipping a link is how facts get lost or invented.

```
diff  →  changelog (per changelog.md)  →  long-form release notes (full GitHub release / blog post)  →  shorter surfaces (email / in-app / social)
```

- **Diff repairs the changelog.** Walk the actual code changes; do not trust commit subjects (see [`changelog.md`](./changelog.md)).
- **Changelog feeds the long-form release notes.** Theme, prioritise, add user-impact framing - but every release-notes claim must trace back to a changelog entry.
- **Long-form release notes feed the shorter surfaces.** The email, in-app banner, and social post select from the long form by reducing depth; they never re-summarise from memory.

If a release-notes claim cannot be traced back to a changelog entry, one of three things is true:

1. The changelog is missing the entry - fix the changelog first (which means going back to the diff), then write the release-notes line.
2. The release-notes claim is wrong - cut it.
3. The release-notes claim is internal-only (refactor, perf without user-visible effect) and does not belong in user-facing notes - cut it.

If the project does not have a changelog yet, fix that first (see [`changelog.md`](./changelog.md)). Writing release notes without a changelog forces every reader to take your summary on faith, with no audit trail.

## Theme Identification

Group changes into user-facing themes, not by file or by commit. A theme is a cluster of changes that serve the same user need, even if they touched unrelated parts of the code.

How to find themes:

1. **Cluster by user-visible effect.** Three changelog entries that all unblock the same use case → one theme.
2. **Cluster by surface.** Five entries touching the same external API → one theme even if they fix different things.
3. **Cluster by reason.** "We had to do this because compliance" - one theme, regardless of file count.
4. **Split when audiences differ.** A perf fix and an API addition can both be "performance" - but only if a user reads them as one improvement. Otherwise split.

Bad themes (signal that you're still entry-listing):
- "Refactoring." Nobody installs a release to get refactoring.
- "Various fixes." Either name them or leave them out.
- "Code quality." Same.

Good themes (signal that you understood the user impact):
- "Windows compatibility" - regardless of how many files contributed.
- "Faster cold start" - even if the work spanned three subsystems.
- "Stricter input validation on the upload endpoint" - even if the diff is small.

A useful test: can a user reading only the theme name decide whether to read further? If not, it is not yet a theme; it is a category.

For a release with many themes, lead with the **highlight reel** - the 3-5 marquee items that pass the "would a stranger care?" test. Everything else is supporting detail.

## The User Impact Lens

Every release-notes line should pass the "so what" test. Read it as a stranger and ask "why should I care?" If the answer requires reading the changelog, rewrite for this surface.

Bad:
```
- Refactored auth middleware.
```
The reader has no idea whether this is risk, opportunity, or noise.

Good:
```
- **Single sign-on now works across subdomains.** The auth middleware was setting the cookie to the exact host rather than the parent domain. Users who left one subdomain and arrived at another were treated as logged out.
```
The reader knows what changed (effect), the symptom that proves it (so they can recognise prior pain), and roughly where (mechanism) - without needing to read the source.

Order each line as **effect first, then mechanism**. The effect is what the reader is searching for; the mechanism is the evidence that the effect is real. In long-form surfaces (blog post, full release body), the mechanism can include a file/anchor pointer so curious readers can navigate. In short surfaces (email, social), drop the mechanism and link to the full notes.

## Inverted Pyramid

Release notes use an inverted pyramid: most important first, supporting detail later, internal-only or marginal items omitted.

A typical release-notes structure:

1. **Headline** (one sentence): the most important user-facing change.
2. **Highlights** (3-5 bullets): marquee items that pass the "would a stranger care?" test.
3. **Breaking changes** (if any): top billing immediately after highlights; full migration path.
4. **Other notable changes**: secondary improvements, bug fixes worth calling out, deprecations.
5. **Upgrade instructions**: how to install, what to check after upgrade, where to file issues.
6. **Acknowledgements** (optional): contributors, reporters, downstream maintainers who helped.

Resist the urge to list everything from the changelog. The changelog is for completeness; release notes are for prioritisation. A 30-bullet release-notes post is a sign that the writer copy-pasted the changelog instead of selecting.

## Breaking Changes

Breaking changes get top billing in release notes - higher than they appear in the changelog. The changelog sorts by category; release notes sort by user impact, and "this will break your code" is the highest impact.

For every breaking change called out in release notes:

1. **Lead with the impact** ("`--legacy-format` no longer works") not the cause ("we removed a flag").
2. **Show before / after** code, config, or command - not prose-only descriptions.
3. **Estimate effort** if non-trivial ("most users replace one CLI flag; CI pipelines using the long form are unaffected").
4. **Link to migration tooling** if any (codemod, script, doc).
5. **Reference the deprecation entry** that preceded it, so users who saw the deprecation can connect the two.

If the changelog has a `BREAKING:` marker that release notes don't surface, you have buried a landmine. Every breaking change in the changelog should appear in user-facing release notes for at least the GitHub release body and the announcement email.

## Voice and Specificity

Release notes can be more narrative than the changelog, but the underlying rules still apply:

- **Active voice.** "We added X" / "X was added" → "Added X".
- **Specific names.** "Improved the dashboard" → "Plans view now reads `.goat-flow/tasks/`".
- **No marketing without numbers.** "Blazing fast" → "0.6s vs 4.3s previously" (or cut the claim).
- **No internal jargon.** "Refactored the orchestrator's reconciliation loop" → "Fewer duplicate webhook deliveries during partial outages".
- **No hedging.** "Should be faster" / "Might fix" / "Generally works" - either it shipped or it didn't. If you have to hedge, the change is not ready for release notes.

Release notes can be **longer than the changelog entry for the same change** when the audience needs context the changelog reader already has. A blog post can spend two paragraphs on a single feature; the changelog gives it one bullet. Both are correct for their surface.

Release notes can also be **shorter than the changelog** for a surface like a tweet or in-app banner. Tailoring depth is allowed; omitting breaking changes is not.

## Antipatterns

Each of these has cost a real release a real upgrade-day surprise. Don't write them; if you see them in a draft you're reviewing, fix.

- **Changelog dumps.** Copy-pasting the changelog into the GitHub release body without selection or framing is "release notes" only in the sense that it ships during a release. The reader gets no signal about what matters.
- **Marketing-only release notes.** "We're thrilled to announce" with no specifics. The reader cannot upgrade off enthusiasm.
- **Missing breaking changes.** A break that appears in the changelog but not the announcement email is a planted landmine. Reviewers MUST scan for `BREAKING:` markers and confirm each one appears in every user-facing surface.
- **Contradicting the changelog.** "No breaking changes in this release" while the changelog lists a `BREAKING:` entry. Single source of truth violation.
- **Vague upgrade instructions.** "Update and enjoy" - what about migrations, deprecations, side effects? Either name them or link to the changelog.
- **Wrong-audience jargon.** Naming internal subsystems (`HookRouter`, `ResolverV2`) in an end-user email. Internal names are signals, not communication.
- **Highlights that aren't highlighted.** Burying the marquee change in bullet 12 because the writer worked through the changelog in order instead of prioritising.
- **Future-vague.** "Coming soon", "in a future release", "we're working on" - these belong on a roadmap, not in release notes for what just shipped.
- **Acknowledgement padding.** Listing every contributor's name when the audience is end users; reserve acknowledgement sections for surfaces where it earns its place (GitHub release body, dev-targeted blog post).
- **Stale numbers.** "100x faster than version 1.0" - over multiple releases this becomes meaningless. State the baseline and the measurement that proves the claim.
- **Missing publication metadata.** Release notes without a version, date, or link to the install instructions force the reader to do extra work to act on what they just read.

## Multi-Surface Consistency

When publishing across multiple surfaces, treat the long form (full release body or full blog post) as the source. Derive shorter surfaces from it by selecting, never by re-summarising from memory.

A practical workflow:

1. **Write the changelog entry.** This is the structural source of truth - see [`changelog.md`](./changelog.md).
2. **Write the full release body** (GitHub release / blog) using the changelog as input. Theme, prioritise, add user-impact framing.
3. **Derive the email** by selecting the highlights + link to the full release body.
4. **Derive the in-app banner** by selecting the single headline + link to the full release body.
5. **Derive the social post** by selecting the single headline as a one-liner.

Each derivation reduces depth; none should contradict the source. If the email omits a breaking change because of length, that omission is the bug - either include it (length be damned) or pull the email back to "Read the release notes for migration details".

## Cadence

Release notes are written at release time, not at commit time. Even projects that use the `Unreleased` changelog cadence (see [`changelog.md`](./changelog.md)) write release notes after deciding to cut a version.

A practical timeline (compress to one sitting for fast-iteration or solo projects; the steps are the same, only the wall-clock changes):

1. **Pre-tag:** review the `Unreleased` section or diff against the prior tag. Identify themes. Draft the release-notes outline.
2. **Tag:** if the project uses write-at-commit cadence per [`changelog.md`](./changelog.md), fold the `Unreleased` section into the new version header at this step - the changelog text is already written, this step renames the heading and dates it. If the project uses write-at-release cadence, write the changelog entry now. Either way, write the GitHub release body next, mirroring the changelog plus install instructions.
3. **Post-tag:** publish derived surfaces (blog, email, social, in-app) using the release body as source.

Resist publishing release notes before the tag. A tag that doesn't match the published narrative is hard to fix without confusing readers who already acted on the early notes.

## Verification Gate

Before publishing release notes on any surface, walk these checks:

1. **Every claim traces to a changelog entry.** If a release-notes line cannot be mapped back to the changelog, either fix the changelog or cut the line.
2. **Every breaking change in the changelog appears in user-facing notes.** Highest user impact gets top billing - never bury or omit.
3. **The headline change passes the "would a stranger care?" test.** Read it as someone who has never seen the project. If the answer is "I don't know what this is", rewrite.
4. **No marketing without numbers.** "Faster", "better", "improved" - cut or replace with the measurement.
5. **No wrong-audience jargon.** Internal subsystem names, refactor descriptions, code-shape claims - cut for end-user surfaces, keep for dev-audience surfaces.
6. **Multi-surface variants do not contradict each other.** The email's "no breaking changes" must not contradict the release body's `BREAKING:` entry.
7. **Upgrade instructions are concrete.** Install command, migration path, where to file issues.
8. **Version, date, and install location are present.** A reader landing on the page should not have to search for which version this is for.
9. **A reader who has never seen this project can decide "should I upgrade?"** from the release notes alone. If they can't, the notes are still a working memo.

If any check fails, fix before publishing. Each one has been the root cause of an upgrade-day incident on some project.

## Troubleshooting

**The changelog is thin and I can't draft release notes from it.** Fix the changelog first per [`changelog.md`](./changelog.md). Release notes derived from a thin changelog will be either wrong or fluffy.

**A reviewer wants more themes than the diff supports.** Don't invent themes to fill space. A small release gets short release notes; that is the correct outcome. Padding is a tell.

**A reviewer wants fewer themes than the diff requires.** Don't drop breaking changes or material user-facing changes for narrative tidiness. If the release truly is broad, the notes are broad; pick the highlight reel and keep the rest as "Other notable changes".

**Marketing wants a different headline than the engineering changelog suggests.** Pick the user-impact framing, not the technical framing. "Faster cold start" is correct even if engineering thinks of it as "rewrote the asset bundler". Both can be true; release-notes voice picks the user-visible one.

**Two breaking changes have different migration paths.** Keep both in the breaking-changes section, each with its own before/after. Do not merge into a single "various migration changes" bullet.

**The release-notes draft contradicts the changelog.** The changelog wins. Fix the release notes; don't fix the changelog to match a draft.

**A change shipped without a changelog entry.** Add the changelog entry first (retroactively, in the correct version). Then write the release-notes line.

**An old release notes surface is now wrong because of follow-up work.** Add a "Updated:" footer linking the follow-up release, but do not silently edit the original. Readers who acted on the original should be able to see what they saw.

## Related References

- [`changelog.md`](./changelog.md) - sibling playbook for the structured in-repo `CHANGELOG.md` that release notes derive from.
- [`code-comments.md`](./code-comments.md) and [`observability.md`](./observability.md) - sibling discipline playbooks; same documentary structure.
- [keepachangelog.com](https://keepachangelog.com) - the conventional changelog format `changelog.md` assumes; release notes derive from any changelog convention.
- [semver.org](https://semver.org) - the version-bump semantics that drive when a release warrants a major announcement versus a quiet patch.
- Project's prior release announcements - the canonical example of the project's preferred release-notes voice and structure. New releases should match this voice before introducing new conventions.
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) - may declare a release-notes policy that points here as the canonical source.
