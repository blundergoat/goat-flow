---
goat-flow-reference-version: "1.16.0"
---
# Skill Deployment

The final-gate content: common rationalisations for skipping testing itself, the full deployment checklist, and the STOP rule that prevents batched untested skills from shipping.

Companion files in this pack:
- `tdd-iteration.md` - core TDD methodology (load first when authoring any skill)
- `adversarial-framing.md` - review-class specific patterns

Load this file when finalising any skill before merge.

## Common rationalisations for skipping testing itself

Agents and authors rationalise away proportionate skill testing the same way they rationalise away code testing. Capture these in your own RED phase for new skills:

| Excuse for skipping testing | Reality |
|------------------------------|---------|
| "The skill is obviously clear" | Clear to you ≠ clear to other agents. Test it. |
| "It's just a reference" | References can have gaps, unclear sections. Test retrieval. |
| "Testing is overkill" | Untested skills have issues. Always. 15 min testing saves hours. |
| "I'll test if problems emerge" | Problems = agents can't use skill. Test BEFORE deploying. |
| "Too tedious to test" | Testing is less tedious than debugging bad skill in production. |
| "I'm confident it's good" | Overconfidence guarantees issues. Test anyway. |
| "Academic review is enough" | Reading ≠ using. Test application scenarios. |
| "No time to test" | Deploying untested skill wastes more time fixing it later. |

All of these mean: **select and run proof proportionate to the change before deploying.**

## Skill deployment checklist

For a new skill or a material behavioural change to an existing skill, this checklist is a release gate before merging. Behaviour-neutral typo, link, citation, and formatting corrections use a focused contract proving behaviour stayed unchanged. For already-shipped skills where a later audit finds missing TDD evidence, record the gap as hardening debt and do not claim three-pass pressure evidence until fresh logs satisfy the checklist. Track each applicable item as a todo in your agent's planning tool - don't work from memory.

## Evidence classification

Use these labels when summarising existing TDD logs:

| Label | Meaning | Completion claim allowed |
|-------|---------|--------------------------|
| `no evidence` | No relevant TDD log found | No pressure-test claim |
| `RED no-repro` | RED scenarios did not reproduce the target failure class | Scenario tested; no reproduced failure |
| `stay-GREEN smoke` | One loaded-skill pass or regression check | Smoke evidence only |
| `partial hardening` | RED/GREEN happened, but fewer than 3 qualifying passes | Hardened against captured failures only |
| `three-pass pressure evidence` | 3 consecutive pre-registered pressure scenarios pass with no new rationalisations | Qualified evidence for the named failure class and provider/model/config only |

Three-pass pressure evidence is scoped to the named failure class and provider/model/config recorded in the trials. If current logs do not meet that threshold, say so directly. Do not backfill missing evidence by creating summary records; rerun the pre-registered pressure tests instead.

## Verification claim evidence

Use this table when a skill or agent needs to substantiate a generic verification
claim. The Excuse / Reality table in `skill-preamble.md` covers how the wrong
claim slips out; this table covers what proof each claim requires.

| Claim | Requires | Not Sufficient |
|---|---|---|
| Tests pass | Test output: 0 failures/errored plus suite summary from this session | Previous run, "should pass", partial run |
| Linter / typecheck clean | Tool exit 0 and full output read in this session | Linter passing implies typecheck |
| Build succeeds | Build command exit 0 and artifact written | Logs look good, last green CI |
| Bug fixed | Original failing reproduction rerun and observed passing | Code changed, "probably fixed" |
| Regression test works | RED -> revert fix -> RED -> restore -> GREEN | Test passes once after the fix |
| Sub-agent finished | VCS diff shows expected changes, re-read by you | Agent self-report |
| Requirements met | Line-by-line checklist against plan or milestone | Tests passing alone |

## Consumer and API Skill Patterns

For consumer-project domain skills, keep the root `SKILL.md` compact: trigger,
Step 0, local constraints, and links to scoped subdomain references. Each
subdomain section should name production-safe evidence commands and rollback or
post-deploy checks when destructive work is possible.

For API-backed skills, prefer the official SDK, name the auth env var, require
source/citation fields where returned data will be reused, pin the API version
the skill was authored against, and surface cost or rate-limit budgets before
fan-out. goat-flow core treats these as authoring guardrails, not generic
deterministic scorer rules.

**RED phase - write failing test:**
- [ ] Create pressure scenarios (3+ combined pressures for discipline skills)
- [ ] Run scenarios WITHOUT skill - document baseline behaviour verbatim
- [ ] Identify patterns in rationalisations / failures
- [ ] Verify RED with the pre-registered independent trial count; retain mixed results as evidence

**GREEN phase - write minimal skill:**
- [ ] Name describes what you DO or the core insight
- [ ] Frontmatter has `goat-flow-skill-version: "1.16.0"` and trigger-only `description`
- [ ] `description` is CSO-optimised (Context Search Optimization): "Use when [trigger]", not a workflow summary
- [ ] Keywords throughout for search (error messages, symptoms, tool names)
- [ ] Overview states the core principle in 1–2 sentences
- [ ] Addresses specific baseline failures identified in RED
- [ ] One excellent example - not multi-language dilution
- [ ] Run scenarios WITH skill - verify agents now comply

**REFACTOR phase - close loopholes:**
- [ ] Identify NEW rationalisations from GREEN testing
- [ ] Add explicit counters inline beside the rules they defend
- [ ] Build / extend the rationalisation table from all iterations
- [ ] Create red-flags list
- [ ] Re-test until three-pass pressure evidence is met (3 consecutive pre-registered passes, no new rationalisations)

**Quality checks:**
- [ ] Small flowchart only if decision non-obvious
- [ ] Quick-reference table for scanning
- [ ] "NOT this skill" boundary section listing what routes elsewhere
- [ ] No narrative storytelling ("in session 2025-10-03 we found...")
- [ ] Supporting files only for executable tools or heavy reference (100+ lines)
- [ ] Token budget met per the four-tier model: dispatcher ≤600 words, functional skill <2500 words, always-loaded shared content <1500 words per file, progressive reference pack <3000 words per file. Skills or packs that exceed their tier must either shed content or split into a sub-pack.

**Deployment:**
- [ ] Build the TDD iteration log in memory, pass it through the compatible redactor, then write `.goat-flow/logs/sessions/YYYY-MM-DD-<skill>-tdd.md`
- [ ] Cross-reference the log filename in the relevant lesson or footgun entry (not in SKILL.md frontmatter - that leaks dev paths to consumer installs)
- [ ] Cross-link into sibling SKILL.md files if relevant
- [ ] Propose a commit message naming which rationalisations were closed and which pressures were tested; the user commits

## STOP: before moving to the next skill

After writing a new skill or materially changing skill behaviour, STOP and complete the applicable deployment checklist.

Do NOT:
- Create multiple new or materially changed skills in a batch without testing each
- Move to the next material behaviour change before the current one is verified
- Treat behaviour-neutral maintenance as exempt from focused contract proof

Deploying untested skills = deploying untested code. It's a violation of quality standards.

## Cross-references

| Where | What |
|-------|------|
| `.goat-flow/skill-docs/skill-preamble.md` | Proof Gate, evidence standard, ceremony level - the loaded-every-invocation layer |
| `.goat-flow/skill-docs/skill-conventions.md` | Task tracking, recovery protocols, orchestration admission |
| `.goat-flow/skill-docs/skill-quality-testing/tdd-iteration.md` | Core TDD methodology and rationalisation table definition |
| `.goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md` | Review-class skill patterns |
| `.goat-flow/learning-loop/decisions/` | Architecture decisions and rationale |
| `.goat-flow/logs/sessions/*-<skill>-tdd.md` | TDD iteration logs live here; filename convention is the index |
