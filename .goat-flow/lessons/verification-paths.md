---
category: verification-paths
last_reviewed: 2026-05-25
---

## Lesson: Do not cite gitignored task files from durable artifacts

**Status:** active | **Created:** 2026-05-07

**What happened:** While cleaning review findings for the `/goat-plan` dashboard preset change, I changed an ADR future-work pointer from one local task-file reference to another instead of removing the pointer. The user corrected it: learning-loop entries and decisions must not depend on gitignored task/log/scratchpad files as durable evidence.

**Root cause:** Treated local planning state as if it were a stable cross-reference. Task workspace files are useful coordination artifacts during a session, but they are not durable repo truth for ADRs, lessons, footguns, or patterns.

**Prevention:** Before adding or editing learning-loop or decision artifacts, reject references to gitignored workspace files unless the artifact is documenting that workspace policy itself. Cite committed source files, committed docs, issue/PR URLs, or semantic anchors in durable artifacts instead. Evidence anchors: `.goat-flow/decisions/README.md` (search: `Implementation TODO, checklist, milestone, or scoped plan`), `.goat-flow/decisions/ADR-014-optional-project-calibration-config.md` (search: `Personal preferences stay out`).

---

## Lesson: Framework paths vs project paths in verbatim-installed skills

**Status:** active | **Created:** 2026-04-11
**What happened:** M17a extracted skill modes into the repository template directory and left repository-local template references in the skill files. Skills are installed verbatim, so every project received instructions that pointed back into the goat-flow repo instead of the installed project. A subsequent multi-agent critique pass flagged the bug as the dominant cause of a system-wide quality regression.
**Evidence:** The critique flagged broken template references in 6 of 7 reviewed consumer projects. `workflow/skills/goat/SKILL.md`, `workflow/skills/goat-security/SKILL.md`, `workflow/skills/goat-qa/SKILL.md` all used repository-local template paths instead of installed-project template paths.
**Prevention:** After editing any skill file that references a path, verify the path exists from the PROJECT's perspective, not the goat-flow repo's perspective. Add to DoD: "grep skill files for repository-local template paths and replace them with the installed project-local equivalent before shipping."

---

## Lesson: Ignored `.goat-flow` paths need `rg -uu` during rename verification

**Status:** active | **Created:** 2026-04-15

**What happened:** While renaming the scratch workspace directory to `scratchpad`, the first reference scan used `rg --hidden` and incorrectly appeared clean. A follow-up scan with `rg -uu` found the real remaining self-reference in `commit.md` (later edits made the original line reference stale - exactly the drift pattern this lesson exists to prevent).

**Root cause:** `--hidden` includes hidden files but still respects ignore rules. For `.goat-flow` verification work, that can hide the exact content being checked.

**Prevention:** For path-renames or cross-reference checks that target ignored workspace state, use `rg -uu` from the start and grep both the old and new patterns before declaring the rename verified.

---

## Lesson: Backticks in shell grep patterns can fake a verification failure

**Status:** active | **Created:** 2026-04-18

**What happened:** During rename verification between local task-plan directories, a ripgrep command embedded backticks in the shell pattern. Bash treated the version-like path fragment as command substitution and failed, which made the verification step noisy and ambiguous.

**Recurrence 2026-05-05:** During 1.8.0 task-plan consolidation, a source-slice reference check embedded a literal markdown backtick in the shell regex (`reference/imported...\\.md` with a backtick exclusion). The PreToolUse hook blocked it with `Backtick command substitution hides nested execution`. The check was rerun with a safer single-quoted pattern that avoided backticks entirely.

**Recurrence 2026-05-08:** During the 1.5.1 release bump, a one-off `node --input-type=module` snapshot-generation command used JavaScript template literals inside the shell heredoc. The PreToolUse hook blocked the command with the same `Backtick command substitution hides nested execution` message. The command was rerun with plain string concatenation.

**Recurrence 2026-05-11:** During 1.6.1 scratchpad release-note verification, a stale-version `rg` pattern included markdown backticks around `1.6.0`. The PreToolUse hook blocked it with `Backtick command substitution hides nested execution`. The check was rerun as separate `rg -e` patterns without backticks.

**Root cause:** Mixed markdown/JavaScript-style quoting with shell quoting during a command. The intent was correct, but the shell/hook interpreted literal backticks before the command body could be treated as data.

**Fix:** For verification and one-off repo maintenance commands, use single-quoted patterns or plain string concatenation only. Do not put markdown or JavaScript template-literal backticks inside the shell command. When a command fails due to quoting, rerun a narrower equivalent before claiming the step is verified.

---

## Lesson: Optional skill-path examples still need real targets or non-path phrasing

**Status:** active | **Created:** 2026-04-18

**What happened:** The first preflight run after M14/M15/Wave 6 landed failed path integrity on installed `goat-security` copies and blocked release verification. Two new lines in `workflow/skills/goat-security/SKILL.md` still referenced `workflow/skills/**`, and the new optional policy hook named `.goat-flow/security-policy.md` without shipping the file. Preflight reported the exact failures:

- `FAIL: ./.claude/skills/goat-security/SKILL.md: contains framework-local workflow/ path`
- `FAIL: Installed skill references missing path: .goat-flow/security-policy.md`

**Root cause:** The skill rewrite was authored from the framework repo’s perspective instead of the installed project’s perspective. The policy hook text was written as “optional” in prose, but the path-integrity check correctly treated the literal path as a promised target. That is the same underlying mistake as other installed-skill path bugs: if a shipped skill names a path, the installed project must be able to resolve it.

**Fix:** Reworded the agent-surface bullets to use installed-project paths only, updated the CI/agent-surface reference pack to avoid `workflow/`, and added the canonical stub file at `.goat-flow/security-policy.md`. Preflight then passed with `PREFLIGHT PASSED  45 checks, 19 warning(s)`.

**Prevention:**
1. After editing any skill or reference pack, run path-integrity or full preflight before syncing milestone state.
2. If a path is truly optional, either ship a stub at that exact location or describe the surface without a literal unresolved path.
3. Treat installed skills as project-facing docs, not framework-facing docs; `workflow/` is evidence of perspective drift unless the file lives only in the framework repo.

---

## Lesson: Renaming a tracked file requires manifest fact updates, not just cross-ref updates

**Status:** active | **Created:** 2026-04-19

**What happened:** Renamed the dashboard's old setup-view file to `setup.html` and updated the include in `index.html`. `npm run typecheck` passed. User ran `npm run dashboard` and the CLI threw `ManifestValidationError: workflow/manifest.json has drifted from observed state` at startup because `facts.dashboard_views` still listed `wizard` instead of `setup`.

**Root cause:** Verified with typecheck + grep for direct references, but `workflow/manifest.json` tracks filesystem facts (view names, preset counts) that are validated against observed state at every CLI entry via `validateManifest()`. Typecheck and grep-for-filename don't cover static facts registered in the manifest; drift only surfaces when the manifest loader runs.

**Fix:** When renaming, adding, or removing files tracked in `workflow/manifest.json` `facts.*` arrays (currently `dashboard_views`, `presets_count`), update the manifest alongside the code change and run `node --import tsx src/cli/cli.ts manifest --check` before declaring done. `manifest --check` is the canonical gate for this drift; typecheck will not catch it.

**Prevention update (2026-04-19):**
1. `manifest --check` proves filesystem state, not git index state. New or replacement files can exist locally and still be missing from the next commit.
2. After any file add/rename/delete tied to manifest facts or install contracts, confirm the replacement is tracked with `git status --short` or `git ls-files --error-unmatch <path>`.
3. If the fix depends on a new repo-local path under `.goat-flow/`, verify that `.goat-flow/.gitignore` explicitly allows it to be tracked before declaring the issue closed.

---

## Lesson: Filesystem validation does not prove commit state

**Status:** active | **Created:** 2026-04-19

**What happened:** Two separate fixes looked complete locally but were still absent from the repository state that collaborators and CI would see. `src/dashboard/views/setup.html` existed on disk and satisfied `workflow/manifest.json`'s `dashboard_views` fact check, but the file was untracked while `wizard.html` was deleted. `.goat-flow/security-policy.md` also existed locally and satisfied path-integrity expectations for `goat-security`, but the file was ignored by `.goat-flow/.gitignore` and therefore absent from git history.

**Root cause:** The local verification gates used filesystem reads, not the git index. `src/cli/manifest/manifest.ts` validates dashboard views with `readdirSync()`, and preflight/path-integrity only care whether a path resolves on disk. That is necessary, but it does not prove the replacement file is staged, tracked, or even eligible to be tracked.

**Fix:** Add an explicit tracked-state checkpoint whenever a fix depends on a new or replacement file. For this incident the concrete repair was: whitelist `.goat-flow/security-policy.md` in `.goat-flow/.gitignore`, ensure the replacement dashboard view is tracked, and use `git status --short` plus `git ls-files --error-unmatch <path>` before closing the loop.

**Prevention:**
1. Treat filesystem checks and tracked-state checks as separate gates.
2. After any add/rename/delete, run `git status --short` and confirm the intended replacement path is listed as tracked or staged, not `??` or hidden behind ignore rules.
3. If a local-only fix relies on a repo path under `.goat-flow/`, inspect `.goat-flow/.gitignore` before assuming the file can ship.

---

## Lesson: Refactors that delete files also need tool-config cleanup

**Status:** active | **Created:** 2026-04-20

**What happened:** The setup-summary refactor passed `npm run typecheck` and the focused detector/dashboard tests, but full preflight still failed at the Knip gate. One failure was a stale ignore entry in `knip.json` for a dashboard preset module that no longer matched the source layout; the other was an exported `SetupStackSummary` type that had no external consumer.

**Root cause:** Verified runtime behavior first and only learned about tooling drift at the end. File deletions and new exports change cold-path tool surfaces (`knip.json`, unused-export analysis) even when app behavior and tests are correct.

**Evidence:** Current repository state no longer supports the old deleted-file wording: `src/dashboard/dashboard-custom-prompts.ts` exists and `knip.json` still carries that path (`knip.json` (search: `dashboard-custom-prompts.ts`)). The verified historical knip cleanup example is commit `f7159fb`, where `knip.json` changed an old dashboard preset ignore to the renamed preset module after a preset rename; the dead historical filenames are intentionally omitted because `stats --check` validates literal file refs even in historical examples. The unused-export half of the lesson remains anchored at `src/cli/detect/project-stack.ts` (search: `interface SetupStackSummary`).

**Recurrence 2026-05-25:** `stats --check` failed on newly added footgun buckets because external mini-swe-agent paths were backticked like repo-local paths, and one real goat-flow anchor still searched for `class TerminalSession` after the implementation used `interface TerminalSession`. The repair kept external paths as prose with only semantic search anchors in backticks, then updated the local terminal anchor to the current symbol. Evidence anchors: `.goat-flow/footguns/agent-output-trust.md` (search: `external mini-swe-agent path`), `.goat-flow/footguns/cleanup-layering.md` (search: `interface TerminalSession`), `.goat-flow/footguns/config.md` (search: `external mini-swe-agent paths`).

**Fix:** Remove the stale Knip ignore entry, de-export the setup-summary interface, then rerun `npx knip` before the final preflight pass.

**Prevention:**
1. After deleting or renaming a source file, scan repo tool configs (`knip.json`, eslint/prettier ignores, test fixtures) for stale path references before relying on preflight.
2. After introducing a new exported symbol during a refactor, run `npx knip` before the full gate so unused exports are caught while the context is still local.

---

## Lesson: Manifest changes require matching snapshot updates

**Status:** active | **Created:** 2026-04-24

**What happened:** Changed the decisions directory anchor from the old dot-gitkeep placeholder to `.goat-flow/decisions/README.md` in `workflow/manifest.json` but missed the corresponding entry in `workflow/manifest-snapshots/v1.2.4.json`. The snapshot still listed the old placeholder after the live manifest had moved to `README.md`. Only caught when the user explicitly asked "did you update the snapshot too?"

**Root cause:** Treated `workflow/manifest.json` as a single source file, but v1.2.4 has a parallel snapshot copy that must stay in sync. The verification pass grepped for stale dot-gitkeep references across `workflow/` and `src/cli/` but the grep results included the snapshot hit and it was mentally dismissed as "historical" without reading which version it was. The v1.2.4 snapshot is the CURRENT version's snapshot - not historical.

**Prevention:**
1. After any edit to `workflow/manifest.json`, immediately check whether `workflow/manifest-snapshots/v<current-version>.json` needs the same change. The current-version snapshot is a live mirror, not a historical record.
2. When grepping for stale references, do not dismiss snapshot hits without checking the version number. Only snapshots for OLDER versions are frozen history.

---
