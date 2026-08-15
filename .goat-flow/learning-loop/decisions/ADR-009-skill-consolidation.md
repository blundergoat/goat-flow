# ADR-009: Canonical skill set - membership criteria and rejected candidates

**Status:** Accepted
**Date:** 2026-04-06
**Updated:** 2026-08-15 - absorbed the membership rulings formerly held in ADR-002 (goat-preflight), ADR-018 (goat-verify), ADR-019 (goat-sbao and goat-test renames), and ADR-050 (goat-audit). Each applied this ADR's justification test; keeping them as separate files split one doctrine across four.

## Context

Extracted from `docs/system-spec.md` (retired in v1.1.0) to preserve design history. Current execution-loop guidance lives in `workflow/setup/reference/execution-loop.md` (search: `READ -> SCOPE -> ACT -> VERIFY`).

Early versions had 8-10 skills. Each skill consumed instruction budget when loaded and created maintenance burden. At the same time, rubric, facts, fragments, and docs were inconsistent about whether the dispatcher counted as a canonical skill at all.

Before the canonical-count question was settled, the framework first had to decide whether the dispatcher should exist at all. The original dispatcher build ADR concluded that keyword-first routing plus one-question disambiguation was cheaper than loading the wrong skill and bouncing through its "NOT this skill" block. That origin story now lives here because the durable question is not whether `/goat` was worth building once; it is whether routing deserves canonical skill status and how that status interacts with the consolidation doctrine.

Cross-project reviews from consumer projects made the usability pressure concrete:

- "9 skills is too many for initial setup" (multiple projects)
- "goat-debug and goat-investigate have 95% Step 0 overlap"
- "goat-simplify is a subset of goat-review"
- "goat-simplify has never been invoked" (no usage across any reviewer)

Every later membership question - add a verifier, add an auditor, add a clarity skill, rename a skill whose name over-claims - resolved against the same test. Those rulings were written as separate ADRs, which meant a reader deciding whether a proposed skill qualifies had to find five files. The test and its results belong together.

The enduring question is not the exact count at a moment in history. It is what earns a skill file, when the dispatcher counts as canonical, and when capabilities should merge into modes instead of becoming standalone skills.

## Decision

A skill must have at least one of:

- a **distinct artefact**
- a **hard workflow gate**
- a **special failure mode**
- a **repeatable structured output**

The dispatcher **does** count as canonical when it is shipped as a `SKILL.md` surface with its own constraints and failure modes. It is not a passive router.

Applying the test:

- keep only skills that pass the justification test above
- count the dispatcher when it is part of the installed canonical set
- prefer modes inside an existing skill when the difference is routing or emphasis, not artifact, gate, failure mode, or output

Current canonical skills are 7 total: `/goat`, `/goat-debug`, `/goat-review`, `/goat-plan`, `/goat-security`, `/goat-qa`, `/goat-critique`.

There is no implementation skill (see ADR-005). Implementation is what the agent does natively. Skills govern everything around it.

### Consolidation history

**Dispatcher counting (from now-removed `ADR-016-dispatcher-is-canonical-skill.md`):**

- The dispatcher is canonical because it has its own failure modes (ambiguous intent, incorrect routing, missing override handling)
- It produces structured output (skill announcement and disambiguation)
- It has distinct constraints (must announce, must not load two skills, must present disambiguation)
- The original build rationale also remains part of the record: keyword-first intent mapping covers the easy cases, one clarification question handles the ambiguous boundary, and direct invocation remains available for power users

**9 → 6 consolidation (from now-removed `ADR-017-consolidate-skills-9-to-6.md`):**

| Removed | Merged Into | As |
|---------|-------------|-----|
| `goat-investigate` | `goat-debug` | Investigate mode + Onboard mode |
| `goat-simplify` | `goat-review` | Simplify mode |
| `goat-refactor` | `goat-plan` | Refactor planning mode |

`goat-security` expanded with Compliance and Dependency-audit modes during that consolidation pass.

### Rejected and replaced candidates

| Candidate | Ruling | Which criterion failed | Date |
|---|---|---|---|
| `goat-preflight` | Removed from the expected set, replaced by `goat-security` | No distinct artefact - `scripts/preflight-checks.sh` already did the work, so the skill was a wrapper. Six independent agent reviews rated it weakest (avg 72/100) | 2026-03-22 |
| `goat-verify` | Not built; shared Proof Gate added to `skill-preamble.md` instead | No special failure mode and no clean trigger space. Five independent analysis passes converged on rejection | 2026-04-18 |
| `goat-audit` | Not built | No distinct artefact - the composed `quality` prompt already encodes the requested contract, and `/goat-review` full depth already claims "audit X" | 2026-08-07 |

**goat-preflight detail.** The preflight *script* (`scripts/preflight-checks.sh`) stays - it is the real enforcement mechanism. Only the skill left the expected list; its files were not deleted, because consumer projects may still carry them. `goat-security` replaced it with a 4-phase structure: threat model → OWASP scan → framework-aware verification → rank by exploitability. The expected count stayed at 7 - a swap, not a reduction.

**goat-verify detail.** Rejecting the skill carried four positive obligations, all shipped:

1. **Shared Proof Gate in the preamble.** `workflow/skills/reference/skill-preamble.md` and its installed copy `.goat-flow/skill-docs/skill-preamble.md` carry a `## Proof Gate` section after `## Evidence Standard`, naming the positive procedure (Identify → Run fresh → Read → Verify → Cite). It is the complement to the 5 hallucination red-flags, which name the violations. `test/integration/preamble-sync.test.ts` asserts the heading exists in both copies.
2. **Routing hygiene, so goat-qa stops over-claiming "verify".** The dispatcher route map in `workflow/skills/goat/SKILL.md` says "verification planning", not "verification". `goat-qa` declares verification out of scope in its own contract block: `NEVER: Run or write tests, verify fixes, review code, or certify merges` and `DEFER TO: Direct test execution, /goat-debug, /goat-review, /goat-plan, or the dispatcher`. Bug-fix verification belongs to `/goat-debug`, diff and PR verification to `/goat-review`, and completion certification to the Proof Gate.
3. **One-line Proof Gate reference per skill**, placed at each skill's handoff, BLOCKING GATE, DoD, or milestone-close position so the reminder fires pedagogically rather than only as inherited policy.
4. **Targeted imports into `goat-debug`**, not a new skill: multi-component boundary instrumentation in D1; the Causation / Necessity / Sufficiency gate and 5-Whys-with-file-evidence in D2; the 3-fix abort rule and rerun-original-repro requirement in D4.

Per-skill gates stay heterogeneous by design - goat-debug confidence (HIGH/MEDIUM/LOW), goat-security confidence (CONFIRMED/PROBABLE/THEORETICAL), goat-review severity tags, goat-plan milestone testing gates, goat-qa must/should/skip tiers. Collapsing them into a generic verifier would destroy information tuned to different consumers. A numeric confidence gate of the `SuperClaude_Framework/confidence-check` kind was rejected across all five analyses: a numeric score is itself a hedge, forbidden by the instruction files' `Hedged claims` red-flag.

### Renames

Two skills were renamed because the command name contradicted the skill body. Both were name-body mismatches on user-facing surfaces, not scope changes.

| Old | New | Why the old name failed |
|---|---|---|
| `goat-sbao` | `goat-critique` | An acronym with no scaffolding at the slash-command layer, while the dispatcher, public skill guide, skill body, and dashboard presets all already taught the operation as "critique" |
| `goat-test` | `goat-qa` | Collided with the ordinary developer meaning. The skill body explicitly neither writes nor runs tests, and its scope spans gap analysis, audit, regression guards, and testing-plan output |

Sibling disambiguation between `/goat-critique` and `/goat-review` stays the job of scope, artifact type, and orchestration depth, not the slash token. The earlier CLI rename of `critique` to `quality` (commit `054bde2`) freed the `critique` name for skill use.

## Consequences

- Skill-count debates resolve through the justification test, not ad hoc preference
- A reader assessing a proposed skill finds the test and every prior ruling in one file
- Dispatcher counting follows from whether the dispatcher is a shipped canonical skill surface, not a separate open question
- Fewer skills means less maintenance, less drift, and less context consumed
- Adding a canonical skill costs 3 hardcoded surfaces (`workflow/install-goat-flow.sh` (search: `readarray -t SKILL_NAMES`), `src/cli/constants.ts` (search: `export function getSkillNames()`), `workflow/manifest.json` (search: `"canonical": [`)), plus audit-drift coverage and installed-copy parity. That cost is the reason the bar is a distinct artefact, gate, failure mode, or structured output
