---
category: docs-and-crossrefs
last_reviewed: 2026-08-10
---

## Footgun: Path validators can treat gitignored local-state markers as missing docs

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A clean checkout fails the harness `doc-paths-resolve` check because a committed doc mentions an intentionally gitignored local-state file. The path is valid as workflow vocabulary, but absent by design. In the 1.10.0 release pass, `.goat-flow/glossary.md` (search: `Active Plan Marker`) referenced `.goat-flow/plans/.active`; simulating a clean checkout where that marker was absent made `goat-flow audit --harness` fail Context with `.goat-flow/glossary.md: unresolved`.

**Why it happens:** Path validators usually equate "backticked repo path" with "committed file that must exist." goat-flow also has checkout-local coordination paths: plan markers, scratchpad notes, local logs, dashboard state, and project identity. Those are deliberately gitignored but still need to be named in docs and prompts.

**Evidence:** `src/cli/audit/harness/check-context.ts` (search: `isGitignoredLocalStatePath`) now exempts those local-state paths before existence checks. `test/unit/audit-command/scoring-model.test.ts` (search: `absent gitignored local-state paths`) reproduces the clean-checkout case with missing `.goat-flow/plans/.active`, `.goat-flow/logs/quality/example.json`, `.goat-flow/scratchpad/notes.md`, `.goat-flow/project-id`, and `.goat-flow/dashboard-state.json`.

**Prevention:** When adding or tightening path validation, classify paths before checking existence: committed setup/doc files must resolve; gitignored local-state paths should be treated as valid navigation vocabulary. Keep `scripts/check-path-integrity.sh` and `doc-paths-resolve` aligned so clean checkouts and installed skills use the same local-state exemption policy.

**Recurrence update (2026-08-01):** Same script, opposite direction. `scripts/check-path-integrity.sh` section 8 resolved a `docs/*.md` ref by finding its basename anywhere under the repo, pruning only `node_modules`, `.git`, and `dist` - so untracked trees *satisfied* refs instead of failing them: worktree and scratchpad copies of the renamed commit guide resolved `docs/coding-standards/git-commit.md`, and `.goat-flow/plans/*/ISSUE.md` resolved `ISSUE.md`. It passed on every developer machine and failed only on CI's tracked-only checkout, inside PR #57's installer round-trip preflight. Section 8 now prunes `.claude/worktrees`, `.goat-flow/plans`, `.goat-flow/scratchpad`, and `.goat-flow/logs` from that fallback, and exempts the two refs absent by design: the `/goat-plan` `ISSUE.md` artifact and the ADR-043 compatibility commit-guide path. `test/integration/path-integrity.test.ts` (search: `docs cross-references`) covers both directions. A basename fallback is only as trustworthy as the tree it searches.

**Recurrence update (2026-08-04):** `evaluateSearchAnchors` initially called `isCheckableForStaleness` before classifying gitignored evidence, making that violation branch unreachable. `test/unit/learning-loop.test.ts` (search: `flags a gitignored plans path used as a search anchor even when the file exists`) caught it. Classify exceptional policy paths before generic skip predicates.

---

## Footgun: Playbooks reference goat-flow repo-internal files absent from consumer installs

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A playbook under `workflow/skills/playbooks/` (installed to `.goat-flow/skill-docs/playbooks/`) or a skill under `workflow/skills/` (installed to `.claude/skills/`, `.agents/skills/`, etc.) cites goat-flow's own repo-internal files - an ADR (`.goat-flow/learning-loop/decisions/ADR-NNN`), CLI source (`check-drift.ts`, `src/cli/...`), a learning-loop file (`.goat-flow/learning-loop/lessons|patterns|footguns`), a repo-internal script under `scripts/` (e.g. `scripts/install-browser-tools.sh`, which ships via neither `workflow/manifest.json` nor the `workflow/` template tree), roadmap jargon (`DESIGN_TARGET`, milestone ids), or a not-yet-existing file ("`conventional-comments.md` (when it exists)"). The reference resolves in this repo but is dead and confusing in a consumer install where those files never ship.

**Why it happens:** Playbooks are dual-purpose - goat-flow's own working docs AND shipped artifacts installed into consumer projects. Anything that resolves in this repo but is not installed becomes a dead reference downstream. Only sibling playbooks (`observability.md`, `code-comments.md`) and the consumer's own instruction files (`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`) are present in both contexts. `check-drift.ts` enforces template-vs-installed byte parity but does NOT catch this: a repo-internal reference drifts identically in both copies and passes drift.

**Evidence:** The 2026-05-29 pass removed repo-only pointers from `workflow/skills/playbooks/code-comments.md` (search: `Related References`) and `workflow/skills/playbooks/gruff-code-quality.md` (search: `Related References`). On 2026-06-05, `workflow/skills/playbooks/browser-use.md` (search: `browser-use-python`), `workflow/skills/playbooks/page-capture.md` (search: `browser-use-python`), and `workflow/skills/goat-debug/SKILL.md` (search: `Browser evidence detection`) dropped the unshipped `scripts/install-browser-tools.sh` path for portable package commands.

**Prevention:** Keep playbook rules self-contained; reference only installed siblings (other playbooks) or the consumer's instruction files. Move goat-flow-repo-specific commands, scans, and ADR pointers to goat-flow's own instruction files, not the shipped playbook. Internal milestone files under `.goat-flow/plans/` are exempt - they are repo-local. Before declaring a playbook or shipped skill done, grep it for `\.goat-flow/(decisions|lessons|patterns|footguns)|src/cli|scripts/|ADR-|check-(drift|goat-flow)|stats --check|DESIGN_TARGET`, and confirm any `scripts/...` or other repo path it names is listed in `workflow/manifest.json` - otherwise genericize it to a portable command.

**Avoid false positives in that grep:** the installer seeds the learning-loop *directories* into consumers - `workflow/install-goat-flow.sh` (search: `for dir in .goat-flow/learning-loop/footguns`) mkdirs `.goat-flow/{footguns,lessons,patterns,decisions,...}` and seeds `.goat-flow/learning-loop/decisions/README.md`. So a reference to a learning-loop *directory the consumer is meant to populate* (e.g. `page-capture.md`'s `.goat-flow/learning-loop/patterns/<project>-playwright.md`, or "grep `.goat-flow/learning-loop/footguns/` for the target area") is portable and must NOT be "fixed". Only a *specific goat-flow-authored file or ADR number* that never ships downstream is dead: `ADR-024`, `src/cli/...`, a named goat-flow lesson/footgun file. Triage each grep hit as directory-generic-for-the-consumer (keep) vs goat-flow-specific-file (move out). 2026-06-05: a playbook critique flagged `deployment.md`'s generic `.goat-flow/learning-loop/decisions/` reference as a dead-ref; verification (`install-goat-flow.sh` seeds the dir) retracted the finding.

**Recurrence update (2026-07-14):** M16 initially linked `hook-policy-testing.md` to three goat-flow-authored ADR/footgun files and two gitignored 1.25.0 milestone files. Source/install byte parity and focused playbook contracts passed, but `test/integration/audit-drift.test.ts` failed because the relative links resolved under nonexistent `workflow/learning-loop/` and `workflow/plans/` paths, while `test/integration/setup-quality-lifecycle.test.ts` proved the milestone files never reached a consumer. The playbook now carries the necessary policy boundaries inline and links only the shipped sibling at `.goat-flow/skill-docs/playbooks/hook-policy-testing.md` (search: `## Related References`).

## Footgun: Flipping a doctrine in one playbook leaves siblings citing the old stance

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A policy change in one doc passes its own review, but a sibling playbook or instruction file still encodes - and triages by - the OLD stance. The two cross-reference each other, so they now contradict. A sibling may even quote another file's stance that no longer exists. Structural checks (drift parity, path resolution) stay green because nothing moved or renamed; only the meaning changed.

**Why it happens:** Doctrine lives in prose spread across densely cross-referencing docs. Changing the canonical statement does not update the docs that cite or depend on it, and no structural check compares *meaning*.

**Evidence:** After `code-comments.md` flipped from "default no comments" to mandatory doc comments on every unit (2026-05-29), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` still triaged `docs.missing-internal-function-doc` as "gold-plating the playbook forbids" per the old "no comment unless WHY" default, and attributed that default to `CLAUDE.md` - which contains no such stance (grep of `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` returned zero comment-policy hits). Reconciled at `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Doc comments are mandatory under that playbook`).

**Prevention:** When you flip a doctrine, grep sibling playbooks, instruction files, and reference docs for the OLD stance's phrasing AND for any doc that cites the changed file by name; reconcile them in the same change. Grep the ACTUAL old wording, not a guessed token - the first cross-ref pass missed "Default to writing no comments" by grepping for "default-no-comment". Verify cross-file quotes: a doc that says `X says "..."` must actually match X.

## Footgun: Adding an instruction-file section ripples across four section-list sources plus the line target

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Adding one `## <Section>` heading to an instruction file (e.g. `## Commit Messages` in the 2026-05-29 commit-doc consolidation) fails seemingly-unrelated contracts: the instruction-parity script reports "canonical H2 order mismatch"; live instruction files can overflow the `line_target` budget; setup-guide ordering and the shared skeleton can drift; and - if the heading is added to manifest `required_sections` - the harness `instruction-sections-present` check fails every stub instruction fixture that lacks it (`boundaryInstruction` / `completeInstruction`).

**Why it happens:** The canonical instruction-file section set is declared in multiple places that must agree, and a separate line-count contract caps the same files:
- `scripts/check-instruction-parity.mjs` (search: `CANONICAL_SECTIONS`) - exact H2-order match across all 7 instruction files (3 live + 4 setup guides).
- `workflow/manifest.json` (search: `"required_sections"`) - drives the harness `instruction-sections-present` check on EVERY audited project, including test stubs and downstream installs.
- `workflow/setup/reference/execution-loop.md` (search: `Required Sections`) - the lettered skeleton each setup guide mirrors; a test asserts it names every section.
Live instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) also cap at `line_target` 125 (search: `line_target`), so adding a section to an already-full file (they sit at ~124) overflows.

**Evidence:** `scripts/check-instruction-parity.mjs` (search: `"Commit Messages"`), `workflow/setup/agents/codex.md` (search: `## Commit Messages`), and `workflow/setup/reference/execution-loop.md` (search: `e) Commit Messages`) gained the section in lock-step. `workflow/manifest.json` `required_sections` deliberately does NOT list it because the stub instructions lack the heading. Room was reclaimed by condensing the numbered Truth Order to one prose line (search: `User's explicit instruction (this session) >`).

**Prevention:** To add a canonical instruction-file section, update the parity `CANONICAL_SECTIONS`, the setup guides, and the skeleton `execution-loop.md` (with re-lettering) together, then add the section to all 7 instruction files. Leave manifest `required_sections` alone unless you also give every stub instruction fixture the heading - enforce instead via parity (own files) and setup templates (downstream). Budget the ~125-line live-file cap by condensing existing content. See ADR-031.

## Footgun: Agent capability metadata goes stale when upstream docs add hooks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Re-check each provider, event, and result channel instead of carrying agent-level support forward.
**Trigger phase:** READ
**Incident count:** 3 | **Latest occurrence:** 2026-08-10

**Symptoms:** Hook support can drift independently by event and response channel. Antigravity's 2026-05-26 correction proved PreToolUse config, and its 2026-05-28 Gruff correction proved PostToolUse input through file matchers and a changed-file fallback. On 2026-08-10, those input paths were still cited as full Gruff support after provider evidence showed their output could not reach the active model.

**Why it happens:** Capability tables freeze one observation and reuse it across events. Setup docs, dashboard state, audit logic, tests, and learning entries then reinforce a user-visible claim that structural checks cannot validate.

**Evidence:**
- `workflow/manifest.json` (search: `"hook_config_file": ".agents/hooks.json"`) records the project hook surface without claiming every event can return a result.
- `src/cli/server/agent-hook-writer.ts` (search: `spec.id === "gruff-code-quality"`) proves Antigravity input routing only.
- `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`) records the current delivery limit.
- `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`) proves the desired toggle does not create unusable registration.

**Prevention:** Check current primary docs and the local binary, then prove the exact event, payload, command, response, continuation, and model visibility separately. Treat config, matchers, and fallbacks as feasibility evidence. After a correction, grep every product, prose, template, and test consumer for the superseded claim.

## Footgun: Hook additions and renames cross runtime, dashboard, and audit surfaces

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Symptoms:** A hook script can exist and pass its own smoke test while the dashboard registry, installer, manifest, preflight parity, audit facts, agent config templates, installed mirrors, and docs disagree about whether it is installed or togglable.

**Evidence:** The 2026-05-25 split touched `src/cli/server/hooks-registry.ts` (search: `deny-dangerous`), the hook self-test, manifest, installer, preflight, agent templates and mirrors, `src/cli/facts/agent/hooks.ts` (search: `LEGACY_GUARDRAIL_HOOK_FILES`), and `src/cli/hooks-command.ts` (search: `handleHooksCommand`).

**Recurrence 2026-05-26:** The `gruff-code-quality` hook rename focused drift run failed because `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `writeHookFixtures`) copied only `patterns-writes.sh` and `deny-dangerous-self-test.sh` into its temporary hook fixture. The live manifest now declares all split guardrails, so the fixture had to copy `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` in lock-step.

**Prevention:** When adding, renaming, or deleting a goat-flow hook, update this lock-step list: canonical script(s), central self-test, registry entry, config default, installer copy list, manifest `hooks[]`, per-agent config templates, installed repo mirrors, audit fact extraction, preflight self-test/parity/runtime smoke, dashboard view/API if response shape changes, CLI help if command surface changes, docs/code-map/architecture/changelog, and tests. Then run a source grep for the old hook id and a runtime-shaped smoke through an installed hook.

## Footgun: Active footgun Symptoms paragraph drifts after the underlying bug is fixed

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** When a behavior fix changes evidence cited by an active footgun, update or resolve that entry in the same change.
**Trigger phase:** VERIFY
**Incident count:** 4
**Latest occurrence:** 2026-08-10

**Symptoms:** A footgun is tagged `**Status:** active` and reads as a current trap. The Prevention rules are still good, but the Symptoms paragraph describes an obsolete code shape. Its search anchor either resolves to behavior that now contradicts the prose or resolves to nothing. Future agents following it either make the wrong current-state decision, chase a removed implementation, or distrust the entire footgun bucket because one entry is verifiably wrong.

**Why it happens:** Footguns get created when an incident hits. When the bug is fixed, the fixer often updates code, tests, and release prose but not the footgun text. The Status tag stays `active` because the principle remains valid, while the cited behavior or identifier becomes stale. The Prevention rules and current-state evidence live at different lifecycles, and index freshness cannot prove that the prose still matches the call site.

**Evidence:** Caught by Codex quality report 2026-05-25-2006-codex-jqclh (local gitignored quality history) flagging `.goat-flow/learning-loop/footguns/setup.md` (search: `Codex install migration matcher and post-install validator used different`). The original active entry's Symptoms paragraph named a search anchor for an obsolete matcher, but `rg` returned zero hits in `workflow/install-goat-flow.sh` - the installer was refactored (per the v1.8.0 changelog entry "Codex install: filesystem permissions migrated in place") to use a single `isInvalidNoneKey` predicate across both the migration awk pass and the validator awk pass. The setup footgun is now resolved with current anchors, preserving the prevention rule without sending agents after a removed symbol.

**Recurrence 2026-08-04:** The first evaluator missed chained needles and root dotfiles; naive carry-over then crossed sentence boundaries. The final grammar follows chains only from an explicit same-sentence target, recognizes dotfiles, and ignores fences. Contracts: `test/unit/check-content-quality.test.ts` (search: `validates every chained search needle`), (search: `does not guess a target for an unqualified search anchor`), and (search: `validates root dotfile search anchors`).

**Recurrence 2026-08-07:** `.goat-flow/learning-loop/footguns/auditor.md` (search: `## Footgun: The deny-mechanism runtime smoke executes the target checkout's own hook command`) and the lesson that cited it were corrected at 07:09 to describe a dashboard audit using `"full"`. Commit `19046c08` changed `src/cli/server/dashboard-audit-routes.ts` (search: `agentFilter === null ? "present-only" : "static"`) at 17:06 without refreshing either entry. The route-level contract in `test/integration/dashboard-audit-api.test.ts` (search: `does not execute selected-project hook launcher in /api/audit`) proves the old present-tense claim is now false.

**Recurrence 2026-08-10:** The Antigravity capability footgun and a resolved optional-hook migration entry still cited local Gruff wiring as current support after the registry and installer stopped registering it. The corrected entries now distinguish runnable input handling from model-visible result delivery. Evidence anchors: `src/cli/server/hooks-registry.ts` (search: `cannot deliver Gruff feedback to the active model`) and `test/unit/hook-registrar-surfaces.test.ts` (search: `keeps gruff-code-quality unregistered for Antigravity without result delivery`).

**Prevention:**
1. When you fix a bug that has a footgun entry, in the same PR EITHER (a) rewrite the Symptoms paragraph to describe the principle the fix demonstrates and update the search anchors to point at the current shape, OR (b) move the entry to the file's "Resolved Entries" section with a one-line summary of what was learned. Do not leave an `active` footgun whose Symptoms anchors don't resolve.
2. When reviewing a footgun bucket, treat a zero-hit anchor or a resolved anchor that contradicts the prose as a SEV signal: either the evidence was always wrong or the underlying behavior changed. Rewrite or resolve the entry; documentation rot is not a guard.
3. `stats --check` validates literal `(search: ...)` anchors in footguns and lessons, and promotes stale existing-target anchors in pattern entries to blocking findings. `audit --check-content` applies the same literal check to current guidance and accepted ADR evidence. History may explain removed code, but its pointer must still resolve to live proof rather than a moved literal.
4. The lifecycle is: incident → footgun (active) → fix lands → footgun rewritten or moved to Resolved. Skipping the last step leaves a trap that punishes the most-careful agents (the ones who actually follow search anchors).

---

## Footgun: Adding a skill-playbook requires lock-step updates across 13+ surfaces

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A playbook appears in `workflow/skills/playbooks/` and `.goat-flow/skill-docs/playbooks/`, but one parity, audit, prompt, install, or docs surface is not enrolled. The playbook works locally until template-vs-installed drift or missing setup context surfaces later.

**Why it happens:** `workflow/manifest.json` is the nominal source of truth, but playbooks are still hand-enumerated across template, installed copy, manifest required files and directory prose, installer copy lines, both README indexes, `scripts/preflight-checks.sh`, `test/integration/preamble-sync.test.ts`, `test/integration/audit-build.test.ts`, `src/cli/audit/check-goat-flow.ts`, `src/cli/audit/check-artifact-integrity.ts`, `workflow/setup/03-install-skills.md`, `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and sometimes `knip.json`.

**Evidence:** `code-comments.md` and `observability.md` initially shipped without full parity enrollment; the gap was closed when later playbooks forced updates to `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/code-comments.md`), `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`), and `test/integration/preamble-sync.test.ts` (search: `template and installed code-comments.md match`). The 2026-05-25 gruff-code-quality addition also proved package-surface coupling when preflight exposed a Knip dependency classification issue.

**Prevention:** When adding a playbook, grep the new filename through every surface above before declaring done. Then run `bash scripts/preflight-checks.sh`; the output must name the new playbook in parity rows. Run `npm test`; `preamble-sync.test.ts` must include the new playbook. If the playbook documents a CLI-only package, run `npx knip --no-progress` and only add `ignoreDependencies` after real npm-script or shell usage still leaves Knip unable to see it.

**Recurrence update (2026-07-13):** M12 registered `skill-playbook-authoring-sync.md` in manifest and audit surfaces, so focused checks and the live controlling-workspace audit passed. The full consumer setup lifecycle then failed because `workflow/install-goat-flow.sh` lacked its explicit copy line; the same sweep found missing preflight, parity-test, setup-doc, architecture, code-map, and quality-prompt enrollment. The next preflight also rejected the playbook because its worked YAML example repeated the exact installed version assignment, producing `1.13.1 | 1.13.1`; examples now use an unquoted `CURRENT_VERSION` sentinel. The decisive reproductions are `test/integration/setup-quality-lifecycle.test.ts` (search: "keeps setup, audit, prompts, and report history on the selected consumer") and `scripts/preflight-checks.sh` (search: "Installed shared reference").

---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Stage a rename before registering its destination; search all tracked files, not only Markdown, for old paths.
**Trigger phase:** VERIFY
**Incident count:** 6
**Latest occurrence:** 2026-08-09

**Symptoms:** A renamed or moved file breaks links in multiple documents. Dense pointer maps mean one stale path can mislead setup, glossary, or architecture readers at multiple entry points.

**Why it happens:** Documentation files reference each other by relative path. The project has hundreds of committed markdown files with dense cross-referencing; use `git ls-files '*.md' | wc -l` for the current count instead of trusting an embedded number. Renaming one file can break references in 5-10 others.

**Evidence:**
- `.goat-flow/glossary.md` → the Canonical File column is a dense pointer map into workflow/setup, skill-reference, and skill files. A single rename can invalidate multiple glossary entries at once.
- `workflow/setup/01-system-overview.md` → `NEXT:` links and numbered-step references hard-link the setup flow across multiple files; renaming one step file breaks the flow.
- `.goat-flow/architecture.md` → component/location tables point readers at concrete paths across `src/`, `workflow/`, and `.goat-flow/`; stale paths here become wrong architecture guidance, not cosmetic drift.

**Recurrences:** On 2026-07-27, M01 registered a destination before M02 created it, so audit failed `evidence_path does not exist`; M02 also missed two synthetic config references. On 2026-08-09, correcting M02's timeout premise left removed-phrase anchors in two roadmaps and two analysis reports; `rg --hidden --no-ignore` caught them. The roadmap files are gitignored, so their same-session before/after sweep is not a durable anchor. Enforcers: `src/cli/audit/provenance-types.ts` (search: `evidence_path does not exist`), `scripts/profile-dashboard-audit.mjs` (search: `Synthetic. Commit rules`), and `src/cli/facts/shared/search-anchors.ts` (search: `Validate one parsed citation`).

~~**Evidence (historical - resolved):** the M13 Phase 3 setup-step renumber left three stale pointers - `.goat-flow/glossary.md` and an evidence-lifecycle ADR entry at removed `workflow/setup/09-customise-to-project.md`, and `.goat-flow/learning-loop/decisions/ADR-011-sbao-mob-core-features.md` at removed `05-install-skills.md`~~ (resolved: now `workflow/setup/05-customise-to-project.md` and `workflow/setup/03-install-skills.md`; the ADR carrying the second pointer later left the active set).

**Prevention:** Before a rename, use `git grep` for the exact path and bare filename across all tracked files. Stage the destination before changing existence-validated pointers. Repeat both sweeps after edits and classify old-path hits as compatibility, legacy, or history; include hidden-file `rg` when ignored state matters. This is DoD gate #6.

---

## Footgun: ADR renumbering breaks cross-references

**Status:** active | **Created:** 2026-05-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** ADR notes that say "absorbs ADR-NNN" or "supersedes ADR-NNN" can silently point at the wrong decision after ADR deletion and renumbering. The linked number still resolves, so a path-existence check misses the break while readers land on an unrelated topic.

**Why it happens:** The ADR number is used as both identity and order. On 2026-04-18, historical ADR stubs were deleted and the surviving ADRs were compact-renumbered; old prose references kept the numeric labels but no longer named the deleted slug.

**Evidence:** A 2026-05-18 ADR cleanup found three numeric references whose numbers still resolved but whose topics no longer matched the historical slug. The concrete stale references have since been rewritten; the active trap is the cross-reference class, not those fixed links. Historical examples are retained below at `.goat-flow/learning-loop/footguns/docs-and-crossrefs.md` (search: `ADR renumbering concrete examples`).

**Prevention:** When deleting, compacting, or renumbering ADRs, grep `.goat-flow/learning-loop/decisions/` for every old `ADR-NNN` token and replace historical references with the deleted slug, not just the number. Then run a topic check: each remaining `ADR-NNN` reference must either match the current target title or explicitly say `now-removed ADR-NNN-slug`.

---

## Footgun: Version bump checks do not cover synthetic project config strings

**Status:** active | **Created:** 2026-04-30 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 4 | **Latest occurrence:** 2026-08-10

**Symptoms:** Version and mirror checks pass while helpers, examples, fixtures, or newly added release runtimes still name or contain the previous release.

**Why it happens:** Release helpers cover curated surfaces. A new file type, manifest-owned runtime, or embedded string stays invisible until both the writer and checker derive the same complete set.

**Evidence:** v1.3.2 missed synthetic dashboard projects; v1.6.1 missed playbook frontmatter; v1.15.0 missed plan examples and regex-escaped assertions. The 1.15.1 helper stamped only shell hooks and derived mirror fanout from per-agent registrations, omitting shared Node runtime modules. Its checker had the same `.sh`-only blind spot, so version and mirror output could look current while a shipped launcher imported stale runtime bytes.

**Structural anchors:**
- `scripts/bump-version.sh` (search: `manifest_hook_runtime_paths`) derives every top-level managed hook mirror from manifest ownership.
- `scripts/check-versions.mjs` (search: `hookRuntimeTemplates`) checks both `.sh` and `.mjs` runtime stamps.
- `workflow/manifest.json` (search: `.goat-flow/hooks/hook-launch-runtime.mjs`) owns the installed runtime and canonical source.

**Prevention:** Derive managed runtime fanout from manifest ownership, not agent registration lists. After each bump, check every shipped runtime extension and search literal plus regex-escaped old versions across the tracked release surface; keep packed-byte canaries for imported runtime modules.

---

## Footgun: Hot-path agent instructions drift unevenly across agents

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** One agent receives weaker release or routing guidance than the others even though all four instruction files are supposed to express the same core contract.

**Why it happens:** Claude, Codex, Antigravity, and Copilot use separate hot-path files with different compression levels (Codex and Antigravity share `AGENTS.md`). Cross-agent consistency checks cover a few structural sections, but not every command line or router-table detail.

**Evidence:** A 2026-04-27 quality-review pass found `.github/copilot-instructions.md` needed the same release command now present at `.github/copilot-instructions.md` (search: `test:full`) because it still told Copilot to run only the slow suite while `CLAUDE.md` and `AGENTS.md` used the full release gate. The same pass found `AGENTS.md` Shared skill reference rows omitted topical files; those rows are now split into meta and playbook entries at `AGENTS.md` (search: `Skill reference (meta)`). (Pre-v1.8.0 evidence also cited `GEMINI.md`; that file was removed when Antigravity replaced Gemini.)

**Prevention:** When changing Essential Commands or Router Table rows in one agent instruction file, grep all hot-path files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) for the same concept and update them together. Add preflight coverage when the row affects release validation or canonical reference discovery.

---

## Footgun: Filesystem-backed validation can miss untracked or ignored replacement files

**Status:** active | **Created:** 2026-04-19 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Local validation passes, but the next commit or CI run breaks because the replacement file exists only in the working tree. The repo appears fixed to the current operator while collaborators still receive the broken state.

**Why it happens:** Several goat-flow verification paths inspect the real filesystem, not the git index. `src/cli/manifest/manifest.ts` enumerates dashboard views with `readdirSync()`, and path-integrity/preflight treat a path as fixed once it exists on disk. That means an untracked replacement file can satisfy local checks. A second variant is worse: `.goat-flow/.gitignore` ignores almost everything by default, so a new repo-local file can look present locally while remaining impossible to commit.

**Evidence:**
- `src/cli/manifest/manifest.ts` (search: `readdirSync(dir)`) validates `facts.dashboard_views` against the working tree, not the index.
- `src/dashboard/index.html` (search: `views/setup.html`) can include a replacement view file even if that file is still untracked.
- `.goat-flow/.gitignore` (search: `*`) ignores new `.goat-flow/*` files unless they are explicitly whitelisted, which masked `.goat-flow/security-policy.md` during local verification.

**Prevention:**
1. After any add/rename/delete tied to setup, dashboard views, or repo-local policy files, run `git status --short` and confirm the replacement path is tracked.
2. Use `git ls-files --error-unmatch <path>` for any new canonical path that a fix depends on.
3. When introducing a new tracked file under `.goat-flow/`, update `.goat-flow/.gitignore` in the same change or the fix is local-only.

---

## Footgun: Prose examples for agent-specific paths drift from the manifest

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A doc lists an agent-specific path (`.agents/skills/`, `.codex/skills/`, etc.) that does not match the manifest. The harness `doc-paths-resolve` check may or may not catch it depending on whether the wrong path happens to exist on disk. When the harness catches it, every agent card in the dashboard drops to 75% Context with the same finding; when it does not, the doc is silently wrong.

**Why it happens:** `workflow/manifest.json` is the canonical source for each agent's `skills_dir`, `hooks_dir`, `settings`, and `instruction_file`. Prose in docs hand-writes these paths as examples - often guessed from the agent name (`antigravity` → `.antigravity/skills/`) rather than looked up. Multiple agents sometimes share a directory (Antigravity and Codex both use `.agents/skills/`), so name-based inference is wrong by default for those agents. The detection gap: the audit only verifies that a backtick path resolves on disk, so a plausible-but-wrong path that happens to exist passes while still misleading readers. ADR-030 records the Gemini to Antigravity runtime swap that made the old example stale.

**Evidence:**
- `workflow/manifest.json` (search: `"skills_dir"`) - four entries, but only three distinct paths: `.claude/skills/`, `.agents/skills/` (shared by Codex and Antigravity), `.github/skills/`. Name-based inference gives the wrong answer for Antigravity.
- `docs/audit-and-quality.md` (search: `satellite agents' skill dirs`) - previously named `.gemini/skills/` as a satellite-agent skill-dir example; that path never existed per the manifest, and the harness caught it only because it does not exist on disk.
- `src/cli/audit/harness/check-context.ts` (search: `extractBacktickPaths`) - existence-only check; an agent-wrong path that exists (e.g. `.claude/skills/` in an Antigravity example) would pass.
- `.goat-flow/learning-loop/decisions/ADR-030-replace-gemini-with-antigravity.md` (search: `Canonical agents`) - current four-agent identity is Claude, Codex, Antigravity, and Copilot.

**Prevention:**
1. Before hand-writing an agent-specific path in prose, grep `workflow/manifest.json` for that agent's `skills_dir` / `hooks_dir` / `settings` / `instruction_file` entry and copy the exact value.
2. When listing satellite-agent directories as examples, enumerate the *distinct* paths from the manifest (today: `.claude/skills/`, `.agents/skills/`, `.github/skills/`) - do not invent per-agent subdirectories from agent names.
3. Consider extending `doc-paths-resolve` to validate agent-specific paths against manifest entries (existence-plus-correctness), not just filesystem existence, so agent-wrong paths that happen to resolve also get caught.

---

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

- **Concept duplication across core docs** (resolved 2026-04-14) - Retired 4 conflicting doc files in v1.1.0; `workflow/setup/reference/execution-loop.md` is now the single authoritative source.
- **Product surface count drift across code, docs, config, and tests** (resolved 2026-04-14) - Fixed 14 inconsistencies where skill counts diverged across README, docs, config, templates, and tests after goat-sbao extraction.
- **Skill template paths use framework-local paths instead of project-local paths** (resolved 2026-04-12) - Changed skill template references away from `workflow/templates/`. The interim landing path `.goat-flow/templates/` was later retired; today the shared references live at `.goat-flow/skill-docs/`.
- **Refactor cleanup doesn't reach bash script conditional guards** (resolved 2026-04-13) - Removed dead `[[ -f src/cli/rubric/version.ts ]]` guard that silently skipped 74 lines of version-consistency checks.
- **Partial feature removal leaves type and detection artifacts** (resolved 2026-04-14) - Removed Copilot from type unions, UI name mappers, terminal runner maps, and SKILL_ROOTS after agent removal.
- **Line target inconsistency for project shapes** (resolved 2026-03-18) - Line target canonicalized to one value for all shapes in ADR-008; read ADR-008 for the current target.
- **CONTRIBUTING.md directs contributors to the wrong subsystem** (resolved 2026-04-13) - Rewritten to describe build checks in `check-goat-flow.ts` + `check-agent-setup.ts` and quality checks in `src/cli/audit/harness/`.
- **Stale references from old project structure** (resolved 2026-04-15) - `ai-workflow-framework` no longer appears anywhere in the repo (verified by `rg "ai-workflow-framework"`).
- **Preflight validates doc totals but not sub-breakdowns** (resolved 2026-04-17) - `scripts/preflight-checks.sh` (search: `B.8a2: Sub-breakdown validation`) now extracts `setup_count` and `agent_count` from the audit modules and validates the `(N setup + M agent)` breakdown claim in `.goat-flow/architecture.md`, not just the total. Verified by grep of preflight source.
- **Dashboard session-limit constants drift across server, UI, docs, and tests** (resolved 2026-04-19) - `src/cli/server/terminal.ts` (search: `MAX_SESSIONS`) exports the constant, `src/cli/server/dashboard-terminal.ts` (search: `MAX_SESSIONS`) imports it, `test/integration/dashboard-server-dashboard-terminal-endpoints.test.ts` (search: `data.maxSessions`) asserts the value, and `docs/dashboard.md` says "Maximum 10 concurrent sessions" - all four surfaces agree on 10. Pattern-class hygiene ("single exported constant reused in API payload, UI guards, and static copy") remains good practice for any future repo-wide cap; grep `maxSessions`, `serverSessions.length >=`, `Maximum of` before closing a similar change.
- **ADR renumbering concrete examples** (resolved 2026-05-27) - Historical stale references to `ADR-010-confusion-log-disposition.md`, `ADR-023-expand-inline-conventions.md`, and `ADR-016-dispatcher-is-canonical-skill.md` were already fixed before M11; the active entry now keeps only the failure pattern.
