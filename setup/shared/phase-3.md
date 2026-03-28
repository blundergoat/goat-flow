# Phase 3 — Verify & Quality Control

Complete Phase 1 and Phase 2 before starting Phase 3.

**Definition of Done: 100% on the CLI scan with zero anti-pattern deductions.**

---

```
STEP 1 - Run the scanner:
Run goat-flow scan against this project for your agent.
Review every failing check and every triggered anti-pattern.

STEP 2 - Fix failing checks:
For each failing check:
1. Read the check description and recommendation.
2. Make the minimum change to pass the check.
3. Do NOT over-engineer — fix the specific issue, not surrounding code.

STEP 3 - Fix anti-patterns:
For each triggered anti-pattern:
1. Read the anti-pattern description and evidence.
2. Apply the recommended fix.
3. Common anti-patterns:
   - AP1: Instruction file over 150 lines → compress
   - AP4: Footguns without file:line evidence → add real evidence
   - AP12: Stale file references → update paths after renames
   - AP13: Stale code references in instruction file → fix paths
   - AP14: Duplicate skill directories → remove non-goat versions
   - AP15: Outdated skill versions → update goat-flow-skill-version tag

STEP 4 - Re-scan and iterate:
Run the scanner again. If any checks still fail or anti-patterns trigger,
fix them. Repeat until the scan shows:
- Grade: A (100%)
- Foundation: 100%
- Standard: 100%
- Full: 100%
- Deductions: 0

STEP 5 - Final verification:
1. Run the project's build/test/lint commands — they MUST still pass.
   GOAT Flow setup should never break the project's existing toolchain.
2. Verify no existing files were silently deleted or emptied.
3. Review git diff — every change should be intentional.

Setup is complete when the scanner reports 100% with zero deductions
and the project's own tests still pass.
```
