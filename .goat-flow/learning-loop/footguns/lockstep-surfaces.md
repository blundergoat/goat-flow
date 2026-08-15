---
category: lockstep-surfaces
last_reviewed: 2026-08-15
---

**Scope:** Changes where adding or renaming one artifact obliges a matching edit on several other surfaces at once, and the partial-update failures that follow. Stale pointers, path validation, and evidence rot live in [docs-and-crossrefs.md](docs-and-crossrefs.md).

## Footgun: Flipping a doctrine in one playbook leaves siblings citing the old stance

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A policy change in one doc passes its own review, but a sibling playbook or instruction file still encodes - and triages by - the OLD stance. The two cross-reference each other, so they now contradict. A sibling may even quote another file's stance that no longer exists. Structural checks (drift parity, path resolution) stay green because nothing moved or renamed; only the meaning changed.

**Why it happens:** Doctrine lives in prose spread across densely cross-referencing docs. Changing the canonical statement does not update the docs that cite or depend on it, and no structural check compares *meaning*.

**Evidence:** After `code-comments.md` flipped from "default no comments" to mandatory doc comments on every unit (2026-05-29), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` still triaged `docs.missing-internal-function-doc` as "gold-plating the playbook forbids" per the old "no comment unless WHY" default, and attributed that default to `CLAUDE.md` - which contains no such stance (grep of `CLAUDE.md` / `AGENTS.md` / `.github/copilot-instructions.md` returned zero comment-policy hits). The 2026-05-29 reconciliation made that then-current mandatory-doc stance explicit. ADR-059 narrowed it on 2026-08-14. The first sibling rewrite accidentally let the "non-obvious contract" qualifier cover public/exported APIs as well as file/module/class boundaries; final review caught the mismatch. The corrected sibling separates those cases at `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `when the symbol is a public/exported API`).

**Prevention:** When you flip a doctrine, grep sibling playbooks, instruction files, and reference docs for the OLD stance's phrasing AND for any doc that cites the changed file by name; reconcile them in the same change. Grep the ACTUAL old wording, not a guessed token - the first cross-ref pass missed "Default to writing no comments" by grepping for "default-no-comment". Verify cross-file quotes: a doc that says `X says "..."` must actually match X. When a rule uses a qualifier, pin its grammatical scope in a contract test; keyword presence cannot distinguish "A or B with Q" from "A, or B with Q".

## Footgun: Adding an instruction-file section ripples across four section-list sources plus the line target

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Adding one `## <Section>` heading to an instruction file (e.g. `## Commit Messages` in the 2026-05-29 commit-doc consolidation) fails seemingly-unrelated contracts: the instruction-parity script reports "canonical H2 order mismatch"; live instruction files can overflow the `line_target` budget; setup-guide ordering and the shared skeleton can drift; and - if the heading is added to manifest `required_sections` - the harness `instruction-sections-present` check fails every stub instruction fixture that lacks it (`boundaryInstruction` / `completeInstruction`).

**Why it happens:** The canonical instruction-file section set is declared in multiple places that must agree, and a separate line-count contract caps the same files:
- `scripts/check-instruction-parity.mjs` (search: `CANONICAL_SECTIONS`) - exact H2-order match across all 7 instruction files (3 live + 4 setup guides).
- `workflow/manifest.json` (search: `"required_sections"`) - drives the harness `instruction-sections-present` check on EVERY audited project, including test stubs and downstream installs.
- `workflow/setup/reference/execution-loop.md` (search: `Required Sections`) - the lettered skeleton each setup guide mirrors; a test asserts it names every section.
Live instruction files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) also cap at `line_target` 125 (search: `line_target`). Measured 2026-08-15 they sit at 120, 120, and 118, so a new section has only a few lines of headroom before it overflows the cap and forces a trim elsewhere.

**Evidence:** `scripts/check-instruction-parity.mjs` (search: `"Commit Messages"`), `workflow/setup/agents/codex.md` (search: `## Commit Messages`), and `workflow/setup/reference/execution-loop.md` (search: `e) Commit Messages`) gained the section in lock-step. `workflow/manifest.json` `required_sections` deliberately does NOT list it because the stub instructions lack the heading. Room was reclaimed by condensing the numbered Truth Order to one prose line (search: `User's explicit instruction (this session) >`).

**Prevention:** To add a canonical instruction-file section, update the parity `CANONICAL_SECTIONS`, the setup guides, and the skeleton `execution-loop.md` (with re-lettering) together, then add the section to all 7 instruction files. Leave manifest `required_sections` alone unless you also give every stub instruction fixture the heading - enforce instead via parity (own files) and setup templates (downstream). Budget the ~125-line live-file cap by condensing existing content. See ADR-031.

---

## Footgun: Hook additions and renames cross runtime, dashboard, and audit surfaces

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Symptoms:** A hook script can exist and pass its own smoke test while the dashboard registry, installer, manifest, preflight parity, audit facts, agent config templates, installed mirrors, and docs disagree about whether it is installed or togglable.

**Evidence:** The 2026-05-25 split touched `src/cli/server/hooks-registry.ts` (search: `deny-dangerous`), the hook self-test, manifest, installer, preflight, agent templates and mirrors, `src/cli/facts/agent/hooks.ts` (search: `LEGACY_GUARDRAIL_HOOK_FILES`), and `src/cli/hooks-command.ts` (search: `handleHooksCommand`).

**Recurrence 2026-05-26:** The `gruff-code-quality` hook rename focused drift run failed because `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `writeHookFixtures`) copied only `patterns-writes.sh` and `deny-dangerous-self-test.sh` into its temporary hook fixture. The live manifest now declares all split guardrails, so the fixture had to copy `patterns-shell.sh`, `patterns-paths.sh`, and `patterns-writes.sh` in lock-step.

**Recurrence 2026-08-15:** The 1.15.1 hook stack added surfaces the 2026-05-25 list predates, so a hook change can now pass every listed check and still ship an unregistrable or unverifiable hook. Executing 1.16.0 M01 confirmed each surface exists and is separately owned: `src/cli/hook-verification-contracts.ts` (search: `HOOK_VERIFICATION_CONTRACTS`) maps hook ids to `hooks verify` scenarios; `src/cli/server/hook-managed-installation.ts` (search: `Remove current and legacy managed files for one retired hook`) owns copy and retirement of installed script bytes; `scripts/generate-managed-hook-desired-state.mjs` (search: `RETIRED_HOOK_SCRIPT_NAMES`) generates the contract the shell installer consumes; `workflow/hooks/hook-launch-runtime.mjs` (search: `captureHookProcessUntilDeadline`) and `workflow/hooks/hook-provider-adapters.mjs` (search: `decodeHookLaunchContract`) own timeout and per-provider delivery; and `test/integration/packaged-hook-install.test.ts` (search: `packaged hook installation canary`) is the only coverage that runs archived package bytes rather than the working tree.

**Prevention:** When adding, renaming, or deleting a goat-flow hook, update this lock-step list: canonical script(s), central self-test, registry entry, config default, installer copy list, generated desired-state contract in `scripts/generate-managed-hook-desired-state.mjs`, managed installation and retirement in `src/cli/server/hook-managed-installation.ts`, verification-scenario mapping in `src/cli/hook-verification-contracts.ts`, launch runtime and provider adapters in `workflow/hooks/hook-launch-runtime.mjs` and `workflow/hooks/hook-provider-adapters.mjs`, manifest `hooks[]`, per-agent config templates, installed repo mirrors, audit fact extraction, preflight self-test/parity/runtime smoke, packaged-install coverage in `test/integration/packaged-hook-install.test.ts`, dashboard view/API if response shape changes, CLI help if command surface changes, docs/code-map/architecture/changelog, and tests. Then run a source grep for the old hook id and a runtime-shaped smoke through an installed hook.

---

## Footgun: Adding a skill-playbook requires lock-step updates across 13+ surfaces

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** A playbook appears in `workflow/skills/playbooks/` and `.goat-flow/skill-docs/playbooks/`, but one parity, audit, prompt, install, or docs surface is not enrolled. The playbook works locally until template-vs-installed drift or missing setup context surfaces later.

**Why it happens:** `workflow/manifest.json` is the nominal source of truth, but playbooks are still hand-enumerated across template, installed copy, manifest required files and directory prose, installer copy lines, both README indexes, `scripts/preflight-checks.sh`, `test/integration/preamble-sync.test.ts`, `test/integration/audit-build.test.ts`, `src/cli/audit/check-goat-flow.ts`, `src/cli/audit/check-artifact-integrity.ts`, `workflow/setup/03-install-skills.md`, `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, and sometimes `knip.json`.

**Evidence:** `code-comments.md` and `observability.md` initially shipped without full parity enrollment; the gap was closed when later playbooks forced updates to `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/code-comments.md`), `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`), and `test/integration/preamble-sync.test.ts` (search: `template and installed code-comments.md match`). The 2026-05-25 gruff-code-quality addition also proved package-surface coupling when preflight exposed a Knip dependency classification issue.

**Prevention:** When adding a playbook, grep the new filename through every surface above before declaring done. Then run `bash scripts/preflight-checks.sh`; the output must name the new playbook in parity rows. Run `npm test`; `preamble-sync.test.ts` must include the new playbook. If the playbook documents a CLI-only package, run `npx knip --no-progress` and only add `ignoreDependencies` after real npm-script or shell usage still leaves Knip unable to see it.

**Recurrence update (2026-07-13):** M12 registered `skill-playbook-authoring-sync.md` in manifest and audit surfaces, so focused checks and the live controlling-workspace audit passed. The full consumer setup lifecycle then failed because `workflow/install-goat-flow.sh` lacked its explicit copy line; the same sweep found missing preflight, parity-test, setup-doc, architecture, code-map, and quality-prompt enrollment. The next preflight also rejected the playbook because its worked YAML example repeated the exact installed version assignment, producing `1.13.1 | 1.13.1`; examples now use an unquoted `CURRENT_VERSION` sentinel. The decisive reproductions are `test/integration/setup-quality-lifecycle.test.ts` (search: "keeps setup, audit, prompts, and report history on the selected consumer") and `scripts/preflight-checks.sh` (search: "Installed shared reference").

---

## Footgun: Hot-path agent instructions drift unevenly across agents

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** One agent receives weaker release or routing guidance than the others even though all four instruction files are supposed to express the same core contract.

**Why it happens:** Claude, Codex, Antigravity, and Copilot use separate hot-path files with different compression levels (Codex and Antigravity share `AGENTS.md`). Cross-agent consistency checks cover a few structural sections, but not every command line or router-table detail.

**Evidence:** A 2026-04-27 quality-review pass found `.github/copilot-instructions.md` needed the same release command now present at `.github/copilot-instructions.md` (search: `test:full`) because it still told Copilot to run only the slow suite while `CLAUDE.md` and `AGENTS.md` used the full release gate. The same pass found `AGENTS.md` Shared skill reference rows omitted topical files; those rows are now split into meta and playbook entries at `AGENTS.md` (search: `Skill reference (meta)`). (Pre-v1.8.0 evidence also cited `GEMINI.md`; that file was removed when Antigravity replaced Gemini.)

**Prevention:** When changing Essential Commands or Router Table rows in one agent instruction file, grep all hot-path files (`CLAUDE.md`, `AGENTS.md`, `.github/copilot-instructions.md`) for the same concept and update them together. Add preflight coverage when the row affects release validation or canonical reference discovery.
