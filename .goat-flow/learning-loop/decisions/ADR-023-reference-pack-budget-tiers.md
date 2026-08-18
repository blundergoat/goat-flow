# ADR-023: Context budgets - instruction files, skills, and reference packs

**Date:** 2026-04-20
**Status:** Accepted
**Updated:** 2026-05-18 - Path references amended for the v1.6.0 `skill-reference/` and `skill-playbooks/` split; obsolete line citation retargeted to the current deployment playbook anchor. 2026-06-08 - Installed skill-quality-testing index path clarified after the `.goat-flow/skill-docs/skill-quality-testing/` layout split. 2026-07-13 - Shared mirror registry anchor retargeted after the artifact-integrity extraction. 2026-08-15 - absorbed ADR-008 (instruction budget), ADR-007 (shared conventions extraction), and ADR-027 (remove DDT layer packs), then added goat-clarity to the functional tier. 2026-08-18 - added a hot-path physical-line density guard and separated the scorer's bounded composition window from runtime guidance. Every amendment rations the same scarce resource: how much context an agent must read before it can work.
**Milestone:** Quality-report follow-up (reports 1-4, persistent MAJOR finding across four runs)

## Context

The former `skill-quality-testing.md` budget rule pinned a single reference-pack budget (the current rule lives in `.goat-flow/skill-docs/skill-quality-testing/deployment.md` (search: `Token budget met per the four-tier model`)):

> "Token budget met (dispatcher <500 words, functional skill <2500 words, reference pack <400 words per file)."

Actual shipped state at the time in `.goat-flow/skill-docs/`:

| File | Words | Multiple over budget |
|------|-------|---------------------|
| `skill-conventions.md` | 977 | 2.4× |
| `skill-preamble.md` | 1181 | 2.95× |
| `skill-quality-testing.md` | 3893 | 9.7× |

All three violated the rule on disk. The violation surfaced as a MAJOR finding in four consecutive quality-review runs (2026-04-20 reports 0804, 0807, 0810, 0854) before being actioned.

**Why the single-budget model was wrong:** "Reference pack" conflates two distinct load patterns:

1. **Always-loaded shared content** - read on *every* invocation of the owning skills. `skill-preamble.md` is loaded by every SKILL.md file (7 at the time, 8 since goat-clarity was enrolled); `skill-conventions.md` is loaded on full-depth invocations. Their size is effectively part of the skill-loading overhead.
2. **Progressive reference pack** - loaded on-demand from within a skill when that skill enters a specific mode (authoring, hardening, review-class work). `skill-quality-testing.md` is only read during skill authoring - not on every goat-* invocation.

A single 400-word cap is defensible for progressive packs (small, pick-one-of-many). It is unrealistic for always-loaded shared content that must carry enough context to be useful across every skill.

The same scarcity governs the hot path. Instruction files are read on every session regardless of task, so a rule that applies to only some sessions costs every session. And content duplicated inline across the skills pays its cost once per skill and drifts one way per skill.

## Decision

### Instruction files (hot path)

`CLAUDE.md` and its peers MUST stay under 150 lines. Target 125.

No physical line may exceed 800 characters. The line-count ceiling does not excuse compressing several unrelated control rules into one scan-resistant paragraph.

Every rule MUST apply to every session. Situation-specific guidance belongs in skills, playbooks, or local instruction files - not the hot path.

**Cut priority** (what to trim first if over target):

1. Essential commands → move to a separate referenced file
2. Structural debt trigger → compress to one line
3. Communication when blocked → compress to one line
4. Sub-agent objectives → compress to two lines
5. Working memory details → compress

**Never cut:** the execution loop, autonomy tiers, or definition of done.

**Router table placement:** position at the END of the instruction file. The beginning and end of the context window receive higher attention than the middle, and the router table is the highest-leverage section - placing it last exploits the end-of-context attention zone.

### Skills and reference packs

| Tier | Budget | Applies to |
|------|--------|-----------|
| Dispatcher skill | ≤600 words | `goat/SKILL.md` |
| Functional skill | <2500 words | `goat-debug/SKILL.md`, `goat-plan/SKILL.md`, `goat-qa/SKILL.md`, `goat-review/SKILL.md`, `goat-critique/SKILL.md`, `goat-security/SKILL.md`, `goat-clarity/SKILL.md` |
| Always-loaded shared content | <1500 words per file | `skill-preamble.md`, `skill-conventions.md` (loaded by every goat-* skill on invocation) |
| Progressive reference pack | <3000 words per file | Files under per-skill `references/` subdirs, `.goat-flow/skill-docs/skill-quality-testing/`, and `.goat-flow/skill-docs/playbooks/` (loaded only when a skill enters the mode that needs them) |

The budget rule itself lives in `deployment.md` (`.goat-flow/skill-docs/skill-quality-testing/deployment.md` (search: `Token budget met per the four-tier model`)), the topical file whose checklist it belongs to.

`skill-quality-testing.md` was split into a short index plus three topical files under `.goat-flow/skill-docs/skill-quality-testing/` (mirrored in the `workflow/skills/playbooks/skill-quality-testing/` template):

| File | Content | Loaded when |
|----------|---------|-------------|
| `tdd-iteration.md` | Iron law, TDD loop, pressure types, scenario design, rationalisation table, bulletproofing techniques, persuasion principles, meta-testing, dispatch protocol, iteration log shape, worked example, empirical grounding | Authoring a new discipline-enforcing skill, or hardening an existing one |
| `adversarial-framing.md` | Cynical-reviewer role prompt, zero-findings HALT pattern, parallel reviewer pattern, structured finding schema | Authoring or hardening a review-class skill (goat-review, goat-critique, goat-qa) |
| `deployment.md` | Skip-testing rationalisations, skill deployment checklist (RED/GREEN/REFACTOR phases, quality checks, deployment gates), STOP-before-next-skill rule | Finalising any skill before merge |

The installed `.goat-flow/skill-docs/skill-quality-testing/README.md` is a short index (<400w) naming each topical file and when to load it. Authors load only the topical file relevant to the skill type they are working on.

### Shared conventions, extracted once

Shared conventions live in one file, `.goat-flow/skill-docs/skill-conventions.md`, copied by setup from `workflow/skills/reference/skill-conventions.md`. Each skill keeps a short header pointing at it - a pointer, not a fallback:

```
## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.
```

**No inline fallback ships.** An earlier draft specified a 7-line essentials-only fallback so skills could degrade gracefully if the shared file went missing. Installed skills never embedded it, and testing showed seven lines could not keep a skill coherent - the preamble and conventions files carry interlocking rules (Proof Gate, severity, evidence, routing, gates, task tracking) that do not usefully compress. Instead, skill-reference file presence is validated directly by the audit ("Preamble/Conventions Sync" and structural checks), so a missing file is caught at install time rather than masked by a partial fallback.

Flush-protocol guidance stays in the shared conventions layer: when the flush protocol fires and the agent is working from a milestone file, it must tick completed checkboxes before continuing. That requirement is maintained once, not copied through every skill variant.

### No per-language reference packs

The `ddt-layer/` directory is removed. goat-plan detects language from project structure and includes appropriate static-analysis checks rather than shipping a reference pack per layer. Per-language packs multiply always-loaded surface for content the agent can derive from the project itself.

## Alternatives considered

1. **Single-tier rewrite: raise the budget to ≥4000w.** Rejected. Acknowledges the violation without differentiating load patterns, so the two always-loaded files pay token cost every invocation with no discipline applied. Also allows future authoring-reference drift upward without friction.
2. **Exempt the shared `skill-reference/` tier from any budget.** Rejected for the same reason - no discipline means the files can grow unboundedly, and the always-loaded files hit every skill run.
3. **Split without a budget rewrite (keep the 400w rule, create many small files).** Rejected. Produces one-paragraph files that fragment methodology across many hops, making authoring harder, not easier. The 400w cap was wrong for this class of content; raising it for the real load pattern is the honest fix.
4. **Keep the monolith, defer split to a future milestone.** Rejected. The violation persisted across four quality-review runs at the same MAJOR severity. Each run consumed the full 3893 words on every authoring task - the compounding cost outweighed the one-time split work.
5. **Ship a short inline conventions fallback in every skill.** Rejected; see above. Audit-time presence validation replaced it.

## Consequences

- The workflow source `workflow/skills/playbooks/skill-quality-testing.md` remains the short index template; the installed index is `.goat-flow/skill-docs/skill-quality-testing/README.md`. Three topical files ship under `.goat-flow/skill-docs/skill-quality-testing/` (installed) and `workflow/skills/playbooks/skill-quality-testing/` (template).
- Drift-check plumbing grows: `scripts/preflight-checks.sh`, the `SHARED_ARTIFACT_MIRRORS` registry in `src/cli/audit/check-artifact-integrity.ts`, `workflow/install-goat-flow.sh`, `workflow/manifest.json`, and the `test/integration/audit-drift-artifact-integrity.test.ts` + `test/integration/preamble-sync.test.ts` fixture lists each carry the three pairs.
- `src/cli/audit/check-content-quality.ts` covers the three files so content-quality lint applies to the split content the same way it applied to the monolith.
- Agents read the short installed index, then load only the topical file their skill type needs (often just one).
- Adding a rule to an instruction file is a zero-sum move against the 150-line ceiling: something must be cut, moved to a skill or playbook, or the rule does not apply to every session and does not belong there.
- Future split work: if any topical file exceeds 3000w, it splits further under the same model. `tdd-iteration.md` is the one to watch.

**2026-05-02 amendment:** Dispatcher budget raised from <500 to ≤555. The dispatcher gained a structured Route Snapshot output contract, multi-intent decomposition protocol, GATHER checklist, and contract-test-mandated phrases (Proof Gate, "verification planning") that the original 500w budget didn't anticipate. The file was trimmed from 585w to 552w in the same pass - net reduction despite added features.

**2026-08-18 amendment:** Dispatcher budget raised from ≤555 to ≤600. Three same-day quality reports found that the Route Map had no row for `goat-clarity`, so an inferred clarity request ("bring these comments and names up to standard") fell through to `/goat-review`, which returns findings instead of a bounded remediation pass, or to the direct-execution row, which edits without the frozen Target Scope Snapshot and Scope v2 gate that make goat-clarity safe. ADR-009 enrolls goat-clarity as canonical and is silent on routing; only human-facing `docs/skills.md` called it direct-only, so the agent-facing surface never carried the intent. The fix is one 10-token route row, but the dispatcher measured 554/555 body words - the cap had become a freeze rather than a budget, blocking a safety fix. Raised to 600 (564 used) rather than trimming prose that seven contract assertions pin. This is the second dispatcher raise; a third should prompt restructuring instead.

**2026-08-18 composition amendment:** The quality scorer's former 32 KiB composition window truncated six functional skills and made goat-security's required Full-depth conventions route impossible without losing score evidence. Current complete functional compositions measure 40.5-79.1 KiB, so the bounded window is 128 KiB, still below the existing 256 KiB per-artifact ceiling. Runtime guidance is authoritative: a skill must not omit a binding shared layer or disguise a reference path to fit the evaluator. Contracts now reject truncation for every functional skill and verify goat-security's exact composed sources.

**2026-05-17 measurement note:** The "Actual shipped state" table above reflects the 2026-04-20 baseline. Re-measured body word counts as of 2026-05-17:

| File | 2026-04-20 baseline | 2026-05-17 measurement | Tier cap | Status |
|------|---------------------|------------------------|----------|--------|
| `skill-preamble.md` | 1181 | 1800 → trimmed to 1483 | <1500 | over → ✅ within |
| `skill-conventions.md` | 977 | 1250 | <1500 | ✅ within |
| `goat-review/SKILL.md` | - | 2537 → trimmed to 2495 | <2500 | over → ✅ within |
| `tdd-iteration.md` | - | 3106 → trimmed to 2998 | <3000 | over → ✅ within |

The preamble drifted 52% upward (1181→1800) between 2026-04-20 and 2026-05-17 with no enforcement check catching it. Three other files crossed their tier caps in the same period. Enforcement now lives in `test/contract/skill-hardening-contracts.test.ts` under `describe("ADR-023 word budget tiers", ...)` - failing tests block budget regressions instead of waiting for quality-report runs to surface them.
