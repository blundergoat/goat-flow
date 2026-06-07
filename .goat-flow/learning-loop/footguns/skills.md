---
category: skills
last_reviewed: 2026-06-03
---

## Footgun: Skill parity edits can miss `.github/skills/` and fail repo-level drift checks

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A skill edit looks complete because `workflow/skills/`, `.agents/skills/`, and `.claude/skills/` match, but repo verification still fails. The remaining drift lives in `.github/skills/`, so `test/integration/audit-drift.test.ts` fails on the repo root even though the more obvious mirrors were updated.

**Why it happens:** The installed skill surface is broader than the two local agent mirrors most edits cover. `workflow/manifest.json` includes a GitHub agent with `skills_dir: ".github/skills/"`, the manifest helper exposes that root to the drift fixture, and path-integrity checks treat it as a first-class installed mirror. A hand-written file list that omits `.github/skills/` is incomplete.

**Evidence:**
- `workflow/manifest.json` (search: `"skills_dir": ".github/skills/"`) declares the GitHub agent skill root.
- `src/cli/manifest/manifest.ts` (search: `getInstalledSkillRoots`) exposes installed skill roots from the manifest-backed agent set.
- `scripts/check-path-integrity.sh` (search: `skill_dirs=".claude/skills .agents/skills .github/skills"`) checks `.github/skills/` alongside the other installed mirrors.
- `test/integration/audit-drift-checkdrift-this-repo.test.ts` (search: `goat-flow root should be drift-clean`) failed on 2026-04-21 with finding `goat-review: template (workflow/skills/goat-review/SKILL.md) and installed copy (.github/skills/goat-review/SKILL.md) differ`.

**Prevention:**
1. When editing `workflow/skills/*/SKILL.md`, update every installed mirror in `.claude/skills/`, `.agents/skills/`, and `.github/skills/` in the same change.
2. Derive installed skill roots from `workflow/manifest.json` or `getInstalledSkillRoots()` rather than from memory.
3. Re-run `test/integration/audit-drift.test.ts` or `goat-flow audit --check-drift` after any skill-parity edit so a missed mirror fails immediately.

## Footgun: Shared reference edits can split workflow templates from installed runtime copies

**Status:** active | **Created:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** An edit to shared skill guidance can look correct in the loaded runtime copy but leave the workflow template behind, causing consumers installed from the template to miss the rule and causing preflight/drift tests to fail.

**Why it happens:** Shared skill reference files have two live surfaces: `workflow/skills/reference/` is the install template source, while `.goat-flow/skill-docs/` is the installed runtime copy loaded by this repo's agents. Agents naturally edit the file they just read at runtime, but the package source of truth also has to move in the same change.

**Evidence:**
- `.goat-flow/skill-docs/skill-preamble.md` (search: `Routing rule`) contains the runtime rule that triggered the current drift.
- `workflow/skills/reference/skill-preamble.md` (search: `Learning-Loop Retrieval`) is the corresponding template source that must remain byte-equivalent except for intentionally synchronized edits.
- `scripts/preflight-checks.sh` (search: `Skill Docs Sync`) fails when shared skill-doc templates and installed copies differ.
- `src/cli/audit/check-drift.ts` (search: `workflow/skills/reference/skill-preamble.md`) also checks shared-reference template/install parity through the audit path.

**Prevention:** When changing shared skill-reference files (`skill-preamble.md`, `skill-conventions.md`) or topical files under `workflow/skills/reference/`, edit the workflow template and installed copy together. When changing standalone playbooks such as `skill-quality-testing.md`, update the matching `workflow/skills/playbooks/` and `.goat-flow/skill-docs/playbooks/` surfaces instead. Re-run `bash scripts/preflight-checks.sh` or at minimum `node --import tsx src/cli/cli.ts audit . --check-drift --format json` before treating the change as complete.

## Footgun: Skill reference-pack merges can leave stale installed files behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A target project upgraded to the current goat-flow release has current `SKILL.md` files and current manifest-listed references, but old per-skill Markdown reference files remain beside them. Agents that grep the `references/` directory can read superseded guidance with old `goat-flow-reference-version` frontmatter even though setup and agent-skill audit checks pass.

**Why it happens:** Skill installation overwrites files listed by `workflow/manifest.json` `skills.references`, but a reference merge or rename removes files from the manifest. A copy-only upgrade does not delete files that are no longer listed, so old files survive unless the installer or audit explicitly treats unlisted references as stale.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `prune_unlisted_skill_references`) now removes unlisted Markdown files from canonical skill `references/` directories before copying current templates.
- `src/cli/audit/check-agent-setup.ts` (search: `checkUnexpectedSkillReferences`) fails the `agent-skills` check when installed goat skill references are not listed in the manifest.
- Downstream gruff-php upgrade on 2026-05-21 left `auth-authz.md`, `cicd-and-agent-surfaces.md`, `dependency-and-supply-chain.md`, and `secrets-and-data-exposure.md` under `.claude/skills/goat-security/references/` after those files were merged into the v1.7.0 `identity-and-data.md` and `supply-chain-and-cicd.md` reference set.

**Prevention:** After any per-skill reference merge, rename, or deletion, update `workflow/manifest.json` `skills.references`, run an installer round-trip test that starts with a stale reference file, and run `node --import tsx src/cli/cli.ts audit <target> --agent <id>` against a target containing the stale file to prove audit fails before reinstall and passes after reinstall.

## Footgun: Bash-prescribed slash-command or skill bodies break under per-block tool isolation

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A SKILL.md or slash-command body grows past one or two `!cmd` invocations into a multi-block bash program. The agent runtime treats each bash block as an independent tool invocation. Variables defined in block N are gone in block N+1; heredocs with substitution, `BASH_REMATCH`, associative arrays, and `$(tool …)` substitution all become unreliable because the shell state is reset between blocks. The command starts producing parse errors or silently does the wrong thing.

**Why it happens:** Authors write a skill body the way they'd write a shell script — top to bottom, with variables shared across steps. Claude Code (and Codex/Gemini) treat each fenced bash block as a separate `Bash` tool call. The slash-command body should describe steps declaratively for the agent to execute; it should not prescribe an exact multi-block bash program. The cost is hidden until the body crosses ~10 lines or ~2 blocks — short skills look fine.

**Evidence:**
- External: `kennyjpowers/claude-flow` PR #2 ("feat: add feedback workflow command" follow-up, MERGED 2025-11-21, 1,691 additions / 3,174 deletions). The original `feedback.md` shipped in PR #1 had 26+ bash blocks using `BASH_REMATCH`, heredocs with substitution, and `$(stm list …)` substitution. The PR #2 feedback log in the external specs/add-feedback-workflow-command/05-feedback.md file (search: `Variable Persistence Problem: Bash variables don't persist between separate Bash tool invocations`) names the root cause: *"The command tries to prescribe exact bash scripts instead of providing declarative guidance for Claude to follow."* Fix: declarative steps + direct `!claudekit status stm` invocations replacing `$(claudekit status stm)` substitution.
- External, follow-up: the same defect remained in sibling `decompose.md` (16 bash blocks) until a second feedback cycle. Same author, same codebase, same fix needed twice. Reinforces "when refactoring is the right answer, do the same refactor across sibling files."
- Goat-flow surfaces at risk: every `workflow/skills/*/SKILL.md`, especially the dispatcher (`goat`) and any skill that orchestrates multi-step shell work. Verification: `rg -c '^```bash' workflow/skills/*/SKILL.md` lists current bash-block counts per skill.

**Prevention:**
1. If a SKILL.md body contains a bash block longer than ~10 lines OR more than 2 bash blocks total, refactor to declarative steps that name the tool and the inputs but let the agent pick the invocation.
2. Use direct `!` tool invocations (e.g. `!goat-flow audit`) not `$(goat-flow audit)` substitution — the substitution form forces a subshell whose state doesn't persist beyond the block.
3. Replace heredocs-with-substitution and associative-array tricks with a single file write + read, or with prose that asks the agent to track the value across steps.
4. Validate by reading the SKILL.md as if a fresh agent ran each bash block in isolation: if any block expects a variable from a prior block, the body is prescriptive — refactor before shipping.
5. When a sibling skill has the same shape (multiple skills wrapping the same kind of tool orchestration), audit them together. The kennyjpowers PR #2/decompose.md pattern shows that fixing only the one that bit leaves the rest as latent traps.

Applies wherever goat-flow ships a SKILL.md or command body that orchestrates multi-step bash work. Cross-reference: `.goat-flow/learning-loop/footguns/skills.md` (search: `Skill parity edits can miss`) for the parallel concern about edits not propagating across installed mirrors — a bash-heavy skill compounds that risk because each block must remain byte-identical across all four installed copies.

## Footgun: Release-version bumps can break skill-rename work through stale fixtures and hardcoded current-version routing

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A skill rename can look complete on directory, manifest, and docs surfaces but still fail verification because release-coupled helpers lag the version bump. On 2026-04-18, the M07 rename run first failed `npm test` in `test/integration/audit-build.test.ts` because the shared config stub still encoded the previous release version. After fixing that, the same verification pass exposed a second break: setup routing still hardcoded `1.1.x` as the only current branch, so a healthy `1.2.0` project was misclassified as needing an upgrade.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` (search: `configVersionCurrent`) enforces exact equality between `.goat-flow/config.yaml` and `AUDIT_VERSION`.
- `test/fixtures/projects/index.ts` (search: `stubConfig`) is the shared config stub used by audit-build fixtures; if it drifts from `AUDIT_VERSION`, "healthy project" tests fail for the wrong reason.
- `src/cli/classify-state.ts` (search: `CURRENT_VERSION_FAMILY`) derives the current version family and routes current vs outdated installs; hardcoding a previous family breaks `composeSetup()` as soon as the package version advances.
- `workflow/install-goat-flow.sh` (search: `Read version from package.json`) must derive the install version from `package.json`; a hardcoded fallback recreates the same stale-version trap at install time.

**Prevention:** When a skill rename ships with a version bump, treat version-sensitive helpers as part of the rename surface. Update current-version classifiers, shared config fixtures, install-script version discovery, and setup-routing tests in the same change before trusting `npm test`.

## Footgun: New skill proposals can be configuration systems shaped around one workflow rather than general-purpose tools

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Symptoms:** A thoughtful, first-person, well-written proposal lands for an eighth canonical skill. It solves a real problem the author actually had. On read-through it turns out the skill is parameterised by the proposer's working style (multi-domain isolation, per-project keyword auto-loading, session-locked context, personal taxonomy) rather than by a structural property of any goat-flow project. Accepting it grows the canonical skill set and forces every downstream consumer (and every audit pass that scores skill quality) to carry weight for a workflow most projects do not have.

**Why it happens:** goat-flow has no prose document defining what makes a skill belong in `workflow/manifest.json` (search: `"canonical"`) vs in an out-of-tree plugin. ADR-009 (search: `Skill consolidation and canonical-skill doctrine`) records the *historical* doctrine of consolidating skills, and ADR-021 (search: `goat-critique runs in one mode: full delegated`) records the rejection of one over-narrow mode, but neither serves as a forward-facing scoping checklist for new skill proposals. `docs/skill-authoring.md` covers how to write a skill once accepted, not whether to accept one. Without that gate, well-intentioned skill PRs are evaluated on craft (which they often pass) rather than scope (where they should fail).

**Evidence:**
- `workflow/manifest.json` (search: `"canonical"`) enumerates the seven canonical skills; an eighth grows the surface area of every per-harness mirror, every audit check, and every parity script.
- `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `Skill consolidation and canonical-skill doctrine`) records the doctrine but does not encode it as an authoring-time gate.
- `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`) is the closest prior art for rejecting a configuration-flavored alternative; it lives as a per-skill decision, not a generic test.
- `docs/skill-authoring.md` (search: `Decide First`) is structured as scaffold / validate / interactive / dashboard / authoring checks; none of the sections gate on general-purpose vs. workflow-specific.
- External corroboration: obra/superpowers PR #1571 ("feat: add context-management skill with domain isolation") was closed with the maintainer comment "the skill as designed is shaped around your specific multi-domain workflow ... that's a configuration system, not [a skill]." Superpowers and goat-flow share the same risk because both maintain a small canonical-skill surface.

**Prevention:**
1. Before adding any skill to `workflow/manifest.json` `skills.canonical`, write a one-paragraph "general-purpose justification" answering: would a project with no overlap to the proposer's workflow still benefit? Record it in the corresponding ADR.
2. Treat skill-shaped configuration (per-domain context auto-loading, session-locked taxonomies, opinion-locked keyword maps) as a signal that the work belongs in a downstream plugin or `.goat-flow/skill-docs/playbooks/` rather than a new canonical skill.
3. If the proposal is craft-strong but scope-narrow, route to `.goat-flow/skill-docs/playbooks/` (which agents can opt into per project) rather than `workflow/skills/` (which every harness installs).

## Footgun: Linter or security-scanner output can pressure rewrites of load-bearing skill language

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Symptoms:** An automated tool (security scanner, prompt-injection detector, prose linter) flags a phrase or framing inside a canonical SKILL.md - `**EXTREMELY IMPORTANT**`-style emphasis, the Excuse | Reality tables, a forceful "Iron Law" line, the deliberate "your AI partner" phrasing. A well-meaning PR rewrites the flagged language to "comply" with the tool's guidance. The rewrite passes the tool, passes typecheck, passes structural skill-quality scoring (`src/cli/quality/skill-quality-score.ts` — search: `scoreContent`), and silently degrades the skill's behaviour-shaping power because the flagged phrasing was load-bearing.

**Why it happens:** Excuse | Reality tables and forceful framing exist precisely *because* they shift agent behaviour under pressure. They look like editorial emphasis to an external tool (and to agents reading them cold) but they are the persuasion mechanism the skill depends on. goat-flow's existing structural scorer measures shape (presence of gates, table rows, frontmatter) but not behaviour, so a "compliance" rewrite passes every CI check while quietly weakening the runtime contract. The trap is structural: load-bearing prose has no machine-distinguishable signature from decorative prose.

**Evidence:**
- `.goat-flow/skill-docs/skill-quality-testing/adversarial-framing.md` (search: `cynical reviewer with zero patience`, `Zero-findings HALT rule`) documents that specific phrasing in review-class skills is the mechanism, not the message.
- `src/cli/quality/skill-quality-score.ts` (search: `scoreContent`, `scoreAllArtifacts`) — the scorer composes text and runs rubric metrics; it does not execute the skill against agent prompts, so a "compliance" rewrite that preserves shape can pass scoring.
- `.claude/skills/goat-plan/SKILL.md` (search: `Excuse`, `Reality`) — the Excuse | Reality table is the persuasion surface most likely to attract a "this is unprofessional / aggressive / could be softened" rewrite suggestion.
- External corroboration: obra/superpowers PR #1608 ("fix(skill): remove prompt-injection marker") was closed as slop. The maintainer's comment: "the framing the scanner flagged is intentional — it's the mechanism that makes Superpowers actually shape agent behavior." Same shape of trap applies here.

**Prevention:**
1. Mark known-load-bearing prose surfaces (Excuse | Reality tables, hard gates, forceful framing lines, the `your AI partner` term) as protected in `docs/skill-authoring.md` so authors know rewording requires evidence.
2. Treat any PR that rewords skill text in response to *tool output* (scanner, linter, model review) as requiring before/after behavioural eval evidence, not just passing structural checks. When the M10 behavioural eval harness lands, this becomes enforceable.
3. CI rule (cheap, valuable): fail PRs whose bodies match canned scanner output patterns (`Risk score:`, `Matched signals:`, `pre-flight guardrails passed`) unless an explicit `[manual-review]` marker is present in the body.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Installed skill files can reference framework-only ADRs that don't exist in consumer projects

**Status:** resolved | **Created:** 2026-05-02 | **Resolved:** 2026-05-02 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** Agents in consumer projects found ADR-021 and ADR-018 citations in installed skill files, tried to look them up in `.goat-flow/learning-loop/decisions/`, and either hallucinated ADR content or lost context. The rules themselves worked, but the authority citations were dead links.

**Resolution:** All ADR references removed from installed skill files in v1.4.0 (goat-critique excuse table, goat-qa regression guard and constraints). Rules are now self-contained with inline rationale. Verified: `rg 'ADR-\d+' workflow/skills/` returns zero matches.

**Prevention (retained):**
1. Skill SKILL.md files and their reference packs must be self-contained. The rule and its rationale must be stated inline - never behind an ADR citation the consumer doesn't have.
2. ADR references are fine in framework-internal files (footguns, lessons, architecture, code-map, instruction files) because those live in the framework repo. The boundary is: if the file gets copied to consumer projects by the installer, it must not reference framework ADRs.
3. When adding a rule to a skill that came from an ADR, state the rule and a one-line "why" inline. Cross-reference the ADR only in the framework's own learning-loop artifacts.

## Footgun: Review skills can choose the wrong PR base when they hardcode `origin/main`

**Status:** resolved | **Created:** 2026-04-25 | **Resolved:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** `/goat-review` could misclassify PR-style review scope or generate the wrong comparison diff in consumer projects whose real integration branch is not `main`. A consumer quality report on 2026-04-25 found a project comparing feature branches to `origin/deploy` while `/goat-review` defaulted local PR detection and fallback review to `origin/main`/`main`.

**Why it happened:** The review skill treated a common GitHub default as a universal project invariant. That leaked a goat-flow/framework assumption into consumer repositories, where the correct base may be `deploy`, `develop`, `trunk`, a release branch, or a PR-specific base returned by hosting metadata.

**Original evidence:**
- `workflow/skills/goat-review/SKILL.md` (search: `commits ahead of \`origin/main\``) makes PR-style auto-detection depend on `origin/main`.
- `workflow/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) makes local PR fallback default to `main`.
- `.claude/skills/goat-review/SKILL.md` (search: `commits ahead of \`origin/main\``) shows the installed Claude mirror has the same behaviour.
- `.agents/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) shows the installed Codex/agents mirror has the same behaviour.
- `.github/skills/goat-review/SKILL.md` (search: `Base branch? (default: \`main\``) shows the installed GitHub/Copilot mirror has the same behaviour.

**Resolution:** `/goat-review` now resolves PR bases by preference order instead of assuming `main`: PR metadata, explicit user base, remote default-branch discovery, then asking the user. `main` remains only a last-resort fallback with `base-detection-failed` recorded in Review Integrity.

**Resolution evidence:**
- `workflow/skills/goat-review/SKILL.md` (search: `baseRefName`) prefers PR metadata when a PR URL or number is available.
- `workflow/skills/goat-review/SKILL.md` (search: `remote HEAD`) discovers the remote default branch before asking.
- `workflow/skills/goat-review/SKILL.md` (search: `base-detection-failed`) records degraded fallback use instead of hiding it.

**Prevention:** Review-base selection must be discovered, not assumed. Prefer PR metadata (`gh pr view ... baseRefName`) when available, then an explicit user-provided base, then remote default-branch discovery from remote HEAD or `git remote show origin`; ask for the base before diffing if discovery fails. Treat `main` only as a last-resort fallback and record a degradation flag when fallback is used.

---

## Footgun: Installed skill copies can drift on punctuation-only edits and fail unrelated test runs

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** `npm test` failed in `test/integration/audit-drift.test.ts` even when the code change did not touch skills, because the tracked installed copies under `.claude/skills/` and `.agents/skills/` had Unicode em dashes while `workflow/skills/` templates had ASCII hyphens.

**Original evidence:**
- `workflow/skills/goat-plan/SKILL.md` vs `.claude/skills/goat-plan/SKILL.md` (search: `Use when work needs milestone tracking`) - hyphen vs em dash
- `workflow/skills/goat-plan/SKILL.md` vs `.claude/skills/goat-plan/SKILL.md` (search: `Milestone files exist for`) - hyphen vs em dash

**Resolution:** Installed copies are now byte-identical with the workflow templates (verified by `diff` returning empty output). The drift check at `test/integration/audit-drift.test.ts` now passes on these files.

**Prevention (retained):** When editing `workflow/skills/*/SKILL.md`, update the installed copies in `.claude/skills/` and `.agents/skills/` in the same change. The preflight `Skill SKILL.md Parity` check and `goat-flow audit --check-drift` both catch byte-level divergence before unrelated work is blocked by stale fixtures.

## Footgun: Workflow template source and installed copy can silently diverge

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-15 | **Updated:** 2026-04-17 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents on consumer projects follow a different rule than agents on the goat-flow repo, because the workflow template (install source) says one thing and the installed copy says another. The divergence is invisible - both files exist, both parse correctly, and no automated check compares their content.

**Resolution:** Four preventions implemented:
1. Divergence fixed - both files now match (verified by diff).
2. Preflight skill-docs sync check (search: `Skill Docs Sync` in `scripts/preflight-checks.sh`) - byte-exact diff of preamble, conventions, and playbooks against workflow templates, fails if any differ.
3. Preflight skill parity check (search: `Skill SKILL.md Parity` in `scripts/preflight-checks.sh`) - byte-exact diff of each workflow template vs `.claude/skills/` and `.agents/skills/` installed copies.
4. CLI drift check (M04, 2026-04-17) via `goat-flow audit --check-drift` (search: `skillContentsEquivalent` in `src/cli/audit/check-drift.ts`) - YAML-aware normalisation so frontmatter key reorder and trailing whitespace do not false-positive; also detects orphan directories and deprecated skill names from `workflow/manifest.json:stale_names`.
5. Integration tests: `test/integration/preamble-sync.test.ts` covers shared docs; `test/integration/audit-drift.test.ts` covers the CLI path with tmpdir fixtures.

**Original evidence (historical):** The shared preamble (template at `workflow/skills/reference/skill-preamble.md`, installed at `.goat-flow/skill-docs/skill-preamble.md`) diverged between template and installed copy around a single-line change; discovered 2026-04-15 by multi-agent critique. Exact line numbers from that incident are no longer recorded here because the file has been edited since.

---

## Footgun: Skills have phase gates but no time/call budget for context gathering

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

Skills enforce phase gates (Step 0 must complete before Phase 1, gates pause for human approval) but have no budget for how long Step 0 can take. Claude can spend an entire session reading templates, exploring the codebase, and gathering context without ever producing output or asking a question.

**Resolution:** Both preventions implemented in `.goat-flow/skill-docs/skill-preamble.md` (search: `## Step 0 Budget`):
1. Step 0 budget: "If Step 0 exceeds 5 file reads without producing output or asking a question, checkpoint with what you know so far."
2. Mid-Step-0 checkpointing: "Checkpoint mid-Step-0 for complex projects rather than silently reading indefinitely."

**Original evidence (historical):** Claude Insights (112 sessions) showed agents reading 20+ files in Step 0 without checkpointing, requiring user intervention to interrupt.

---

- **Workflow-summarising skill descriptions cause CSO shortcutting** (resolved 2026-04-19) - All 7 current goat-* descriptions (including the dispatcher) are compliant with the trigger-only rule ("Use when …"), not workflow summaries. The rule is enforced in `workflow/skills/playbooks/skill-quality-testing/deployment.md` (search: `CSO-optimised`). Original incident was in the external `superpowers-skills` repo; the goat-flow regression was on the dispatcher description and was rewritten the same day it was caught.
- **Dispatcher intent mapping has no coverage for analysis/evaluation verbs** (resolved 2026-04-14) - Added analysis/evaluation verbs to the dispatcher disambiguation table so ambiguous requests prompt skill selection instead of auto-routing.
- **CI template derives skill names by prefixing instead of listing them** (resolved 2026-04-14) - Removed `src/cli/prompt/fragments/` directory in v1.1.0; CI template generation no longer exists.
- **Blind mv/cp/Write can overwrite existing files** (resolved 2026-04-18) - Covered by the Never-tier no-clobber rule and destination-check guidance in the hot-path instruction files; no longer kept as an active architectural footgun.
