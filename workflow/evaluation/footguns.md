# Prompt: Create or Seed docs/footguns.md

Paste this into your coding agent to create or update the footguns file. Footguns are architectural landmines - cross-domain coupling points where changing one thing silently breaks another.

---

## The Prompt

```
Create or update docs/footguns.md for this project.

IF docs/footguns.md already exists:
  MERGE with it. Keep ALL existing entries intact. Read the codebase
  and add NEW footguns discovered from reading the code. Do NOT replace,
  remove, or rewrite existing entries.

IF docs/footguns.md does NOT exist:
  Create it and seed with REAL footguns found by reading the codebase.

WHAT TO LOOK FOR:
- Cross-domain coupling (changing file A silently breaks file B)
- Shared state that multiple components depend on
- Import order dependencies
- Silent failure paths (errors swallowed, no logging, no user feedback)
- Configuration that affects multiple components
- Files that MUST change together (coupled by convention, not by code)
- Database/API contracts where both sides must match
- Environment variables used across multiple services
- Shared source files (scripts that are sourced by multiple parents)

FORMAT - every entry MUST follow this structure:

# Footguns

## [descriptive title]
**Files:** `path/to/file.ext:NN`, `path/to/other.ext:NN`
**Risk:** [what breaks and why - be specific]
**Mitigation:** [how to avoid triggering it]

Every entry added by the agent must include this flag at the start:
> [!WARNING] AI-GENERATED: UNVERIFIED
The human removes this flag after reviewing the entry. CI will fail
if this flag exists on the main branch.

Every footgun entry must include a `**Created:** YYYY-MM-DD` line.
This enables CI staleness detection (entries not triggered in 90+ days
are candidates for archival during quarterly shrink).

RULES:
- Every entry MUST include file:line evidence pointing to REAL code
- Do NOT invent hypothetical footguns
- Do NOT include general best practices ("always test your code")
- Every footgun must be SPECIFIC to THIS codebase
- Footguns without file:line evidence are treated as fabricated
  (anti-pattern AP4, -3 scoring deduction)

PROPAGATION:
After creating footguns, check if any map to specific directories.
If a directory has 2+ footgun entries, note this - a local CLAUDE.md
file may be needed for that directory (Layer 2 local context).

VERIFICATION:
- Verify docs/footguns.md exists
- Verify every entry has file:line references (grep for file patterns)
- If merged with existing: verify no entries were removed or overwritten
- Count entries and report
- Report any directories with 2+ footgun entries (candidates for
  local CLAUDE.md files)
```
