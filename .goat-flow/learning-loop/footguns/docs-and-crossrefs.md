---
category: docs-and-crossrefs
last_reviewed: 2026-07-13
---

## Footgun: Path validators can treat gitignored local-state markers as missing docs

**Status:** active | **Created:** 2026-06-07 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A clean checkout fails the harness `doc-paths-resolve` check because a committed doc mentions an intentionally gitignored local-state file. The path is valid as workflow vocabulary, but absent by design. In the 1.10.0 release pass, `.goat-flow/glossary.md` (search: `Active Plan Marker`) referenced `.goat-flow/plans/.active`; simulating a clean checkout where that marker was absent made `goat-flow audit --harness` fail Context with `.goat-flow/glossary.md: unresolved`.

**Why it happens:** Path validators usually equate "backticked repo path" with "committed file that must exist." goat-flow also has checkout-local coordination paths: plan markers, scratchpad notes, local logs, dashboard state, and project identity. Those are deliberately gitignored but still need to be named in docs and prompts.

**Evidence:** `src/cli/audit/harness/check-context.ts` (search: `isGitignoredLocalStatePath`) now exempts those local-state paths before existence checks. `test/unit/audit-command/scoring-model.test.ts` (search: `absent gitignored local-state paths`) reproduces the clean-checkout case with missing `.goat-flow/plans/.active`, `.goat-flow/logs/quality/example.json`, `.goat-flow/scratchpad/notes.md`, `.goat-flow/project-id`, and `.goat-flow/dashboard-state.json`.

**Prevention:** When adding or tightening path validation, classify paths before checking existence: committed setup/doc files must resolve; gitignored local-state paths should be treated as valid navigation vocabulary. Keep `scripts/check-path-integrity.sh` and `doc-paths-resolve` aligned so clean checkouts and installed skills use the same local-state exemption policy.

---

## Footgun: Playbooks reference goat-flow repo-internal files absent from consumer installs

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A playbook under `workflow/skills/playbooks/` (installed to `.goat-flow/skill-docs/playbooks/`) or a skill under `workflow/skills/` (installed to `.claude/skills/`, `.agents/skills/`, etc.) cites goat-flow's own repo-internal files - an ADR (`.goat-flow/learning-loop/decisions/ADR-NNN`), CLI source (`check-drift.ts`, `src/cli/...`), a learning-loop file (`.goat-flow/learning-loop/lessons|patterns|footguns`), a repo-internal script under `scripts/` (e.g. `scripts/install-browser-tools.sh`, which ships via neither `workflow/manifest.json` nor the `workflow/` template tree), roadmap jargon (`DESIGN_TARGET`, milestone ids), or a not-yet-existing file ("`conventional-comments.md` (when it exists)"). The reference resolves in this repo but is dead and confusing in a consumer install where those files never ship.

**Why it happens:** Playbooks are dual-purpose - goat-flow's own working docs AND shipped artifacts installed into consumer projects. Anything that resolves in this repo but is not installed becomes a dead reference downstream. Only sibling playbooks (`observability.md`, `code-comments.md`) and the consumer's own instruction files (`CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md`) are present in both contexts. `check-drift.ts` enforces template-vs-installed byte parity but does NOT catch this: a repo-internal reference drifts identically in both copies and passes drift.

**Evidence:** 2026-05-29 portability pass on `workflow/skills/playbooks/code-comments.md` (search: `Related References`) removed an ADR-024 pointer, `check-drift.ts`/`check-goat-flow.ts` source refs, `DESIGN_TARGET` jargon, and a "conventional-comments.md (when it exists)" entry. `workflow/skills/playbooks/gruff-code-quality.md` (search: `Related References`) had the same class: `.goat-flow/learning-loop/patterns|lessons|footguns` Related-References, a goat-flow-only `node --import tsx src/cli/cli.ts stats --check` gate, and a repo-historical `contract:` marker scan - all genericized or removed. 2026-06-05 ship-readiness pass: `browser-use.md` and `page-capture.md` (search: `browser-use-python` wrapper) plus `goat-debug` SKILL.md (search: `Browser evidence detection`) offered `scripts/install-browser-tools.sh` as an install path, but that script lives only at top-level `scripts/` and is in neither the manifest nor `workflow/`; all three were switched to the portable `pip install browser-use` / `pip install playwright` commands.

**Prevention:** Keep playbook rules self-contained; reference only installed siblings (other playbooks) or the consumer's instruction files. Move goat-flow-repo-specific commands, scans, and ADR pointers to goat-flow's own instruction files, not the shipped playbook. Internal milestone files under `.goat-flow/plans/` are exempt - they are repo-local. Before declaring a playbook or shipped skill done, grep it for `\.goat-flow/(decisions|lessons|patterns|footguns)|src/cli|scripts/|ADR-|check-(drift|goat-flow)|stats --check|DESIGN_TARGET`, and confirm any `scripts/...` or other repo path it names is listed in `workflow/manifest.json` - otherwise genericize it to a portable command.

**Avoid false positives in that grep:** the installer seeds the learning-loop *directories* into consumers - `workflow/install-goat-flow.sh` (search: `for dir in .goat-flow/learning-loop/footguns`) mkdirs `.goat-flow/{footguns,lessons,patterns,decisions,...}` and seeds `.goat-flow/learning-loop/decisions/README.md`. So a reference to a learning-loop *directory the consumer is meant to populate* (e.g. `page-capture.md`'s `.goat-flow/learning-loop/patterns/<project>-playwright.md`, or "grep `.goat-flow/learning-loop/footguns/` for the target area") is portable and must NOT be "fixed". Only a *specific goat-flow-authored file or ADR number* that never ships downstream is dead: `ADR-024`, `src/cli/...`, a named goat-flow lesson/footgun file. Triage each grep hit as directory-generic-for-the-consumer (keep) vs goat-flow-specific-file (move out). 2026-06-05: a playbook critique flagged `deployment.md`'s generic `.goat-flow/learning-loop/decisions/` reference as a dead-ref; verification (`install-goat-flow.sh` seeds the dir) retracted the finding.

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

**Symptoms:** Dashboard and docs can report an agent as "not supported" for hooks while the runtime has a project-local hook config or a viable fallback path. The 2026-05-26 Antigravity correction found stale "not wired" claims in `workflow/setup/agents/antigravity.md` (search: `.agents/hooks.json`), `workflow/hooks/README.md` (search: `secret-bearing file tools`), and `workflow/manifest.json` (search: `"antigravity"`) after official Antigravity docs documented `.agents/hooks.json` and PreToolUse hooks. The 2026-05-28 gruff correction then removed a stale `gruff-code-quality` exclusion after the hook gained Antigravity file-tool matchers and a git-changed-file fallback.

**Why it happens:** Agent capability tables freeze a past product observation. Manifest fields, setup docs, dashboard state, audit logic, and changelog prose then reinforce each other, so structural checks can pass while the primary upstream docs have moved on.

**Evidence:**
- `workflow/manifest.json` (search: `"hook_config_file": ".agents/hooks.json"`) now records the corrected Antigravity hook config.
- `src/cli/server/agent-hook-writer.ts` (search: `spec.id === "gruff-code-quality"`) maps `gruff-code-quality` to Antigravity file-edit tool names.
- `workflow/hooks/gruff-code-quality.sh` (search: `payload_file_paths`) prefers payload paths, and `workflow/hooks/gruff-code-quality.sh` (search: `git_changed_supported_paths`) falls back to git-changed supported files when a PostToolUse payload omits the edited path.
- `workflow/hooks/agent-config/antigravity-hooks.json` (search: `run_command|view_file`) is the new Antigravity config template.
- `.agents/hooks.json` (search: `deny-dangerous`) is the installed mirror that proves this controlling workspace no longer treats Antigravity as hookless.

**Prevention:** Before marking an agent capability "unsupported" or "capability-limited", check current primary product docs and the local binary version, then test whether an agent-specific matcher or repository-state fallback can preserve the contract. Use hook-specific unsupported reasons only after the fallback path is disproven. After correcting capability metadata, grep docs, changelog, footguns, manifest, audit, dashboard, templates, and installed mirrors for the old unsupported wording.

## Footgun: Hook additions and renames cross runtime, dashboard, and audit surfaces

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook script can exist and pass its own smoke test while the dashboard registry, installer, manifest, preflight parity, audit facts, agent config templates, installed mirrors, and docs disagree about whether it is installed or togglable.

**Evidence:** The 2026-05-25 guardrails split and `gruff-code-quality` addition touched `src/cli/server/hooks-registry.ts` (search: `deny-dangerous`), `workflow/hooks/` (search: `deny-dangerous-self-test.sh`), `workflow/manifest.json` (search: `patterns-writes.sh`), `workflow/install-goat-flow.sh` (search: `deny-dangerous-self-test.sh`), `scripts/preflight-checks.sh` (search: `configured_hook_smoke_output`), per-agent config templates under `workflow/hooks/agent-config/`, installed mirrors under `.claude/hooks/`, `.codex/hooks/`, `.github/hooks/`, audit fact extraction in `src/cli/facts/agent/hooks.ts` (search: `LEGACY_GUARDRAIL_HOOK_FILES`), and dashboard/CLI surfaces in `src/dashboard/views/hooks.html` plus `src/cli/hooks-command.ts` (search: `handleHooksCommand`).

**Recurrence 2026-05-26:** The `gruff-code-quality` hook rename focused drift run failed because `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `writeHookFixtures`) copied only `patterns-writes.sh` and `deny-dangerous-self-test.sh` into its temporary hook fixture. The live manifest now declares all split guardrails, so the fixture had to copy `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` in lock-step.

**Prevention:** When adding, renaming, or deleting a goat-flow hook, update this lock-step list: canonical script(s), central self-test, registry entry, config default, installer copy list, manifest `hooks[]`, per-agent config templates, installed repo mirrors, audit fact extraction, preflight self-test/parity/runtime smoke, dashboard view/API if response shape changes, CLI help if command surface changes, docs/code-map/architecture/changelog, and tests. Then run a source grep for the old hook id and a runtime-shaped smoke through an installed hook.

## Footgun: Active footgun Symptoms paragraph drifts after the underlying bug is fixed

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A footgun is tagged `**Status:** active` and reads as a current trap. The Prevention rules are still good, but the Symptoms paragraph describes a code shape that no longer exists. Search anchors in the Symptoms paragraph resolve to nothing — `grep` on the live tree returns zero hits for the identifier the footgun says to look at. Future agents following the anchor either chase a ghost incident (looking for a regex that's been refactored away) or distrust the entire footgun bucket because one entry is verifiably wrong.

**Why it happens:** Footguns get created when an incident hits. When the bug is fixed, the fixer often updates code + tests + changelog but does not update the footgun text. The Status tag stays `active` because the *principle* (e.g., "two paths checking the same shape must call one predicate") is still valid — but the *evidence* (the specific identifier the Symptoms paragraph names) is now stale. The Prevention rules and the Symptoms paragraph live at different lifecycles, and no single check enforces that they stay in sync.

**Evidence:** Caught by the Codex quality report `.goat-flow/logs/quality/2026-05-25-2006-codex-jqclh.json` flagging `.goat-flow/learning-loop/footguns/setup.md` (search: `Codex install migration matcher and post-install validator used different`). The original active entry's Symptoms paragraph named a search anchor for an obsolete matcher, but `rg` returned zero hits in `workflow/install-goat-flow.sh` - the installer was refactored (per the v1.8.0 changelog entry "Codex install: filesystem permissions migrated in place") to use a single `isInvalidNoneKey` predicate across both the migration awk pass and the validator awk pass. The setup footgun is now resolved with current anchors, preserving the prevention rule without sending agents after a removed symbol.

**Prevention:**
1. When you fix a bug that has a footgun entry, in the same PR EITHER (a) rewrite the Symptoms paragraph to describe the principle the fix demonstrates and update the search anchors to point at the current shape, OR (b) move the entry to the file's "Resolved Entries" section with a one-line summary of what was learned. Do not leave an `active` footgun whose Symptoms anchors don't resolve.
2. When reviewing a footgun bucket, treat zero-hit search anchors as a SEV signal: either the anchor was always wrong (find the right one) or the underlying bug was fixed (rewrite or resolve). A footgun that fails `rg <anchor>` is documentation rot, not a guard.
3. `stats --check` validates `last_reviewed` dates and bucket size but does not verify that semantic anchors in footgun bodies resolve to real symbols. The check that catches this today is human review — usually a quality report or a downstream agent following the anchor. Until automated, treat persisted footgun findings in quality reports as higher-priority than newly-flagged ones because they survived a prior review pass.
4. The lifecycle is: incident → footgun (active) → fix lands → footgun rewritten or moved to Resolved. Skipping the last step leaves a trap that punishes the most-careful agents (the ones who actually follow search anchors).

---

## Footgun: Adding a skill-playbook requires lock-step updates across 13+ surfaces

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A playbook appears in `workflow/skills/playbooks/` and `.goat-flow/skill-docs/playbooks/`, but one parity, audit, prompt, install, or docs surface is not enrolled. The playbook works locally until template-vs-installed drift or missing setup context surfaces later.

**Why it happens:** `workflow/manifest.json` is the nominal source of truth, but playbooks are still hand-enumerated across template, installed copy, manifest required files and directory prose, installer copy lines, both README indexes, `scripts/preflight-checks.sh`, `test/integration/preamble-sync.test.ts`, `test/integration/audit-build.test.ts`, `src/cli/audit/check-goat-flow.ts`, `src/cli/audit/check-artifact-integrity.ts`, `workflow/setup/03-install-skills.md`, `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and sometimes `knip.json`.

**Evidence:** `code-comments.md` and `observability.md` initially shipped without full parity enrollment; the gap was closed when later playbooks forced updates to `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/code-comments.md`), `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`), and `test/integration/preamble-sync.test.ts` (search: `template and installed code-comments.md match`). The 2026-05-25 gruff-code-quality addition also proved package-surface coupling when preflight exposed a Knip dependency classification issue.

**Prevention:** When adding a playbook, grep the new filename through every surface above before declaring done. Then run `bash scripts/preflight-checks.sh`; the output must name the new playbook in parity rows. Run `npm test`; `preamble-sync.test.ts` must include the new playbook. If the playbook documents a CLI-only package, run `npx knip --no-progress` and only add `ignoreDependencies` after real npm-script or shell usage still leaves Knip unable to see it.

---

## Footgun: Cross-reference fragility across docs

**Status:** active | **Created:** 2026-03-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A renamed or moved file breaks links in multiple documents. Dense pointer maps mean one stale path can mislead setup, glossary, or architecture readers at multiple entry points.

**Why it happens:** Documentation files reference each other by relative path. The project has hundreds of committed markdown files with dense cross-referencing; use `git ls-files '*.md' | wc -l` for the current count instead of trusting an embedded number. Renaming one file can break references in 5-10 others.

**Evidence:**
- `.goat-flow/glossary.md` → the Canonical File column is a dense pointer map into workflow/setup, skill-reference, and skill files. A single rename can invalidate multiple glossary entries at once.
- `workflow/setup/01-system-overview.md` → `NEXT:` links and numbered-step references hard-link the setup flow across multiple files; renaming one step file breaks the flow.
- `.goat-flow/architecture.md` → component/location tables point readers at concrete paths across `src/`, `workflow/`, and `.goat-flow/`; stale paths here become wrong architecture guidance, not cosmetic drift.

~~**Evidence (historical - resolved):**~~
- ~~`.goat-flow/glossary.md` → still pointed at removed `workflow/setup/09-customise-to-project.md` after the M13 Phase 3 setup-step renumber~~ (resolved: now points to `workflow/setup/05-customise-to-project.md`)
- ~~historical evidence-lifecycle ADR entry → still pointed at removed `workflow/setup/09-customise-to-project.md` after the same renumber~~ (resolved before the ADR was later removed from the active set)
- ~~`.goat-flow/learning-loop/decisions/ADR-011-sbao-mob-core-features.md` → still referenced removed `05-install-skills.md` after the setup flow moved the install step to `workflow/setup/03-install-skills.md`~~ (resolved: now points to `workflow/setup/03-install-skills.md`)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

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

**Symptoms:** `bash scripts/bump-version.sh <version>` and `npm run check-versions` both pass, but helper scripts, integration fixtures, or secondary reference/playbook trees can still retain the previous release version.

**Why it happens:** The bump script intentionally updates a curated list of release surfaces, and `check-versions.mjs` verifies the version surfaces it knows about. Synthetic project builders that embed a config file as an inline string, or newly split reference directories that are not added to both the bump script and checker, stay outside both surfaces unless they are manually grepped.

**Evidence:** During the v1.3.2 M07 release gate, `npm run check-versions` printed `All template and reference versions match 1.3.2`, but `rg -n "1\\.3\\.1" ... scripts/profile-dashboard-audit.mjs test` still found current-version strings in `scripts/profile-dashboard-audit.mjs` (search: `writeSyntheticProject`) and `test/integration/dashboard-server.helpers.ts` (search: `makeDashboardCacheProject`). During the v1.6.1 bump on 2026-05-11, `bash scripts/bump-version.sh 1.6.1` and `npm run check-versions` passed while `rg -n 'goat-flow-reference-version: "1\\.6\\.0"' workflow/skills/playbooks .goat-flow/skill-docs/playbooks` still found stale playbook frontmatter.

**Structural anchors:**
- `scripts/bump-version.sh` (search: `# ── Source files (version string replacement)`) lists the curated surfaces the bump workflow edits.
- `scripts/check-versions.mjs` (search: `goat-flow-reference-version`) verifies skill and reference frontmatter, not arbitrary embedded config stubs.
- `workflow/skills/playbooks/README.md` (search: `goat-flow-reference-version`) is a standalone playbook tree that must be included alongside `workflow/skills/reference/`.
- `scripts/profile-dashboard-audit.mjs` (search: `writeSyntheticProject`) creates a synthetic `.goat-flow/config.yaml` for profiler runs.
- `test/integration/dashboard-server.helpers.ts` (search: `makeDashboardCacheProject`) creates a dashboard-cache fixture project with an embedded config string.

**Prevention:** After every release bump, run a targeted stale-version grep across scripts, tests, packages, workflow templates, installed skill/reference/playbook mirrors, and config files, not just `npm run check-versions`: `rg -n "<old-version>" scripts test package.json package-lock.json .goat-flow/config.yaml workflow .agents .claude .github/skills .goat-flow/skill-docs .goat-flow/skill-docs/playbooks`.

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

**Why it happens:** `workflow/manifest.json` is the canonical source for each agent's `skills_dir`, `hooks_dir`, `settings`, and `instruction_file`. Prose in docs hand-writes these paths as examples - often guessed from the agent name (`antigravity` → `.antigravity/skills/`) rather than looked up. Multiple agents sometimes share a directory (Antigravity and Codex both use `.agents/skills/`), so name-based inference is wrong by default for those agents. The detection gap: `src/cli/audit/harness/check-context.ts` (search: `extractBacktickPaths`) only verifies that backtick-quoted paths resolve on disk. A plausible-but-wrong path that happens to exist (e.g. writing `.claude/skills/` in an Antigravity example) passes the audit while still misleading readers. ADR-030 records the Gemini to Antigravity runtime swap that made the old example stale.

**Evidence:**
- `workflow/manifest.json` (search: `"skills_dir"`) - four entries, but only three distinct paths: `.claude/skills/`, `.agents/skills/` (shared by Codex and Antigravity), `.github/skills/`. Name-based inference gives the wrong answer for Antigravity.
- `docs/audit-and-quality.md` (search: `satellite agents' skill dirs`) - previously named `.gemini/skills/` as an example of a satellite-agent skill dir. The path does not exist (and never did per the manifest); the harness caught it only because `.gemini/skills/` happens not to exist on disk.
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
