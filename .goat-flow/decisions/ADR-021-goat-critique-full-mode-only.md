# ADR-021: goat-critique is full delegated mode only (no quick/inline fallback)

**Status:** Accepted
**Date:** 2026-04-19

## Context

- The skill previously shipped two modes: Quick (inline SKEPTIC/ANALYST/STRATEGIST lens passes in a single reviewer context) and Full / delegated (2-3 isolated sub-agents + cross-examination + dispute gating). Stake calibration defaulted Standard-complexity work to Quick (`.claude/skills/goat-critique/SKILL.md:30-42`).
- Quick mode produced artifact-shaped output without the mechanism that makes the skill worth invoking. A single reviewer running three named lens passes in the same context is not multi-perspective critique - it is self-talk under three labels. Informational diversity, which the skill body itself names as the point of Phase 1 (`.claude/skills/goat-critique/SKILL.md:49-51`), disappears when all passes share one context.
- The skill's own coherence already admitted this gap: under Quick mode, Phase 2 required that every split finding be tagged as inconclusive "because cross-examination is skipped, there is no basis to pick a winner" (`.claude/skills/goat-critique/SKILL.md:91`). That rule is a concession that Quick mode cannot do the job the skill exists to do.
- Low-ceremony multi-lens review is already covered elsewhere. `/goat-review` handles diff-level analysis, pre-existing separation, and single-reviewer quality questions without delegation. Users who want inline lens thinking have that surface; they do not need a Quick fallback inside goat-critique.
- Recent in-repo experience (2026-04-19 session critiquing the 12-task fix plan derived from `.goat-flow/logs/quality/**`) ran in Quick mode because delegation authorization was implicit rather than explicit. The output was usable but structurally misrepresented the work done: section headings suggested multi-agent coverage while only one context was ever produced. Open-question tagging flagged the inconclusive findings, but the artifact shape still read like delegated critique on a quick scan.
- The earlier rename captured by ADR-019 aligned the skill's command name with its mechanism. Collapsing to delegated-only aligns the skill's behaviour with the mechanism the name now promises.

## Decision

1. **goat-critique runs in one mode: full delegated.** 5 phases, 2-3 sub-agents by default; optionally 4 when cross-model spawning is available (see critique improvement plan M1/M5). Spawned via the Agent tool. Phase 1 MUST use isolated Agent-tool calls; no inline role-play substitute is permitted.
2. ~~**If delegation is unavailable in the session, the skill does not run.** Step 0 stops and redirects the user to `/goat-review`. Inline lens passes are not an acceptable fallback.~~ **Superseded (2026-04-23):** All four supported agents (Claude Code, Codex, Gemini, Copilot) ship sub-agent delegation. The redirect is dead ceremony per `.goat-flow/lessons/agent-behavior-trust.md` (search: `Sub-agent delegation is universal`). Removed from `docs/skills.md` and skill files.
3. **Skill-chained entry still runs the full 5-phase flow.** The only concession granted by skill-chaining is skipping the intake confirmation; it does not unlock a quick variant.
4. **`Output Format` ships one template.** The dual Quick/Full template is removed.
5. **The `SKILLS_DOC_STALE_PHRASES` detector entry that asserts "quick mode skips cross-examination and clarification" (`src/cli/audit/check-factual-claims.ts:352-357` - `skills-critique-contract-drift`) is removed.** With Quick mode retired, the detector's own claim is no longer true; keeping it would false-positive on correct docs.

## Consequences

**Positive**
- Skill name and skill mechanism match on every invocation. The output artifact now corresponds to the work actually performed.
- Open Questions remain a precise signal: they appear only when cross-examination was genuinely inconclusive, not as an automatic consequence of having skipped it.
- File size drops (~210 → ~130 lines) and invocation ceremony drops with it. Closer to peer skills such as `/goat-review` and `/goat-qa` in surface area.
- Users who previously hit Quick mode because delegation was implicit now land on `/goat-review`, which is already sized for single-context review and does not over-promise multi-agent coverage.

**Negative**
- Reduced accessibility: a user who wants lightweight multi-lens thinking without delegation overhead no longer gets an inline option from goat-critique. They must use `/goat-review` or apply the SKEPTIC/ANALYST/STRATEGIST framing themselves.
- Existing habits and stored prompts that invoked goat-critique in Quick mode break immediately at Step 0. The redirect is explicit, but it is still a behavioural break.
- Public docs referencing Quick mode (`docs/skills.md:24,187,211,213`) must be updated in the same change. Stale references would re-introduce the expectation the skill just removed.
- Harness / audit surfaces that referenced Quick vs Full mode as separate paths (`src/cli/audit/check-factual-claims.ts:352-357`) need adjustment. Footgun/lesson narrative that discussed Quick mode is historical and remains as-is; it is not rewritten.
- The 2026-04-19 quality-log Quick-mode run becomes an orphan pattern. It does not need retraction, but future readers comparing the log to the shipped skill will see a structure the skill no longer produces.

**Neutral**
- The Core Trio lens (SKEPTIC / ANALYST / STRATEGIST) is retained inside every delegated sub-agent. Only the inline application is retired.
- Phases 3 (Cross-Examine) and 4 (Clarify) already only ran in full mode; their text does not change.
- Downstream skills that called `/goat-critique` via chaining already assumed multi-agent mechanics; those call sites do not need to change.

## Alternatives considered

- **Keep Quick mode, strengthen the guardrails.** Reject. The structural problem is not guardrail strength - it is that inline lens passes cannot produce isolated-context diversity. A louder warning does not add agents.
- **Rename Quick mode to `/goat-critique-inline` as a separate entry point.** Reject. Two entry points doubles the dispatcher decision surface, and the inline form is already covered by `/goat-review`.
- **Default to Full, keep Quick as opt-in.** Reject. Prior wording already framed Full as opt-in by authorization, yet Quick was the routine behaviour. Making Quick opt-in does not change the default-path habit.
- **Merge goat-critique into goat-review with a `--multi-agent` flag.** Reject. The two skills have materially different contracts: goat-review gates on diff scope, pre-existing separation, and blast radius; goat-critique gates on multi-perspective isolation and cross-examination. Merging flattens both contracts and weakens both.

## Related decisions

- **ADR-011** - multi-perspective critique is a core goat-flow feature. This ADR does not revisit the feature's role; it constrains the implementation to the delegated-only form.
- **ADR-019** - renamed `goat-sbao` to `goat-critique`. That rename aligned the skill's command name with its operation. This ADR aligns the operation with its mechanism.

## Revisit Triggers

Open a new ADR only if one of these occurs after the change ships:

1. Demand for inline multi-lens critique (not covered by `/goat-review`) becomes a repeated pain point across users.
2. Delegation becomes unavailable by default in a supported agent runtime (Claude, Codex, Gemini, Copilot), forcing the skill to add a fallback to stay useful.
3. A lighter-weight brain-dump critique workflow emerges separately and makes goat-critique feel ceremonial for standard work, suggesting the ceremony ceiling was mis-set.

## References

- `workflow/skills/goat-critique/SKILL.md` (canonical template)
- `.claude/skills/goat-critique/SKILL.md`
- `.agents/skills/goat-critique/SKILL.md`
- `.github/skills/goat-critique/SKILL.md`
- `docs/skills.md:24,187,211,213`
- `src/cli/audit/check-factual-claims.ts:352-357`
- `.goat-flow/decisions/ADR-011-critique-mob-core-features.md`
- `.goat-flow/decisions/ADR-019-rename-sbao-to-critique-and-test-to-qa.md`
- `.goat-flow/skill-reference/skill-preamble.md`
