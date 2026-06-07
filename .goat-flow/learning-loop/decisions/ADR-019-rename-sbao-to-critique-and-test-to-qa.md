# ADR-019: Rename `goat-sbao` to `goat-critique` and `goat-test` to `goat-qa`

**Status:** Accepted
**Date:** 2026-04-18
**Updated:** 2026-05-18 - evidence citations converted from file-line form to semantic anchors.

## Context

The two skill names being changed had different failure modes, but both were name-body mismatches on user-facing command surfaces.

- `goat-sbao` used an acronym with almost no linguistic scaffolding at the slash-command layer. The glossary expands `SBAO` as "Signal-Based Adaptive Orchestration" and points readers at `/goat-sbao` as the standalone skill (`.goat-flow/glossary.md`), while the dispatcher and public skill guide already teach the operation as "critique" (`workflow/skills/goat/SKILL.md` route map; `docs/skills.md`). The skill body itself also teaches the workflow as critique from the opening sentence through the phase structure (`workflow/skills/goat-critique/SKILL.md`), and dashboard presets present it to users as "Critique a Plan" (`src/dashboard/preset-prompts.json`).
- `goat-test` collided with the ordinary developer meaning of "test". The skill body explicitly says it does not write test code or run full test commands (`.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`)) and repeats that prohibition in its NOT list and constraints (`.claude/skills/goat-qa/SKILL.md` (search: `NOT this skill`) and `.claude/skills/goat-qa/SKILL.md` (search: `MUST NOT generate test code`)). Its actual scope spans testing-gap analysis, audit mode, regression guards, and QA flow-diagram output (`.claude/skills/goat-qa/SKILL.md` (search: `## Regression Guard Mode`) and `.claude/skills/goat-qa/SKILL.md` (search: `## Phase 4 - Flow Diagram`)), which is broader than coverage and narrower than test execution.
- The earlier CLI rename from `critique` to `quality` removed the command-line namespace collision that would have made `/goat-critique` awkward. Commit `054bde2` (`2026-04-18`, `refactor(cli): rename \`critique\` command to \`quality\``) left `quality` as the canonical CLI subcommand and preserved `critique` only as a removal hint (`src/cli/cli.ts` (search: `"critique" was renamed to "quality"`)). That earlier rename was about making the CLI self-describing; the side effect is that `critique` is now free for a skill name.
- ADR-018 had already tightened the verification-routing claim around `goat-test`: "Testing gaps, coverage, verification planning" rather than raw "verification", plus an explicit "verify coverage" trigger (`.goat-flow/learning-loop/decisions/ADR-018-no-goat-verify-skill.md` (search: `verification planning`)). This rename continues that direction by removing the remaining over-claim embedded in the word "test" itself.
- Final shortlist convergence favored `goat-critique` for the critique skill and `goat-qa` for the testing-gap skill. The decision records the converged names and the trade-offs that beat the shortlist alternatives; it does not re-open the naming round.

## Decision

1. **Rename `goat-sbao` to `goat-critique`.** The command name now matches the vocabulary already used by the router, public docs, presets, and the skill body itself (`workflow/skills/goat/SKILL.md` route map; `docs/skills.md`; `src/dashboard/preset-prompts.json`; `workflow/skills/goat-critique/SKILL.md`). The losing criterion was preserving the mechanism or adversarial framing in the command name; sibling disambiguation from `/goat-review` stays the job of scope, artifact type, and orchestration depth, not the slash token.

2. **Rename `goat-test` to `goat-qa`.** "QA" is the only shortlisted term broad enough to cover the skill's full scope without promising execution: testing-gap analysis, audit, regression guard, and flow diagram output (`.claude/skills/goat-qa/SKILL.md` (search: `## Regression Guard Mode`) and `.claude/skills/goat-qa/SKILL.md` (search: `## Phase 4 - Flow Diagram`)). The losing criterion was maximal familiarity: status-quo `test` is familiar, but it contradicts the skill's explicit "does not run or write tests" contract (`.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`) and `.claude/skills/goat-qa/SKILL.md` (search: `MUST NOT generate test code`)).

## Consequences

- **Positive:** `/goat-critique` aligns the name with the trigger verb users already type. The router row that used to read "review vs sbao vs plan" now reads "review vs critique vs plan", which matches the user's natural verb instead of forcing them to know the acronym first (`workflow/skills/goat/SKILL.md` route map).
- **Positive:** `/goat-qa` stops over-claiming test execution. The command name no longer contradicts the skill's first-read contract and NOT list (`.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`) and `.claude/skills/goat-qa/SKILL.md` (search: `NOT this skill`)).
- **Positive:** Dashboard preset prose already uses critique-language, so the rename mostly brings command names up to the vocabulary the UI already teaches (`src/dashboard/preset-prompts.json`).
- **Negative:** Migration cost is real. The rename touches 6 skill directories across the 3-way copy structure, `workflow/manifest.json`, `workflow/install-goat-flow.sh`, `src/cli/constants.ts`, `.goat-flow/skill-docs/skill-preamble.md`, `workflow/skills/reference/skill-preamble.md`, `docs/skills.md`, `.goat-flow/glossary.md`, and `test/integration/audit-drift.test.ts` (`workflow/manifest.json` (search: `"canonical": [`); `workflow/install-goat-flow.sh` (search: `readarray -t SKILL_NAMES`); `src/cli/constants.ts` (search: `export const SKILL_NAMES`); `test/integration/audit-drift.test.ts` (search: `v1.2.0 stale names`)).
- **Negative:** Existing installations and human habits using `/goat-sbao` or `/goat-test` break immediately at the slash-command layer unless stale-name migration ships with the rename. The manifest and drift checks therefore need to treat both old names as deprecated alongside the older stale set (`workflow/manifest.json` (search: `"stale_names": [`) and `test/integration/audit-drift.test.ts` (search: `expected deprecated finding for goat-sbao`)).
- **Negative:** `/goat-qa` trades one misleading signal for a smaller one. "QA" can imply a broader ownership boundary than this skill actually has, but the skill resolves that on first read by defining itself as a testing-gap analyser rather than a generic QA owner (`.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`)).
- **Negative:** `SBAO` becomes a historical term rather than the command surface. The glossary has to decide whether that term is removed entirely or retained as historical aliasing for old docs and logs (`.goat-flow/glossary.md` (search: `| SBAO |`)).
- **Neutral:** This is a naming-only change. It does not change phases, behaviour, constraints, gates, or outputs for either skill.
- **Neutral:** The Core Trio and the critique mechanism remain intact. The skill still uses the SKEPTIC/ANALYST/STRATEGIST lens, isolated sub-agents, cross-examination, and dispute gating; only the command name changes (`.claude/skills/goat-critique/SKILL.md` (search: `SKEPTIC/ANALYST/STRATEGIST combined lens`) and `.claude/skills/goat-critique/SKILL.md` (search: `## Phase 3 - Cross-Examine`)).

## Alternatives considered

- **`goat-sbao` shortlist**
  - `/goat-panel` - rejected. It names a multi-agent mechanism but softens the disagreement-driven method in the wrong direction and has no existing vocabulary support across router, docs, glossary, or presets.
  - `/goat-challenge` - rejected. It preserves the adversarial signal better than `/goat-critique`, but the system already teaches this workflow as critique on every major user-facing surface. The semantic gain did not justify rewriting the surrounding vocabulary.
  - `/goat-crit` - rejected. It breaks the repo's whole-word naming pattern (`/goat-plan`, `/goat-review`, `/goat-debug`, `/goat-security`) and collides cognitively with the skill's own `CRITICAL` severity language.
- **`goat-test` shortlist**
  - `/goat-coverage` - rejected. It fits Audit mode's coverage analysis, but it misnames Regression Guard, Flow Diagram, and the risk-tiered testing-plan output. It also points users toward line/branch coverage tooling that this skill does not run.
  - Status quo `/goat-test` - rejected. The command name promised execution while the skill body refused it (`.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`) and `.claude/skills/goat-qa/SKILL.md` (search: `MUST NOT generate test code`)). ADR-018 could narrow the routing language, but it could not remove the name-body contradiction without this rename.

## Related decisions

- **ADR-018** - no standalone `/goat-verify` skill; verification stays routed through existing skills and shared doctrine. This ADR continues ADR-018's scope-tightening for the former `goat-test` surface (`.goat-flow/learning-loop/decisions/ADR-018-no-goat-verify-skill.md` (search: `verification planning`)).
- **ADR-011** - multi-perspective critique remains a core goat-flow feature. This rename changes the command name, not the feature's role in the system (`.goat-flow/learning-loop/decisions/ADR-011-critique-mob-core-features.md` (search: `Multi-perspective critique`)).
- **Prior CLI rename:** commit `054bde2` (`2026-04-18`) renamed the CLI subcommand `critique` to `quality`, freeing `critique` for skill use without a parallel CLI collision (`src/cli/cli.ts` (search: `"critique" was renamed to "quality"`)).

## Revisit Triggers

Open a new ADR only if one of these concrete conditions occurs after the rename ships:

1. `/goat-qa` usage shows repeated immediate correction or abandonment because users expected test execution rather than planning / analysis output.
2. goat-flow grows a real test-execution or CI-driving skill surface, forcing a fresh decision on whether `qa` should expand to include execution or cede the name.
3. Sustained user confusion persists between `/goat-critique` and `/goat-review` even after the existing NOT lists, router rows, and documentation are in place.

## References

- `.goat-flow/glossary.md` (search: `| SBAO |`)
- `workflow/skills/goat/SKILL.md` route map
- `docs/skills.md` (search: `/goat-critique`)
- `.claude/skills/goat-critique/SKILL.md` (search: `goat-critique runs in one mode`)
- `.claude/skills/goat-qa/SKILL.md` (search: `It does not write test code or run full test commands`)
- `src/dashboard/preset-prompts.json`
- `workflow/manifest.json` (search: `"canonical": [`)
- `workflow/install-goat-flow.sh` (search: `readarray -t SKILL_NAMES`)
- `src/cli/constants.ts` (search: `export const SKILL_NAMES`)
- `test/integration/audit-drift.test.ts` (search: `v1.2.0 stale names`)
- `.goat-flow/learning-loop/decisions/ADR-011-critique-mob-core-features.md`
- `.goat-flow/learning-loop/decisions/ADR-018-no-goat-verify-skill.md`
- `054bde2` (`2026-04-18`, `refactor(cli): rename \`critique\` command to \`quality\``)
