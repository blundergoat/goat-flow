---
category: lockstep-surfaces
last_reviewed: 2026-09-05
---

**Scope:** Changes where adding or renaming one artifact obliges a matching edit on several other surfaces at once, and the partial-update failures that follow. Stale pointers, path validation, and evidence rot live in [docs-and-crossrefs.md](docs-and-crossrefs.md).

## Footgun: The `.goat-flow/.gitignore` rule spelling is duplicated as literals across template, audit, installer, and tests

**Status:** active | **Created:** 2026-08-18 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** A change to any rule in `workflow/setup/reference/goat-flow-gitignore` is a lock-step change: sweep `command grep -rn -E '"!?(learning-loop|skill-docs|hooks|plans|scratchpad|logs/[a-z]+)/' src test scripts` and update every literal in the same batch, then prove a hook toggle leaves a template-spelled file byte-identical.
**Trigger phase:** ACT

**Prevention:**
1. Treat gitignore rule text as a lock-step surface: template, `.goat-flow/.gitignore` mirror, `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS`, `ensureHookGitignoreEntries`, the installer's `ensure_gitignore_entry` calls, and every fixture or regex that spells a rule. Prove the installer with a fresh `goat-flow install <tmp>` followed by `goat-flow audit <tmp>`.
2. Derive fixtures from `REQUIRED_GOAT_FLOW_GITIGNORE_PATTERNS`; where a fixture must be stale on purpose, say so in a comment.
3. Keep `test/unit/hook-registrar-surfaces.test.ts` (search: `byte-identical`), `test/integration/gitignore-shape.test.ts`, and the installer matrix's exact-byte assertion green after any rule edit.

**Symptoms:** Template, mirror, constant, and parity test all agree and the fast suite is green, yet a consumer who enables a hook ends up with one extra effective line in `.goat-flow/.gitignore` and a `goat-flow-gitignore` audit failure ("does not use the required order").

**Why it happens:** The parity test pins only the template against the audit constant. `src/cli/server/hook-managed-installation.ts` (search: `ensureHookGitignoreEntries`) and `workflow/install-goat-flow.sh` (search: `ensure_gitignore_entry ".goat-flow/.gitignore"`) append their own literals, and several tests carry hand-written fixtures (`test/integration/dashboard-server.helpers.ts`, search: `!hooks/**`; `test/integration/audit-build.test.ts`, search: `stay ignored`; `test/contract/skill-hardening-shared-3.test.ts`, search: `logs\/sessions`). A spelling change such as M56's `!hooks/**` to `!**/hooks/**` leaves them all behind silently.

**Evidence:** During 1.16.0 M56 on 2026-08-18 the template moved every slash-containing rule to the `**/` prefix while the constant, mirror, parity test, and 2071-test fast suite stayed green; `ensureHookGitignoreEntries` still appended `!hooks/**`, and a fresh install carried 43 effective lines and failed its own audit. `test/unit/hook-registrar-surfaces.test.ts` (search: `leaves a template-spelled goat-flow gitignore byte-identical`) failed 2 cases before the fix. Because that proved only the TypeScript toggle, `test/integration/setup-install-agent-matrix.test.ts` (search: `standalone installer must preserve the canonical goat-flow gitignore exactly`) now runs the real installer and compares exact bytes for every agent fixture.

---

## Footgun: Flipping a doctrine in one playbook leaves siblings citing the old stance

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-08-16

**Prevention:** When you flip or extract a doctrine, grep sibling playbooks, instruction files, reference docs, and the full test tree for the old stance's exact wording and for every file that cites the changed owner by name, then reconcile them in one change. Grep the actual old phrase, not a guessed token: the first pass missed "Default to writing no comments" by grepping for "default-no-comment". Before paraphrasing a semantic anchor, find any contract outside the focused suite that pins it. A doc that says `X says "..."` must match X, and a qualifier's grammatical scope needs a contract test, because keyword presence cannot distinguish "A or B with Q" from "A, or B with Q".

**Symptoms:** A policy change passes its own review while a sibling still encodes and triages by the old stance, sometimes quoting a sentence that no longer exists. Drift parity and path resolution stay green because nothing moved; only the meaning changed.

**Why it happens:** Doctrine lives in prose spread across densely cross-referencing docs, and no structural check compares meaning.

**Evidence:** After `code-comments.md` flipped from "default no comments" to mandatory doc comments on 2026-05-29, `gruff-code-quality.md` still triaged `docs.missing-internal-function-doc` as "gold-plating the playbook forbids" and attributed that default to `CLAUDE.md`, which contains no such stance. ADR-059 narrowed the doctrine on 2026-08-14, and the first sibling rewrite let a "non-obvious contract" qualifier cover exported APIs as well as module boundaries; the corrected split is at `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `when the symbol is a public/exported API`). **Recurrence 2026-08-16:** M51's router paraphrased the examples exemption and failed `test/contract/comment-playbook-doctrine.test.ts` (search: `keeps examples correct and links the code-comment owner`) until `exempt from stylistic rewriting, not correctness, syntax, or security` was restored in both mirrors. The same preflight found `skill-quality-testing/tdd-iteration.md` describing clean controls without the contract's `no false finding, recommendation, or action` outcome, now stated verbatim (search: `The clean control produces no false finding`).

## Footgun: Adding an instruction-file section ripples across the manifest contract, templates, fixtures, and line target

**Status:** active | **Created:** 2026-05-29 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Change `workflow/manifest.json` first: add the heading to `required_sections`, classify it once under `shared_sections` or `provider_delta_sections`, then update every live and setup instruction file and the lettered setup skeleton, plus downstream audit fixtures when the heading applies to consumers. Run instruction parity, the focused manifest and parity tests, and the line-budget checks together.

**Symptoms:** One new `## <Section>` heading fails seemingly unrelated contracts: canonical H2 order, live shared-section byte parity, setup-loop parity, downstream `instruction-sections-present` fixtures, skeleton coverage, and the hot-path line budget.

**Why it happens:** `workflow/manifest.json` (search: `"shared_sections"`) owns the heading list and the shared/provider partition; `scripts/check-instruction-parity.mjs` (search: `validateSectionPartition`) consumes it for live and setup files; `workflow/setup/reference/execution-loop.md` (search: `Required Sections`) is the human skeleton; audit fixtures model downstream files independently; and the manifest also holds the `line_target` budget.

**Evidence:** The 2026-05-29 `Commit Messages` addition needed lock-step edits across live files, setup guides, and the skeleton. On 2026-08-30, moving the last hardcoded parity ownership into the manifest staled the old script anchor and `stats --check` rejected it; the repaired contract is pinned by `test/unit/local-instructions.test.ts` (search: `rejects byte drift in a manifest-declared shared live section`) and `test/unit/manifest.test.ts` (search: `declares shared live sections, provider deltas, and Codex local discovery`).

---

## Footgun: Hook additions and renames cross runtime, dashboard, and audit surfaces

**Status:** active | **Created:** 2026-05-25 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-08-15

**Prevention:** When adding, renaming, or deleting a hook, update the whole lock-step list: canonical scripts, central self-test, registry entry, config default, installer copy list, the generated desired-state contract in `scripts/generate-managed-hook-desired-state.mjs`, managed installation and retirement in `src/cli/server/hook-managed-installation.ts`, scenario mapping in `src/cli/hook-verification-contracts.ts`, launch runtime and provider adapters in `workflow/hooks/hook-launch-runtime.mjs` and `workflow/hooks/hook-provider-adapters.mjs`, manifest `hooks[]`, per-agent config templates, installed mirrors, audit fact extraction, preflight self-test, parity, and runtime smoke, packaged-install coverage in `test/integration/packaged-hook-install.test.ts`, dashboard view and API when the response shape changes, CLI help, docs, code-map, architecture, changelog, and tests. Then grep the old hook id and run a runtime-shaped smoke through an installed hook.

**Symptoms:** A hook script exists and passes its own smoke test while the registry, installer, manifest, preflight parity, audit facts, config templates, mirrors, and docs disagree about whether it is installed or togglable.

**Evidence:** The 2026-05-25 split touched `src/cli/server/hooks-registry.ts` (search: `deny-dangerous`), `src/cli/facts/agent/hooks.ts` (search: `LEGACY_GUARDRAIL_HOOK_FILES`), and `src/cli/hooks-command.ts` (search: `handleHooksCommand`) beside the self-test, manifest, installer, preflight, templates, and mirrors. **Recurrence 2026-05-26:** the `gruff-code-quality` rename failed `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `writeHookFixtures`) because the fixture copied only two guardrail files and had to copy all three split guards. **Recurrence 2026-08-15:** 1.16.0 M01 confirmed surfaces the original list predates, each separately owned: `src/cli/hook-verification-contracts.ts` (search: `HOOK_VERIFICATION_CONTRACTS`), `src/cli/server/hook-managed-installation.ts` (search: `Remove current and legacy managed files for one retired hook`), `scripts/generate-managed-hook-desired-state.mjs` (search: `RETIRED_HOOK_SCRIPT_NAMES`), `workflow/hooks/hook-launch-runtime.mjs` (search: `captureHookProcessUntilDeadline`), `workflow/hooks/hook-provider-adapters.mjs` (search: `decodeHookLaunchContract`), and `test/integration/packaged-hook-install.test.ts` (search: `packaged hook installation canary`), the only coverage that runs archived package bytes.

---

## Footgun: Adding a skill-playbook requires lock-step updates across 13+ surfaces

**Status:** active | **Created:** 2026-05-24 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 3 | **Latest occurrence:** 2026-08-24

**Prevention:** Discover the enumeration set by grepping an existing sibling's filename (for example `writing-human-facing-prose.md`) across the tree and triaging every hit as enumeration or incidental; treat any test that names the sibling as an enumeration surface until its assertions prove otherwise. Then run `bash scripts/preflight-checks.sh`, which must name the new playbook in parity rows, and `npm test`, where `preamble-sync.test.ts` must include it. If the playbook documents a CLI-only package, run `npx knip --no-progress` and add `ignoreDependencies` only after real npm-script or shell usage still leaves Knip blind.

**Symptoms:** The playbook exists in `workflow/skills/playbooks/` and `.goat-flow/skill-docs/playbooks/`, but one parity, audit, prompt, install, or docs surface is not enrolled, and the gap surfaces later as drift or missing setup context.

**Why it happens:** `workflow/manifest.json` is the nominal source of truth, but playbooks are hand-enumerated across the template, installed copy, manifest required files and `file_ownership`, installer copy lines, both README indexes, `scripts/preflight-checks.sh`, `test/integration/preamble-sync.test.ts`, `test/integration/audit-build.test.ts`, `src/cli/audit/check-goat-flow.ts`, `src/cli/audit/artifact-templates.ts` (search: `SHARED_ARTIFACT_MIRRORS`), `src/cli/audit/skill-docs-contract.ts` (search: `STANDALONE_PLAYBOOK_FILES`), `src/cli/prompt/compose-quality-agent-setup.ts` (search: `Standalone playbooks`), `workflow/setup/03-install-skills.md`, `.goat-flow/architecture.md`, `.goat-flow/code-map.md`, `test/unit/playbook-contract.test.ts` (search: `standalonePlaybookPaths`), `test/integration/audit-drift.helpers.ts` (search: `SHARED_PLAYBOOK_FILENAMES`), `test/fixtures/projects/index.ts` (search: `HEALTHY_STANDALONE_PLAYBOOK_FILENAMES`), `test/contract/skill-hardening-contracts.test.ts` (search: `TOP_LEVEL_PLAYBOOKS`), `test/contract/playbook-precedence-doctrine.test.ts` (search: `AUTHORITY_PLAYBOOKS`), and sometimes `knip.json`.

**Evidence:** `code-comments.md` and `observability.md` shipped without full enrollment until later playbooks forced `scripts/preflight-checks.sh` (search: `if [[ -f workflow/skills/playbooks/code-comments.md`), `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`), and `test/integration/preamble-sync.test.ts` (search: `template and installed code-comments.md match`). **Recurrence 2026-07-13:** M12 registered `skill-playbook-authoring-sync.md` in manifest and audit surfaces, yet `workflow/install-goat-flow.sh` lacked its copy line and preflight, parity, setup-doc, architecture, code-map, and quality-prompt enrollment were missing; preflight also rejected a worked YAML example that repeated the installed version as `1.13.1 | 1.13.1`, so examples now use an unquoted `CURRENT_VERSION` sentinel. Reproductions: `test/integration/setup-quality-lifecycle.test.ts` (search: "keeps setup, audit, prompts, and report history on the selected consumer") and `scripts/preflight-checks.sh` (search: "Installed shared reference"). **Recurrence 2026-08-24:** `writing-agent-facing-instructions.md` found five more surfaces, and the fresh-install assertion in `test/integration/setup-quality-lifecycle.test.ts` (search: `must reach a fresh consumer install`) became registry-driven over `STANDALONE_PLAYBOOK_FILES`; a sixth, the `## Project Authority` requirement in the precedence contract, stayed green locally and was caught by external review.

---

## Footgun: Hot-path agent instructions drift unevenly across agents

**Status:** active | **Created:** 2026-04-27 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When changing Essential Commands or Router Table rows in one instruction file, grep `CLAUDE.md`, `AGENTS.md`, and `.github/copilot-instructions.md` for the same concept and update them together. Add preflight coverage when the row affects release validation or canonical reference discovery.

**Symptoms:** One agent receives weaker release or routing guidance than the others although the three hot-path files are meant to express one core contract.

**Why it happens:** Claude, Codex, Antigravity, and Copilot read three separate files at different compression levels, with Codex and Antigravity sharing `AGENTS.md`. Cross-agent checks cover a few structural sections, not every command line or router row.

**Evidence:** A 2026-04-27 quality review found `.github/copilot-instructions.md` still told Copilot to run only the slow suite while the other files used the full release gate; the release command now sits at `.github/copilot-instructions.md` (search: `test:full`). The same pass found `AGENTS.md` skill-reference rows omitting topical files; they are now split at `AGENTS.md` (search: `Skill reference (meta)`).
