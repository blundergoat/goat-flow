---
category: skills
last_reviewed: 2026-04-18
---

## Footgun: Workflow-summarising skill descriptions cause CSO shortcutting

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents invoking a skill via `/<skill>` shortcut past the full `SKILL.md` body when the `description:` field summarises WHAT the skill does or HOW it works — the description becomes a substitute for reading the body.

**Why it happens:** LLMs anchor on the description as a sufficient summary and skip expanding the full skill content. This is the Context Search Optimization (CSO) failure class.

**Evidence:**
- Original incident in the external `superpowers-skills` repo (path: skills/meta/writing-skills/SKILL.md, lines 134-172 at the time) — `subagent-driven-development`'s description said "dispatches subagent per task with code review between tasks" and Claude performed ONE review instead of the two-stage review defined in the body.
- Regression caught in goat-flow itself on 2026-04-18: the `goat` dispatcher description was "Single entry point that classifies intent and dispatches to the correct goat-* skill" — workflow-summary, not trigger-only. Rewritten to "Use when you describe an outcome and need the right goat-* workflow chosen for you."

**Prevention:** Descriptions must be trigger-only — say WHEN to invoke the skill, never WHAT it does or HOW. All 7 current goat-* descriptions (including the dispatcher) are compliant as of 2026-04-18. When adding or editing a skill, the description field must pass the trigger-only test: if removing it and reading only the description tells you the skill's workflow steps or internal phases, it is a CSO violation regardless of how accurate it is.

---

## Footgun: Weak retrieval cues cause learning-loop misses

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A grep-first retrieval returns zero hits even though a relevant footgun exists, because the first query uses roadmap or abstraction language instead of the concrete failure class stored in the bucket.

**Why it happens:** The learning-loop buckets index real incidents and failure classes, not milestone names. Queries like "support matrix" or "registry canonicality" sound precise in planning context but do not match the actual wording of stored hook/platform incidents.

**Evidence:**
- Observed during M10 task planning: initial query `support matrix|agent matrix|registry canonicality` returned 0 hits against `.goat-flow/footguns/`, while the reworded query `Codex has no compaction notification hook` immediately hit `.goat-flow/footguns/hooks.md`. (Raw retrieval run recorded in a local-only task log.)
- `workflow/skills/reference/skill-preamble.md` now hard-codes the mitigation: derive 2-4 terms from target area + symptom + named file/tool, retry once, then record a miss instead of broad-loading a bucket.

**Prevention:** Seed first-pass retrieval terms with the concrete symptom, platform, or file/tool name rather than milestone titles or abstract design labels. One reword is allowed; if the second query still misses, record the retrieval miss explicitly and move on. Broad-loading the bucket to compensate defeats the protocol.

---

## Footgun: Installed skill copies can drift on punctuation-only edits and fail unrelated test runs

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** `npm test` failed in `test/integration/audit-drift.test.ts` even when the code change did not touch skills, because the tracked installed copies under `.claude/skills/` and `.agents/skills/` had Unicode em dashes while `workflow/skills/` templates had ASCII hyphens.

**Original evidence:**
- `workflow/skills/goat-plan/SKILL.md:15` vs `.claude/skills/goat-plan/SKILL.md:15` (hyphen vs em dash)
- `workflow/skills/goat-plan/SKILL.md:39` vs `.claude/skills/goat-plan/SKILL.md:39` (hyphen vs em dash)

**Resolution:** Installed copies are now byte-identical with the workflow templates on the cited lines (verified by `diff` returning empty output against both `.claude/skills/goat-plan/SKILL.md:15` and `:39`). The drift check at `test/integration/audit-drift.test.ts` now passes on these files.

**Prevention (retained):** When editing `workflow/skills/*/SKILL.md`, update the installed copies in `.claude/skills/` and `.agents/skills/` in the same change. The preflight `Skill SKILL.md Parity` check and `goat-flow audit --check-drift` both catch byte-level divergence before unrelated work is blocked by stale fixtures.

## Footgun: Release-version bumps can break skill-rename work through stale fixtures and hardcoded current-version routing

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A skill rename can look complete on directory, manifest, and docs surfaces but still fail verification because release-coupled helpers lag the version bump. On 2026-04-18, the M07 rename run first failed `npm test` in `test/integration/audit-build.test.ts` because the shared config stub still encoded the previous release version. After fixing that, the same verification pass exposed a second break: setup routing still hardcoded `1.1.x` as the only current branch, so a healthy `1.2.0` project was misclassified as needing an upgrade.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` (search: `configVersionCurrent`) enforces exact equality between `.goat-flow/config.yaml` and `AUDIT_VERSION`.
- `test/fixtures/projects/index.ts:34-48` is the shared `stubConfig()` used by audit-build fixtures; if it drifts from `AUDIT_VERSION`, "healthy project" tests fail for the wrong reason.
- `src/cli/classify-state.ts` (search: `CURRENT_VERSION_FAMILY`) derives the current version family and routes current vs outdated installs; hardcoding a previous family breaks `composeSetup()` as soon as the package version advances.
- `workflow/install-goat-flow.sh` (search: `Read version from package.json`) must derive the install version from `package.json`; a hardcoded fallback recreates the same stale-version trap at install time.

**Prevention:** When a skill rename ships with a version bump, treat version-sensitive helpers as part of the rename surface. Update current-version classifiers, shared config fixtures, install-script version discovery, and setup-routing tests in the same change before trusting `npm test`.

## Footgun: Workflow template source and installed copy can silently diverge

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-15 | **Updated:** 2026-04-17 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents on consumer projects follow a different rule than agents on the goat-flow repo, because the workflow template (install source) says one thing and the installed copy says another. The divergence is invisible - both files exist, both parse correctly, and no automated check compares their content.

**Resolution:** Four preventions implemented:
1. Divergence fixed - both files now match (verified by diff).
2. Preflight preamble/conventions check (search: `Preamble/Conventions Sync` in `scripts/preflight-checks.sh`) - byte-exact diff of preamble and conventions against workflow templates, fails if they differ.
3. Preflight skill parity check (search: `Skill SKILL.md Parity` in `scripts/preflight-checks.sh`) - byte-exact diff of each workflow template vs `.claude/skills/` and `.agents/skills/` installed copies.
4. CLI drift check (M04, 2026-04-17) via `goat-flow audit --check-drift` (search: `skillContentsEquivalent` in `src/cli/audit/check-drift.ts`) - YAML-aware normalisation so frontmatter key reorder and trailing whitespace do not false-positive; also detects orphan directories and deprecated skill names from `workflow/manifest.json:stale_names`.
5. Integration tests: `test/integration/preamble-sync.test.ts` covers shared docs; `test/integration/audit-drift.test.ts` covers the CLI path with tmpdir fixtures.

**Original evidence (historical):** The shared preamble (template at `workflow/skills/reference/skill-preamble.md`, installed at `.goat-flow/skill-reference/skill-preamble.md`) diverged between template and installed copy around a single-line change; discovered 2026-04-15 by multi-agent critique. Exact line numbers from that incident are no longer recorded here because the file has been edited since.

---

## Footgun: Agent rewrites shared docs with agent-specific vocabulary

**Status:** resolved | **Created:** 2026-03-21 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

Moved to resolved: all evidence is from retired v1.1.0 files and current shared docs were verified multi-agent as of 2026-04-15. The behavioral pattern (agents replacing rather than adding) is documented as a lesson, not a current architectural trap. If the pattern recurs in current files, re-activate with fresh evidence.

**Prevention (retained):**
- Agent-specific files (`workflow/setup/agents/`, `.claude/`, `.gemini/`) - edits fine
- Shared docs (`docs/`, `workflow/`) - MUST remain agent-neutral or list all agents
- When adding agent support: ADD to tables and examples, never DELETE or REPLACE existing agent references
- Setup prompts MUST include explicit scope constraints: "Do NOT modify files outside `.gemini/` and `GEMINI.md`"

---

## Footgun: Skills have phase gates but no time/call budget for context gathering

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

Skills enforce phase gates (Step 0 must complete before Phase 1, gates pause for human approval) but have no budget for how long Step 0 can take. Claude can spend an entire session reading templates, exploring the codebase, and gathering context without ever producing output or asking a question.

**Resolution:** Both preventions implemented in `.goat-flow/skill-reference/skill-preamble.md:77-79`:
1. Step 0 budget: "If Step 0 exceeds 5 file reads without producing output or asking a question, checkpoint with what you know so far."
2. Mid-Step-0 checkpointing: "Checkpoint mid-Step-0 for complex projects rather than silently reading indefinitely."

**Original evidence (historical):** Claude Insights (112 sessions) showed agents reading 20+ files in Step 0 without checkpointing, requiring user intervention to interrupt.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Dispatcher intent mapping has no coverage for analysis/evaluation verbs** (resolved 2026-04-14) - Added analysis/evaluation verbs to the dispatcher disambiguation table so ambiguous requests prompt skill selection instead of auto-routing.
- **CI template derives skill names by prefixing instead of listing them** (resolved 2026-04-14) - Removed `src/cli/prompt/fragments/` directory in v1.1.0; CI template generation no longer exists.
- **Blind mv/cp/Write can overwrite existing files** (resolved 2026-04-18) - Covered by the Never-tier no-clobber rule and destination-check guidance in the hot-path instruction files; no longer kept as an active architectural footgun.
