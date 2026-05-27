---
category: setup-and-migration
last_reviewed: 2026-05-27
---

## Lesson: Agents given broad setup tasks rewrite shared docs as agent-specific

**Created:** 2026-03-21

**What happened:** Gemini CLI was asked to set up GOAT Flow. It modified 6 shared documentation files, including several retired pre-v1.1 architecture docs now superseded by `workflow/setup/01-system-overview.md`, plus the old getting-started and enforcement docs that now live under `workflow/setup/` and `workflow/hooks/`. Those edits replaced Claude Code references with Gemini-specific equivalents. One of the retired architecture docs lost its Claude Code skills row entirely. The enforcement template ended up in a hybrid state - half `.claude/` paths, half `.gemini/` paths.

**Prevention:** Agent setup prompts must include explicit scope constraints. For Gemini: "Only create/modify files under `.gemini/` and `GEMINI.md`. Do NOT modify `docs/`, `workflow/`, or any file outside the `.gemini/` directory." For any agent: treat shared documentation as a boundary that requires Ask First permission.

---

## Lesson: Setup agents propagate errors from existing instruction files

**Created:** 2026-03-22

**What happened:** Rampart's CLAUDE.md had `redaction.rs` (doesn't exist - redaction is Python only). Blundergoat's CLAUDE.md had a stale web middleware path pointing at `middleware.ts` instead of `proxy.ts`, plus a stale API SQL directory pointing at `migrations/` instead of `schema/`. Setup agents read these wrong paths from the existing instruction files and copied them into newly generated cold-path guidance, propagating the error.
**Root cause:** The verification gate said "verify paths in the generated files" but didn't say "also audit the existing instruction file you're reading from." Agents trust the hot-path file as authoritative without checking.
**Fix:** Added an "ALSO AUDIT EXISTING INSTRUCTION FILES" gate to the shared setup-reference guidance - verify Ask First paths exist, check router entries resolve, and fix stale paths before copying them into cold-path files.

---

## Lesson: Agents under line pressure cut "small but required" sections

**Created:** 2026-03-20

**What happened:** Both rampart and sus-form-detector agents dropped Sub-Agent Objectives (f) and Communication When Blocked (g) when compressing CLAUDE.md toward the line target. In the historical setup prompt flow, the instructions said "Do NOT skip sections (f)-(i)" in Prompt B, but Prompt A (used for new projects) didn't have this warning. That old setup-prompt path no longer exists; current per-agent setup guidance lives under `workflow/setup/agents/`.

**Prevention:** Every constraint that agents are likely to cut under pressure must appear in both the shared template (`workflow/setup/reference/execution-loop.md` (search: `Target: under 125 lines. Hard limit: 150.`)) and the current per-agent setup guide under `workflow/setup/agents/` (search: `configured line target and hard limit`). A rule in only one place is a rule that gets missed.

---

## Lesson: Agents resolve contradictions by following whichever source they read first

**Created:** 2026-03-20

**What happened:** A retired pre-v1.1 system-spec document showed the old 5-step execution loop while `workflow/setup/reference/execution-loop.md` had the updated 6-step version with SCOPE. The setup prompt told agents to read the retired spec first. Both rampart and sus-form-detector agents absorbed the stale loop and either didn't notice or couldn't override the newer execution-loop file. 7 of 8 gaps in sus-form-detector traced to this single contradiction.

**Prevention:** When updating any concept that appears in multiple files, update the file agents read FIRST before or at the same time as the authoritative source. Never assume agents will reconcile contradictions - they follow the first version they encounter. Retiring the old system-spec doc in v1.1.0 removes this specific duplication, but the general principle remains.

---

## Lesson: Removing a concept requires full-repo grep, not just code grep

**Created:** 2026-03-22

**What happened:** Shape removed from scanner code (ADR-002) but `[APP / LIBRARY / SCRIPT COLLECTION]` survived in 9 setup/workflow/doc files. Confusion-log removed (ADR-001) but agent recreated it because the constraint wasn't in the prompt.
**Root cause:** Grepped `src/` and `test/` but not `workflow/setup/`, `workflow/`, `docs/`.
**Fix:** Preflight now enforces removed patterns across all live directories. ADR removals must grep the entire repo.

---

## Lesson: Optional setup fields need harness verification too

**Created:** 2026-04-15

**What happened:** `toolchain` and `ask_first` were removed from the shipped 1.1.0 config scaffold and setup flow to keep base setup smaller, and a 1.2.0 revisit task was added. The initial verification pass checked the installer, setup docs, prompts, and the full test suite. A later "double check" read the harness code and found `audit --harness` still penalized projects that correctly omitted those fields.

**Root cause:** Treated the change as "simplify scaffold/docs" instead of "change the semantics of a public config concept." The same concept also lived in advisory harness checks, summary copy, and recommendations.

**Prevention:** When removing or downgrading a config concept, audit these surfaces together: config scaffold, setup docs, prompt text, harness checks, harness summaries, and focused regressions. Always run `goat-flow audit . --harness --format json` after the edit to confirm the user-facing contract matches the docs.

---

## Lesson: Optional workflow state must not become audit or quality gates

**Created:** 2026-05-03

**What happened:** The dashboard rated Recovery low because audit treated unchecked `.goat-flow/tasks/` milestone checkboxes as degraded recovery. It also rated Verification low because `test-runner-configured` required a structured/detected test command or saved validation artifact. The user corrected both assumptions: task checkboxes are optional local workflow state and can be long-term roadmap or brainstorming; project test command choice is project-specific and belongs in quality/release review, not deterministic install audit.

**Prevention:** Deterministic audit may check that goat-flow-owned directories and hook/registration surfaces exist, but must not score optional local workflow state or project-specific command calibration. Quality prompts must also avoid flagging unchecked task/milestone checkboxes, status fields, roadmap files, or completion percentages by themselves. Only report task-file issues when an observed skill behavior fails. Evidence anchors: `src/cli/audit/harness/check-recovery.ts` (search: `not audited`), `src/cli/audit/harness/check-verification.ts` (search: `evidence-before-claims`), `src/cli/prompt/compose-quality.ts` (search: `Do NOT report them as quality findings`).

---

## Lesson: Installed settings.json deny patterns drifted from workflow templates undetected

**Created:** 2026-04-26

**What happened:** Multi-agent quality reports found `.claude/settings.json` had `Bash(*git push*--force*)` while the workflow template (`workflow/hooks/agent-config/claude.json`) had the correct `Bash(*git push*)`. The installed copy was weaker than intended, allowing feature-branch pushes that the template blocked. `.gemini/settings.json` was correct. At incident time, the drift was invisible because no preflight or audit check compared installed settings patterns against their templates.
**Root cause:** Preflight had parity checks for skill files (`Skill SKILL.md Parity`) and shared references (`Preamble/Conventions Sync`), but did not yet have equivalent coverage for settings.json deny patterns. The settings files are hand-maintained after install, and edits to one agent's settings don't automatically propagate or verify against the template.
**Prevention:** After changing deny patterns in `workflow/hooks/agent-config/*.json`, run `bash scripts/preflight-checks.sh` and confirm `Agent Config Parity` still passes. If a new settings surface or deny family is added, extend the parity map and `covers()` validation in `scripts/preflight-checks.sh` in the same change.

---

## Lesson: mv/rename overwrites destination file without checking if it exists

**Created:** 2026-03-21

**What happened:** User asked to rename `TODO_improvements_v0.3.md` to `TODO_improvements_v0.4.md`. Agent ran `mv v0.3 v0.4` without checking that v0.4 already existed. The mv overwrote v0.4 with v0.3's content. When the user said "undo", the agent moved v0.4 (now containing v0.3's content) back to v0.3, destroying v0.4's original content entirely. The file was untracked by git and unrecoverable.

**Prevention:** Before any `mv`, `cp`, or Write that targets an existing path, MUST run `ls` on the destination first. If the destination exists, stop and ask the user. This applies to all file operations that can overwrite - not just mv. Add to the Never tier: "Overwrite existing files without confirming destination is safe."
