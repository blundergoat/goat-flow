---
category: docs-and-crossrefs
last_reviewed: 2026-05-28
---

## Footgun: Agent capability metadata goes stale when upstream docs add hooks

**Status:** active | **Created:** 2026-05-26 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Dashboard and docs can report an agent as "not supported" for hooks while the runtime has a project-local hook config or a viable fallback path. The 2026-05-26 Antigravity correction found stale "not wired" claims in `workflow/setup/agents/antigravity.md` (search: `.agents/hooks.json`), `workflow/hooks/README.md` (search: `secret-bearing file tools`), and `workflow/manifest.json` (search: `"antigravity"`) after official Antigravity docs documented `.agents/hooks.json` and PreToolUse hooks. The 2026-05-28 gruff correction then removed a stale `gruff-code-quality` exclusion after the hook gained Antigravity file-tool matchers and a git-changed-file fallback.

**Why it happens:** Agent capability tables freeze a past product observation. Manifest fields, setup docs, dashboard state, audit logic, and changelog prose then reinforce each other, so structural checks can pass while the primary upstream docs have moved on.

**Evidence:**
- `workflow/manifest.json` (search: `"hook_config_file": ".agents/hooks.json"`) now records the corrected Antigravity hook config.
- `src/cli/server/agent-hook-writer.ts` (search: `spec.id === "gruff-code-quality"`) maps `gruff-code-quality` to Antigravity file-edit tool names.
- `workflow/hooks/gruff-code-quality.sh` (search: `file_paths_for_payload`) falls back to git-changed supported files when a PostToolUse payload omits the edited path.
- `workflow/hooks/agent-config/antigravity-hooks.json` (search: `run_command|view_file`) is the new Antigravity config template.
- `.agents/hooks.json` (search: `guard-secret-paths`) is the installed mirror that proves this controlling workspace no longer treats Antigravity as hookless.

**Prevention:** Before marking an agent capability "unsupported" or "capability-limited", check current primary product docs and the local binary version, then test whether an agent-specific matcher or repository-state fallback can preserve the contract. Use hook-specific unsupported reasons only after the fallback path is disproven. After correcting capability metadata, grep docs, changelog, footguns, manifest, audit, dashboard, templates, and installed mirrors for the old unsupported wording.

## Footgun: Hook additions and renames cross runtime, dashboard, and audit surfaces

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A hook script can exist and pass its own smoke test while the dashboard registry, installer, manifest, preflight parity, audit facts, agent config templates, installed mirrors, and docs disagree about whether it is installed or togglable.

**Evidence:** The 2026-05-25 guardrails split and `gruff-code-quality` addition touched `src/cli/server/hooks-registry.ts` (search: `guard-destructive-shell`), `workflow/hooks/` (search: `guardrails-self-test.sh`), `workflow/manifest.json` (search: `guard-repository-writes.sh`), `workflow/install-goat-flow.sh` (search: `guardrails-self-test.sh`), `scripts/preflight-checks.sh` (search: `guardrail_hooks`), per-agent config templates under `workflow/hooks/agent-config/`, installed mirrors under `.claude/hooks/`, `.codex/hooks/`, `.github/hooks/`, audit fact extraction in `src/cli/facts/agent/hooks.ts` (search: `GUARDRAIL_HOOK_FILES`), and dashboard/CLI surfaces in `src/dashboard/views/hooks.html` plus `src/cli/cli.ts` (search: `handleHooksCommand`).

**Recurrence 2026-05-26:** The `gruff-code-quality` hook rename focused drift run failed because `test/integration/audit-drift.test.ts` (search: `writeHookFixtures`) copied only `guard-repository-writes.sh` and `guardrails-self-test.sh` into its temporary hook fixture. The live manifest now declares all split guardrails, so the fixture had to copy `guard-destructive-shell.sh`, `guard-secret-paths.sh`, and `guard-repository-writes.sh` in lock-step.

**Prevention:** When adding, renaming, or deleting a goat-flow hook, update this lock-step list: canonical script(s), central self-test, registry entry, config default, installer copy list, manifest `hooks[]`, per-agent config templates, installed repo mirrors, audit fact extraction, preflight self-test/parity/runtime smoke, dashboard view/API if response shape changes, CLI help if command surface changes, docs/code-map/architecture/changelog, and tests. Then run a source grep for the old hook id and a runtime-shaped smoke through an installed hook.

## Footgun: Active footgun Symptoms paragraph drifts after the underlying bug is fixed

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A footgun is tagged `**Status:** active` and reads as a current trap. The Prevention rules are still good, but the Symptoms paragraph describes a code shape that no longer exists. Search anchors in the Symptoms paragraph resolve to nothing — `grep` on the live tree returns zero hits for the identifier the footgun says to look at. Future agents following the anchor either chase a ghost incident (looking for a regex that's been refactored away) or distrust the entire footgun bucket because one entry is verifiably wrong.

**Why it happens:** Footguns get created when an incident hits. When the bug is fixed, the fixer often updates code + tests + changelog but does not update the footgun text. The Status tag stays `active` because the *principle* (e.g., "two paths checking the same shape must call one predicate") is still valid — but the *evidence* (the specific identifier the Symptoms paragraph names) is now stale. The Prevention rules and the Symptoms paragraph live at different lifecycles, and no single check enforces that they stay in sync.

**Evidence:** Caught by the Codex quality report `.goat-flow/logs/quality/2026-05-25-2006-codex-jqclh.json` flagging `.goat-flow/footguns/setup.md` (search: `Codex install migration matcher and post-install validator used different`). The original active entry's Symptoms paragraph named a search anchor for an obsolete matcher, but `rg` returned zero hits in `workflow/install-goat-flow.sh` - the installer was refactored (per the v1.8.0 changelog entry "Codex install: filesystem permissions migrated in place") to use a single `isInvalidNoneKey` predicate across both the migration awk pass and the validator awk pass. The setup footgun is now resolved with current anchors, preserving the prevention rule without sending agents after a removed symbol.

**Prevention:**
1. When you fix a bug that has a footgun entry, in the same PR EITHER (a) rewrite the Symptoms paragraph to describe the principle the fix demonstrates and update the search anchors to point at the current shape, OR (b) move the entry to the file's "Resolved Entries" section with a one-line summary of what was learned. Do not leave an `active` footgun whose Symptoms anchors don't resolve.
2. When reviewing a footgun bucket, treat zero-hit search anchors as a SEV signal: either the anchor was always wrong (find the right one) or the underlying bug was fixed (rewrite or resolve). A footgun that fails `rg <anchor>` is documentation rot, not a guard.
3. `stats --check` validates `last_reviewed` dates and bucket size but does not verify that semantic anchors in footgun bodies resolve to real symbols. The check that catches this today is human review — usually a quality report or a downstream agent following the anchor. Until automated, treat persisted footgun findings in quality reports as higher-priority than newly-flagged ones because they survived a prior review pass.
4. The lifecycle is: incident → footgun (active) → fix lands → footgun rewritten or moved to Resolved. Skipping the last step leaves a trap that punishes the most-careful agents (the ones who actually follow search anchors).

---

## Footgun: Adding a skill-playbook requires lock-step updates across 13+ surfaces

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A new playbook is dropped into `workflow/skills/playbooks/` and `.goat-flow/skill-playbooks/`, listed in the manifest, and seemingly working - but later silently drifts from its template because one of several parity checks was never enrolled. Or a future contributor adding a similar playbook misses one of the surfaces, leaving the playbook discoverable but undocumented in audit / drift / prompt output.

**Why it happens:** `workflow/manifest.json` is the nominal source of truth for "which playbooks exist", but many other surfaces independently enumerate the same list and each must be updated by hand:

1. `workflow/skills/playbooks/<name>.md` - template
2. `.goat-flow/skill-playbooks/<name>.md` - installed copy (must byte-match template)
3. `workflow/manifest.json` - two entries: `required_files` list AND the `directories.".goat-flow/skill-playbooks/"` description string
4. `workflow/install-goat-flow.sh` (search: `copy_file "$GOAT_FLOW_ROOT/workflow/skills/playbooks/`) - installer copy line
5. `workflow/skills/playbooks/README.md` AND `.goat-flow/skill-playbooks/README.md` - index tables (must byte-match each other)
6. `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/`) - byte-exact parity block per playbook
7. `test/integration/preamble-sync.test.ts` (search: `template and installed`) - per-playbook sync assertion + path constants block
8. `test/integration/audit-build.test.ts` (search: `requiredSkillReferenceFiles`) - required-files list
9. `src/cli/audit/check-goat-flow.ts` (search: `REQUIRED_SKILL_REFERENCE_FILES`) - two lists: the `Set` used for the manifest-catch-all gate AND the `REQUIRED_SKILL_REFERENCE_FILES` const used for agent-skill audits
10. `src/cli/audit/check-drift.ts` (search: `template: "workflow/skills/playbooks/`) - drift comparison entries plus a parallel comment header at the top of the file
11. `src/cli/prompt/compose-quality.ts` (search: `Standalone playbooks`) - prompt-context description string
12. `.goat-flow/architecture.md` (search: `the standalone playbooks indexed by`) - inline playbook list in the Committed knowledge row
13. `.goat-flow/code-map.md` - two entries: inline list comment on the `playbooks/` template line AND the per-file description block under `skill-playbooks/`
14. `knip.json` (search: `ignoreDependencies`) - only when the playbook relies on a CLI-only devDependency that is invoked from docs/scripts instead of imported by TypeScript.

Two playbooks (`code-comments.md`, `observability.md`) shipped earlier in this PR with #6, #7, and #10 partially or fully missing - the playbooks were installed, copied on update, and visible in the README, but byte-exact parity between template and installed was not enforced. The gap was caught while adding `release-notes.md` and `changelog.md`; all four playbooks are now enrolled everywhere.

**Evidence:**
- `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/code-comments.md`) added during the same change set that added `changelog.md` and `release-notes.md` parity, retroactively closing the gap for the two prior playbooks.
- `src/cli/audit/check-drift.ts` (search: `template: "workflow/skills/playbooks/code-comments.md"`) similarly added retroactively.
- `test/integration/preamble-sync.test.ts` (search: `template and installed code-comments.md match`) similarly added.
- 2026-05-25 gruff-code-quality addition/rename: `bash scripts/preflight-checks.sh --verbose --no-color` in the installer round-trip fixture enrolled `gruff-code-quality.md`, then failed Knip because `@blundergoat/gruff-ts` is a CLI-only devDependency. `knip.json` (search: `@blundergoat/gruff-ts`) now records that non-imported tool dependency explicitly.

**Prevention:**
1. When adding a new skill-playbook, walk the checklist above before declaring done. Every surface is independent; missing one leaves silent drift.
2. Run `bash scripts/preflight-checks.sh` after enrolling the new playbook. If preflight does not name the new playbook in its parity output (look for `template and installed copy match`), surface #6 is unenrolled.
3. Run `npm test` after enrolling. If `preamble-sync.test.ts` does not list the new playbook in test names, surface #7 is unenrolled.
4. Treat the manifest as the source of truth structurally, but treat the other surfaces as load-bearing duplicates that must be updated in lock-step. A future refactor that derives the parity blocks from `manifest.json` would eliminate this footgun, but until that lands, the enumeration is the contract.
5. When reviewing a playbook-addition PR, grep for the new filename in every surface listed above. Missing surfaces = blocking comment.
6. If the playbook introduces or documents a package that is used only as a CLI, run `npx knip --no-progress`; add a scoped `ignoreDependencies` entry instead of pretending doc or shell mentions are import edges.

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
- ~~`.goat-flow/decisions/ADR-011-sbao-mob-core-features.md` → still referenced removed `05-install-skills.md` after the setup flow moved the install step to `workflow/setup/03-install-skills.md`~~ (resolved: now points to `workflow/setup/03-install-skills.md`)

**Prevention:** After any file rename or move, grep the entire repo for the old path. Use `grep -r "old-filename" --include="*.md"` before declaring done. This is DoD gate #6.

---

## Footgun: ADR renumbering breaks cross-references

**Status:** active | **Created:** 2026-05-18 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** ADR notes that say "absorbs ADR-NNN" or "supersedes ADR-NNN" can silently point at the wrong decision after ADR deletion and renumbering. The linked number still resolves, so a path-existence check misses the break while readers land on an unrelated topic.

**Why it happens:** The ADR number is used as both identity and order. On 2026-04-18, historical ADR stubs were deleted and the surviving ADRs were compact-renumbered; old prose references kept the numeric labels but no longer named the deleted slug.

**Evidence:** A 2026-05-18 ADR cleanup found three numeric references whose numbers still resolved but whose topics no longer matched the historical slug. The concrete stale references have since been rewritten; the active trap is the cross-reference class, not those fixed links. Historical examples are retained below at `.goat-flow/footguns/docs-and-crossrefs.md` (search: `ADR renumbering concrete examples`).

**Prevention:** When deleting, compacting, or renumbering ADRs, grep `.goat-flow/decisions/` for every old `ADR-NNN` token and replace historical references with the deleted slug, not just the number. Then run a topic check: each remaining `ADR-NNN` reference must either match the current target title or explicitly say `now-removed ADR-NNN-slug`.

---

## Footgun: Cold-path docs drift while structural audit passes

**Status:** active | **Created:** 2026-04-15 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** The CLI audit reports PASS while cold-path documentation contains false claims, wrong check descriptions, dead paths, and glossary misdirections. Contributors reading docs instead of code form incorrect mental models of what the system does.

**Why it happens:** The audit validates structure (files exist, paths resolve, versions match). Partial content automation exists - `src/cli/audit/check-factual-claims.ts` catches count-claim drift across PROSE_TARGETS plus `docs/*.md`, and `src/cli/audit/check-content-quality.ts` lints vague terms and generic instructions on a fixed QUALITY_TARGETS list (instruction files, skill-reference, public docs, ADRs, workflow/setup templates). Coverage is incomplete: footgun/lesson content is only schema-enforced via `stats --check` (status field and `(search:...)` anchors), not fact-checked. Cold-path surfaces outside these target lists still drift manually as code changes.

**Evidence (verified by 8 independent critiques, 2026-04-15; recurrence confirmed by 4-critique cross-review, 2026-04-16):**

*Round 1 (2026-04-15, all resolved):*
- ~~`docs/audit-and-critique.md` - describes checks that no longer exist~~ (resolved 2026-04-15: check descriptions updated to match current code)
- ~~`docs/coding-standards/conventions.md` - claims "Zero runtime dependencies"~~ (resolved 2026-04-15: now says "Runtime dependencies: js-yaml, ws")
- ~~`docs/coding-standards/conventions.md` - claims `src/cli/prompt/types.ts` exists~~ (resolved 2026-04-15: reference removed)
- ~~`.goat-flow/glossary.md` - Handoff entry says "See Task Tracking in `.goat-flow/skill-preamble.md`"~~ (resolved 2026-04-16: glossary now correctly points to `skill-conventions.md`; the reference was later moved to `.goat-flow/skill-reference/` as a subdir but that change is separate from this resolution)
- ~~`.goat-flow/glossary.md` - Working Memory points to `skill-preamble.md`~~ (resolved 2026-04-16: glossary now correctly points to `skill-conventions.md`)
- ~~`.goat-flow/code-map.md` - listed a retired validator under `scripts/`~~ (resolved 2026-04-16: code-map moved that entry to `workflow/` with an explanatory note; the validator was later removed)
- ~~`src/cli/prompt/compose-critique.ts` - ships literal placeholder `<your-hooks-dir>`~~ (resolved 2026-04-16: placeholder removed)

*Round 2 (2026-04-16, all resolved - same pattern recurred after dashboard TS migration and skill directory restructure):*
- ~~`CONTRIBUTING.md` - claimed "8 build checks" and "18 advisory checks"; actual: 16 and 16~~ (resolved 2026-04-16)
- ~~`CONTRIBUTING.md` - referenced `app.js` and `preset-prompts.js` after .ts rename~~ (resolved 2026-04-16)
- ~~`.goat-flow/code-map.md` - claimed 15 harness checks; actual: 16~~ (resolved 2026-04-16)
- ~~`.goat-flow/code-map.md` - showed flat skill file structure after directory restructure~~ (resolved 2026-04-16)
- ~~`.goat-flow/architecture.md` - referenced `preset-prompts.js` after .ts rename~~ (resolved 2026-04-16)
- ~~`src/cli/cli.ts` - help text said 15 harness checks; actual: 16~~ (resolved 2026-04-16)
- ~~`workflow/setup/03-install-skills.md` - referenced old flat skill file names~~ (resolved 2026-04-16)
- ~~historical upgrade guide entry - referenced `goat-debug.md` instead of `goat-debug/SKILL.md`~~ (resolved 2026-04-16)

*Round 3 (2026-04-24, all resolved - surfaced by 3 independent Copilot quality reports):*
- ~~`docs/skills.md` - /goat-plan summary said "defaults to inline/read-only output" and "MUST NOT write milestone files unless the user explicitly asks"; the same file and the installed skill both say File-Write is the default at Standard+~~ (resolved 2026-04-24: summary rewritten to describe the 4-mode picker accurately)
- ~~`docs/harness-quality.md` + `docs/audit-and-quality.md` - claimed quality assessment "runs 7 skill invocations" on real code; `src/cli/prompt/compose-quality.ts` (search: `Option A`) prefers file analysis and only does live invocation "if context allows"~~ (resolved 2026-04-24: language updated to reflect file-analysis-preferred approach)
- ~~`.goat-flow/architecture.md` - hot-path listing named only CLAUDE.md, AGENTS.md, GEMINI.md; omitted `.github/copilot-instructions.md` which `workflow/setup/agents/copilot.md` (search: `standalone hot-path`) and `workflow/setup/01-system-overview.md` (search: `## What goat-flow is`) both treat as hot-path~~ (resolved 2026-04-24: copilot-instructions.md added to hot-path listing)

*Round 4 (2026-05-11, all resolved - surfaced by full documentation audit; same pattern recurred during the v1.6.0 release wave):*
- ~~`CONTRIBUTING.md` - claimed "17 checks grouped by 5 concerns" while `src/cli/audit/harness/check-*.ts` exports 16 distinct ids and every other doc surface (audit-checks.md, cli.md, audit-and-quality.md, harness-audit.md, glossary.md, architecture.md) said 16~~ (resolved 2026-05-11)
- ~~`CONTRIBUTING.md` - placed `skill-quality-testing.md` in `workflow/skills/reference/`; the v1.4.x reference/playbook split moved it to `workflow/skills/playbooks/` and it installs to `.goat-flow/skill-playbooks/`~~ (resolved 2026-05-11)
- ~~`docs/cli.md` - missing `goat-flow skill new` and `goat-flow quality candidacy` (both shipped in v1.6.0 and documented in `docs/skill-authoring.md`)~~ (resolved 2026-05-11)
- ~~`docs/dashboard.md` - API endpoints table missing `/api/quality/evaluate` (canonical per v1.6.0), `/api/quality/analyse`, `/api/quality/history`, `/api/skill-quality/inventory`, `/api/skill-quality`, `/api/browse`, `POST /api/projects/list`, `POST /api/terminal/:id/upload-image`~~ (resolved 2026-05-11)
- ~~`.goat-flow/code-map.md` - docs/ listing missing `skill-authoring.md`, `skill-quality-config.md`, `site/`; `.goat-flow/` listing missing `logs/critiques/`, `logs/security/`, `logs/uploads/`~~ (resolved 2026-05-11)
- ~~`.goat-flow/architecture.md` - "Local report history" row missing `.goat-flow/logs/security/`~~ (resolved 2026-05-11)
- ~~`.goat-flow/glossary.md` - Hot Path entry omitted `.github/copilot-instructions.md` despite the same fix being applied to `architecture.md` in Round 3~~ (resolved 2026-05-11)
- ~~`CLAUDE.md` / `AGENTS.md` / `GEMINI.md` / `.github/copilot-instructions.md` - "Never" tier listed materially different forbidden actions across the four files; `scripts/check-instruction-parity.mjs` did not catch it because it validates section headings only~~ (resolved 2026-05-11: aligned to canonical CLAUDE.md/copilot wording; AGENTS.md and GEMINI.md updated)
- ~~All four instruction-file headers - dated `(2026-05-04)` against `v1.6.0`; CHANGELOG shows v1.6.0 shipped on 2026-05-10; `2026-05-04` was the date of v1.4.3~~ (resolved 2026-05-11)
- ~~`.goat-flow/decisions/ADR-025` / `ADR-026` / `ADR-027` - `**Status:** accepted` (lowercase) violated the README's documented status vocabulary `Proposed | Accepted | Implemented | Superseded`~~ (resolved 2026-05-11)
- ~~`README.md` - "Skills (seven `/goat-*` commands + dispatcher)" miscounted; there are 6 `/goat-*` skills plus the dispatcher = 7 total~~ (resolved 2026-05-11)
- ~~`.github/PULL_REQUEST_TEMPLATE.md` - test plan said `node dist/cli/cli.js audit .` while every other doc uses `npx goat-flow audit .`; `dist/` may not exist when contributors run the test plan~~ (resolved 2026-05-11)
- ~~`workflow/evaluation/README.md` - file table listed `footguns.md` and `lessons.md` only; directory also contains `patterns.md`~~ (resolved 2026-05-11)
- ~~`docs/dashboard.md`, `.goat-flow/skill-playbooks/skill-quality-testing.md`, `.goat-flow/skill-playbooks/skill-quality-testing/tdd-iteration.md`, `workflow/skills/reference/skill-preamble.md` (and the workflow source mirrors of the playbook files) - cited evidence under `.goat-flow/scratchpad/` (gitignored) or vaguely "the prime corpus", so readers cloning the repo could not follow the references; same surfaces also leaked third-party / competitor skill names (MySQL, Valyu, frontend-design) and a vendor env var (`VALYU_API_KEY`) into goat-flow's own committed docs~~ (resolved 2026-05-11: scratchpad-path citations replaced with in-repo references or guidance-only framing; competitor names removed and patterns rewritten provider-neutrally; new lesson added at `.goat-flow/lessons/agent-behavior.md` (search: `Agent cited gitignored content as evidence in committed docs`))
- ~~`docs/skill-quality-config.md` - used a bare skill-file basename in code formatting while explaining uploaded skill evaluation; path-integrity treated it as a repo-local path and failed `test/integration/audit-drift.test.ts` in PR #36~~ (resolved 2026-05-11: now uses prose at `docs/skill-quality-config.md` (search: `uploaded skill file can keep`))

**Impact:** The framework demands "real evidence only" and "MUST maintain cross-file consistency" while its own cold-path surfaces violate both rules. Agents consulting docs for orientation get wrong information. The audit's PASS stamp creates false confidence. Round 4 also surfaced two new failure modes worth promoting to a preflight check (see Prevention #5 and #6 below).

**Prevention:**
1. Add content-drift checks to preflight: compare doc check descriptions against exported check names from code
2. Extend path-integrity checks to cover code-map, glossary canonical-file paths, and convention claims
3. Consider auto-generating audit docs from check code to prevent drift permanently
4. Change Step 01 early-stop rule (`workflow/setup/01-system-overview.md` (search: `## State check`)) to require content-drift checks, not just structural audit pass
5. **Block citations of gitignored paths from committed files** - add a preflight grep for `\.goat-flow/(scratchpad|tasks|logs/sessions|logs/quality|logs/critiques|logs/security|logs/uploads)/` inside `*.md` and `*.ts` files (excluding the gitignored trees themselves and the documented "where to write artifacts" instructions). The `instruction-file-skill-reference-pointer` audit check already understands which paths are gitignored; reuse that classification here.
6. **Block competitor / third-party skill names in goat-flow-owned committed surfaces** - maintain a small denylist (`Valyu`, `MySQL skill`, `prime corpus`, `frontend-design skill`, `writing-skills`, plus any future external skill references discovered) and grep `*.md` / `*.ts` outside `node_modules`, `.claude/worktrees`, `.goat-flow/scratchpad`, `.goat-flow/tasks`, `.goat-flow/logs`. Generic patterns must be stated provider-neutrally (`<VENDOR>_API_KEY`, `a domain skill`, `a vendor-SDK skill`).
7. **Do not format illustrative basenames as path-like code spans** unless they resolve from the repo root. If a filename is an example rather than an actual path, write it in prose or include a valid parent directory.

---

## Footgun: Version bump checks do not cover synthetic project config strings

**Status:** active | **Created:** 2026-04-30 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** `bash scripts/bump-version.sh <version>` and `npm run check-versions` both pass, but helper scripts, integration fixtures, or secondary reference/playbook trees can still retain the previous release version.

**Why it happens:** The bump script intentionally updates a curated list of release surfaces, and `check-versions.mjs` verifies the version surfaces it knows about. Synthetic project builders that embed a config file as an inline string, or newly split reference directories that are not added to both the bump script and checker, stay outside both surfaces unless they are manually grepped.

**Evidence:** During the v1.3.2 M07 release gate, `npm run check-versions` printed `All template and reference versions match 1.3.2`, but `rg -n "1\\.3\\.1" ... scripts/profile-dashboard-audit.mjs test` still found current-version strings in `scripts/profile-dashboard-audit.mjs` (search: `writeSyntheticProject`) and `test/integration/dashboard-server.test.ts` (search: `makeDashboardCacheProject`). During the v1.6.1 bump on 2026-05-11, `bash scripts/bump-version.sh 1.6.1` and `npm run check-versions` passed while `rg -n 'goat-flow-reference-version: "1\\.6\\.0"' workflow/skills/playbooks .goat-flow/skill-playbooks` still found stale playbook frontmatter.

**Structural anchors:**
- `scripts/bump-version.sh` (search: `# ── Source files (version string replacement)`) lists the curated surfaces the bump workflow edits.
- `scripts/check-versions.mjs` (search: `goat-flow-reference-version`) verifies skill and reference frontmatter, not arbitrary embedded config stubs.
- `workflow/skills/playbooks/README.md` (search: `goat-flow-reference-version`) is a standalone playbook tree that must be included alongside `workflow/skills/reference/`.
- `scripts/profile-dashboard-audit.mjs` (search: `writeSyntheticProject`) creates a synthetic `.goat-flow/config.yaml` for profiler runs.
- `test/integration/dashboard-server.test.ts` (search: `makeDashboardCacheProject`) creates a dashboard-cache fixture project with an embedded config string.

**Prevention:** After every release bump, run a targeted stale-version grep across scripts, tests, packages, workflow templates, installed skill/reference/playbook mirrors, and config files, not just `npm run check-versions`: `rg -n "<old-version>" scripts test package.json package-lock.json .goat-flow/config.yaml workflow .agents .claude .github/skills .goat-flow/skill-reference .goat-flow/skill-playbooks`.

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
- `.goat-flow/decisions/ADR-030-replace-gemini-with-antigravity.md` (search: `Canonical agents`) - current four-agent identity is Claude, Codex, Antigravity, and Copilot.

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
- **Skill template paths use framework-local paths instead of project-local paths** (resolved 2026-04-12) - Changed skill template references away from `workflow/templates/`. The interim landing path `.goat-flow/templates/` was later retired; today the shared references live at `.goat-flow/skill-reference/`.
- **Refactor cleanup doesn't reach bash script conditional guards** (resolved 2026-04-13) - Removed dead `[[ -f src/cli/rubric/version.ts ]]` guard that silently skipped 74 lines of version-consistency checks.
- **Partial feature removal leaves type and detection artifacts** (resolved 2026-04-14) - Removed Copilot from type unions, UI name mappers, terminal runner maps, and SKILL_ROOTS after agent removal.
- **Line target inconsistency for project shapes** (resolved 2026-03-18) - Line target canonicalized to one value for all shapes in ADR-008; read ADR-008 for the current target.
- **CONTRIBUTING.md directs contributors to the wrong subsystem** (resolved 2026-04-13) - Rewritten to describe build checks in `check-goat-flow.ts` + `check-agent-setup.ts` and quality checks in `src/cli/audit/harness/`.
- **Stale references from old project structure** (resolved 2026-04-15) - `ai-workflow-framework` no longer appears anywhere in the repo (verified by `rg "ai-workflow-framework"`).
- **Preflight validates doc totals but not sub-breakdowns** (resolved 2026-04-17) - `scripts/preflight-checks.sh` (search: `B.8a2: Sub-breakdown validation`) now extracts `setup_count` and `agent_count` from the audit modules and validates the `(N setup + M agent)` breakdown claim in `.goat-flow/architecture.md`, not just the total. Verified by grep of preflight source.
- **Dashboard session-limit constants drift across server, UI, docs, and tests** (resolved 2026-04-19) - `src/cli/server/terminal.ts` (search: `MAX_SESSIONS`) exports the constant, `src/cli/server/dashboard-terminal.ts` (search: `MAX_SESSIONS`) imports it, `test/integration/dashboard-server.test.ts` (search: `data.maxSessions`) asserts the value, and `docs/dashboard.md` says "Maximum 10 concurrent sessions" - all four surfaces agree on 10. Pattern-class hygiene ("single exported constant reused in API payload, UI guards, and static copy") remains good practice for any future repo-wide cap; grep `maxSessions`, `serverSessions.length >=`, `Maximum of` before closing a similar change.
- **ADR renumbering concrete examples** (resolved 2026-05-27) - Historical stale references to `ADR-010-confusion-log-disposition.md`, `ADR-023-expand-inline-conventions.md`, and `ADR-016-dispatcher-is-canonical-skill.md` were already fixed before M11; the active entry now keeps only the failure pattern.
