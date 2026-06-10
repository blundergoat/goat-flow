---
goat-flow-reference-version: "1.11.0"
---
# Release Notes

Use this when writing a user-facing release announcement: GitHub release body, app-store notes, email, in-app "what's new", or short social copy. For the durable in-repo change ledger, load [`changelog.md`](./changelog.md) first.

## Availability Check

This is a discipline reference, not a runnable tool. Load it when:

- Drafting release notes or a release announcement.
- Turning a changelog into user-facing highlights.
- Reviewing release notes before publish.
- Answering "what's new in vX.Y.Z?"

No availability command applies. If the project has draft-shape, link, or version checks, run them; they augment the **Verification Gate** and do not replace it.

## Intent

You are a coding agent producing or reviewing a release artifact. Your job is to turn verified changelog evidence into the shortest useful user-facing release notes.

A reader opens release notes to decide: should I upgrade, what matters to me, and what might break? They may never read the changelog.

Agents default verbose. Counter that deliberately: draft the accurate version, then cut about half the words. Preserve headline impact, breaking changes, upgrade steps, measurements, and links; remove launch-copy, duplicated changelog detail, and implementation trivia.

## Source Chain

Release notes are derived, not invented:

```text
diff -> changelog -> release notes -> shorter surfaces
```

Rules:

- Fix the changelog first if it is missing a shipped change.
- Every release-note claim must trace to the changelog or a verified changed surface.
- If a claim is internal-only, cut it.
- If the release notes contradict the changelog, the changelog wins.
- Do not summarize from memory.

The useful signal order mirrors changelog work: PRs/issues, tests, changed product surfaces, diff, config/dependency changes, then commit messages last.

## Default Output

If the user does not name a surface, write a concise GitHub release body: title, one-sentence headline, 3-5 highlights, breaking changes if any, and upgrade instructions. Do not write a blog-style introduction unless asked.

## Selection Rules

- Lead with the change a stranger would care about.
- Group by user benefit, not commit, file, or category.
- Keep only material user-facing changes.
- Include all breaking changes, even if the short surface has room for little else.
- Skip refactors, tests, CI, dependency bumps, and internal cleanup unless users see the result.
- If there are many changes, make a highlight reel and put the rest under "Other notable changes".

Theme names must help a user decide whether to read further. Good: "Windows install fixes", "Faster cold start", "Stricter upload validation". Bad: "Refactoring", "Various fixes", "Code quality".

## Writing Rules

- Write for users, not implementers.
- Lead with effect, then add mechanism only when it helps trust or action.
- Use plain English and short sentences.
- Prefer bullets over paragraphs.
- Say "Fixed duplicate search results", not "Refactored search reconciliation".
- Say "Search results now load 3x faster", not "Improved performance".
- Do not use "excited to announce", "game-changing", "powerful", or other launch-copy.
- Do not name internal classes, files, or subsystems for end-user surfaces.

Bad: "Refactored auth middleware." Good: "**Single sign-on works across subdomains.** Users no longer get logged out between app subdomains."

## Breaking Changes

Breaking changes get top billing. For each one:

1. Lead with user impact.
2. Show before/after command, config, or code when useful.
3. Estimate migration effort if non-trivial.
4. Link to migration tooling or docs.
5. Reference prior deprecation if there was one.

If the changelog has `BREAKING:` and release notes omit it, the notes are unsafe to publish.

## Surface Rules

Default shapes: GitHub release = headline, 3-5 highlights, breaks, upgrade; app/in-app = headline plus 1-3 bullets; email = 3-5 bullets plus link; social = one headline plus link; blog = only when asked.

Tailor depth, not facts. Short surfaces may omit secondary changes, but must not hide breaking changes or contradict the full notes.

## Compression Pass

Before publishing:

1. Delete launch-copy and throat-clearing.
2. Delete repeated changelog detail.
3. Delete implementation trivia.
4. Split long sentences; keep one idea per sentence.
5. Keep non-breaking highlights to one sentence unless a second sentence carries measurement, migration note, or user-visible caveat.

The default release body should be about half the first agent draft.

## Antipatterns

- **Changelog dump:** no selection or framing.
- **Marketing-only notes:** enthusiasm without facts.
- **Missing breaks:** breaking change buried or omitted.
- **Wrong audience:** internal subsystem names in user-facing copy.
- **Vague upgrade:** "update and enjoy".
- **Future-vague:** "coming soon" in notes for what shipped.
- **Acknowledgement padding:** names that do not help the release reader.
- **Agent launch-copy bloat:** wrapper prose that hides the user impact.

## Verification Gate

Before publishing:

1. Every claim traces to the changelog or verified diff evidence.
2. Every breaking change appears clearly and early.
3. The headline passes "would a stranger care?"
4. No marketing without measurements.
5. No internal jargon on end-user surfaces.
6. Multi-surface variants do not contradict each other.
7. Upgrade instructions are concrete.
8. Version, date, and install/update location are present.
9. A reader can decide whether to upgrade without reading commit history.
10. The compression pass ran.

## Troubleshooting

- **Thin changelog:** fix it first; release notes from a weak changelog become guesswork.
- **Too long or polished:** cut about half before changing facts.
- **Different headline requested:** use user impact, not internal implementation framing.
- **Missing changelog entry:** add it first, then write the release-note line.

## Related References

- [`changelog.md`](./changelog.md) - source-of-truth release ledger.
- Project's prior release announcements - match voice and structure before inventing a new one.
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) may declare release-note policy.
