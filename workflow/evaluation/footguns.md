# Prompt: Create or Seed docs/footguns/

Paste this into your coding agent to create or update the footguns file.
Footguns are codebase-specific traps where a local-looking change breaks a
different part of the system through hidden coupling or stale assumptions.

---

## The Prompt

```
Create or update `docs/footguns/` for this project.

Each footgun is one markdown file (for example: `docs/footguns/2026-03-31-short-title.md`).

IF docs/footguns/ already exists:
  MERGE with it carefully. Keep existing confirmed entries unless newer
  evidence shows the footgun is resolved. Prefer appending a Status note
  over deleting history.

IF docs/footguns/ does NOT exist:
  Create the directory and seed with one file per real, code-proven footgun.

WHAT TO LOOK FOR:
- Cross-domain coupling where changing file A silently breaks file B
- Contracts duplicated across docs, templates, parser/scanner layers, or APIs
- Shared configuration that multiple surfaces depend on differently
- Files that MUST change together even though the code does not enforce it
- Rename/move hazards, path assumptions, generated-output drift
- Multi-step setup or rendering flows where a second code path bypasses
  the normal invariants
- Any trap proven by the repo itself, not by general best practice

FORMAT - every entry MUST follow this structure:

---
name: [descriptive title]
status: active
created: YYYY-MM-DD
evidence_type: ACTUAL_MEASURED
---

# Footgun Entry

## Footgun: [descriptive title]
**Evidence type:** ACTUAL_MEASURED
**Symptoms:** [what a human sees go wrong]
**Why it happens:** [the hidden coupling or drift]
**Evidence:**
- `path/to/file.ext` → [what this file contains that demonstrates the trap]
- `path/to/other.ext` → [what this file contains]
**Prevention:** [how to avoid or verify against it]
**Created:** YYYY-MM-DD

If the trap is no longer active but still matters as history, keep the
entry and add:
**Status:** RESOLVED - [short reason]

RULES:
- Every entry MUST include file path evidence pointing to REAL code. Line numbers are optional historical context.
- Do NOT invent hypothetical footguns
- Do NOT include generic advice like "write tests" or "review carefully"
- Every footgun must be SPECIFIC to THIS codebase
- New entries should describe the smallest useful trap, not a vague theme
- If two entries are actually the same trap, merge them instead of creating
  near-duplicate titles

PROPAGATION:
After creating footguns, check if any map to specific directories.
If a directory has 2+ footgun entries, note this - a local CLAUDE.md
file may be needed for that directory (Layer 2 local context).

VERIFICATION:
- Verify docs/footguns/ exists
- Verify every entry has file path references under Evidence
- Verify every new entry has Evidence type, Symptoms, Why it happens,
  Prevention, and Created
- If merged with existing: verify no confirmed entry was removed without
  an explicit reason
- Report the count of total entries and new entries added
- Report any directories with 2+ footgun entries as candidates for local
  instruction files
```
