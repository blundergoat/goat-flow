---
category: skill-authoring
last_reviewed: 2026-09-05
---

**Scope:** Skill candidacy, versioning, tool-isolated execution, and runtime authoring traps. Editing shipped guidance, authority, and size caps lives in [skill-guidance.md](skill-guidance.md); mirror sync lives in [skills.md](skills.md).

## Footgun: Bash-prescribed slash-command or skill bodies break under per-block tool isolation

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. If a SKILL.md body holds a bash block longer than about 10 lines or more than 2 bash blocks, refactor to declarative steps that name the tool and inputs and let the agent pick the invocation.
2. Use direct `!` invocations such as `!goat-flow audit`, not `$(goat-flow audit)` substitution. Replace heredocs-with-substitution and associative-array tricks with one file write plus read, or with prose that asks the agent to carry the value.
3. Validate by reading each bash block as if a fresh agent ran it alone; a block that expects a variable from an earlier block is prescriptive.
4. When sibling skills share the shape, fix them together. `rg -c '^```bash' workflow/skills/*/SKILL.md` lists current block counts.

**Symptoms:** A skill body grows into a multi-block bash program. The runtime treats each fenced block as an independent Bash call, so variables, `BASH_REMATCH`, associative arrays, and `$(tool ...)` substitution vanish between blocks and the command parses badly or silently does the wrong thing.

**Why it happens:** Authors write the body like a shell script, top to bottom with shared state, while Claude Code and the other supported CLIs reset shell state between blocks. Short skills look fine, so the cost stays hidden until the body crosses the threshold.

**Evidence:** External: `kennyjpowers/claude-flow` PR #2 (merged 2025-11-21) rewrote a `feedback.md` command that shipped with 26+ bash blocks; its feedback log (search: `Variable Persistence Problem: Bash variables don't persist between separate Bash tool invocations`) names the cause, and the sibling `decompose.md` needed the same fix a cycle later. Local: every `workflow/skills/*/SKILL.md`, especially the dispatcher, ships to four mirrors that must stay byte-identical, so a bash-heavy body compounds `.goat-flow/learning-loop/footguns/skills.md` (search: `Skill parity edits can miss`).

## Footgun: Release-version bumps can break skill-rename work through stale fixtures and hardcoded current-version routing

**Status:** active | **Created:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-26

**Prevention:** Treat version-sensitive helpers as rename scope: update classifiers, config fixtures, quality snapshot ids and bands, installer version discovery, and setup-routing tests before trusting `npm test`.

**Symptoms:** A skill rename looks complete on directory, manifest, and docs surfaces but fails verification because release-coupled helpers lag the bump. On 2026-04-18 `test/integration/audit-build.test.ts` failed because the shared config stub encoded the previous version; then setup routing still hardcoded `1.1.x` as the only current family and classified a healthy `1.2.0` project as needing an upgrade.

**Why it happens:** Several helpers encode the current version independently, and the rename itself exercises none of them.

**Evidence:** `src/cli/audit/check-goat-flow.ts` (search: `configVersionCurrent`) requires exact equality with `AUDIT_VERSION`; `test/fixtures/projects/index.ts` (search: `stubConfig`) is the shared stub; `src/cli/classify-state.ts` (search: `CURRENT_VERSION_FAMILY`) routes current versus outdated installs; `workflow/install-goat-flow.sh` (search: `Read version from package.json`) must derive the install version rather than hardcode it. **Recurrence 2026-08-26:** renaming two writing playbooks left the quality snapshot with `reference:writing-style`, no rows for the replacements, and stale bands, so validation found 29 artifacts against 28 rows and measured changelog and release notes at 80% and 84% outside 72-76%; anchor `package.json` (search: `skill-quality:snapshot`).

## Footgun: New skill proposals can be configuration systems shaped around one workflow rather than general-purpose tools

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Prevention:**
1. Before adding a skill to `workflow/manifest.json` `skills.canonical`, record a one-paragraph general-purpose justification in the ADR: would a project with no overlap to the proposer's workflow still benefit?
2. Treat skill-shaped configuration (per-domain context auto-loading, session-locked taxonomies, personal keyword maps) as a signal that the work belongs in a downstream plugin or a playbook under `.goat-flow/skill-docs/playbooks/`, which projects opt into, rather than `workflow/skills/`, which every harness installs.

**Symptoms:** A well-written proposal for a ninth canonical skill solves a real problem the author had, but the skill is parameterised by the proposer's working style rather than by a structural property of goat-flow projects. Accepting it makes every consumer and every skill-quality audit carry weight for a workflow most projects lack.

**Why it happens:** No document defines what belongs in `skills.canonical` versus out of tree. ADR-009 records the historical consolidation doctrine and ADR-021 rejects one over-narrow mode, but neither is a forward-facing scoping gate, and `docs/skill-authoring.md` covers how to write a skill, not whether to accept one. Proposals are therefore judged on craft, which they pass, rather than on scope.

**Evidence:** `workflow/manifest.json` (search: `"canonical"`) lists eight skills; `.goat-flow/learning-loop/decisions/ADR-009-skill-consolidation.md` (search: `A skill must have at least one of`); `.goat-flow/learning-loop/decisions/ADR-021-goat-critique-full-mode-only.md` (search: `goat-critique runs in one mode: full delegated`); `docs/skill-authoring.md` (search: `Decide First`). External corroboration: obra/superpowers PR #1571 ("feat: add context-management skill with domain isolation") was closed as "a configuration system, not [a skill]".

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Routing skill-conventions into goat-security overflows the skill-quality composition cap

**Status:** resolved | **Created:** 2026-08-18 | **Resolved:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** The scorer's composition window is 128 KiB, under the 256 KiB artifact ceiling, and measured functional compositions run 40.5 to 79.1 KiB. Goat-security routes Full depth to conventions and names its five packs with explicit `references/` paths; a general contract rejects any truncation and the security contract checks its exact composed sources. Anchors: `src/cli/quality/quality-config.ts` (search: `Current full functional contexts measure 40.5-79.1 KiB`), `test/contract/skill-hardening-contracts.test.ts` (search: `against its complete configured context`), `test/contract/skill-hardening-security-1.test.ts` (search: `goat-security quality composition must include its full configured context`).

**Original symptoms:** Adding the Full-depth route made the scorer report `composition truncated at 32KB`. Six other skills were already truncated, and goat-security's packs were absent from composition because the skill named bare filenames.

**Prevention retained:** Treat every required route and reference pointer as runtime truth first and evaluator input second; never remove binding guidance to satisfy a scorer cap.

---

## Footgun: Review skills can choose the wrong PR base when they hardcode `origin/main`

**Status:** resolved | **Created:** 2026-04-25 | **Resolved:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `/goat-review` resolves the base in preference order: PR metadata (`baseRefName`), explicit user base, remote default-branch discovery, then asking. `main` is a last resort recorded as `base-detection-failed` in Review Integrity. Anchors in `workflow/skills/goat-review/SKILL.md`: (search: `baseRefName`), (search: `remote HEAD`), (search: `base-detection-failed`).

**Original symptoms:** A 2026-04-25 consumer report showed a project comparing feature branches to `origin/deploy` while the skill and every installed mirror defaulted PR detection and fallback to `origin/main`.

---

## Footgun: Skills have phase gates but no time/call budget for context gathering

**Status:** resolved | **Created:** 2026-04-05 | **Resolved:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `.goat-flow/skill-docs/skill-preamble.md` (search: `## Step 0 Budget`) caps Step 0 at 5 file reads before checkpointing and requires mid-Step-0 checkpoints on complex projects. Claude Insights over 112 sessions had shown agents reading 20+ files without output until the user intervened.

---

- **Workflow-summarising skill descriptions cause CSO shortcutting** (resolved 2026-04-19) - every goat-* description follows the trigger-only rule enforced in `workflow/skills/playbooks/skill-quality-testing/deployment.md` (search: `CSO-optimised`).
- **Dispatcher intent mapping has no coverage for analysis/evaluation verbs** (resolved 2026-04-14) - those verbs were added to the dispatcher disambiguation table.
- **CI template derives skill names by prefixing instead of listing them** (resolved 2026-04-14) - `src/cli/prompt/fragments/` was removed in v1.1.0.
- **Blind mv/cp/Write can overwrite existing files** (resolved 2026-04-18) - covered by the Never-tier no-clobber rule in the hot-path instruction files.
