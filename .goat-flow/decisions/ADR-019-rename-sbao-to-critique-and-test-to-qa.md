# ADR-019: Rename `goat-sbao` to `goat-critique` and `goat-test` to `goat-qa`

**Status:** Accepted
**Date:** 2026-04-18

## Context

The two skill names being changed had different failure modes, but both were name-body mismatches on user-facing command surfaces.

- `goat-sbao` used an acronym with almost no linguistic scaffolding at the slash-command layer. The glossary expands `SBAO` as "Signal-Based Adaptive Orchestration" and points readers at `/goat-sbao` as the standalone skill (`.goat-flow/glossary.md`), while the dispatcher and public skill guide already teach the operation as "critique" (`workflow/skills/goat/SKILL.md` route map; `docs/skills.md`). The skill body itself also teaches the workflow as critique from the opening sentence through the phase structure (`workflow/skills/goat-critique/SKILL.md`), and dashboard presets present it to users as "Critique a Plan" (`src/dashboard/preset-prompts.json`).
- `goat-test` collided with the ordinary developer meaning of "test". The skill body explicitly says it does not write test code or run full test commands (`.claude/skills/goat-qa/SKILL.md:15-19`) and repeats that prohibition in its NOT list and constraints (`.claude/skills/goat-qa/SKILL.md:28,130-139`). Its actual scope spans testing-gap analysis, audit mode, regression guards, and QA flow-diagram output (`.claude/skills/goat-qa/SKILL.md:21-28,103-126`), which is broader than coverage and narrower than test execution.
- The earlier CLI rename from `critique` to `quality` removed the command-line namespace collision that would have made `/goat-critique` awkward. Commit `054bde2` (`2026-04-18`, `refactor(cli): rename \`critique\` command to \`quality\``) left `quality` as the canonical CLI subcommand and preserved `critique` only as a removal hint (`src/cli/cli.ts:84-104`). That earlier rename was about making the CLI self-describing; the side effect is that `critique` is now free for a skill name.
- ADR-018 had already tightened the verification-routing claim around `goat-test`: "Testing gaps, coverage, verification planning" rather than raw "verification", plus an explicit "verify coverage" trigger (`.goat-flow/decisions/ADR-018-no-goat-verify-skill.md:36-48`). This rename continues that direction by removing the remaining over-claim embedded in the word "test" itself.
- Final shortlist convergence favored `goat-critique` for the critique skill and `goat-qa` for the testing-gap skill. The decision records the converged names and the trade-offs that beat the shortlist alternatives; it does not re-open the naming round.

## Decision

1. **Rename `goat-sbao` to `goat-critique`.** The command name now matches the vocabulary already used by the router, public docs, presets, and the skill body itself (`workflow/skills/goat/SKILL.md` route map; `docs/skills.md`; `src/dashboard/preset-prompts.json`; `workflow/skills/goat-critique/SKILL.md`). The losing criterion was preserving the mechanism or adversarial framing in the command name; sibling disambiguation from `/goat-review` stays the job of scope, artifact type, and orchestration depth, not the slash token.

2. **Rename `goat-test` to `goat-qa`.** "QA" is the only shortlisted term broad enough to cover the skill's full scope without promising execution: testing-gap analysis, audit, regression guard, and flow diagram output (`.claude/skills/goat-qa/SKILL.md:21-28,103-126`). The losing criterion was maximal familiarity: status-quo `test` is familiar, but it contradicts the skill's explicit "does not run or write tests" contract (`.claude/skills/goat-qa/SKILL.md:15-19,28,130-139`).

## Consequences

- **Positive:** `/goat-critique` aligns the name with the trigger verb users already type. The router row that used to read "review vs sbao vs plan" now reads "review vs critique vs plan", which matches the user's natural verb instead of forcing them to know the acronym first (`workflow/skills/goat/SKILL.md` route map).
- **Positive:** `/goat-qa` stops over-claiming test execution. The command name no longer contradicts the skill's first-read contract and NOT list (`.claude/skills/goat-qa/SKILL.md:15-19,28,130-139`).
- **Positive:** Dashboard preset prose already uses critique-language, so the rename mostly brings command names up to the vocabulary the UI already teaches (`src/dashboard/preset-prompts.json`).
- **Negative:** Migration cost is real. The rename touches 6 skill directories across the 3-way copy structure, `workflow/manifest.json`, `workflow/install-goat-flow.sh`, `src/cli/constants.ts`, `.goat-flow/skill-reference/skill-preamble.md`, `workflow/skills/reference/skill-preamble.md`, `docs/skills.md`, `.goat-flow/glossary.md`, and `test/integration/audit-drift.test.ts` (`workflow/manifest.json:44-65`; `workflow/install-goat-flow.sh:139-140`; `src/cli/constants.ts:7-15`; `test/integration/audit-drift.test.ts:159-199`).
- **Negative:** Existing installations and human habits using `/goat-sbao` or `/goat-test` break immediately at the slash-command layer unless stale-name migration ships with the rename. The manifest and drift checks therefore need to treat both old names as deprecated alongside the older stale set (`workflow/manifest.json:54-66`; `test/integration/audit-drift.test.ts:159-234`).
- **Negative:** `/goat-qa` trades one misleading signal for a smaller one. "QA" can imply a broader ownership boundary than this skill actually has, but the skill resolves that on first read by defining itself as a testing-gap analyser rather than a generic QA owner (`.claude/skills/goat-qa/SKILL.md:15-19`).
- **Negative:** `SBAO` becomes a historical term rather than the command surface. The glossary has to decide whether that term is removed entirely or retained as historical aliasing for old docs and logs (`.goat-flow/glossary.md:37-38`).
- **Neutral:** This is a naming-only change. It does not change phases, behaviour, constraints, gates, or outputs for either skill.
- **Neutral:** The Core Trio and the critique mechanism remain intact. The skill still uses the SKEPTIC/ANALYST/STRATEGIST lens, isolated sub-agents, cross-examination, and dispute gating; only the command name changes (`.claude/skills/goat-critique/SKILL.md:51-140`).

## Alternatives considered

- **`goat-sbao` shortlist**
  - `/goat-panel` - rejected. It names a multi-agent mechanism but softens the disagreement-driven method in the wrong direction and has no existing vocabulary support across router, docs, glossary, or presets.
  - `/goat-challenge` - rejected. It preserves the adversarial signal better than `/goat-critique`, but the system already teaches this workflow as critique on every major user-facing surface. The semantic gain did not justify rewriting the surrounding vocabulary.
  - `/goat-crit` - rejected. It breaks the repo's whole-word naming pattern (`/goat-plan`, `/goat-review`, `/goat-debug`, `/goat-security`) and collides cognitively with the skill's own `CRITICAL` severity language.
- **`goat-test` shortlist**
  - `/goat-coverage` - rejected. It fits Audit mode's coverage analysis, but it misnames Regression Guard, Flow Diagram, and the risk-tiered testing-plan output. It also points users toward line/branch coverage tooling that this skill does not run.
  - Status quo `/goat-test` - rejected. The command name promised execution while the skill body refused it (`.claude/skills/goat-qa/SKILL.md:15-19,28,130-139`). ADR-018 could narrow the routing language, but it could not remove the name-body contradiction without this rename.

## Related decisions

- **ADR-018** - no standalone `/goat-verify` skill; verification stays routed through existing skills and shared doctrine. This ADR continues ADR-018's scope-tightening for the former `goat-test` surface (`.goat-flow/decisions/ADR-018-no-goat-verify-skill.md:36-48`).
- **ADR-011** - multi-perspective critique remains a core goat-flow feature. This rename changes the command name, not the feature's role in the system (`.goat-flow/decisions/ADR-011-critique-mob-core-features.md:14-34`).
- **Prior CLI rename:** commit `054bde2` (`2026-04-18`) renamed the CLI subcommand `critique` to `quality`, freeing `critique` for skill use without a parallel CLI collision (`src/cli/cli.ts:84-104`).

## Revisit Triggers

Open a new ADR only if one of these concrete conditions occurs after the rename ships:

1. `/goat-qa` usage shows repeated immediate correction or abandonment because users expected test execution rather than planning / analysis output.
2. goat-flow grows a real test-execution or CI-driving skill surface, forcing a fresh decision on whether `qa` should expand to include execution or cede the name.
3. Sustained user confusion persists between `/goat-critique` and `/goat-review` even after the existing NOT lists, router rows, and documentation are in place.

## References

- `.goat-flow/glossary.md:37-40`
- `workflow/skills/goat/SKILL.md` route map
- `docs/skills.md:24,41-42,69-72`
- `.claude/skills/goat-critique/SKILL.md:15-20,44-140`
- `.claude/skills/goat-qa/SKILL.md:15-28,103-139`
- `src/dashboard/preset-prompts.json`
- `workflow/manifest.json:44-65`
- `workflow/install-goat-flow.sh:139-140`
- `src/cli/constants.ts:7-15`
- `test/integration/audit-drift.test.ts:159-199`
- `.goat-flow/decisions/ADR-011-critique-mob-core-features.md`
- `.goat-flow/decisions/ADR-018-no-goat-verify-skill.md`
- `054bde2` (`2026-04-18`, `refactor(cli): rename \`critique\` command to \`quality\``)
