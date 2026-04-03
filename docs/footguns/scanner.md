---
category: scanner
---

## Footgun: Eval templates, parser, and scanner drift out of contract

**Status:** active | **Created:** 2026-03-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An eval written exactly from the shipped template can fail the scanner, or a valid eval heading accepted by the parser can still fail the rubric. Users create evals that look correct in markdown but lose points in `goat-flow scan`.

**Why it happens:** Eval structure is defined in three places with different assumptions:
- `workflow/evaluation/evals.md` tells users what to write
- `src/cli/evals/parser.ts` decides which headings are semantically equivalent
- `src/cli/facts/shared.ts` performs strict regex checks for the rubric

When one of those changes without the others, the setup guidance stops matching the scan logic.

**Evidence:**
- `workflow/evaluation/evals.md` → template tells users to create an `## Origin` section
- `src/cli/facts/shared.ts` → scanner only accepts `**Origin:**` labels
- `src/cli/evals/parser.ts` → parser treats `Scenario` as equivalent to `Replay Prompt`

**Prevention:** Treat eval shape as a single contract. Any change to allowed headings, label format, or example structure must be updated in the template, parser, and scanner together. Verify with one round-trip test: write an eval from the template, parse it, then confirm it passes the full-tier scan checks.

---

## Footgun: Scanner reports enforcement features it didn't detect

**Status:** active | **Created:** 2026-03-31 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Scanner gives Codex full marks for deny hook quality (jq parsing, chaining detection, compaction hook) when the Codex enforcement is actually a Starlark execpolicy file — a completely different format that doesn't use jq or split on &&/||/;.

**Why it happens:** `src/cli/facts/agent.ts` hardcodes `denyUsesJq = true` and `denyHandlesChaining = true` for execpolicy agents, and treats `session_start` hooks as compaction hooks. These are assumptions, not detections. The scanner reports them as facts.

**Evidence:**
- `src/cli/facts/agent.ts` → hardcoded assumptions for Codex enforcement quality
- goat-flow Codex self-review (66/100): "the scanner fakes Codex compaction and deny-hook properties"

**Prevention:** Only report what's actually detected from file content. If a Starlark file exists, report it exists — don't assume it has properties that only apply to bash hooks.

---

## Footgun: Scanner AP2 penalizes project-specific skills

**Status:** resolved | **Created:** 2026-04-01 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Scanner deducts -3 for any skill directory that doesn't start with `goat-`. Projects with custom skills (`deploy/`, `lint-fix/`, `preflight/`) get penalized and the setup fragment tells the agent to rename them to `goat-deploy/` etc.

**Why it happens:** AP2 assumed all skills in a project should have the `goat-` prefix. The check was dead code (could never trigger because `skills.found` only contains canonical goat-flow names from `SKILL_NAMES`), but the associated fragment `ap-fix-skill-names` contained harmful instructions that would rename project-specific skills.

**Evidence:**
- `src/cli/rubric/anti-patterns.ts` → AP2 check (removed)
- `src/cli/prompt/fragments/anti-patterns.ts` → `ap-fix-skill-names` fragment (removed)
- halaxy-agents-lab had project-specific `preflight/`, `audit/`, `review/` skills that would have been flagged

**Prevention:** Scanner checks should only validate goat-flow's own skills (from `SKILL_NAMES`), never impose naming conventions on project-specific skills. The `goat-` prefix is a goat-flow convention, not a universal rule.

---

## Footgun: Scanner gives 100% while generated files are broken

**Status:** open | **Created:** 2026-04-03 | **Evidence:** ACTUAL_MEASURED

The scanner awards 100% (A grade) to projects that have:
- Broken `ai/README.md:3` (invalid content)
- `settings.json` missing hook registration that the rubric claims exists (`src/cli/facts/agent/hooks.ts:479`, `src/cli/rubric/standard/hooks.ts:55` check file existence only)
- Physically broken skill files (`.claude/skills/goat-plan/SKILL.md:182` — stale tail, `:198` — references deleted goat-investigate)
- Malformed eval frontmatter (duplicate YAML blocks)
- CI workflow containing literal scanner-bait comments (`.github/workflows/context-validation.yml:40`)

**Evidence:** Found by Codex on strands-php-client (100% score, broken ai/README.md), blundergoat-platform (100% score, broken goat-plan SKILL.md + unregistered hook), ambient-scribe (duplicate eval frontmatter).

**Impact:** The scanner rewards formatting compliance, not functional correctness. Users trust A/100 as "setup is good" when it means "setup matches regex patterns."

**Fix:** M18 in `.goat-flow/tasks/0.10.0/M18-scanner-ux.md`. Add semantic validation: verify hook registration, validate skill file content, parse eval frontmatter, check ai/README.md references resolve.
