# ADR-009: Canonical skill set - membership criteria and rejected candidates

**Status:** Accepted
**Date:** 2026-04-06
**Updated:** 2026-09-05 - condensed. Earlier amendments absorbed the rulings from now-removed ADR-002 (goat-preflight), ADR-016 (dispatcher counting), ADR-017 (9-to-6 consolidation), ADR-018 (goat-verify), ADR-019 (renames), and ADR-050 (goat-audit), and enrolled goat-clarity on 2026-08-20.

## Context

Early versions shipped 8-10 skills. Each consumed instruction budget when loaded and added maintenance. Consumer reviews said "9 skills is too many for initial setup", that goat-debug and goat-investigate shared 95% of Step 0, and that goat-simplify was a subset of goat-review no reviewer had ever invoked. Rubric, facts, and docs also disagreed about whether the dispatcher counted as a skill.

Every later membership question - a verifier, an auditor, a clarity skill, a rename - resolved against the same test, so the test and its rulings live in one file.

## Decision

A skill must have at least one of a distinct artefact, a hard workflow gate, a special failure mode, or a repeatable structured output to earn a `SKILL.md`; otherwise prefer modes inside an existing skill.

The dispatcher counts as canonical because it ships as a `SKILL.md` with its own constraints (announce the route, never load two skills, present disambiguation) and failure modes (ambiguous intent, wrong route, missing override handling). Keyword-first routing plus one clarifying question was cheaper than loading the wrong skill and bouncing through its "NOT this skill" block.

Current canonical set, 8 total: `/goat`, `/goat-debug`, `/goat-plan`, `/goat-review`, `/goat-critique`, `/goat-security`, `/goat-qa`, `/goat-clarity`. There is no implementation skill (ADR-005).

**goat-clarity** qualifies through a distinct Clarity Remediation Receipt, a frozen Target Scope Snapshot with a Scope v2 gate, selector-specific refusal states, and repeatable bounded output. It remediates comments, documentation, local and private names, contained private placement, and an enumerated set of public or exported identifier spelling changes. That spelling exception needs a second explicit approval after the skill discloses the exact write set and per-identifier compatibility impact; the initial request is not enough, one approval covers only the disclosed set, added identifiers need another gate, and the skill requires explicit user acceptance for each compatibility break. Broader public refactoring, migration, and behavioural change stay ordinary implementation or `/goat-plan`.

### Rulings

| Candidate | Ruling | Failed criterion | Date |
| --- | --- | --- | --- |
| `goat-investigate` | Merged into `goat-debug` as Investigate and Onboard modes | Routing difference only | 2026-04-06 |
| `goat-simplify` | Merged into `goat-review` as Simplify mode | Subset of review, never invoked | 2026-04-06 |
| `goat-refactor` | Merged into `goat-plan` as Refactor planning mode | Routing difference only | 2026-04-06 |
| `goat-preflight` | Replaced by `goat-security` (threat model, OWASP scan, framework-aware verification, rank by exploitability); `scripts/preflight-checks.sh` stays as the enforcement mechanism | No distinct artefact; six reviews rated it weakest, average 72/100 | 2026-03-22 |
| `goat-verify` | Not built; a shared Proof Gate was added to the preamble instead | No special failure mode and no clean trigger space; five analyses converged | 2026-04-18 |
| `goat-audit` | Not built | No distinct artefact; the `quality` prompt and `/goat-review` full depth already own "audit X" | 2026-08-07 |

`goat-security` also gained Compliance and Dependency-audit modes in the 9-to-6 pass. Installed skills are never deleted from consumer projects when they leave the expected list.

Rejecting `goat-verify` carried four obligations, all shipped: a `## Proof Gate` section in `workflow/skills/reference/skill-preamble.md` and its installed copy (Identify, Run fresh, Read, Verify, Cite), asserted by `test/integration/preamble-sync.test.ts`; routing hygiene so the dispatcher says "verification planning" and `goat-qa` declares `**NEVER:** Run or write tests, verify fixes, review code, or certify merges`; a one-line Proof Gate reference at each skill's handoff or gate; and targeted imports into `goat-debug` (boundary instrumentation in D1, the Causation / Necessity / Sufficiency gate and 5-Whys in D2, the 3-fix abort rule and rerun-original-repro requirement in D4). Per-skill gates stay heterogeneous by design; a generic numeric confidence gate was rejected because a score is itself a hedge.

### Renames

| Old | New | Why the old name failed |
| --- | --- | --- |
| `goat-sbao` | `goat-critique` | An acronym with no scaffolding at the slash layer while every other surface taught "critique" |
| `goat-test` | `goat-qa` | Collided with the developer meaning; the skill neither writes nor runs tests |

The CLI rename of `critique` to `quality` (commit `054bde2`) freed the name. `/goat-critique` and `/goat-review` are distinguished by scope, artifact, and orchestration depth, not by the slash token.

## Consequences

- Skill-count debates resolve through the justification test, not preference.
- Adding a canonical skill costs a manifest entry, three installed mirrors, release and CI lists, the functional-budget contract, dashboard routing, setup docs, audit-drift coverage, and installed-copy parity. Runtime names stay manifest-derived. That cost is why the bar is a distinct artefact, gate, failure mode, or structured output.
