---
category: setup-and-migration
last_reviewed: 2026-09-05
---

**Scope:** Installing goat-flow into a project and migrating an existing install - what a package smoke proves, mirror fan-out, the scope a setup agent may write, and concepts that survive their own removal. Repo-wide gates that catch the fallout are [verification-preflight.md](verification-preflight.md).

## Lesson: Packaged install smoke is not a completed setup audit

**Status:** active | **Created:** 2026-08-03
**Decision changed:** Release probes verify deterministic installation and adapted-project audit as separate stages.
**Trigger phase:** VERIFY
**Incident count:** 3 | **Latest occurrence:** 2026-09-05

**Prevention:** In a package smoke, assert version and managed install results on a fresh target, then run the harness, content, and drift audit against a fixture or checkout whose adaptive project content is already complete. Do not treat deterministic file installation as proof that the LLM-authored setup phase ran. For settings changes, also start from an existing settings file without the new keys and follow its generated setup prompt, because reinstalling a freshly seeded target proves preservation rather than upgrade coverage. Evidence anchor: `src/cli/cli-handlers.ts` (search: `Setup preview and setup apply both use the deterministic install path`) routes `setup --apply` through managed installation while plain `setup` composes the adaptive guidance.

**What happened:** A packaged-release probe ran `setup --apply` against an empty git repository and immediately required the full harness audit to pass. The installer correctly wrote its 69 managed files and the audit correctly failed, because no agent had yet authored the project-specific `AGENTS.md`, architecture, or code map that the installer's own next steps name.

**Root cause:** Installation and adaptation are two stages, and a smoke that runs both as one cannot distinguish an installer defect from an unfinished target.

**Recurrence 2026-08-03:** A second release-readiness pass repeated the bare-target audit although this lesson existed; the packaged CLI again installed 69 managed files and correctly failed. Re-reading this entry redirected the package proof to the configured goat-flow checkout, where setup, Codex agent setup, all five harness concerns, 49 drift comparisons, and a 234-file content lint passed.
**Recurrence 2026-09-05:** Attribution verification installed a fresh target twice, missing that an existing settings file keeps attribution unset and that the upgrade prompt skipped the Claude guide holding the merge instruction. A second reproduction created attribution-only settings before installation, and the installer preserved that file without seeding template permissions. `src/cli/prompt/compose-setup.ts` (search: `attributionGuidance`), `workflow/setup/agents/claude.md` (search: `### Attribution settings`), `workflow/install-goat-flow.sh` (search: `const perms = settings && settings.permissions`).

---

## Lesson: Skill edits must fan out to all four installed mirrors, and removed anchors cascade

**Status:** active | **Created:** 2026-07-18

**Prevention:** Treat one canonical skill edit as a four-target fan-out, `workflow/skills/` plus the `.claude/`, `.agents/`, and `.github/` mirrors, and verify with `goat-flow audit . --check-drift`. After deleting or renaming any anchored function, run `goat-flow stats . --check`, rewrite the citing footgun and lesson anchors as dated resolved-history prose, then re-check bucket size. Evidence anchors: `test/unit/support-bundle.test.ts` (search: `emits clean JSON through the CLI`), `.goat-flow/learning-loop/footguns/deny-shell.md` (search: `removed 2026-07-18`).

**What happened:** A goat-critique skill and reference-pack edit was synced to three mirrors and the contract suite passed, but `goat-flow audit . --check-drift` failed on the fourth mirror under `.github/skills/`, taking the workspace-self support-bundle test with it. Separately, removing a hook helper made two footgun evidence anchors stale, failing the `feedback-loop-active` harness check, and rewriting those anchors pushed the footgun bucket over its size gate.

**Root cause:** The mirror set was treated as three targets, and anchor repair was treated as free of size consequences.

---

## Lesson: Agents given broad setup tasks rewrite shared docs as agent-specific

**Status:** active | **Created:** 2026-03-21

**Prevention:** Give every agent setup prompt an explicit write scope naming that agent's own directory and instruction file, and forbid edits outside it. For any agent, shared documentation is a boundary that requires Ask First permission before a setup run touches it.

**What happened:** An agent CLI asked to set up goat-flow modified six shared documentation files, including retired pre-v1.1 architecture docs now superseded by `workflow/setup/01-system-overview.md` and the old getting-started and enforcement docs now under `workflow/setup/` and `workflow/hooks/`. It replaced Claude Code references with its own equivalents, one retired architecture doc lost its Claude Code skills row, and the enforcement template ended in a hybrid state with paths from two agents.

**Root cause:** The setup prompt described the goal without bounding the write scope, so shared documentation looked like fair game for agent-specific adaptation.

**Note:** The incident agent was the since-removed Gemini CLI target; the supported agents are now Claude, Codex, Antigravity, and Copilot, and the rule applies unchanged to each.

---

## Lesson: Setup agents propagate errors from existing instruction files

**Status:** active | **Created:** 2026-03-22

**Prevention:** Audit an existing instruction file before copying from it: verify that Ask First paths exist, that router entries resolve, and that stale paths are corrected before generating cold-path guidance.

**What happened:** One consumer's instruction file named a Rust redaction source file in a project whose redaction is Python only, and another pointed at a middleware module that had been renamed to a proxy module plus a SQL directory that had moved from migrations to schema. Setup agents read those paths as authoritative and copied them into newly generated guidance.

**Root cause:** The verification gate said to verify paths in the generated files but not to audit the existing file being read from, and agents trust the hot-path instruction file without checking it.

---

## Lesson: Agents under line pressure cut "small but required" sections

**Status:** active | **Created:** 2026-03-20

**Prevention:** Every constraint agents are likely to cut under pressure must appear in the shared template and, where an agent guide owns the same limit, in that guide; a rule stated in only one applicable place gets missed. Evidence anchors: `workflow/setup/reference/execution-loop.md` (search: `Target: under 125 lines. Hard limit: 150.`), `workflow/setup/agents/claude.md` (search: `125-line target and 150-line hard limit`), `workflow/setup/agents/copilot.md` (search: `150-line hard limit and 125-line target`).

**What happened:** Two consumer setup runs dropped the Sub-Agent Objectives and Communication When Blocked sections while compressing an instruction file toward its line target. The historical prompt flow warned against skipping those sections in the upgrade prompt but not in the new-project prompt; that path no longer exists and per-agent guidance now lives under `workflow/setup/agents/`.

**Root cause:** A line budget and a required-section list lived in different places, so satisfying the budget silently violated the list.

---

## Lesson: Agents resolve contradictions by following whichever source they read first

**Status:** active | **Created:** 2026-03-20

**Prevention:** When updating a concept that appears in several files, update the file agents read first, before or at the same time as the authoritative source. Never assume agents will reconcile a contradiction; they follow the first version they encounter.

**What happened:** A retired pre-v1.1 system-spec document showed the old five-step execution loop while `workflow/setup/reference/execution-loop.md` had the updated version with SCOPE, and the setup prompt told agents to read the retired spec first. Two consumer setups absorbed the stale loop, and seven of eight gaps in one of them traced to that single contradiction.

**Root cause:** Read order, not authority, decided which version an agent applied. Retiring the old doc removed this duplication, and the principle stands for any concept with more than one home.

---

## Lesson: Removing a concept requires full-repo grep, not just code grep

**Status:** active | **Created:** 2026-03-22
**Incident count:** 2 | **Latest occurrence:** 2026-08-15

**Prevention:** After removing or renaming a concept, search the entire tracked repository with `git grep -l` rather than a curated directory list, then run both `stats --check` and the harness audit, because they cover different surfaces and neither validates search anchors inside ADRs.

**What happened:** The project-shape concept removed under the historical ADR-002 survived in nine setup, workflow, and doc files after only `src/` and `test/` were searched, and the confusion-log concept removed under the historical ADR-001 was recreated by an agent because the constraint never reached the prompt. Current authority for both is `.goat-flow/learning-loop/decisions/ADR-033-goat-flow-directory-restructure.md`.

**Root cause:** A curated grep list encodes where the author expects the concept to live, while a removed concept survives exactly where nobody expected it.

**Recurrence 2026-08-15:** Consolidating 48 ADRs to 24 used a hand-enumerated target list that omitted `.goat-flow/glossary.md`, leaving its Instruction Budget row pointing at a deleted ADR. `stats --check` passed throughout because its anchor validation covers footgun, lesson, and pattern buckets only; the harness audit's `doc-paths-resolve` check caught it at 157 of 158 resolved. `.goat-flow/learning-loop/footguns/docs-drift.md` (search: `The audit validates structure`).

---

## Lesson: Optional setup fields need harness verification too

**Status:** active | **Created:** 2026-04-15

**Prevention:** When removing or downgrading a config concept, audit these surfaces together: the config scaffold, setup docs, prompt text, harness checks, harness summaries, and focused regressions. Run `goat-flow audit . --harness --format json` after the edit to confirm the user-facing contract matches the docs.

**What happened:** Two config fields were removed from the shipped 1.1.0 scaffold and setup flow to keep base setup smaller. The first verification pass checked the installer, setup docs, prompts, and the full suite; a later double-check read the harness code and found `audit --harness` still penalizing projects that correctly omitted those fields.

**Root cause:** The change was treated as simplifying a scaffold rather than changing the semantics of a public config concept, which also lives in advisory harness checks, summary copy, and recommendations.

---

## Lesson: Optional workflow state must not become audit or quality gates

**Status:** active | **Created:** 2026-05-03

**Prevention:** Deterministic audit may check that goat-flow-owned directories and hook registration surfaces exist, but must not score optional local workflow state or project-specific command calibration. Quality prompts must not flag unchecked task or milestone checkboxes, status fields, roadmap files, or completion percentages on their own; report a task-file issue only when an observed skill behaviour fails. Evidence anchors: `src/cli/audit/harness/check-recovery.ts` (search: `not audited`), `src/cli/audit/harness/check-verification.ts` (search: `evidence-before-claims`), `src/cli/prompt/compose-quality-static-sections.ts` (search: `Do NOT report them as quality findings`).

**What happened:** The dashboard rated Recovery low because audit treated unchecked milestone checkboxes as degraded recovery, and rated Verification low because a check required a structured or detected test command. The user corrected both: checkboxes are optional local state that can be long-term roadmap or brainstorming, and the project's test-command choice belongs in quality or release review rather than deterministic install audit.

**Root cause:** Local workflow state was scored as if it were installation state.

---

## Lesson: Installed settings.json deny patterns drifted from workflow templates undetected

**Status:** active | **Created:** 2026-04-26

**Prevention:** After changing deny patterns in `workflow/hooks/agent-config/`, run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` passes. If a new settings surface or deny family is added, extend the parity map and its coverage validation in the same change. Evidence anchor: `scripts/preflight-checks.sh` (search: `Agent Config Parity`).

**What happened:** Multi-agent quality reports found `.claude/settings.json` carrying a narrower force-push deny pattern than the broader push deny in its template `workflow/hooks/agent-config/claude.json`, so the installed copy was weaker than intended and allowed feature-branch pushes the template blocked; another agent's installed settings were correct. The drift was invisible because no preflight or audit check compared installed settings patterns against their templates.

**Root cause:** Preflight had parity checks for skill files and shared references but none for settings deny patterns, and settings files are hand-maintained after install, so an edit to one agent's settings neither propagates nor gets verified.

---

## Lesson: mv/rename overwrites destination file without checking if it exists

**Status:** active | **Created:** 2026-03-21

**Prevention:** Before any `mv`, `cp`, or Write that targets an existing path, run `ls` on the destination first and stop to ask if it exists; `mv -n` refuses to clobber. This is already a Never-tier rule in the instruction files, which forbid overwriting without checking the destination. Evidence anchor: `CLAUDE.md` (search: `Check the destination before overwrite`).

**What happened:** Asked to rename a v0.3 improvements TODO file to v0.4, the agent ran `mv` without checking that v0.4 already existed, overwriting it. When the user said "undo", the agent moved v0.4, by then holding v0.3's content, back to v0.3, destroying v0.4's original content. The file was untracked and unrecoverable.

**Root cause:** A rename was treated as a move of one file rather than a write to a path that might already hold something.
