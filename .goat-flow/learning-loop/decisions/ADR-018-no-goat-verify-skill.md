# ADR-018: No standalone goat-verify skill; use shared Proof Gate

**Status:** Implemented
**Date:** 2026-04-18
**Updated:** 2026-05-18 - evidence citations converted from file-line form to semantic anchors.
**Updated:** 2026-05-27 - Runtime slot updated per ADR-030; four-agent references now read Claude, Codex, Antigravity, and Copilot.

## Context

During the v1.1.x review cycle the question arose whether goat-flow should add an 8th canonical skill called `goat-verify` to own verification / completion-claim discipline across the goat-* skills. Five independent analysis passes (one self, four external agents) were run over the same brief. Options considered:

1. Build standalone canonical `goat-verify` installed by default.
2. Do not build; add a shared Proof Gate to `skill-preamble.md` and patch existing skills.
3. Stage: shared gate now, promote to standalone skill only if duplication pressure persists.
4. Optional / non-canonical `goat-verify` outside the install set.

All 5 analyses converged on rejecting option 1. Evidence:

- Verification is already a first-class framework concern on the hot path (`AGENTS.md` (search: `Hallucination red-flags`) + `AGENTS.md` (search: `MUST confirm ALL`)) and in cold-path shared doctrine (`.goat-flow/skill-docs/skill-preamble.md` (search: `## Evidence Standard`)).
- Per-skill gates are domain-specific and heterogeneous by design: goat-debug confidence (HIGH/MEDIUM/LOW = reproduced/traced/inferred), goat-security confidence (CONFIRMED/PROBABLE/THEORETICAL), goat-review severity tags `[MUST/SHOULD/MAY:patch/needs-decision]`, goat-plan per-milestone testing gates, goat-qa must/should/skip tiers. Collapsing them into a generic verifier would destroy information tuned to different consumers.
- There is no cross-skill verification routing today - each gate is bespoke and self-contained. A new routed skill would have no clean trigger space distinct from `/goat-debug` (bug-fix verification), `/goat-review` (diff/PR verification), `/goat-qa` (coverage verification), or the DoD, violating the CSO rule in `.goat-flow/glossary.md` (search: `field must be trigger-only`).
- Prior ADRs establish precedent against this pattern:
  - **ADR-009** (skill consolidation) - new skills must have a distinct artifact or failure mode.
  - **ADR-005** (no implementation skill) - rejected the goat-doer / goat-verifier split; verification must come from fresh review/test invocations, not an artificial verifier layer over the same work.
  - **ADR-002** (replace preflight with security skill) - rejected "glorified checklist skill" in favour of strengthening real enforcement surfaces.
  - Prior v1.1.0 cleanup already established the relevant pattern: duplicated always-on rules belong in `skill-preamble.md`, not in a separate always-loaded file such as the retired `RULES.md`.
  - **ADR-009** (skill consolidation doctrine) - repo trends toward fewer skills, not more, and new skills must justify their existence.
- Measured blast radius of a new canonical skill: 3 hardcoded surfaces (`workflow/install-goat-flow.sh` (search: `readarray -t SKILL_NAMES`), `src/cli/constants.ts` (search: `export const SKILL_NAMES`), `workflow/manifest.json` (search: `"canonical": [`)), plus audit-drift test coverage (`test/integration/audit-drift.test.ts` (search: `for (const name of SKILL_NAMES)`)), plus installed-copy parity (`.goat-flow/learning-loop/footguns/skills.md` (search: `punctuation-only edits`) documents real drift incidents that proved parity is not free).

External pattern mining (superpowers/verification-before-completion, systematic-debugging, BMAD review decomposition, Archon debug/plan, claude-mem make-plan) yielded importable content for existing surfaces, not justification for a new skill. `SuperClaude_Framework/confidence-check` (>=90% numeric gate) was rejected across all 5 analyses as incompatible with goat-flow's evidence-over-hedges culture - a numeric confidence score is itself a hedge forbidden by `AGENTS.md` (search: `Hedged claims`).

## Decision

1. **No standalone `goat-verify` skill.** Skill count stays at 7. `workflow/manifest.json`, `src/cli/constants.ts`, `workflow/install-goat-flow.sh`, and the canonical-skill drift coverage in `test/integration/audit-drift.test.ts` (search: `for (const name of SKILL_NAMES)`) stay unchanged.

2. **Shared Proof Gate in the preamble.** Add a `## Proof Gate` section to `workflow/skills/reference/skill-preamble.md` (and installed copy `.goat-flow/skill-docs/skill-preamble.md`) after `## Evidence Standard`. The Proof Gate names the positive procedure (Identify → Run fresh → Read → Verify → Cite) that substantiates claims. It is the complement to the 5 hallucination red-flags, which name the violations.

3. **Routing hygiene - stop goat-qa from over-claiming "verify".** Update the dispatcher route map from "Testing gaps, coverage, verification → /goat-qa" to "Testing gaps, coverage, verification planning → /goat-qa". Update `goat-qa/SKILL.md` quick-mode trigger from `"verify"` to `"verify coverage"`. Add explicit redirection lines in `goat-qa`'s "NOT this skill" block: bug-fix verification → `/goat-debug`, diff/PR verification → `/goat-review`, completion certification → Proof Gate. The route map now lives in `workflow/skills/goat/SKILL.md`; `skill-preamble.md` keeps the shared Proof Gate and universal guidance only.

4. **One-line Proof Gate reference at each skill's primary claim-making moment.** Add a short reference to the Proof Gate in each of the 7 skills' handoff / BLOCKING GATE / DoD / milestone-close positions so the reminder fires pedagogically, not only as inherited policy.

5. **Targeted imports into `goat-debug`** (not a new skill):
   - Multi-component boundary instrumentation in D1 (from `superpowers/systematic-debugging:72-107`).
   - Causation / Necessity / Sufficiency validation gate and 5-Whys-with-file-evidence in D2 (from historical external Archon debug/plan material).
   - 3-fix abort rule and rerun-original-repro requirement in D4 (from `superpowers/systematic-debugging:195-213`).
   - Proof Gate reference in D4.

6. **Capture the one genuinely new behavioural insight as a lesson.** Rationalization anti-patterns ("Confidence ≠ evidence", "Just this once", "Partial check is enough", etc.) go into `.goat-flow/learning-loop/lessons/verification.md` as a new `## Lesson:` entry. This is the excuse-pattern catalog the red-flags do not explicitly enumerate.

7. **Deterministic text-contract tests.** Extend `test/integration/preamble-sync.test.ts` to assert the `## Proof Gate` heading exists in both preamble copies. Keep route-map and skill-hardening coverage pinned to the surviving contract surfaces: goat-qa trigger does not claim raw `"verify"`; the `/goat` dispatcher route map says "verification planning"; every canonical skill references "Proof Gate".

## Consequences

- **Blast radius contained.** No canonical-skill-count changes. No edits to `workflow/install-goat-flow.sh`, `src/cli/constants.ts`, `workflow/manifest.json`, or canonical-skill drift coverage in `test/integration/audit-drift.test.ts` (search: `for (const name of SKILL_NAMES)`). The 3 hardest drift surfaces stay untouched.
- **Hot/cold path distinction preserved.** Hot path (`AGENTS.md`) remains within its 150-line budget (`.goat-flow/learning-loop/decisions/ADR-008-instruction-budget-constraint.md` (search: `MUST stay under 150 lines`)). Cold-path shared doctrine (`skill-preamble.md`) absorbs the new Proof Gate following the existing shared-preamble pattern, while dispatcher-only routing stays in `/goat`.
- **Verification discipline strengthens without routing complexity.** Every skill's output moment is governed by the Proof Gate via inheritance plus an explicit one-line reference, while each skill retains domain-specific gate semantics (confidence scales, severity tags, testing gates).
- **Rollback is trivial.** Revert the preamble Proof Gate section, the one-line references in 7 skills, the goat-debug domain patches, the lesson entry, and this ADR. No persisted state (config, manifest, constants) to unwind. Single `git revert` discharges the change.

## Revisit Triggers

Open a new ADR to promote to standalone `goat-verify` only if, after this rollout has shipped and been used for at least one release cycle:

1. Three or more recurring completion-without-evidence incidents occur that the red-flags and Proof Gate together did not catch (logged as entries in `.goat-flow/learning-loop/lessons/verification.md`).
2. Three or more distinct skills independently develop a ≥15-line identical verification procedure (true shared logic, not wording overlap).
3. A new intent space emerges that is concretely distinct from `/goat-debug`, `/goat-review`, `/goat-qa`, `/goat-security`, `/goat-plan`, and `/goat-critique`, reported by real usage - not hypothesized.

If any precondition fires, the new ADR's implementation must touch the 3 hardcoded surfaces (install script, constants, manifest), add a canonical entry, bump the audit-drift count, and pass 3-way-copy parity. That cost is the reason this ADR refused them today.

## References

- `.goat-flow/skill-docs/skill-preamble.md` - Proof Gate added after Evidence Standard.
- `workflow/skills/goat/SKILL.md` - dispatcher route map tightened to "verification planning".
- `workflow/skills/goat-debug/SKILL.md` - D1 boundary instrumentation, D2 causation/necessity/sufficiency + 5-Whys, D4 3-fix rule + Proof Gate reference.
- `workflow/skills/goat-qa/SKILL.md` - trigger "verify" → "verify coverage"; expanded NOT-this-skill routing.
- `workflow/skills/{goat, goat-plan, goat-review, goat-critique, goat-security}/SKILL.md` - Proof Gate one-line references.
- `.goat-flow/learning-loop/lessons/verification.md` - new `## Lesson: Verification rationalization anti-patterns` entry.
- `test/integration/preamble-sync.test.ts` and `test/contract/skill-hardening-contracts.test.ts` - contract tests.
- Precedent: ADR-002, ADR-005, ADR-009, plus the earlier shared-preamble cleanup that retired `RULES.md`.
- Drift-risk motivation: `.goat-flow/learning-loop/footguns/skills.md` (search: `punctuation-only edits`).
