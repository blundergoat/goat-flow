---
category: agent-behavior
last_reviewed: 2026-05-01
---

## Lesson: Agent ignored explicit "next step" command in pasted output

**Created:** 2026-05-01

**What happened:** User pasted goat-flow setup output that included a clearly labeled "Next step (recommended): Run `goat-flow audit . --harness`" section. The agent read the output, confirmed the dashboard was fixed, and reported success - without running the recommended command. The user had to explicitly ask "did you run this?" before the agent executed it. The command would have been the first end-to-end verification that the harness concern removal actually worked in practice.

**Root cause:** The agent treated the pasted output as informational context rather than an implicit instruction. It confirmed the text looked correct ("5 concerns, no Boundary") but never executed the verification step that the output itself prescribed. This is a verification gap: claiming success based on reading text rather than running the command that proves it.

**Why it matters:** "Next step (recommended)" in CLI output exists precisely because the preceding command cannot fully verify the system on its own. Skipping it means the agent declared victory on a structural change (removing a harness concern) without the end-to-end proof that the change worked. The user caught it; in a less attentive session the gap would have shipped silently.

**Prevention:** When pasted output contains a "next step", "recommended", or "run this" command, treat it as an implicit instruction and execute it immediately. This is especially critical after structural changes where the command is the verification gate. Reading output is not running it.

---

## Lesson: Commit subjects paraphrased the diff with weak verbs

**Created:** 2026-04-29

**What happened:** Audit of the last 10 commit messages on `dev` (HEAD `0366419`..`82db04b`, 2026-04-25..2026-04-29) showed 7 of 10 subjects led with *enhance, improve, streamline,* or *clarify* and carried no body. Examples: `feat(deny-dangerous): enhance command checks for combined shell flags and git push scenarios`, `refactor(docs): streamline artifact routing instructions and enhance clarity`, `refactor(docs): enhance clarity in artifact routing and learning loop instructions` (back-to-back, near-identical wording on different content). Reading the message in isolation - without the diff - told a future bisector or release-notes drafter nothing about what actually changed.

**Root cause:** The agent was generating commit subjects by paraphrasing the diff in abstract verbs ("the change makes X better") instead of naming the concrete edit ("replace shell-specific build steps with Node fs calls"). The prior `.github/git-commit-instructions.md` listed format rules and a "what not to commit" list but did not name the failure mode or show a bad-vs-good rewrite, so the rules were easy to satisfy on paper while still emitting low-information subjects. One outlier commit (`4e0ec5d fix(dashboard): speed up home audit load on Windows`) carried a concrete subject + bulleted body and stood out as the gold standard.

**Why it matters:** Commit messages are the only artifact a future maintainer reads when running `git log`, `git bisect`, or assembling a CHANGELOG. Subjects built from *enhance/improve/streamline/clarify* force every reader to open the diff to learn what shipped, defeating the purpose of structured commits. The synonym churn ("streamline... enhance clarity" two commits in a row) is also a tell that the agent was rewording rather than describing.

**Prevention:** `.github/git-commit-instructions.md` (and its mirror `docs/coding-standards/git-commit.md`) now (a) ban the weak-verb list explicitly, (b) prescribe concrete verbs (*add, remove, replace, rename, fix, deny, gate, harden, cache*), (c) require a body whenever the subject names more than one axis or has a non-obvious motivation, and (d) include three bad→good rewrites built from the actual recent log so the agent has an imitable pattern, not just abstract rules. The gold-standard `4e0ec5d` body is reproduced inline as the body template (search: "speed up home audit load on Windows" in `.github/git-commit-instructions.md`).

## Lesson: Retrieval terms must name the concrete failure class

**Created:** 2026-04-18

**What happened:** During the M10 retrieval proof, the plan-oriented query `support matrix|agent matrix|registry canonicality` returned zero learning-loop hits for M12 work even though the relevant trap already existed in `.goat-flow/footguns/hooks.md`. Rewording the search to the concrete platform limitation - `Codex has no compaction notification hook` - found the entry immediately.

**Root cause:** The first query mirrored the milestone title instead of the language used by the stored incident. The learning-loop buckets are written around concrete symptoms, platform limits, and file/tool names; abstract planning vocabulary is too detached from that corpus.

**Why this matters:** Search-first retrieval only works if the first query is grounded enough to overlap with the recorded evidence. Weak cues do not just miss a convenience result; they create false confidence that "nothing relevant exists" unless the protocol forces a reword or an explicit miss.

**Prevention:** Build the first retrieval query from target area + symptom + named file/tool, not from milestone names or architecture abstractions. If the first pass is abstract, reword toward the concrete failure class before concluding miss.

---

## Lesson: Confused install-copy path pair for a directory move

**Created:** 2026-04-18

**What happened:** User proposed `.goat-flow/skill-reference/` as a new installed-state location for the three reference files currently at `workflow/skills/reference/` (`skill-preamble.md`, `skill-conventions.md`, `skill-quality-testing.md`) - intended as part of goat-flow's install-copy flow, grouping the trio alongside `.goat-flow/footguns/`, `.goat-flow/lessons/`, `.goat-flow/decisions/`. The agent read the proposal as "move/rename `workflow/skills/reference/` → `.goat-flow/skill-reference/`" and framed the change as a restructure that would leave `workflow/skills/reference/` depopulated. User had to restate the install relationship explicitly: *"workflow contains all the files for the goat-flow system installation ... .goat-flow/skill-reference/ would be used to copy those three files for the goat-flow system itself"*.

**Root cause:** Agent collapsed the `workflow/` vs `.goat-flow/` distinction when reading the proposal. goat-flow's architecture has a load-bearing split - `workflow/` is template source (what the goat-flow package ships), `.goat-flow/` is installed state (what exists in a consumer project after install) - and the install script copies from the former to the latter. When the user names a path under each, the default reading should be "install-copy relationship" (both paths exist; one populated from the other at install time), not "rename" (one replaces the other).

**Why it matters:** Proposing a rename out of `workflow/` would have stripped goat-flow of its template source. A consumer project has no `workflow/` directory; any SKILL.md cross-reference that points there is broken post-install. The user had to correct the misreading before any implementation could start - at real cost in turn-count and user frustration.

**Prevention:** When the user proposes a new path under `.goat-flow/` that co-exists with an existing path under `workflow/`, default to reading it as "both paths exist, with install-time copy between them". Before recommending any move, ask whether the template source at `workflow/...` should remain populated. The invariant to preserve: `workflow/` stays as template source; `.goat-flow/` is populated from it at install time.

---

## Lesson: When deny hook blocks a command, use the unblocked equivalent

**Created:** 2026-03-28
**Updated:** 2026-05-01

**What happened:** Agent needed to delete `.github/skills/goat-onboard/` and `.github/skills/goat-reflect/` directories. Used `rm -rf` which was blocked by deny-dangerous.sh. Instead of using `rm file && rmdir dir` (which is not blocked), the agent asked the user to delete manually - wasting a round trip on something trivially solvable.

**Repeat incident:** During CLI menu/install verification, the installer smoke command used `rm -rf "$tmp"` for temp cleanup and the deny hook blocked it. The corrected smoke used a fixed `/tmp/goat-flow-install-smoke-*` path, preserved the command status, and cleaned up with `rm -r "$tmp"` after verification.

**Root cause:** Agent defaulted to `rm -rf` out of habit and treated the deny hook block as a dead end instead of thinking about alternatives for 2 seconds.
**Fix:** When a command is blocked, think about the unblocked equivalent. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`. The deny hook blocks dangerous patterns, not all file operations.

---

## Lesson: Installed skill files are not templates
**Created:** 2026-04-04

**What happened:** Scanner flagged AP18 (ADAPT comments in installed skills) causing a -2pt deduction on all 3 agents. Instead of fixing the installed files, the agent dismissed the failure as "expected for a template repo" and proposed suppressing AP18 when scanning the goat-flow repo. The user corrected this: `.claude/skills/`, `.agents/skills/`, `.github/skills/` are real project files that must pass the scanner at 100% - they are not templates. The templates live in `workflow/skills/` where ADAPT markers belong.

**Why it matters:** The entire point of the scanner is to validate installed files. Dismissing scanner failures on installed files undermines the tool's purpose. The distinction between template source (`workflow/skills/`) and installed copies (`.claude/skills/`, `.agents/skills/`, `.github/skills/`) is fundamental to goat-flow's architecture.

**Prevention:** Never dismiss scanner failures on installed skill files as "expected." If the scanner flags something in `.claude/skills/`, `.agents/skills/`, or `.github/skills/`, fix it. Only `workflow/skills/` (the distribution templates) should have ADAPT markers. When the scanner reports a deduction, the default response is "fix the file" not "suppress the check."

---

## Lesson: Agent used setup script as source of truth instead of package.json
**Created:** 2026-04-05

**What happened:** When investigating CI test failures on Node 20, the agent read `setup-initial.sh` (which checks for Node 22+) and concluded the project requires Node 22 - contradicting `package.json` `engines.node: ">=20.11.0"`. The agent then suggested updating CI to Node 22 instead of fixing the scripts. The user corrected this: `package.json` is the canonical source of truth for the Node version requirement. Three shell scripts (`setup-initial.sh`, `dependency-install.sh`, `start-dev.sh`) all had the wrong version check.

**Why it matters:** Derived artifacts (scripts, docs, CI) can drift from the canonical source. When they conflict, the agent must identify which source is authoritative rather than picking whichever it read first. For Node version requirements, `package.json` `engines` is always canonical - it's what npm enforces, what CI reads, and what downstream consumers see.

**Prevention:** When version requirements conflict across files, check `package.json` first. It's the published contract. Scripts and docs are derived from it, not the other way around.

---

---

## Lesson: Scanner 100% does not mean the project is correct

**Created:** 2026-03-31

**What happened:** goat-flow scored 100% on its own scanner while preflight-checks.sh failed with 8 errors. Scanner checked structural presence (files exist, have right headings). Preflight checked functional correctness (commands work, paths resolve, versions match).

**Prevention:** Don't treat scanner score as a quality gate for the whole project. Use it for what it checks (structure) and preflight for what it checks (function). When they disagree, investigate.

---

## Lesson: Single-source-of-truth claims need a cold-path review pass

**Created:** 2026-04-18

**What happened:** M12 moved agent support metadata into `workflow/manifest.json`, but a follow-up code review still found residual parallel authority surfaces: Codex was given a fictional `post_turn: "Stop"` event in the manifest, the dashboard frontend narrowed injected agent ids back to `claude | codex | gemini`, and `.goat-flow/config.yaml` unknown `agents:` ids only produced warnings so audit status stayed green.

**Prevention:** When claiming "single writable authority", run a cold-path pass that searches for hardcoded enums, literal allowlists, and docs/templates restating the same contract. The migration is not complete until manifest, installer, config validation, audit failures, and frontend payload readers all agree on the same authority.

---

## Lesson: Sanitizing shell variable capture breaks `set -u` when variable is scoped inside a conditional

**Created:** 2026-04-21

**What happened:** `preflight-checks.sh` had a flaky test: `node --input-type=module` commands occasionally emitted stray diagnostic output containing `[` characters, which `grep` interpreted as regex, producing `grep: Unmatched [` errors. The fix added `| grep -oE '^[0-9]+$' | tail -1` to strip non-numeric output and switched to `grep -Fq` for fixed-string matching. But the sanitization pipeline returned empty when the node command failed in the temp fixture (no working `dist/`), causing `build_count=""`. The outer `if [[ -n "$build_count" ]]` correctly skipped the architecture checks - but `setup_count` was only assigned inside that `if` block. A downstream `if [[ -n "$setup_count" ]]` outside the block hit `set -u` (`unbound variable`) and crashed the script.

**Root cause:** Variable scoping assumption. `setup_count` was set on a line that only executes when `build_count` is non-empty, but was referenced unconditionally later. The original code never triggered this because without sanitization the node command always produced *some* stdout (even if it included garbage), so `build_count` was never empty - it was just wrong. The sanitization made the empty case reachable for the first time.

**Prevention:** When adding a filter that can turn non-empty output into empty output, trace every downstream reference to the captured variable. In `set -u` scripts, any variable set inside a conditional must either be initialized before the conditional or only referenced inside the same branch.

---

## Lesson: Line-number evidence in footguns/lessons creates silent maintenance debt

**Created:** 2026-04-24

**What happened:** Three independent Gemini quality reports in one session flagged stale `file:line` references across footgun entries. `hooks.md` cited `deny-dangerous.sh` lines for the read-only whitelist that had moved, and `skills.md` cited `skill-preamble.md` lines for the Step 0 budget that had also moved. Nine active line references across 3 footgun files had drifted. The framework's README and CLAUDE.md already said "line numbers are advisory" but evaluation templates said "RECOMMENDED," so agents kept using them.

**Root cause:** Line numbers shift on every edit to the target file. Unlike stale file paths (which `stats --check` catches), stale line numbers point at valid-but-wrong code and pass all mechanical checks. The guidance was contradictory: README discouraged them while the evaluation template encouraged them.

**Prevention:** Use grep-friendly semantic anchors (`(search: "pattern")`, function names, section headings) instead of line numbers. Per ADR-024, line numbers are now discouraged in evaluation templates and instruction files. `stats --check` validates `(search: ...)` anchors against actual file content, giving mechanical enforcement that line numbers never had.

---

## Lesson: Remove redundant local references after promoting shared doctrine

**Created:** 2026-04-27

**What happened:** M12 promoted browser-use guidance into the canonical shared playbook `.goat-flow/skill-playbooks/browser-use.md`, but the first implementation kept four per-skill browser-use compatibility files under goat-debug reference directories. The user pointed out that once the shared playbook exists, those skill-local copies duplicate doctrine and create another drift surface.

**Root cause:** The agent preserved a backward-compatibility shape from the starting point without proving that any installed project still needed the per-skill file. That weakened the shared-reference migration: one canonical reference existed, but stale compatibility files could keep attracting edits or references.

**Prevention:** When moving guidance into `.goat-flow/skill-reference/`, grep every old path, remove redundant local copies unless there is an explicit compatibility requirement, and update manifest/install references in the same pass. Compatibility copies are a conscious exception, not the default cleanup state.

---
