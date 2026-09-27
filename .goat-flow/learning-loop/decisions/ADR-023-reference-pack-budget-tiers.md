# ADR-023: Context budgets - instruction files, skills, and reference packs

**Date:** 2026-04-20
**Status:** Accepted
**Updated:** 2026-09-05 - condensed; the measurement tables are dropped because `test/contract/skill-hardening-contracts.test.ts` (search: `ADR-023 word budget tiers`) now enforces the tiers. Earlier amendments absorbed now-removed ADR-008 (instruction budget), ADR-007 (shared conventions), and ADR-027 (no per-language packs), raised the dispatcher budget twice, and added the line-density guard and the scorer window.

## Context

The skill-quality checklist once pinned one reference-pack budget of 400 words per file while the three shipped shared files measured 977, 1181, and 3893 words. Four consecutive quality reports on 2026-04-20 flagged the same MAJOR finding. The single budget conflated two load patterns: always-loaded shared content that every skill reads on invocation, and progressive reference packs read only when a skill enters a specific mode. A 400-word cap suits the second and starves the first.

The same scarcity governs the hot path. Instruction files load every session, so a rule that applies to some sessions costs all of them, and content duplicated inline across skills pays once per skill and drifts once per skill. Between 2026-04-20 and 2026-05-17 the preamble grew 52% with nothing catching it, which is why enforcement moved into contract tests.

## Decision

Every agent-read surface has a tier budget, and instruction files stay under 150 lines with every rule applying to every session.

**Instruction files (hot path).** `CLAUDE.md` and its peers stay under 150 lines, target 125. No physical line exceeds 800 characters; the line ceiling does not excuse compressing unrelated rules into one scan-resistant paragraph. Situation-specific guidance belongs in skills, playbooks, or local instruction files. When over target, cut in this order: essential commands to a referenced file, then the structural-debt trigger, communication-when-blocked, sub-agent objectives, and working-memory details. Never cut the execution loop, autonomy tiers, or definition of done. The Router Table sits last, where end-of-context attention is highest.

**Skills and reference packs.**

| Tier | Budget | Applies to |
| --- | --- | --- |
| Dispatcher skill | ≤600 words | `goat/SKILL.md` |
| Functional skill | <2500 words | the seven functional `goat-*/SKILL.md` files |
| Always-loaded shared content | <1500 words per file | `skill-preamble.md`, `skill-conventions.md` |
| Progressive reference pack | <3000 words per file | per-skill `references/`, `.goat-flow/skill-docs/skill-quality-testing/`, `.goat-flow/skill-docs/playbooks/` |

The budget rule lives in `.goat-flow/skill-docs/skill-quality-testing/deployment.md` (search: `Token budget met per the four-tier model`). The former monolith is a short README index plus three topical files: `tdd-iteration.md` for authoring or hardening a discipline skill, `adversarial-framing.md` for review-class skills, and `deployment.md` for finalising any skill. Authors load only the file their skill type needs.

**Shared conventions, extracted once.** Conventions live in `.goat-flow/skill-docs/skill-conventions.md`, copied from `workflow/skills/reference/skill-conventions.md`. Each skill carries a pointer header, not a fallback:

```
## Shared Conventions

Read `.goat-flow/skill-docs/skill-preamble.md` for shared conventions.
On full-depth, also read `.goat-flow/skill-docs/skill-conventions.md`.
Universal constraints from `skill-preamble.md` apply.
```

No inline fallback ships. Seven lines could not keep a skill coherent because the preamble and conventions carry interlocking rules, so audit validates file presence instead. The flush-protocol rule (tick completed checkboxes before continuing when working from a milestone) is maintained once in the conventions layer.

**No per-language packs.** goat-plan derives language from project structure rather than shipping a reference pack per layer.

**Dispatcher raises.** 500 to 555 on 2026-05-02 for the Route Snapshot contract and contract-pinned phrases. 555 to 600 on 2026-08-18, when a missing `goat-clarity` route row let clarity requests fall through to `/goat-review` or direct execution while the file sat at 554 of 555 words. A third raise should prompt restructuring instead.

**Scorer window.** The quality scorer's composition window is 128 KiB, below the 256 KiB per-artifact ceiling, because 32 KiB truncated six functional skills. Runtime guidance is authoritative: a skill must not omit a binding shared layer or disguise a reference path to fit the evaluator.

## Failure Mode Comparison

| Option | What fails | Verdict |
| --- | --- | --- |
| One budget raised to 4000 words | Always-loaded files pay full cost every invocation with no discipline; authoring references drift upward | Rejected |
| Exempt shared files from any budget | Unbounded growth on every skill run | Rejected |
| Keep 400 words and split into many files | One-paragraph files fragment the method across hops | Rejected |
| Inline conventions fallback in every skill | Seven lines cannot carry interlocking rules; presence validation replaced it | Rejected |
| Four tiers by load pattern, enforced by contract tests | Adding a hot-path rule is zero-sum against 150 lines | Accepted |

## Consequences

- Drift plumbing carries the three topical files: `scripts/preflight-checks.sh`, the `SHARED_ARTIFACT_MIRRORS` registry in `src/cli/audit/artifact-templates.ts`, `workflow/install-goat-flow.sh`, `workflow/manifest.json`, and the artifact-integrity and preamble-sync tests. `src/cli/audit/check-content-quality.ts` lints them.
- A topical file that exceeds 3000 words splits further under the same model; `tdd-iteration.md` is the one to watch.
