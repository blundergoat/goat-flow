---
category: agent-tooling
last_reviewed: 2026-09-04
---

**Scope:** How the agent uses its tools and environment - resolving install-copy against source paths, recovering rather than bypassing a blocked command, variable scoping under `set -u`, and which artifact is the source of truth. Reading instructions and retrieving memory is [agent-behavior.md](agent-behavior.md).

## Lesson: Confused install-copy path pair for a directory move

**Created:** 2026-04-18
**Updated:** 2026-08-16
**Decision changed:** Resolve the exact workflow source from `workflow/manifest.json` or `rg --files`, then set and verify the installed executable mode explicitly when a copy crosses filesystems.
**Trigger phase:** READ
**Incident count:** 5
**Latest occurrence:** 2026-08-16

**Prevention:** Resolve managed paths from `workflow/manifest.json`, learning entries from `INDEX.md`, and ignored milestones with `rg --files --hidden --no-ignore`. Never infer directory or document names. When distributing executables across WSL, NTFS, or Linux filesystems, copy content, set the destination to the intended mode explicitly, and verify both `stat` and byte parity.

**What happened:** Four pre-edit reads or commands inferred paths: the agent misread a workflow source/install pair as a move, pluralized a managed source directory, guessed the removed historical `ADR-016-dispatcher-is-canonical-skill.md` path, then guessed an M06 milestone filename. Each failed. `workflow/manifest.json` (search: `"source": "workflow/skills/reference/skill-conventions.md"`), `.goat-flow/learning-loop/decisions/INDEX.md` (search: `ADR-033-goat-flow-directory-restructure.md`), and `rg --files --hidden --no-ignore` supplied the exact paths.

**Recurrence 2026-08-16:** Copying `workflow/hooks/post-turn-safety.sh` from the NTFS-backed source checkout into a Linux controller with `cp --preserve=mode` propagated mode `0777` over the controller's intended `0755`. The content was correct, but the installation metadata was not. An immediate `chmod 0755` plus `stat` and byte-parity checks restored the expected installation.

**Root cause:** The agent inferred concept-shaped names instead of resolving the manifest, generated index, or ignored-plan inventory; the install cases also collapsed workflow sources into installed copies or assumed source filesystem metadata was portable.

**Why it matters:** A wrong move can remove consumer templates, an invented source path makes planning fail before useful work begins, and copied mode bits can silently broaden permissions on an otherwise correct installed hook.

---

## Lesson: When deny hook blocks a command, use the unblocked equivalent

**Created:** 2026-03-28
**Updated:** 2026-09-04
**Decision changed:** After a guard rejects cleanup syntax, keep every destructive target literal and use the narrowest permitted file and directory operations.
**Trigger phase:** ACT
**Incident count:** 10 | **Latest occurrence:** 2026-09-04

**Prevention:** When a command is blocked, use the narrow unblocked equivalent instead of bypassing the guard or stopping prematurely. Keep cleanup targets literal in destructive command operands even after validating a shell variable. Prefer individual file removal followed by `rmdir`; use `mv -n` for moves.

**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/`. Used `rm -rf`, blocked by the destructive-shell guard. Instead of `rm file && rmdir dir` (not blocked), it asked the user to delete manually - wasting a round trip on something trivially solvable.

**Root cause:** The agent treated one rejected command shape as a dead end, or assumed a separately validated variable made an unresolved destructive operand easy for the policy hook to verify. The guard classifies the submitted command; it cannot rely on earlier shell reasoning.

**Earlier recurrence (date not recorded):** During CLI menu/install verification, an installer smoke used recursive removal through a temporary-path variable. The recovery preserved the command status, removed files narrowly, and then removed the empty directory. The current guard owns this classification at `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm -r without safe scoping`).

**Incident ledger:**

- **Recurrence 2026-05-17:** A release-blocker cleanup embedded a large helper in one command and hit the segment cap. Moving the inspected helper to a file made the invocation reviewable. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Command has more than 50 chained segments`).
- **Recurrence 2026-07-13:** Two truncation variants were blocked while assembling a rollback patch. The recovery verified an absent destination, created it from the first diff, and appended later diffs. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `truncate can destroy file contents`).
- **Recurrence 2026-07-16:** A read-only search embedded an executable-looking destructive literal and was rejected before `rg` ran. Searching for semantic terms avoided replaying the command shape. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `truncate can destroy file contents`).
- **Recurrence 2026-07-19:** An inline Node summarizer embedded a shell-execution primitive. Piping direct CLI output to `jq` supplied the same assertion without an interpreter wrapper. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Interpreter -c/-e with shell-execution primitive`).
- **Recurrence 2026-08-16:** A known JSON Stop payload was piped into a shell hook. Redirecting an inspected local payload file preserved the test without the prohibited pipe-to-shell shape. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Pipe to shell`).
- **Recurrence 2026-08-22:** Planning reads hit both the command-segment cap and backtick classification. Smaller read batches and an inspected file-backed draft avoided both rejected shapes. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`) and (search: `Command has more than 50 chained segments`).
- **Recurrence 2026-09-03:** An approved disposable-worktree cleanup used recursive removal through a validated shell variable, so PreToolUse rejected the whole batch before execution. The corrected command named the worktree literally, removed the four remaining files individually, and used `rmdir` for the two empty directories. Evidence: `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `rm -r without safe scoping`).
- **Recurrence 2026-09-04:** Two M15 read-only diagnostics were rejected before execution: a double-quoted search embedded Markdown backticks, and an inline Node wrapper referenced `spawnSync`. Literal-safe search terms and a direct CLI-to-`jq` pipeline produced the same evidence without bypassing the guard. Evidence: `workflow/hooks/deny-dangerous.sh` (search: `Backtick command substitution hides nested execution`) and `workflow/hooks/deny-dangerous/patterns-shell.sh` (search: `Interpreter -c/-e with shell-execution primitive`).

---

## Lesson: Installed skill files are not templates
**Created:** 2026-04-04
**Status:** historical | **Reason:** The scanner was removed per ADR-013; the installed-files-are-real-files lesson remains active.

**Prevention:** Never dismiss historical scanner failures or current audit/drift findings on installed skill files as "expected." If a check flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix the installed artifact. Only `workflow/skills/` (distribution templates) should have ADAPT markers. Default: "fix the file", not "suppress the check."

**What happened:** The historical scanner system (removed per ADR-013) flagged AP18 (ADAPT comments in installed skills), causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the relevant installed-artifact checks - not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** Though the scanner was removed per ADR-013, the distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is still fundamental to goat-flow's architecture. Dismissing installed-artifact failures as template noise undermines the current audit/drift checks the same way it undermined the scanner.

---

## Lesson: Agent used setup script as source of truth instead of package.json
**Created:** 2026-04-05

**Prevention:** When version requirements conflict across files, check `package.json` first - the published contract. Scripts and docs derive from it, not the other way around.

**What happened:** Investigating CI test failures on Node 20, the agent read `setup-initial.sh` (which checks for Node 22+) and concluded the project requires Node 22 - contradicting `package.json` `engines.node: ">=20.11.0"`. It then suggested updating CI to Node 22 instead of fixing the scripts. The user corrected this: `package.json` is canonical for the Node version. Three scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`) had the wrong check.

**Why it matters:** Derived artifacts (scripts, docs, CI) can drift from the canonical source. When they conflict, identify which is authoritative rather than picking whichever you read first. For Node version requirements, `package.json` `engines` is canonical - what npm enforces, what CI reads, what downstream consumers see.

---

## Lesson: Sanitizing shell variable capture breaks `set -u` when variable is scoped inside a conditional

**Created:** 2026-04-21

**Prevention:** When adding a filter that can turn non-empty output into empty, trace every downstream reference to the captured variable. In `set -u` scripts, any variable set inside a conditional must be initialized before the conditional or only referenced inside the same branch.

**What happened:** `preflight-checks.sh` had a flaky test: `node --input-type=module` commands occasionally emitted stray diagnostic output containing `[` characters, which `grep` interpreted as regex, producing `grep: Unmatched [` errors. The fix added `| grep -oE '^[0-9]+$' | tail -1` to strip non-numeric output and switched to `grep -Fq` for fixed-string matching. But the sanitization pipeline returned empty when the node command failed in the temp fixture (no working `dist/`), causing `build_count=""`. The outer `if [[ -n "$build_count" ]]` correctly skipped the architecture checks - but `setup_count` was only assigned inside that block. A downstream `if [[ -n "$setup_count" ]]` outside it hit `set -u` (`unbound variable`) and crashed the script.

**Root cause:** Variable scoping. `setup_count` was set on a line that only executes when `build_count` is non-empty, but referenced unconditionally later. The original code never triggered this because without sanitization the node command always produced *some* stdout (even if garbage), so `build_count` was never empty - just wrong. Sanitization made the empty case reachable for the first time.

---

## Lesson: Line-number evidence in footguns/lessons creates silent maintenance debt

**Created:** 2026-04-24

**Prevention:** Use grep-friendly semantic anchors (`(search: "pattern")`, function names, section headings) instead of line numbers or runtime-rendered names. Per ADR-024, line numbers are discouraged in evaluation templates and instruction files. `stats --check` validates `(search: ...)` anchors against literal file content - mechanical enforcement that line numbers and generated labels never had.

**What happened:** Three independent Gemini quality reports in one session flagged stale `file:line` references across footgun entries. `hooks.md` cited old guardrail lines for the read-only whitelist that had moved; `skills.md` cited `skill-preamble.md` lines for the Step 0 budget that had also moved. Nine active line references across 3 footgun files had drifted. README and CLAUDE.md said "line numbers are advisory" but evaluation templates said "RECOMMENDED", so agents kept using them.

**Root cause:** Line numbers shift on every edit to the target file. Unlike stale file paths (which `stats --check` catches), stale line numbers point at valid-but-wrong code and pass all mechanical checks. The guidance was contradictory: README discouraged them while the evaluation template encouraged them.

**Recurrence 2026-06-04:** While adding review-derived footguns, `stats --check` caught an evidence anchor whose search text used `file !== "README.md"` even though the real code used `f !== "README.md"`. The entry failed stale-ref validation before closeout. Lesson: not just "avoid line numbers" - exact semantic anchors still need a grep pass after drafting.

**Recurrence 2026-08-04:** A timing-receipt footgun cited the rendered title of a parameterized test. The title existed in test output but not as literal source, so `stats --check` rejected it. Dynamic fixture values and generated test names are not durable semantic anchors; cite a literal fixture constant, helper, or assertion instead.

**Recurrence 2026-09-01:** A same-agent quality assessment found the active `dashboard-terminal.md` footgun (search: `Workspace terminal waiting state has multiple derived surfaces`) telling agents to instrument "the else branch at line 1916" - a branch the Round-6 redesign had removed - and to add cases to a monolithic test file that had been split months earlier. Both survived `stats --check` because a prose line number ("around line 1916") is not a `file:line` ref, and in a footgun a bare backtick path is existence-checked only on an `Evidence anchors:` line (`src/cli/facts/shared/learning-loop-common.ts`, search: `scanBareEvidenceAnchors`); lessons do check bare paths, but their prefix grammar omits `test/` (search: `const pathPattern`), so a dead `test/` path passes there too. Prevention rules are forward-looking instructions, so the scanner's blind spot matters most there: write every path in a Prevention item as `file (search: "needle")` so it is validated, and describe a mechanism by its function, never by its line.

---

## Lesson: Remove redundant local references after promoting shared doctrine

**Created:** 2026-04-27

**Prevention:** When moving guidance into `.goat-flow/skill-docs/`, grep every old path, remove redundant local copies unless an explicit compatibility requirement exists, and update manifest/install references in the same pass. Compatibility copies are a conscious exception.

**What happened:** M12 promoted browser-use guidance into the canonical shared playbook `.goat-flow/skill-docs/playbooks/browser-use.md`, but the first implementation kept four per-skill browser-use compatibility files under goat-debug reference directories. The user pointed out that once the shared playbook exists, those skill-local copies duplicate doctrine and add a drift surface.

**Root cause:** The agent preserved a backward-compatibility shape without proving any installed project still needed the per-skill file. That weakened the migration: one canonical reference existed, but stale compatibility files could keep attracting edits or references.

---

## Lesson: Sub-agent delegation is universal across goat-flow's four supported agents

**Status:** active | **Created:** 2026-04-20 | **Merged during:** M11 learning-loop consolidation

**Prevention:** Before accepting a finding that adds a capability pre-check, verify it against the four supported agents. If all four ship it, retract the finding. Applies to delegation, hook support, MCP, slash commands, and other historically-partial capabilities.

**What happened:** Quality reports proposed a pre-check before routing to `/goat-critique`, assuming delegation might be unavailable. The user corrected the premise: Claude Code, Codex, Antigravity, and Copilot all ship sub-agent / delegated-agent capability, so the pre-check would be dead ceremony.

**Root cause:** Reviewers reasoned abstractly about platform variance instead of grounding the finding in goat-flow's supported-agent list.

---

## Lesson: Agent wedged its own shell in /tmp and tried to bypass the guard instead of recovering

**Created:** 2026-06-04

**Prevention:**
1. Keep scratch work inside the repo - use `.goat-flow/scratchpad/` (gitignored), never `cd /tmp`. The persistent Bash cwd must not leave the repo tree while a cwd-relative guard is active.
2. A repeated `git repository root unavailable` (or `Guard cannot start`) block on every Bash means the shell cwd is outside the repo. Do not retry or disable the guard - ask the user to type `!cd <repo>` to reset the persisted cwd, and keep working through Read/Edit/Write meanwhile.

**What happened:** While evaluating a GitHub PR, the agent staged scratch files in `/tmp` and ran `cd /tmp` to fetch them. From then on every Bash call was blocked by the PreToolUse guard with `BLOCKED: ... git repository root unavailable`, because the launcher runs `git rev-parse` in the session's persistent cwd and `/tmp` is outside any repo. The agent retried Bash several times, then reached for `dangerouslyDisableSandbox` before concluding it was stuck. The block also rejected the recovering `cd <repo>`, since the guard runs before the command's `cd`.

**Root cause:** Two mistakes. (1) It used `/tmp` as scratch space, moving the persistent shell cwd outside the repo, when a repo-local dir (`.goat-flow/scratchpad/`) would have kept cwd inside the tree. (2) On seeing the same `git repository root unavailable` block on every Bash, it treated each as a one-off and retried or hunted for a bypass instead of recognising a cwd-wedge and asking the user to reset the shell. Trap and fix: `.goat-flow/learning-loop/footguns/hook-installation.md` (search: `outside any git repo`).
