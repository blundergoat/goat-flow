# ADR-008: Instruction budget constraint - why 125 lines, why it matters

**Status:** Accepted
**Date:** 2026-04-06
**Updated:** 2026-05-18 - retired `docs/system-spec.md` citation retargeted to the current instruction-section successor.

## Context

Extracted from `docs/system-spec.md` (retired in v1.1.0). Current instruction-section guidance lives in `workflow/setup/reference/execution-loop.md` (search: `Target: under 125 lines. Hard limit: 150.`).

Frontier models follow ~150-200 instructions reliably. Claude Code's system prompt consumes ~50, leaving ~100-150 for CLAUDE.md. Degradation is **uniform, not sequential** - too many instructions makes the model worse at ALL of them equally, not just the ones at the bottom.

Key evidence:
- Tools mentioned in AGENTS.md are used **160x more often** than unmentioned ones (GitHub 2,500-repo analysis)
- Auto-generated context files reduce success by ~3% while increasing inference cost by 20%+ (HumanLayer)
- Code examples beat prose - higher signal per token

## Decision

CLAUDE.md (and equivalent instruction files) MUST stay under 150 lines. Target 125.

Every rule MUST apply to every session. Situation-specific guidance belongs in skills, playbooks, or local instruction files - not the hot path.

**Cut priority** (what to trim first if over target):
1. Essential commands → move to separate referenced file
2. Structural debt trigger → compress to one line
3. Communication when blocked → compress to one line
4. Sub-agent objectives → compress to two lines
5. Working memory details → compress

**Never cut:** The execution loop, autonomy tiers, or definition of done.

**Router table placement:** Position at the END of the instruction file. Research shows the beginning and end of the context window receive higher attention than the middle. The router table is the highest-leverage section (160x usage uplift) - placing it at the end exploits the end-of-context attention zone.

## Consequences

- Hard 150-line limit enforced by scanner (AP1: -3 deduction if exceeded)
- Setup templates generate instruction files targeting 125 lines
- Domain knowledge that doesn't fit moves to .goat-flow/ cold path
- Skills load on demand (not every turn), preserving budget for core behavior rules
