---
category: docs-and-crossrefs
last_reviewed: 2026-09-05
---

## Footgun: Path validators can treat gitignored local-state markers as missing docs

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-08-04

**Prevention:** When adding or tightening path validation, classify paths before checking existence: committed setup and doc files must resolve, while gitignored local-state paths are valid navigation vocabulary. Classify exceptional policy paths before generic skip predicates. Keep `scripts/check-path-integrity.sh` and `doc-paths-resolve` on the same local-state exemption policy, and never let a basename fallback search untracked trees, because a fallback is only as trustworthy as the tree it searches.

**Symptoms:** A clean checkout fails the harness `doc-paths-resolve` check because a committed doc names an intentionally gitignored local-state file. In the 1.10.0 release pass, `.goat-flow/glossary.md` (search: `Active Plan Marker`) referenced `.goat-flow/plans/.active`, and a simulated clean checkout without that marker made `goat-flow audit --harness` fail Context with `.goat-flow/glossary.md: unresolved`.

**Why it happens:** Path validators equate "backticked repo path" with "committed file that must exist", but goat-flow also has checkout-local coordination paths (plan markers, scratchpad notes, local logs, dashboard state, project identity) that are deliberately gitignored yet must be named in docs and prompts.

**Evidence:** `src/cli/audit/harness/check-context.ts` (search: `isGitignoredLocalStatePath`) exempts local-state paths before existence checks; `test/unit/audit-command/scoring-model.test.ts` (search: `absent gitignored local-state paths`) reproduces the clean checkout with `.goat-flow/plans/.active`, `.goat-flow/logs/quality/example.json`, `.goat-flow/scratchpad/notes.md`, `.goat-flow/project-id`, and `.goat-flow/dashboard-state.json` missing. **Recurrence 2026-08-01, opposite direction:** `scripts/check-path-integrity.sh` section 8 resolved a `docs/*.md` ref by finding its basename anywhere under the repo, so worktree and scratchpad copies satisfied `docs/coding-standards/git-commit.md` and a plan README satisfied `ISSUE.md`; the check passed on every developer machine and failed only on CI's tracked-only checkout in PR #57. Section 8 now prunes `.claude/worktrees`, `.goat-flow/plans`, `.goat-flow/scratchpad`, and `.goat-flow/logs` and exempts the two refs absent by design, covered by `test/integration/path-integrity.test.ts` (search: `docs cross-references`). **Recurrence 2026-08-04:** `evaluateSearchAnchors` called `isCheckableForStaleness` before classifying gitignored evidence, making that violation branch unreachable until `test/unit/learning-loop.test.ts` (search: `flags a gitignored plans path used as a search anchor even when the file exists`) caught it.

---

## Footgun: Playbooks reference goat-flow repo-internal files absent from consumer installs

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-07-14

**Prevention:** Keep playbook rules self-contained; reference only installed siblings and the consumer's instruction files, and move goat-flow-specific commands, scans, and ADR pointers into goat-flow's own instruction files. Before declaring a playbook or shipped skill done, grep it for `\.goat-flow/(decisions|lessons|patterns|footguns)|src/cli|scripts/|ADR-|check-(drift|goat-flow)|stats --check|DESIGN_TARGET` and confirm any `scripts/...` path it names is listed in `workflow/manifest.json`; otherwise genericize it. Triage each hit: a reference to a learning-loop directory the consumer is meant to populate is portable, because `workflow/install-goat-flow.sh` (search: `for dir in .goat-flow/learning-loop/footguns`) seeds those directories, and only a specific goat-flow-authored file or ADR number is dead.

**Symptoms:** A playbook under `workflow/skills/playbooks/` or a skill under `workflow/skills/` cites an ADR, CLI source, a learning-loop file, an unshipped script such as `scripts/install-browser-tools.sh`, roadmap jargon, or a not-yet-existing file. The reference resolves in this repo and is dead in every consumer install.

**Why it happens:** Playbooks are both goat-flow's working docs and shipped artifacts, and `check-drift.ts` enforces template-versus-installed byte parity, which a repo-internal reference passes identically in both copies.

**Evidence:** The 2026-05-29 pass removed repo-only pointers from `workflow/skills/playbooks/code-comments.md` (search: `Related References`) and `workflow/skills/playbooks/gruff-code-quality.md` (search: `Related References`). On 2026-06-05, `workflow/skills/playbooks/browser-use.md` (search: `browser-use-python`), `workflow/skills/playbooks/page-capture.md` (search: `browser-use-python`), and `workflow/skills/goat-debug/SKILL.md` (search: `Browser evidence detection`) dropped the unshipped installer script for portable package commands; the same day a critique flagged `deployment.md`'s generic decisions-directory reference and was retracted once the installer seeding was verified. **Recurrence 2026-07-14:** M16 linked `hook-policy-testing.md` to three goat-flow-authored files and two gitignored milestone files; parity passed, but `test/integration/audit-drift.test.ts` failed on links resolving under nonexistent `workflow/learning-loop/` paths and `test/integration/setup-quality-lifecycle.test.ts` proved the milestone files never reach a consumer. The playbook now carries its policy inline and links only `.goat-flow/skill-docs/playbooks/hook-policy-testing.md` (search: `## Related References`).

## Footgun: Agent capability metadata goes stale when upstream docs add hooks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Re-check each provider, event, and result channel instead of carrying agent-level support forward.
**Trigger phase:** READ
**Incident count:** 4 | **Latest occurrence:** 2026-08-23

**Prevention:** Check current primary docs and the local binary, then prove the exact event, payload, command, response, continuation, and model visibility separately. Treat config, matchers, and fallbacks as feasibility evidence only. After a correction, grep every product, prose, template, and test consumer for the superseded claim.

**Symptoms:** Hook support drifts independently by event and response channel. Antigravity's 2026-05-26 correction proved PreToolUse config and its 2026-05-28 Gruff correction proved PostToolUse input through file matchers, yet on 2026-08-10 those input paths were still cited as full Gruff support after provider evidence showed their output could not reach the active model.

**Why it happens:** Capability tables freeze one observation and reuse it across events, and setup docs, dashboard state, audit logic, tests, and learning entries then reinforce a claim structural checks cannot validate.

**Evidence:** `workflow/manifest.json` (search: `"hook_config_file": ".agents/hooks.json"`) records the project hook surface without claiming every event returns a result; `src/cli/server/agent-hook-command.ts` (search: `spec.id === "gruff-code-quality"`) proves Antigravity input routing only; `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`) records the delivery limit; `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`) proves the toggle does not create unusable registration. **Recurrence 2026-08-23:** M13's first compatibility matrix said Claude subagents could not spawn subagents, while the current [Claude Code subagent reference](https://code.claude.com/docs/en/sub-agents) says they delegate up to three layers by default and the installed CLI was 2.1.240; rechecking removed that false blocker before the ADR draft.

## Footgun: Active footgun Symptoms paragraph drifts after the underlying bug is fixed

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a behavior fix changes evidence cited by an active footgun, update or resolve that entry in the same change.
**Trigger phase:** ACT
**Caught at:** VERIFY
**Incident count:** 5
**Latest occurrence:** 2026-09-05

**Prevention:** When you fix a bug that has a footgun entry, in the same change either rewrite its Symptoms to the principle the fix demonstrates with anchors at the current shape, or move it to Resolved with a one-line summary; never leave an active entry whose anchors do not resolve. When reviewing a bucket, treat a zero-hit anchor or one that contradicts the prose as a SEV signal. `stats --check` validates literal `(search: ...)` anchors in footguns and lessons and promotes stale existing-target anchors in patterns to blocking findings; `audit --check-content` applies the same literal check to current guidance and accepted ADR evidence. The lifecycle is incident, active footgun, fix, then rewrite or resolve; skipping the last step punishes the agents who follow anchors.

**Symptoms:** An entry tagged `**Status:** active` has good Prevention rules but a Symptoms paragraph describing an obsolete code shape, with an anchor that resolves to contradicting behaviour or to nothing, so agents chase removed code or distrust the whole bucket.

**Why it happens:** The fixer updates code, tests, and release prose but not the footgun, and the Status stays active because the principle holds while the cited identifier goes stale; index freshness cannot prove prose still matches the call site.

**Evidence:** A Codex quality report on 2026-05-25 flagged `.goat-flow/learning-loop/footguns/setup.md` (search: `Codex install migration matcher and post-install validator used different`), whose Symptoms named a matcher that the v1.8.0 installer refactor had replaced with a single `isInvalidNoneKey` predicate; the entry is now resolved with current anchors. **Recurrence 2026-08-04:** the first anchor evaluator missed chained needles and root dotfiles, and naive carry-over crossed sentence boundaries; the final grammar follows chains only from an explicit same-sentence target, per `test/unit/check-content-quality.test.ts` (search: `validates every chained search needle`), (search: `does not guess a target for an unqualified search anchor`), and (search: `validates root dotfile search anchors`). **Recurrence 2026-08-07:** `.goat-flow/learning-loop/footguns/auditor.md` (search: `## Footgun: The deny-mechanism runtime smoke executes the target checkout's own hook command`) was corrected at 07:09 to describe a dashboard audit using `"full"`, and commit `19046c08` changed `src/cli/server/dashboard-audit-routes.ts` (search: `agentFilter === null ? "present-only" : "static"`) at 17:06 without refreshing it; `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) proves the old claim false. **Recurrence 2026-08-10:** the Antigravity capability entry and a resolved migration entry still cited local Gruff wiring as current support after the registry stopped registering it; both now distinguish runnable input handling from model-visible delivery. **Recurrence 2026-09-05:** a concision rewrite of every footgun bucket produced eight `stats --check` findings across three runs, all from the validator's grammar rather than from stale code: two `(search: ...)` needles were re-attributed to a different file named earlier in the same sentence, one long-dead needle surfaced only once its citation used the validated form, one rewording broke an inbound anchor from `.goat-flow/learning-loop/patterns/architecture.md`, a sibling cited as bare `hooks.md` was validated instead of skipped, an entry that named its own bucket without a path lost its only evidence anchor, and the words "retired in" followed by a version number counted against the last active entry twice, once in a trailing resolved bullet list and once in this paragraph's first draft, per `src/cli/facts/shared/learning-loop-sections.ts` (search: `uses retired-file evidence`). Give every needle its own full path in the same sentence, grep inbound anchors before rewording, and keep that phrasing out of active sections.

---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Stage a rename before registering its destination; search all tracked files, not only Markdown, for old paths.
**Trigger phase:** SCOPE
**Caught at:** VERIFY
**Incident count:** 8
**Latest occurrence:** 2026-08-27

**Prevention:** Before a rename, use `git grep` for the exact path and bare filename across all tracked files, stage the destination before changing existence-validated pointers, and repeat both sweeps after edits, classifying old-path hits as compatibility, legacy, or history; include hidden-file `rg` when ignored state matters. After merging a learning-loop bucket or generated index, run `goat-flow index` and `goat-flow stats --check` even when Git reports a clean auto-merge. This is DoD gate #6.

**Symptoms:** A renamed or moved file breaks links in several documents at once. The glossary's Canonical File column, the `NEXT:` links in `workflow/setup/01-system-overview.md`, and the component tables in `.goat-flow/architecture.md` are dense pointer maps, so one stale path misleads setup, glossary, and architecture readers together.

**Why it happens:** Hundreds of committed Markdown files reference each other by relative path (`git ls-files '*.md' | wc -l` gives the current count), so renaming one file typically breaks references in 5 to 10 others.

**Evidence:** 2026-07-27: M01 registered a destination before M02 created it, so audit failed `evidence_path does not exist`, and M02 missed two synthetic config references. 2026-08-09: correcting M02's timeout premise left removed-phrase anchors in two roadmaps and two analysis reports that `rg --hidden --no-ignore` caught. 2026-08-27: renaming the Codex capture-expiry integration test updated the new recurrence but left an older one pointing at the previous title, and later that day Git auto-merged concurrent edits to a bucket and its generated index without a textual conflict while the combined index kept the old decision text and token estimate; `stats --check` caught both. Enforcers: `src/cli/audit/provenance-types.ts` (search: `evidence_path does not exist`), `scripts/profile-dashboard-audit.mjs` (search: `Synthetic. Commit rules`), `src/cli/facts/shared/search-anchors.ts` (search: `Validate one parsed citation`), `test/integration/hook-effective-state.test.ts` (search: `expires exact Codex proof while keeping uncaptured Stop stale`), `src/cli/stats/stats.ts` (search: `stale file ref`), `src/cli/stats/index-freshness.ts` (search: `const expected = formatIndex`). The historical M13 setup-step renumber left three stale pointers at the removed steps 09-customise-to-project and 05-install-skills, since fixed to `workflow/setup/05-customise-to-project.md` and `workflow/setup/03-install-skills.md`.

---

## Footgun: Consolidating a rule stated several ways deletes the riders only one variant carried

**Status:** active | **Created:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Before merging divergent statements of one rule, list every distinct clause across all variants, not only the clause they disagree about. Merge on the conflict, then re-add each rider the merged text dropped.
**Trigger phase:** ACT
**Incident count:** 2
**Latest occurrence:** 2026-08-18

**Prevention:** Enumerate the clause set across every variant before merging and diff the merged text against that set, not against any single source. Pin the recovered rider with a contract assertion in the same change, because a clause no test names is the one the next consolidation deletes. Prefer a pointer over a restatement at every non-owner site; a summary beside the owner is a new variant. Anchor: `test/contract/skill-hardening-shared-2.test.ts` (search: `no other style rule applies unless the user asks`).

**Symptoms:** A deduplication pass makes one rule consistent and silently narrows it, and every contract still passes because the deleted clause existed in prose in exactly one variant.

**Why it happens:** Divergence analysis fixes attention on the axis where variants disagree. Clauses orthogonal to that axis ride along in only some variants and have no advocate during the merge, the shortest consistent wording drops them, and a word budget rewards exactly that. The trap fires again when the merged rule is restated beside its pointer.

**Evidence:** 2026-08-18, M55: three sites stated the replies-editing permission in `.goat-flow/skill-docs/playbooks/writing-human-facing-prose.md` (search: `Replies are deliberately narrow`) and `.goat-flow/skill-docs/playbooks/writing-sentence-diagnostics.md` (search: `Replies to people receive`), disagreeing on whether a diagnosed social cost authorises an edit; only two carried a requested-tone escape, consolidating on the social-cost axis removed it from all three, and the first repair restated `correctness and residue only` as absolute in the Audience paragraph while the owner read `unless the user asks`. The playbook forbids that class of change in its own Correctness and Meaning section (search: `an optional action into a required one`). **Recurrence 2026-08-18:** a line-density rewrite across seven instruction surfaces dropped the user-only commit rider, the current-session GitHub authorization rider, and two canonical retrieval-order phrases; preflight failed 10 of 2,084 tests, and the focused suite failed 4 of 44 until every rider and grep-stable phrase returned. Enforcers: `test/contract/command-phrases.test.ts` (search: `agent mutation and external-write authority`) and `scripts/check-instruction-parity.mjs` (search: `MAX_INSTRUCTION_LINE_CHARACTERS`).

---

## Footgun: ADR renumbering breaks cross-references

**Status:** active | **Created:** 2026-05-18 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When deleting, compacting, or renumbering ADRs, grep `.goat-flow/learning-loop/decisions/` for every old `ADR-NNN` token and replace historical references with the deleted slug, not only the number. Then check topic: each remaining `ADR-NNN` reference either matches the current target title or says `now-removed ADR-NNN-slug`.

**Symptoms:** ADR notes that say "absorbs ADR-NNN" or "supersedes ADR-NNN" point at the wrong decision after deletion and renumbering. The number still resolves, so a path-existence check misses the break while readers land on an unrelated topic.

**Why it happens:** The ADR number is both identity and order. On 2026-04-18 historical stubs were deleted and survivors compact-renumbered, but prose kept the numeric labels without the deleted slug.

**Evidence:** A 2026-05-18 cleanup found three numeric references whose numbers resolved but whose topics no longer matched; the concrete links are fixed and retained under `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `ADR renumbering concrete examples`).

---

## Footgun: Version bump checks do not cover synthetic project config strings

**Status:** active | **Created:** 2026-04-30 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 5 | **Latest occurrence:** 2026-08-10

**Prevention:** Derive fanout from manifest ownership. After every bump, search tracked release surfaces for literal and regex-escaped old versions, capture the release snapshot, run packed-byte canaries, and run the full suite.

**Symptoms:** Curated version and mirror checks pass while fixtures, examples, or newly shipped runtimes retain the previous release.

**Why it happens:** The writer and the checker share the same incomplete list, so agreement does not prove coverage.

**Evidence:** Earlier releases missed synthetic dashboard projects, playbook frontmatter, plan examples, and regex-escaped assertions; 1.15.1 first omitted shared Node hook runtimes, and final proof found two 1.15.0 contract assertions and no frozen v1.15.1 manifest snapshot. Anchors: `scripts/bump-version.sh` (search: `manifest_hook_runtime_paths`), `scripts/check-versions.mjs` (search: `hookRuntimeTemplates`), `test/contract/skill-hardening-review-1.test.ts` (search: `registers evidenced goat-review reasoning traps across every root`), `test/unit/manifest.test.ts` (search: `provides a readable snapshot for every changelog release`).

---

## Footgun: Filesystem-backed validation can miss untracked or ignored replacement files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After any add, rename, or delete tied to setup, dashboard views, or repo-local policy files, run `git status --short` and `git ls-files --error-unmatch <path>` to confirm the replacement path is tracked. When introducing a tracked file under `.goat-flow/`, update `.goat-flow/.gitignore` in the same change, or the fix is local-only.

**Symptoms:** Local validation passes, but the next commit or CI run breaks because the replacement file exists only in the working tree, so the repo looks fixed to the operator while collaborators still get the broken state.

**Why it happens:** Several verification paths inspect the real filesystem, not the git index, and `.goat-flow/.gitignore` ignores almost everything by default, so a new repo-local file can look present while remaining impossible to commit.

**Evidence:** `src/cli/manifest/manifest.ts` (search: `readdirSync(dir)`) validates `facts.dashboard_views` against the working tree; `src/dashboard/index.html` (search: `views/setup.html`) can include a replacement view that is still untracked; `.goat-flow/.gitignore` (search: `*`) ignores new `.goat-flow/*` files unless whitelisted, which masked `.goat-flow/security-policy.md` during local verification.

---

## Footgun: Prose examples for agent-specific paths drift from the manifest

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Before hand-writing an agent-specific path in prose, grep `workflow/manifest.json` for that agent's `skills_dir`, `hooks_dir`, `settings`, or `instruction_file` entry and copy the exact value. When listing satellite-agent directories as examples, enumerate the distinct manifest paths (today `.claude/skills/`, `.agents/skills/`, `.github/skills/`) rather than inventing per-agent subdirectories from agent names, because `doc-paths-resolve` checks only that a path exists, not that it belongs to the named agent.

**Symptoms:** A doc lists an agent-specific path such as `.gemini/skills/` that does not match the manifest. When the wrong path happens not to exist, every agent card drops to 75% Context with the same finding; when it exists, the doc is silently wrong.

**Why it happens:** Prose guesses paths from agent names, but Antigravity and Codex share `.agents/skills/`, so name-based inference is wrong by default for those agents, and the audit verifies existence only.

**Evidence:** `workflow/manifest.json` (search: `"skills_dir"`) has four entries and three distinct paths; `docs/audit-and-quality.md` (search: `satellite agents' skill dirs`) previously named `.gemini/skills/`, which never existed; `src/cli/audit/harness/check-context.ts` (search: `extractBacktickPaths`) is existence-only; `.goat-flow/learning-loop/decisions/ADR-020-add-copilot-cli.md` (search: `Canonical agents`) records the four-agent identity of Claude, Codex, Antigravity, and Copilot.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Concept duplication across core docs** (resolved 2026-04-14) - v1.1.0 removed four conflicting doc files; `workflow/setup/reference/execution-loop.md` is the single source.
- **Product surface count drift across code, docs, config, and tests** (resolved 2026-04-14) - 14 skill-count inconsistencies fixed after the goat-sbao extraction.
- **Skill template paths use framework-local paths instead of project-local paths** (resolved 2026-04-12) - references moved off `workflow/templates/`; the interim `.goat-flow/templates/` was retired and shared references now live at `.goat-flow/skill-docs/`.
- **Refactor cleanup doesn't reach bash script conditional guards** (resolved 2026-04-13) - a dead `[[ -f src/cli/rubric/version.ts ]]` guard silently skipped 74 lines of version checks.
- **Partial feature removal leaves type and detection artifacts** (resolved 2026-04-14) - Copilot removed from type unions, UI name mappers, terminal runner maps, and SKILL_ROOTS after the agent removal.
- **Line target inconsistency for project shapes** (resolved 2026-03-18) - one value for all shapes per ADR-023.
- **CONTRIBUTING.md directs contributors to the wrong subsystem** (resolved 2026-04-13) - rewritten to describe build checks in `check-goat-flow.ts` plus `check-agent-setup.ts` and quality checks in `src/cli/audit/harness/`.
- **Stale references from old project structure** (resolved 2026-04-15) - `ai-workflow-framework` no longer appears anywhere in the repo.
- **Preflight validates doc totals but not sub-breakdowns** (resolved 2026-04-17) - `scripts/preflight-checks.sh` (search: `B.8a2: Sub-breakdown validation`) validates the `(N setup + M agent)` breakdown in `.goat-flow/architecture.md`, not only the total.
- **Dashboard session-limit constants drift across server, UI, docs, and tests** (resolved 2026-04-19) - `src/cli/server/terminal.ts` (search: `MAX_SESSIONS`) exports the constant, `src/cli/server/dashboard-terminal.ts` (search: `MAX_SESSIONS`) imports it, `test/integration/dashboard-server-dashboard-terminal-endpoints.test.ts` (search: `payload.maxSessions`) asserts it, and `docs/dashboard.md` says "Maximum 10 concurrent sessions"; grep `maxSessions`, `serverSessions.length >=`, and `Maximum of` before closing a similar change.
- **ADR renumbering concrete examples** (resolved 2026-05-27) - stale references to `ADR-010-confusion-log-disposition.md`, `ADR-023-expand-inline-conventions.md`, and `ADR-016-dispatcher-is-canonical-skill.md` were fixed before M11; the active entry keeps only the failure pattern.
