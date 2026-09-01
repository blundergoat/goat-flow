---
category: skill-authoring
last_reviewed: 2026-08-29
---

**Scope:** Skill candidacy, versioning, tool-isolated execution, and runtime authoring traps. Editing shipped guidance, authority, and size caps lives in [skill-guidance.md](skill-guidance.md); mirror sync lives in [skills.md](skills.md).

## Footgun: Bash-prescribed slash-command or skill bodies break under per-block tool isolation

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. If a SKILL.md body contains a bash block longer than ~10 lines OR more than 2 bash blocks total, refactor to declarative steps that name the tool and the inputs but let the agent pick the invocation.
2. Use direct `!` tool invocations (e.g. `!goat-flow audit`) not `$(goat-flow audit)` substitution — the substitution form forces a subshell whose state doesn't persist beyond the block.
3. Replace heredocs-with-substitution and associative-array tricks with a single file write + read, or with prose that asks the agent to track the value across steps.
4. Validate by reading the SKILL.md as if a fresh agent ran each bash block in isolation: if any block expects a variable from a prior block, the body is prescriptive — refactor before shipping.
5. When a sibling skill has the same shape (multiple skills wrapping the same kind of tool orchestration), audit them together. The kennyjpowers PR #2/decompose.md pattern shows that fixing only the one that bit leaves the rest as latent traps.

**Symptoms:** A SKILL.md or slash-command body grows past one or two `!cmd` invocations into a multi-block bash program. The agent runtime treats each bash block as an independent tool invocation. Variables defined in block N are gone in block N+1; heredocs with substitution, `BASH_REMATCH`, associative arrays, and `$(tool …)` substitution all become unreliable because the shell state is reset between blocks. The command starts producing parse errors or silently does the wrong thing.

**Why it happens:** Authors write a skill body the way they'd write a shell script — top to bottom, with variables shared across steps. Claude Code (and the other supported agent CLIs) treat each fenced bash block as a separate `Bash` tool call. The slash-command body should describe steps declaratively for the agent to execute; it should not prescribe an exact multi-block bash program. The cost is hidden until the body crosses ~10 lines or ~2 blocks — short skills look fine.

**Evidence:**
- External: `kennyjpowers/claude-flow` PR #2 ("feat: add feedback workflow command" follow-up, MERGED 2025-11-21, 1,691 additions / 3,174 deletions). The original `feedback.md` shipped in PR #1 had 26+ bash blocks using `BASH_REMATCH`, heredocs with substitution, and `$(stm list …)` substitution. The PR #2 feedback log in the external specs/add-feedback-workflow-command/05-feedback.md file (search: `Variable Persistence Problem: Bash variables don't persist between separate Bash tool invocations`) names the root cause: *"The command tries to prescribe exact bash scripts instead of providing declarative guidance for Claude to follow."* Fix: declarative steps + direct `!claudekit status stm` invocations replacing `$(claudekit status stm)` substitution.
- External, follow-up: the same defect remained in sibling `decompose.md` (16 bash blocks) until a second feedback cycle. Same author, same codebase, same fix needed twice. Reinforces "when refactoring is the right answer, do the same refactor across sibling files."
- Goat-flow surfaces at risk: every `workflow/skills/*/SKILL.md`, especially the dispatcher (`goat`) and any skill that orchestrates multi-step shell work. Verification: `rg -c '^```bash' workflow/skills/*/SKILL.md` lists current bash-block counts per skill.

Applies wherever goat-flow ships a SKILL.md or command body that orchestrates multi-step bash work. Cross-reference: `.goat-flow/learning-loop/footguns/skills.md` (search: `Skill parity edits can miss`) for the parallel concern about edits not propagating across installed mirrors — a bash-heavy skill compounds that risk because each block must remain byte-identical across all four installed copies.

## Footgun: Release-version bumps can break skill-rename work through stale fixtures and hardcoded current-version routing

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Treat version-sensitive helpers as rename scope: update classifiers, config fixtures, quality snapshot ids and bands, installer version discovery, and setup-routing tests before trusting `npm test`.

**Symptoms:** A skill rename can look complete on directory, manifest, and docs surfaces but still fail verification because release-coupled helpers lag the version bump. On 2026-04-18, a skill-rename verification run first failed `npm test` in `test/integration/audit-build.test.ts` because the shared config stub still encoded the previous release version. After that fix, the same verification pass exposed a second break: setup routing still hardcoded `1.1.x` as the only current branch, so a healthy `1.2.0` project was misclassified as needing an upgrade.

**Evidence:**
- `src/cli/audit/check-goat-flow.ts` (search: `configVersionCurrent`) enforces exact equality between `.goat-flow/config.yaml` and `AUDIT_VERSION`.
- `test/fixtures/projects/index.ts` (search: `stubConfig`) is the shared config stub used by audit-build fixtures; if it drifts from `AUDIT_VERSION`, "healthy project" tests fail for the wrong reason.
- `src/cli/classify-state.ts` (search: `CURRENT_VERSION_FAMILY`) derives the current version family and routes current vs outdated installs; hardcoding a previous family breaks `composeSetup()` as soon as the package version advances.
- `workflow/install-goat-flow.sh` (search: `Read version from package.json`) must derive the install version from `package.json`; a hardcoded fallback recreates the same stale-version trap at install time.

**Recurrence 2026-08-26:** A change renamed two writing playbooks, but the quality snapshot kept `reference:writing-style`, omitted both replacements, and retained old bands for two linked playbooks. Fresh validation found 29 artifacts versus 28 rows, then measured changelog at 80% and release notes at 84% outside 72-76%. Evidence: `package.json` (search: `skill-quality:snapshot`).

## Footgun: New skill proposals can be configuration systems shaped around one workflow rather than general-purpose tools

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Prevention:**
1. Before adding any skill to `workflow/manifest.json` `skills.canonical`, write a one-paragraph "general-purpose justification" answering: would a project with no overlap to the proposer's workflow still benefit? Record it in the corresponding ADR.
2. Treat skill-shaped configuration (per-domain context auto-loading, session-locked taxonomies, opinion-locked keyword maps) as a signal that the work belongs in a downstream plugin or `.goat-flow/skill-docs/playbooks/` rather than a new canonical skill.
3. If the proposal is craft-strong but scope-narrow, route to `.goat-flow/skill-docs/playbooks/` (which agents can opt into per project) rather than `workflow/skills/` (which every harness installs).

**Symptoms:** A thoughtful, first-person, well-written proposal lands for an eighth canonical skill. It solves a real problem the author actually had. On read-through it turns out the skill is parameterised by the proposer's working style (multi-domain isolation, per-project keyword auto-loading, session-locked context, personal taxonomy) rather than by a structural property of any goat-flow project. Accepting it grows the canonical skill set and forces every downstream consumer (and every audit pass that scores skill quality) to carry weight for a workflow most projects do not have.

**Why it happens:** goat-flow has no prose document defining what makes a skill belong in `workflow/manifest.json` (search: `"canonical"`) vs in an out-of-tree plugin. ADR-009 (search: `A skill must have at least one of`) records the *historical* doctrine of consolidating skills, and ADR-021 (search: `goat-critique runs in one mode: full delegated`) records the rejection of one over-narrow mode, but neither serves as a forward-facing scoping checklist for new skill proposals. `docs/skill-authoring.md` covers how to write a skill once accepted, not whether to accept one. Without that gate, well-intentioned skill PRs are evaluated on craft (which they often pass) rather than scope (where they should fail).

**Evidence:**
- `workflow/manifest.json` (search: `"canonical"`) enumerates the eight canonical skills; a ninth grows the surface area of every per-harness mirror, every audit check, and every parity script.
- `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `A skill must have at least one of`) records the doctrine but does not encode it as an authoring-time gate.
- `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`) is the closest prior art for rejecting a configuration-flavored alternative; it lives as a per-skill decision, not a generic test.
- `docs/skill-authoring.md` (search: `Decide First`) is structured as scaffold / validate / interactive / dashboard / authoring checks; none of the sections gate on general-purpose vs. workflow-specific.
- External corroboration: obra/superpowers PR #1571 ("feat: add context-management skill with domain isolation") was closed with the maintainer comment "the skill as designed is shaped around your specific multi-domain workflow ... that's a configuration system, not [a skill]." Superpowers and goat-flow share the same risk because both maintain a small canonical-skill surface.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Routing skill-conventions into goat-security overflows the skill-quality composition cap

**Status:** resolved | **Created:** 2026-08-18 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** Adding goat-security's required Full-depth route to `skill-conventions.md` made the deterministic quality scorer report `composition truncated at 32KB`. Six other functional skills were already truncated, while goat-security's five packs were absent from composition because the skill named bare filenames instead of `references/<file>.md` paths.

**Why it happened:** The 32 KiB composition ceiling was smaller than the context the skills actually instruct agents to load. That evaluator limit encouraged omission of binding guidance from the runtime skill and made incomplete scoring look complete.

**Resolution:** Goat-security now routes Full depth to conventions and names all five packs with explicit `references/` paths. The scorer's bounded composition window is 128 KiB, below the existing 256 KiB artifact ceiling; measured current functional compositions range from 40.5 to 79.1 KiB. A general contract scores every functional skill and rejects any truncation, while the security contract checks its exact composed sources.

**Resolution evidence:** `src/cli/quality/quality-config.ts` (search: `Current full functional contexts measure 40.5-79.1 KiB`), `test/contract/skill-hardening-contracts.test.ts` (search: `against its complete configured context`), and `test/contract/skill-hardening-security-1.test.ts` (search: `goat-security quality composition must include its full configured context`).

**Prevention:** Treat every required route and reference pointer as runtime truth first and evaluator input second. Measure all functional compositions after changing shared guidance, keep the bounded ceiling below `maxArtifactBytes`, and never remove binding guidance merely to satisfy a scorer cap.

---

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
