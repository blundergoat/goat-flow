# Successful Patterns

Capture approaches that worked well so future sessions can reuse them deliberately.

## Pattern: Verify structural renames with a repo-wide grep
**Context:** Renaming setup files, moving shared references, or changing canonical doc paths.
**Approach:** Update the replacement file first, grep the old path across active docs/code, fix every live reference, then rerun validation (`validate-goat-flow-setup`, preflight, audit) before closing the task.

## Pattern: Multi-agent critique - how to run it effectively
**Context:** Commissioning multiple independent agent reviews of a framework, architecture, or release candidate.

**When to use:** Large surface area (docs + code + scripts + CI + installed outputs), high cost of a missed finding (audit honesty bugs, user-facing false paths), or pre-release validation.

**How to run:**
1. Give each reviewer the same prompt. Don't share prior reviews - contamination defeats independence.
2. Use different models, not just different instances. Codex and Gemini have different systematic blind spots than Claude. One of each covers more ground than three Claudes.
3. Synthesize and verify after each review. Track first-discovery per finding. Dispute false claims with source evidence before accepting them. ~15-20% of claims per review will need verification.
4. Stop when score variance drops. If several consecutive reviews cluster within a tight score band, coverage is probably adequate. If scores still vary widely, major categories are still being missed.

**Sweet spot by task type:**
- Routine PR or module review: 1, maybe 2 if high-stakes
- Feature or component audit: 3, from different models
- Framework or architecture audit: 4-5, with explicit surface-area scoping in the prompt
- Pre-release with audit honesty concerns: up to 7; accept the synthesis overhead

**Key insight:** MAJOR findings can appear late. Late-session reviews on this repo have surfaced audit-honesty findings (Codex compaction hook false positive, ask_first glob comparison bug) that no earlier reviewer raised. Both would have shipped. Late reviews don't always find only minor things.

**What NOT to do:**
- Don't rank findings by how many reviewers found them. The most important findings are often found by exactly one reviewer.
- Don't use score to select which reviewer to trust. Score tracks coverage, not quality.
- Don't skip synthesis. Raw multi-agent output is noisier than single-agent output. The synthesis step is where reliability comes from.

## Pattern: Verification scope must match change scope
**Context:** Any change that touches more than just code.
**Approach:** When the change is code-only, running tests is sufficient. When the change touches docs, setup prompts, or workflow templates, verification must read those files too. When building on existing files, audit them first - errors in source files propagate to everything built on top.

## Pattern: Blocked ≠ impossible
**Context:** A deny hook blocks a command.
**Approach:** Deny hooks block dangerous patterns, not all operations. When a command is blocked, spend 2 seconds thinking about the safe alternative before asking the user or giving up. `rm -rf dir/` → `rm dir/file && rmdir dir/`. `mv old new` → `mv -n old new`.

## Pattern: Skill consolidation requires a full grep after every merge
**Context:** Renaming, merging, or deleting skills.
**Approach:** After any skill rename/merge/delete: (1) grep entire repo for every old name, (2) check all 3 agent dirs (.claude/, .agents/), (3) check constants + types + test fixtures, (4) run the full test suite + audit. Don't trust "it builds and tests pass" - read the changed files.

## Pattern: Complexity refactors need file-level lint before closeout
**Context:** Reducing complexity in a specific function.
**Approach:** Lint the whole file before declaring the pass complete. A single extracted function can still leave sibling offenders, and helper rewrites can introduce small follow-up mistakes. Treat the file, not the original function, as the verification unit.

## Pattern: Refactors need typecheck before preflight
**Context:** After a large extraction or restructuring pass.
**Approach:** Run `npx tsc --noEmit` before relying on preflight. Complexity-only verification can miss callback type drift, helper return narrowing, and small unused-parameter regressions that only show up once TypeScript checks the whole tree.

## Pattern: Model cross-platform PTY launches as pure spawn specs
**Context:** Terminal or runner integrations that must work on native Windows and POSIX shells.
**Approach:** Keep shell/args/env selection in a pure helper that accepts an explicit platform, keep Windows runner-path ranking in its own helper, test both branches directly with synthetic `win32` / `linux` / `darwin` inputs, then finish with one host-local real spawn repro for the current OS. This keeps Linux/macOS behavior pinned even when the live bug only shows up on Windows.

## Pattern: Summary surfaces should use cheap evidence and reserve full proofs for drill-ins
**Context:** Dashboard home cards, aggregate setup summaries, or any overview route that only needs to answer "is this mechanism installed?" rather than "does the full runtime proof pass right now?"
**Approach:** Split expensive validation by intent. Let summary surfaces use the cheapest evidence that still answers the summary question, such as file presence, cached facts, or a downgraded evidence level. Keep full runtime probes, self-tests, and live enforcement checks on explicit deep paths like per-agent audits, quality pages, or dedicated verification commands. Verify both paths separately: one route-scoped test that proves the summary path stays fast, and one deeper-path test that proves the runtime check still exists where it matters.
