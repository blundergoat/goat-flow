# Skill Preamble

All goat-* skills read this preamble on every invocation. For full-depth work,
also read `skill-conventions.md`.

---

## Execution Loop Integration

When a goat-* skill is active, the skill's Step 0 satisfies READ/SCOPE. Resume the loop at ACT.

## Severity Scale

SECURITY > CORRECTNESS > INTEGRATION > PERFORMANCE > STYLE

Order findings by severity, not by file or discovery order.

## Evidence Standard

- Every finding MUST include file evidence — either `file:line` when the specific line demonstrates the issue, or `file` when the trap is file-level. Path-only evidence is valid when a line number would be fabricated.
- MUST NOT fabricate file paths, function names, or artifact content
- Before presenting findings, re-read each cited `file:line` to confirm accuracy
- Tag evidence quality: **OBSERVED** (directly verified in code) vs **INFERRED** (deduced but not directly confirmed — state what direct evidence is missing)
- If you cannot re-read the cited evidence before responding, mark the claim **UNVERIFIED**
- Before citing a function or symbol name, verify it exists with a repo search
- Before citing a CLI flag, verify it with `--help` or the command's docs
- Before citing a config key, read the actual config file first

## Depth Choice

- **Quick:** compressed workflow, minimal ceremony, direct output
- **Full:** all phases, SBAO/Mob if planning, full output format
- If arriving from the dispatcher with depth already chosen, skip the depth question

## Learning Loop

After completing the skill, check if this run uncovered anything worth logging:
- Behavioural mistake → `## Lesson:` entry in `.goat-flow/lessons/` category bucket
- Successful repeatable approach → `## Pattern:` entry in `.goat-flow/patterns.md`
- Architectural trap with file evidence → `## Footgun:` entry in `.goat-flow/footguns/` category bucket

## Human Gates

- **BLOCKING GATE** — stop and wait for human decision. Used for: scope approval, phase transitions, final review.
- **CHECKPOINT** — present status and continue unless interrupted.
