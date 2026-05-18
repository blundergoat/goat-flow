# ADR-007: Extract shared skill conventions to .goat-flow/skill-reference/skill-conventions.md

**Status:** Accepted
**Updated:** 2026-05-18 - repaired historical references to now-removed `ADR-023-expand-inline-conventions.md`, `ADR-011-shared-conventions-keep-inline.md`, and `ADR-024-flush-protocol-checkbox-enforcement.md`; 2026-04-19 revision still applies.
**Date:** 2026-04-06

## Context

The now-removed `ADR-011-shared-conventions-keep-inline.md` (2026-03-28) chose to keep shared conventions inline in each skill template for self-containment. At 12 lines per skill, the duplication cost was acceptable. The now-removed `ADR-023-expand-inline-conventions.md` (2026-04-04) expanded the inline block from 12 to 62 lines, preserving the self-containment principle while closing content gaps (recovery, working memory, autonomy awareness, closing protocol).

By v1.1.0, the shared conventions had grown to 152 lines. With the functional skills across three agent directories (`.claude/skills/`, `.agents/skills/`, `.github/skills/`), this produced thousands of lines of duplicated content. The drift check - the only mechanism preventing divergence - could not keep pace with the maintenance burden. The duplication surface was now actively causing the drift it was designed to prevent.

One more pressure in the same chain came from the now-removed `ADR-024-flush-protocol-checkbox-enforcement.md`: the same checkbox-ticking failure recurred twice in four days, and the fix was to push another behavioural rule into the shared conventions. That solved the immediate failure, but it made the "keep everything inline" approach even more expensive to maintain.

## Decision

Extract shared conventions from inline in each skill to a single file: `.goat-flow/skill-reference/skill-conventions.md`. Setup copies this from `workflow/skills/reference/skill-conventions.md`.

Each skill keeps a short header that points to the shared file. It is a pointer, not a fallback:

```
## Shared Conventions

Read `.goat-flow/skill-reference/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-reference/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.
```

**No inline fallback ships.** An earlier draft of this ADR specified a 7-line essentials-only fallback intended to let skills degrade gracefully if the shared file were missing. In practice the installed skills never embedded that fallback, and testing showed it did not provide enough behaviour to keep a skill coherent - the preamble/conventions files carry interlocking rules (Proof Gate, severity, evidence, routing, gates, task tracking) that cannot be usefully summarised in seven lines. Instead, skill-reference file presence is validated directly by the audit ("Preamble/Conventions Sync" and structural checks), so a missing file is caught at install time, not masked by a partial fallback.

The flush protocol guidance introduced during the now-removed `ADR-024-flush-protocol-checkbox-enforcement.md` incident stays in the shared conventions layer after extraction:

- when the flush protocol fires and the agent is working from a milestone file, it must tick completed checkboxes before continuing
- that requirement is now maintained once in the shared conventions instead of copied through every skill variant

## Consequences

- Skills are no longer fully self-contained - they require one external file read at invocation.
- A missing `skill-conventions.md` or `skill-preamble.md` degrades skill behaviour rather than being masked by a partial fallback; the audit's sync/parity checks catch the absence at install time.
- Updates to shared conventions are 1 template edit plus a sync step to installed copies, validated by preflight's Preamble/Conventions Sync and Skill SKILL.md Parity checks.
- The drift surface drops from thousands of duplicated lines to the pointer header, which is stable.
- Behavioural fixes like the checkbox-ticking flush rule stop creating another round of large copy-edit sweeps across every skill template.
