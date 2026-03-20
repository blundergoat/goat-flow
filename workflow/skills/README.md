# Layer 3 - Skills

Skills are loaded via slash commands, not always-on. Each skill has a focused scope with a distinct artifact, a hard quality gate, and a repeatable output.

Skills are **created by Phase 1b** in the runtime setup prompts (`setup-claude.md` or `setup-codex.md`). This folder documents what each skill does and when it's needed.

---

## Skills

| Skill | Purpose | Trigger | Output |
|-------|---------|---------|--------|
| `/goat-preflight` | Pre-task validation | Before starting any task | Pass/fail checklist |
| `/goat-debug` | Root cause analysis | When a bug is reported or test fails | Diagnosis with evidence |
| `/goat-audit` | Codebase quality review | On demand or before major changes | Findings with severity |
| `/goat-research` | Deep investigation of unfamiliar areas | Exploring new codebases or domains | Research summary with sources |
| `/goat-review` | Structured review of changes | Before merging or after significant work | Findings with severity |

## Why Each Skill Is Designed This Way

### /goat-preflight
**Problem:** Shipping broken builds. The agent finishes work and says "done" without running the full check suite. Individual checks (just tests, just lint) miss issues the full pipeline catches.
**Design:** Mechanical, repeatable output with RFC 2119 priorities. MUST items (type-check, lint, compile) cannot be skipped. Produces a structured pass/fail report, not prose.

### /goat-debug
**Problem:** Agents guess fixes before understanding the bug. The instinct is to "just try something" - swap a value, add a null check, toggle a flag. This works ~30% of the time and creates confusing diffs the other 70%.
**Design:** Hard gate - diagnosis with file:line evidence first, fixes only after human reviews findings. The explicit "If you want to 'just try something' before tracing the code path, STOP" instruction exists because this failure mode is nearly universal. (Source: Microsoft AutoDev, direct experience)

### /goat-audit
**Problem:** Fabricated findings. Audits are high-stakes - false positives erode trust, false negatives create risk. LLMs are reliably bad at distinguishing real findings from plausible-sounding ones they invented.
**Design:** Four-pass structure with an explicit fabrication gate at pass 4. Discovery → Verification (re-read each finding) → Prioritisation → Self-Check ("did I fabricate this?"). MUST NOT propose fixes - the audit's job is to find issues, not solve them.

### /goat-research
**Problem:** Planning without understanding the codebase. The agent proposes an approach based on assumptions about how the code works, then discovers midway through implementation that the assumptions were wrong.
**Design:** Hard gate - produce research.md with files involved, request flow, boundaries touched, and risks/gotchas (minimum 3 with file:line evidence). No planning until human reviews.

### /goat-review
**Problem:** Rubber-stamp reviews. Without structure, the agent says "looks good" or lists trivial style issues while missing architectural concerns.
**Design:** Structured review with RFC 2119 severity levels and respect for autonomy tiers. The agent investigates independently - it doesn't blindly apply external suggestions.

**Naming:** The `goat-` prefix eliminates all naming conflicts with both built-in agent commands and user-defined custom skills.

## Skill Justification Test

A skill earns its place if it meets ALL of:

1. **Distinct artifact** - produces something the execution loop doesn't
2. **Hard quality gate** - has pass/fail criteria, not subjective
3. **Special failure mode** - addresses a failure the loop alone misses
4. **Repeatable output** - same input produces consistent results

Skills that failed this test and were downgraded to inline instructions: `/annotation-cycle`, `/sbao-synthesis`, `/review-triage`, `/revert-rescope`.

## File Locations

| Agent | Skills Path |
|-------|------------|
| Claude Code | `.claude/skills/{name}/SKILL.md` |
| Codex | `docs/codex-playbooks/{name}.md` |
