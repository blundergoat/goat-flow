---
category: setup
last_reviewed: 2026-05-24
---

## Footgun: Codex install migration matcher and post-install validator use different "invalid glob" definitions

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Two paths in `workflow/install-goat-flow.sh` decide whether a `"<key>" = "none"` entry under `[permissions.goat-flow.filesystem]` is invalid: the migration matcher (search: `invalidNoneEntryPattern`) decides whether to rewrite the section, and the post-install validator (search: `function isInvalidNoneKey`) decides whether to abort. Three divergences observed on PR #44:

1. The matcher's `[^"]*\*\*[^"/]*` alternative matches valid subtree-denies like `"secrets/**" = "none"` that the validator correctly skips (because they end in `/**`). Migration then rewrites the section to the canonical block, silently dropping any user-added valid entries (e.g. `"private/**" = "none"`) - data loss that weakens the user's filesystem deny-list.
2. The matcher's `^...$` anchors miss invalid globs inside inline-table forms (`":workspace_roots" = { "*.pem" = "none" }`). The validator's `inlineTablePattern` catches them - so install aborts with `still has invalid Codex permission entries` instead of self-healing the legacy shape.
3. The validator's `:project_roots` check is `/:project_roots/.test(content)` (raw substring against full file). A comment like `# legacy :project_roots removed` blocks the install. The `sectionEntryPattern` similarly scans every `"..." = "none"` line in the file with no section context, treating unrelated `"*.pem" = "none"` entries in custom tables as filesystem errors.

**Why it happens:** Matcher and validator were authored separately - one to spot lines that need canonicalising, the other to ratify the final shape. When the matcher is too broad, valid customs are silently flattened. When it is too narrow, the validator becomes the only line of defence and the install fails for users that migration could have fixed in place.

**Prevention:**
1. Migration and validator must call ONE predicate (`isInvalidNoneKey`-shape). Do not duplicate the rule across two regexes.
2. Any TOML-shape check that needs to ignore comments or inline tables MUST parse keys, not substring-scan raw text.
3. Permission-shape checks MUST be scoped to the relevant section. Regex against full file content treats unrelated tables as configuration errors.
4. Migration that rewrites a whole section drops everything inside the original section that is not in the canonical block - whole-section rewrites are only safe when the canonical block is a strict superset of every shape users are allowed to add.

## Footgun: Hookless agent profiles break when installer treats hooks as universal

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The installer round-trip test can fail for an otherwise valid agent profile with `ERROR: manifest profile for 'antigravity' is incomplete`. PR #44 hit this in `test/integration/audit-drift.test.ts` (search: `install for ${agentId} should pass`) because the round-trip installs every manifest agent, including Antigravity.

**Why it happens:** `workflow/manifest.json` allows capability-limited agents whose hook fields are absent, but the Bash installer previously required `hooks_dir` and `deny_hook` for every profile before copying shared files and skills. That made "no upstream hook mechanism documented yet" indistinguishable from a corrupt manifest profile.

**Evidence:**
- `src/cli/manifest/types.ts` (search: `agents whose upstream CLI exists`) documents optional `deny_mechanism` and `hook_events`.
- `workflow/setup/agents/antigravity.md` (search: `No deny-hook mechanism is wired`) documents Antigravity's current hookless status.
- `workflow/install-goat-flow.sh` (search: `HOOKS_ENABLED=false`) now gates hook copying separately from skills/reference installation.
- `test/integration/audit-drift.test.ts` (search: `install for ${agentId} should pass`) proves every manifest agent still participates in install round-trip coverage.

**Prevention:** Installer profile validation must require `skills_dir` for every agent, but hook fields only when any hook-related destination is present. Do not fix hookless-agent failures by removing the agent from round-trip coverage; that hides installer regressions for capability-limited profiles.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: goat-plan claims "durable shared state" but task files are intentionally gitignored

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `goat-plan/SKILL.md` description updated to say "local working state for the current session" instead of "shared state between human and coding agent." Updated across all agent copies (.claude, .agents) and the workflow template.

**Original symptoms:** The skill description over-promised persistence for gitignored task files.

---

## Footgun: Redundant context files waste token budget on every skill invocation

**Status:** resolved | **Created:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `RULES.md` (432 words) in the goat dispatcher skill loaded on every `/goat` dispatch. 6 of 6 sections duplicated content already in CLAUDE.md and the shared skill preamble. Net unique content: ~30 words. Flagged by a coding agent critique on a consumer project as a framework flaw.

**Why it happened:** RULES.md was created as a standalone "core mandates" file for the mono-skill dispatcher model. When the architecture split into 7 separate skills with a shared preamble (now at `.goat-flow/skill-reference/skill-preamble.md`), the preamble absorbed the same rules but RULES.md was never removed.

**Evidence (historical, pre-subdir-move paths):** `RULES.md` sections mapped 1:1 to existing surfaces. Evidence Standard, Severity Scale, and Learning Loop all duplicated content already in the shared preamble; Execution Loop duplicated CLAUDE.md's loop section. Specific line numbers from 2026-04-16 are stale after the `.goat-flow/skill-reference/` subdir move and are no longer recorded here.

**Resolution:** Deleted `RULES.md`. Moved 2 unique lines into the shared preamble's "Engineering Standards" section.

**Prevention:** When adding a new shared-context file, check whether its content already exists in CLAUDE.md or the shared preamble. Before promoting any file to "load on every invocation," verify it provides net-new signal per token.

---

- **Setup creates parallel surfaces instead of migrating existing ones** (resolved 2026-04-20) - legacy_surfaces block removed from `workflow/manifest.json` and the `# 0. Legacy surface detection` block deleted from `workflow/install-goat-flow.sh` per no-backwards-compat policy. Pre-v1 installs are out of scope; consumer projects on old layouts are expected to start fresh.
- **Setup instructions contradict spec on execution loop steps** (resolved 2026-04-14) - Retired `docs/system-spec.md` and `docs/five-layers.md` in v1.1.0; `workflow/setup/reference/execution-loop.md` is now the single authoritative source.
- **Multi-agent setup files share structure but not vocabulary** (resolved 2026-04-14) - Updated Gemini hook event names and settings.json to use correct CLI-specific vocabulary instead of copying Claude's.
- **Workflow skill templates lag behind installed skills** (resolved 2026-04-15) - All 7 templates now match installed skills; preflight validates version parity.
- **Ask First config/instruction sync is documented as blocking but not validated** (resolved 2026-04-13) - Added `normalizePath()` for glob-aware comparison; downgraded Step 06 "BLOCKING" to advisory.
- **Base setup simplification can leave harness checks enforcing removed config fields** (resolved 2026-04-15) - Harness now treats missing `toolchain` and `ask_first` as optional with explanatory findings.
- **Deduplicated multi-agent setup drifts from per-agent setup rules** (resolved 2026-04-13) - Removed `--agent all` and `composeMultiAgentSetup()`; setup now requires explicit `--agent` flag and routes per-agent only.
- **Setup adds skills but never removes them** (resolved 2026-04-15) - The `agent-skills` check in `check-agent-setup.ts` now detects deprecated skill directories. Upgrade docs include explicit deletion instructions. Migration script handles it automatically.
