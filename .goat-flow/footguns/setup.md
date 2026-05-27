---
category: setup
last_reviewed: 2026-05-26
---

## Footgun: Optional-hook agent profiles break when installer treats hooks as universal

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The installer round-trip test can fail for an otherwise valid agent profile with missing hook fields, even when that agent legitimately has no project-local hook mechanism yet. PR #44 hit this in `test/integration/audit-drift.test.ts` (search: `install for ${agentId} should pass`) when Antigravity was temporarily modeled as hookless.

**Why it happens:** `workflow/manifest.json` allows agents whose project-local hook fields are absent, but the Bash installer previously required `hooks_dir` and `deny_hook` for every profile before copying shared files and skills. That made "no hook mechanism documented yet" indistinguishable from a corrupt manifest profile.

**Evidence:**
- `src/cli/manifest/types.ts` (search: `upstream runtime has no documented project-local hook wiring`) documents optional `deny_mechanism` and `hook_events`.
- `workflow/install-goat-flow.sh` (search: `HOOKS_ENABLED=false`) now gates hook copying separately from skills/reference installation.
- `test/integration/audit-drift.test.ts` (search: `install for ${agentId} should pass`) proves every manifest agent still participates in install round-trip coverage.

**Prevention:** Installer profile validation must require `skills_dir` for every agent, but hook fields only when any hook-related destination is present. Do not fix hookless-agent failures by removing the agent from round-trip coverage; that hides installer regressions for future capability-limited profiles.

## Footgun: New-harness contributions can bypass the manifest-driven installer and modify shared core surfaces

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Symptoms:** A PR proposes "add harness X support." The diff turns out to copy skill files directly into a new `.harness-x/` directory, hand-edits a CLAUDE.md or AGENTS.md to add harness-specific instructions, monkey-patches `workflow/install-goat-flow.sh` with a harness-specific branch, or forks a shared instruction surface because the new harness "needs its own copy." The PR is craft-strong (the integration works on the proposer's machine) but architecturally wrong: it bypasses the manifest-driven contract every existing harness obeys and creates a divergent install surface that no parity check defends.

**Why it happens:** goat-flow's clean per-harness model — `workflow/manifest.json` declares each agent with its `skills_dir`, `hooks_dir`, `hook_config_file`, and `local_pattern`; `workflow/install-goat-flow.sh` reads the manifest and writes mirrors; `scripts/check-instruction-parity.mjs` enforces shared canonical sections across instruction files — is invisible to a contributor who has not added a harness before. They reach for the most direct mechanism (copy files where the harness expects them) instead of the architectural mechanism (add a manifest entry and let the installer place the files). There is no `docs/adding-a-new-harness.md` walking the path, so each new contribution is a fresh chance to recreate the trap.

**Evidence:**
- `workflow/manifest.json` (search: `"agents"`, `"skills_dir"`, `"hooks_dir"`, `"hook_config_file"`) declares every supported agent in a single contract; bypassing it creates a phantom harness invisible to manifest-driven tooling.
- `workflow/install-goat-flow.sh` (search: `manifest_eval supported-agents`, `SKILLS_DIR`) reads the manifest and writes per-agent mirrors; any harness whose files arrive by another path will silently drift the moment a skill changes.
- `scripts/installers/` holds `install-claude.sh`, `install-codex.sh`, `install-github-copilot.sh`, `install-antigravity.sh`, `install-kilo.sh` — each is a thin wrapper over the manifest-driven core, not a bespoke implementation. A new harness should add a sibling, not a fork.
- `scripts/check-instruction-parity.mjs` (search: `SETUP_FILES`, `LIVE_FILES`, `CANONICAL_SECTIONS`) enforces shared sections across instruction files; a harness that adds its own instruction file without registering it here is silently exempt from the parity contract.
- `AGENTS.md` and `CLAUDE.md` are shared instruction surfaces covered by setup/parity rules; a PR that hand-edits one surface for a new harness without updating the manifest-driven setup path breaks the shared-source pattern that keeps them in sync.
- External corroboration: obra/superpowers PR #1586 ("feat: add DeepSeek TUI harness support") was closed with "we need to use their plugin install mechanism, this would need to target the dev branch, not main, and you'd need to not turn AGENTS.md into a file instead of the symlink it is today." Same trap, same root cause: a contributor reached for the direct mechanism instead of the architectural one.

**Prevention:**
1. Write `docs/adding-a-new-harness.md` enumerating: add a `workflow/manifest.json` agent entry, add the agent's hook config in `workflow/hooks/agent-config/` (if hooks are supported), add a thin wrapper in `scripts/installers/`, register any new instruction file in `scripts/check-instruction-parity.mjs`'s `LIVE_FILES`, run `bash workflow/install-goat-flow.sh` and confirm parity. Cite this doc from `CONTRIBUTING.md` so new-harness contributors find it before writing code.
2. Reject any PR that forks a shared instruction file (`AGENTS.md`, `CLAUDE.md`, future shared surfaces) outside the manifest/setup/parity path. "I need a separate file" is the wrong fix.
3. Reject any PR that hardcodes a harness-specific branch inside `workflow/install-goat-flow.sh`. New harnesses arrive via manifest entries and per-agent wrappers, not by branching the core installer.
4. When adding the 5th, 6th, or Nth harness, run the path-integrity check (`scripts/check-path-integrity.sh`) and the parity check (`scripts/check-instruction-parity.mjs`) and confirm both pass before merging.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Codex install migration matcher and post-install validator used different "invalid glob" definitions

**Status:** resolved | **Created:** 2026-05-24 | **Resolved:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `workflow/install-goat-flow.sh` now uses the same `isInvalidNoneKey` predicate shape in both the Codex permission migration path and the post-install validator. Current anchors: `workflow/install-goat-flow.sh` (search: `Single source of truth: a "none" key is only invalid`) for the migration helper, and `workflow/install-goat-flow.sh` (search: `Single source of truth: must match isInvalidNoneKey`) for the validator helper.

**Original symptoms:** The migration path and validator used separate invalid-glob definitions for `"<key>" = "none"` entries under `[permissions.goat-flow.filesystem]`. That created three failure modes on PR #44: valid trailing-`/**` subtree denies could be flattened during migration, invalid inline-table globs could survive migration and fail validation, and raw substring scans could treat comments or unrelated custom tables as Codex filesystem errors.

**Prevention retained:** Migration and validation must share one predicate for Codex permission key validity. TOML-shape checks that need to ignore comments, inline tables, or unrelated sections must parse the relevant section/key shape instead of scanning raw file content.

---

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
