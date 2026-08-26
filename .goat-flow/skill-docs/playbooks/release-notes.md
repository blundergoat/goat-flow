---
goat-flow-reference-version: "1.16.0"
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

## Project Authority

An authoritative project release-note policy controls the chosen surface, voice, structure, and required notices. If no such project standard exists, fall back to this playbook's defaults. Active instructions and the project's authoritative hierarchy still rank higher. Those lower layers must not weaken safety, accepted architecture, verified facts, evidence requirements, or verification gates.

## Prose Routing

This playbook owns audience, evidence selection, output surface, and release-note shape. Set those here, then apply [`writing-human-facing-prose.md`](./writing-human-facing-prose.md) as the core prose pass.

Load [`writing-structure-diagnostics.md`](./writing-structure-diagnostics.md) only when a document-level assembly defect remains, and [`writing-sentence-diagnostics.md`](./writing-sentence-diagnostics.md) only when a sentence-level reader cost remains. If both apply, repair structure first. Diagnostics may refine admitted prose but never add or remove release facts, change version attribution, or expand the write scope.

## Intent

You are a coding agent producing or reviewing a release artifact. Your job is to turn verified changelog evidence into the shortest useful user-facing release notes.

A reader opens release notes to decide: should I upgrade, what matters to me, and what might break? They may never read the changelog.

Agents default verbose. Counter that deliberately: draft the accurate version, then cut about half the words. Preserve headline impact, breaking changes, upgrade steps, measurements, and links; remove launch-copy, duplicated changelog detail, and implementation trivia.

## Audience Gate

The primary reader is the person who uses, calls, operates, or upgrades the shipped product. Select the interface they actually touch: CLI, API, library, service, runtime, installer, configuration, or UI. Do not invent a UI or consumer workflow for a library, command, or operator surface.

Include a change only when that reader receives or experiences it. Let them find the affected surface, consequence, risk, and required action in one scan. Internal-only work is excluded unless it changes user behaviour or release safety.

Preserve exact public flags, config keys, versions, errors, measurements, and migration commands. Audience selection changes framing and depth, never the verified facts.

## Output Provenance

Release notes are derived, not invented:

```text
diff -> changelog -> release notes -> shorter surfaces
```

Rules:

- A changed surface can prove the ledger is incomplete; use it to correct the changelog, not to bypass it.
- If that correction is within the approved write scope, make it first. If it is outside the approved write scope, stop publication, report the ledger gap, and request scope expansion.
- Every release-note claim must trace to the corrected changelog.
- If a claim is internal-only, cut it.
- If release notes and changelog conflict, resolve the fact against verified release evidence and correct the changelog before drafting the notes.
- Do not summarize from memory.
- Record the release version, evidence baseline, and requested output surface in working evidence; the published copy need not narrate that process.
- Derive shorter variants from the verified full notes so email, in-app, and social outputs share provenance.

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
- For each selected change, lead with effect, then consequence, then required action when one exists. Add mechanism only when it helps trust or action.
- Use plain English and short sentences.
- Prefer bullets over paragraphs.
- Say "Fixed duplicate search results", not "Refactored search reconciliation".
- Say "Search results now load 3x faster", not "Improved performance".
- Name a visible regression or limitation plainly; do not hide it behind a positive theme.
- Do not use "excited to announce", "game-changing", "powerful", or other launch-copy.
- Do not name internal classes, files, or subsystems for end-user surfaces.

Bad: "Refactored auth middleware." Good: "**Single sign-on works across subdomains.** Users no longer get logged out between app subdomains."

## Length Fallback

The requested release surface and the project's established style own length. When the project or release surface owns no different shape, use one physical line and 150 characters as a fallback for an ordinary highlight. Short surfaces may reduce selection, but they may not distort a selected fact.

Cut launch-copy, repeated changelog context, and internal mechanism first. Never generalise an exact public flag, config key, version, error, measurement, migration command, visible regression, or caveat to meet the fallback. Breaking impact and required action may use a second line or dedicated section.

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

A draft that loses half its words without losing a fact was too verbose. That is a diagnosis after the cut, not a target: the drafting agent is the only reader who can see the original, so the binding limits are the Surface Rules and the Length Fallback.

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

1. Every claim traces to the corrected changelog, and working evidence names the version, baseline, and surface.
2. Every breaking change appears clearly and early.
3. The Audience Gate identifies the real product reader and interface; no internal-only item slipped through.
4. No marketing without measurements.
5. No internal jargon on end-user surfaces.
6. Multi-surface variants do not contradict each other.
7. Upgrade instructions are concrete.
8. Version, date, and install/update location are present in the copy or authoritative publication metadata.
9. A reader can decide whether to upgrade without reading commit history.
10. The compression pass ran.
11. Selected changes lead with effect, consequence, and required action while preserving visible regressions and exact public detail.
12. The Length Fallback was used only when no project or surface shape controlled.

## Troubleshooting

- **Thin or missing changelog:** follow **Output Provenance**; correct it when in scope, otherwise stop publication and report the ledger gap.
- **Too long or polished:** cut wrapper prose, duplicate context, and internal mechanism before changing facts.
- **Different headline requested:** use user impact, not internal implementation framing.

## Related References

- [`changelog.md`](./changelog.md) - source-of-truth release ledger.
- [`writing-human-facing-prose.md`](./writing-human-facing-prose.md) - core correctness and diagnostic routing after audience and selection are settled.
- [`writing-structure-diagnostics.md`](./writing-structure-diagnostics.md) - optional document-level assembly diagnosis before sentence work.
- [`writing-sentence-diagnostics.md`](./writing-sentence-diagnostics.md) - optional sentence-level diagnosis after structure is sound.
- Project's prior release announcements - match voice and structure before inventing a new one.
- Project instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) may declare release-note policy.
