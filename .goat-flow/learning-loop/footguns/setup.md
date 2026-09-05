---
category: setup
last_reviewed: 2026-09-05
---

## Footgun: A preview-layer classification change is inert until apply consumes the decision

**Status:** active | **Created:** 2026-08-15 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When changing what a preview row means, identify which process performs the write. If that is the shell installer, the change is not done until a per-path decision reaches it and `copy_file` honours it. Prove it with an integration fixture that runs the public CLI and asserts on target bytes, in the shape of `test/integration/setup-install-upgrade-1150.test.ts` (search: `the upgrade must preserve project content under an unchanged template`). Never re-derive the classification in Bash; one contract, generated or passed, is the rule for this surface.

**Symptoms:** Dry-run shows the new row, the verdict and exit code change, and the user's file is still overwritten. Every classifier unit test passes, and typecheck cannot see the gap because the two halves are written in different languages.

**Why it happens:** Preview classification, admission, and authority live in TypeScript; the writes live in the installer script. Nothing in the type system, the linter, or a classifier unit test crosses that boundary.

**Evidence:** While implementing 1.16.0 M02's `local-preserved` rule on 2026-08-15, `classifyManagedSetupFile` changed and `install` exited 0, but `workflow/install-goat-flow.sh` (search: `copy_file()`) still replaced every system-owned destination. The fix was a decision channel: `src/cli/install-command.ts` (search: `Each row's own decision travels to Bash`) turns preview rows into `--preserve-path` and `--replace-user-path` flags, and `workflow/install-goat-flow.sh` (search: `installer_path_is_preserved`) consults them inside `copy_file`.

## Footgun: Optional-hook agent profiles break when installer treats hooks as universal

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Installer profile validation requires `skills_dir` for every agent, but hook fields only when a hook-related destination is present. Do not fix a hookless-agent failure by removing the agent from round-trip coverage; that hides installer regressions for future capability-limited profiles.

**Symptoms:** The installer round-trip test fails for a valid agent profile that has no project-local hook mechanism yet. PR #44 hit this in `test/integration/audit-drift-checkdrift-installer-round-trip-fixture.test.ts` (search: `install for ${agentId} should pass`) when Antigravity was temporarily modelled as hookless.

**Why it happens:** `workflow/manifest.json` allows agents without project-local hook fields, but the Bash installer once required `hooks_dir` and `deny_hook` for every profile, so "no hook mechanism documented yet" looked like a corrupt profile.

**Evidence:** `src/cli/manifest/types.ts` (search: `upstream runtime has no documented project-local hook wiring`) documents optional `deny_mechanism` and `hook_events`; `workflow/install-goat-flow.sh` (search: `HOOKS_ENABLED=false`) gates hook copying separately from skills and references; the round-trip test above keeps every manifest agent in coverage.

## Footgun: New-harness contributions can bypass the manifest-driven installer and modify shared core surfaces

**Status:** active | **Created:** 2026-05-26 | **Evidence:** OBSERVED

**Prevention:**
1. Add a harness through the manifest: a `workflow/manifest.json` agent entry, its hook config in `workflow/hooks/agent-config/` when hooks are supported, registration of any new instruction file in `scripts/check-instruction-parity.mjs` `LIVE_FILES`, then `bash workflow/install-goat-flow.sh` and a parity run.
2. Reject a PR that forks a shared instruction file (`AGENTS.md`, `CLAUDE.md`) or hardcodes a harness-specific branch inside `workflow/install-goat-flow.sh`. "I need a separate file" is the wrong fix.
3. Before merging any new harness, run `scripts/check-path-integrity.sh` and `scripts/check-instruction-parity.mjs`.

**Symptoms:** A PR copies skill files into a new `.harness-x/` directory, hand-edits an instruction file, or patches the installer with a harness-specific branch. It works on the proposer's machine and creates a divergent install surface that no parity check defends.

**Why it happens:** The per-harness model is invisible to a first-time contributor: the manifest declares each agent's `skills_dir`, `hooks_dir`, `hook_config_file`, and `local_pattern`; the installer reads it and writes mirrors; the parity script enforces shared sections. No document walks that path, so contributors reach for the direct mechanism.

**Evidence:**
- `workflow/manifest.json` (search: `"agents"`) declares every supported agent; `workflow/install-goat-flow.sh` (search: `manifest_eval supported-agents`) writes per-agent mirrors from it; `scripts/check-instruction-parity.mjs` (search: `LIVE_FILES`) enforces shared sections only for registered files.
- `scripts/installers/*.sh` install the agent CLIs themselves and never call the goat-flow installer, so they are not where a harness is added.
- External corroboration: obra/superpowers PR #1586 ("feat: add DeepSeek TUI harness support") was closed for bypassing the plugin install mechanism and turning a symlinked `AGENTS.md` into a file.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Final-path checks followed symlinked parent directories

**Status:** resolved | **Created:** 2026-07-14 | **Resolved:** 2026-07-17 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Managed-write admission must inspect every target path component before any file or directory creation and must not let force bypass an unsafe component.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-07-14

**Resolution:** Managed preview, install state, and installer admission inspect each existing path component before scaffolding or writing, and `--force` cannot bypass a symlinked or non-regular component.

**Original symptoms:** M26 placed `.goat-flow/logs/quality` as a symlink to a directory outside the project with an outside `README.md` matching the template, and a final-path check accepted it. M28 then showed that validating staged files was still too late: a symlinked `.goat-flow` root received 19 setup directories before the first file check blocked.

**Why it happened:** `lstat` does not follow the final symlink, but it resolves symlinked parents on the way to a child, so a final-file check proved only that the last component was regular.

**Evidence:** `src/cli/managed-setup-write-set.ts` (search: `Every parent must remain a real directory`); `src/cli/managed-setup-state.ts` (search: `Require project-local directories before any baseline read or write`); `src/cli/managed-setup-admission.ts` (search: `no authority bypasses path safety`); `workflow/install-goat-flow.sh` (search: `The shared setup root must be local before migrations`); regressions in `test/integration/setup-install-preview.test.ts` (search: `blocks symlinked managed parents even when force is supplied`), `test/unit/managed-setup-preview.test.ts` (search: `rejects a valid baseline behind a symlinked install-state directory`), and `test/integration/setup-install-atomic-staging.test.ts` (search: `blocks a symlinked goat-flow root before creating outside directories`).

**Prevention retained:** Walk every destination component before scaffolding and before file writes. Treat symlinked, non-regular, and unreadable components as path-safety failures that no overwrite flag bypasses, and snapshot the outside tree in regression tests so a green status proves containment.

---

## Footgun: Codex install migration matcher and post-install validator used different "invalid glob" definitions

**Status:** resolved | **Created:** 2026-05-24 | **Resolved:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `workflow/install-goat-flow.sh` uses one `isInvalidNoneKey` predicate shape in both the Codex permission migration (search: `Single source of truth: a "none" key is only invalid`) and the post-install validator (search: `Single source of truth: must match isInvalidNoneKey`).

**Original symptoms:** Separate definitions of an invalid `"<key>" = "none"` entry under `[permissions.goat-flow.filesystem]` produced three failures on PR #44: valid trailing-`/**` subtree denies flattened during migration, invalid inline-table globs surviving migration, and raw substring scans treating comments or unrelated tables as errors.

**Prevention retained:** Migration and validation share one predicate for Codex permission key validity, and TOML-shape checks parse the relevant section instead of scanning raw file content.

---

## Footgun: goat-plan claims "durable shared state" but task files are intentionally gitignored

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** The `goat-plan/SKILL.md` description now says "local working state for the current session" in the workflow template and every installed copy.

---

## Footgun: Redundant context files waste token budget on every skill invocation

**Status:** resolved | **Created:** 2026-04-16 | **Evidence:** ACTUAL_MEASURED

**Resolution:** `RULES.md` in the dispatcher skill loaded 432 words on every `/goat` dispatch, and 6 of 6 sections duplicated `CLAUDE.md` or the shared preamble. It was deleted and its 2 unique lines moved into the preamble's Engineering Standards section.

**Prevention retained:** Before promoting a file to "load on every invocation", check whether its content already exists in the instruction file or the shared preamble, and verify it provides net-new signal per token.

---

- **Setup creates parallel surfaces instead of migrating existing ones** (resolved 2026-04-20) - the `legacy_surfaces` block and the installer's legacy-surface detection were removed per the no-backwards-compat policy; pre-v1 installs start fresh.
- **Setup instructions contradict spec on execution loop steps** (resolved 2026-04-14) - v1.1.0 removed `docs/system-spec.md` and `docs/five-layers.md`; `workflow/setup/reference/execution-loop.md` is the single source.
- **Multi-agent setup files share structure but not vocabulary** (resolved 2026-04-14) - hook event names and settings now use each CLI's own vocabulary instead of Claude's.
- **Workflow skill templates lag behind installed skills** (resolved 2026-04-15) - all templates match installed skills; preflight validates version parity.
- **Ask First config/instruction sync is documented as blocking but not validated** (resolved 2026-04-13) - `normalizePath()` added for glob-aware comparison; Step 06 downgraded from blocking to advisory.
- **Base setup simplification can leave harness checks enforcing removed config fields** (resolved 2026-04-15) - missing `toolchain` and `ask_first` are optional with explanatory findings.
- **Deduplicated multi-agent setup drifts from per-agent setup rules** (resolved 2026-04-13) - `--agent all` and `composeMultiAgentSetup()` removed; setup requires an explicit `--agent`.
- **Setup adds skills but never removes them** (resolved 2026-04-15) - the `agent-skills` check in `check-agent-setup.ts` detects deprecated skill directories and the migration script removes them.
