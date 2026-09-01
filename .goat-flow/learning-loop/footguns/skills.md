---
category: skills
last_reviewed: 2026-08-31
---

## Footgun: Skill parity edits can miss `.github/skills/` and fail repo-level drift checks

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:**
1. When editing `workflow/skills/*/SKILL.md`, update every installed mirror in `.claude/skills/`, `.agents/skills/`, and `.github/skills/` in the same change.
2. Derive installed skill roots from `workflow/manifest.json` or `getInstalledSkillRoots()` rather than from memory.
3. Re-run `test/integration/audit-drift.test.ts` or `goat-flow audit --check-drift` after any skill-parity edit so a missed mirror fails immediately.

**Symptoms:** A skill edit looks complete because `workflow/skills/`, `.agents/skills/`, and `.claude/skills/` match, but repo verification still fails. The remaining drift lives in `.github/skills/`, so `test/integration/audit-drift.test.ts` fails on the repo root even though the edit updated the more obvious mirrors.

**Why it happens:** The installed skill surface is broader than the two local agent mirrors most edits cover. `workflow/manifest.json` includes a GitHub agent with `skills_dir: ".github/skills/"`, the manifest helper exposes that root to the drift fixture, and path-integrity checks treat it as a first-class installed mirror. A hand-written file list that omits `.github/skills/` is incomplete.

**Evidence:**
- `workflow/manifest.json` (search: `"skills_dir": ".github/skills/"`) declares the GitHub agent skill root.
- `src/cli/manifest/manifest.ts` (search: `getInstalledSkillRoots`) exposes installed skill roots from the manifest-backed agent set.
- `scripts/check-path-integrity.sh` (search: `skill_dirs=".claude/skills .agents/skills .github/skills"`) checks `.github/skills/` alongside the other installed mirrors.
- `test/integration/audit-drift-checkdrift-this-repo.test.ts` (search: `goat-flow root should be drift-clean`) failed on 2026-04-21 with finding `goat-review: template (workflow/skills/goat-review/SKILL.md) and installed copy (.github/skills/goat-review/SKILL.md) differ`.
- 2026-08-04 goat-review contract synchronization updated all four roots. Durable coverage remains in `test/integration/audit-drift-checkdrift-this-repo.test.ts` (search: `goat-flow root should be drift-clean`) and `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).
- 2026-08-04 goat-debug disposition synchronization likewise updated all four roots. The installed contract is pinned in `test/contract/skill-hardening-skills-1.test.ts` (search: `keeps goat-debug ADJUSTED disposition countable in its root output`), with mirror budgets covered by `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).
- 2026-08-30 goat-review threshold hardening removed valid-looking unchunked terminal states from all four roots. The installed contract is pinned in `test/contract/skill-hardening-review-1.test.ts` (search: `ends an oversized review when the user declines chunking`), with mirror budgets covered by `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).
- 2026-08-30 goat-critique host ownership aligned the skill, ADR-021, public guidance, and setup inventory without changing ADR-006's gate conversion. The installed contract is pinned in `test/contract/skill-hardening-skills-2.test.ts` (search: `keeps goat-critique host-owned so human gates cannot auto-convert`), with mirror budgets covered by `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).

## Footgun: Shared reference edits can split workflow templates from installed runtime copies

**Status:** active | **Created:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When changing shared skill-reference files (`skill-preamble.md`, `skill-conventions.md`) or topical files under `workflow/skills/reference/`, edit the workflow template and installed copy together. When changing standalone playbooks under `workflow/skills/playbooks/`, update the matching `.goat-flow/skill-docs/playbooks/` surfaces too. Exception: the `skill-quality-testing` methodology source starts at `workflow/skills/playbooks/skill-quality-testing.md` plus topical files under `workflow/skills/playbooks/skill-quality-testing/`, but installs to `.goat-flow/skill-docs/skill-quality-testing/README.md` plus the installed topical files. Re-run `bash scripts/preflight-checks.sh` or at minimum `node --import tsx src/cli/cli.ts audit . --check-drift --format json` before treating the change as complete.

**Symptoms:** An edit to shared skill guidance can look correct in the loaded runtime copy but leave the workflow template behind, so projects installed from that template miss the rule and preflight/drift tests fail.

**Why it happens:** Shared skill reference files have two live surfaces: `workflow/skills/reference/` is the install template source, while `.goat-flow/skill-docs/` is the installed runtime copy loaded by this repo's agents. Agents naturally edit the file they just read at runtime, but the package source of truth also has to move in the same change.

**Evidence:**
- `.goat-flow/skill-docs/skill-preamble.md` (search: `Routing rule`) contains the runtime rule that triggered the current drift.
- `workflow/skills/reference/skill-preamble.md` (search: `Learning-Loop Retrieval`) is the corresponding template source that must remain byte-equivalent except for intentionally synchronized edits.
- `scripts/preflight-checks.sh` (search: `Skill Docs Sync`) fails when shared skill-doc templates and installed copies differ.
- `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`) owns the canonical shared-reference mirror registry used by the audit path.

## Footgun: Skill reference-pack merges can leave stale installed files behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After any per-skill reference merge, rename, or deletion, update `workflow/manifest.json` `skills.references`, run an installer round-trip test that starts with a stale reference file, and run `node --import tsx src/cli/cli.ts audit <target> --agent <id>` against a target containing the stale file to prove audit fails before reinstall and passes after reinstall.

**Symptoms:** A target project upgraded to the current goat-flow release has current `SKILL.md` files and current manifest-listed references, but old per-skill Markdown reference files remain beside them. Agents that grep the `references/` directory can read superseded guidance with old `goat-flow-reference-version` frontmatter even though setup and agent-skill audit checks pass.

**Why it happens:** Skill installation overwrites files listed by `workflow/manifest.json` `skills.references`, but a reference merge or rename removes files from the manifest. A copy-only upgrade does not delete files that are no longer listed, so old files survive unless the installer or audit explicitly treats unlisted references as stale.

**Evidence:**
- `workflow/install-goat-flow.sh` (search: `prune_unlisted_skill_references`) now removes unlisted Markdown files from canonical skill `references/` directories before copying current templates.
- `src/cli/audit/check-agent-setup.ts` (search: `checkUnexpectedSkillReferences`) fails the `agent-skills` check when installed goat skill references are not listed in the manifest.
- Downstream gruff-php upgrade on 2026-05-21 left `auth-authz.md`, `cicd-and-agent-surfaces.md`, `dependency-and-supply-chain.md`, and `secrets-and-data-exposure.md` under `.claude/skills/goat-security/references/` after those files were merged into the v1.7.0 `identity-and-data.md` and `supply-chain-and-cicd.md` reference set.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Installed skill files can reference framework-only ADRs that don't exist in consumer projects

**Status:** resolved | **Created:** 2026-05-02 | **Resolved:** 2026-05-02 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** Agents in consumer projects found ADR-021 and the removed historical `ADR-018-no-goat-verify-skill.md` citations in installed skill files, tried to look them up in `.goat-flow/learning-loop/decisions/`, and either hallucinated ADR content or lost context. The rules themselves worked, but the authority citations were dead links.

**Resolution:** All ADR references removed from installed skill files in v1.4.0 (goat-critique excuse table, goat-qa regression guard and constraints). Rules are now self-contained with inline rationale. Verified: `rg 'ADR-\d+' workflow/skills/` returns zero matches.

**Prevention (retained):**
1. Skill SKILL.md files and their reference packs must be self-contained. The rule and its rationale must be stated inline - never behind an ADR citation the consumer doesn't have.
2. ADR references are fine in framework-internal files (footguns, lessons, architecture, code-map, instruction files) because those live in the framework repo. The boundary is: if the file gets copied to consumer projects by the installer, it must not reference framework ADRs.
3. When adding an ADR-derived rule to a skill, state the rule and a one-line "why" inline. Cross-reference the ADR only in the framework's own learning-loop artifacts.

## Footgun: Installed skill copies can drift on punctuation-only edits and fail unrelated test runs

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Original symptoms:** `npm test` failed in `test/integration/audit-drift.test.ts` even when the code change did not touch skills, because the tracked installed copies under `.claude/skills/` and `.agents/skills/` had Unicode em dashes while `workflow/skills/` templates had ASCII hyphens.

**Original evidence:**
- `workflow/skills/goat-plan/SKILL.md` vs `.claude/skills/goat-plan/SKILL.md` (search: `## When to Use`) - hyphen vs em dash in the historical text at that section
- `workflow/skills/goat-plan/SKILL.md` vs `.claude/skills/goat-plan/SKILL.md` (search: `Milestone files exist for`) - hyphen vs em dash

**Resolution:** Installed copies are now byte-identical with the workflow templates (verified by `diff` returning empty output). The drift check at `test/integration/audit-drift.test.ts` now passes on these files.

**Prevention (retained):** When editing `workflow/skills/*/SKILL.md`, update the installed copies in `.claude/skills/` and `.agents/skills/` in the same change. The preflight `Skill SKILL.md Parity` check and `goat-flow audit --check-drift` both catch byte-level divergence before unrelated work is blocked by stale fixtures.

## Footgun: Workflow template source and installed copy can silently diverge

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-15 | **Updated:** 2026-04-17 | **Evidence:** ACTUAL_MEASURED

**Symptoms:** Agents on consumer projects follow a different rule than agents on the goat-flow repo, because the workflow template (install source) says one thing and the installed copy says another. The divergence is invisible - both files exist, both parse correctly, and no automated check compares their content.

**Resolution:** Four preventions implemented:
1. Divergence fixed - both files now match (verified by diff).
2. Preflight skill-docs sync check (search: `Skill Docs Sync` in `scripts/preflight-checks.sh`) - byte-exact diff of preamble, conventions, and playbooks against workflow templates, fails if any differ.
3. Preflight skill parity check (search: `Skill SKILL.md Parity` in `scripts/preflight-checks.sh`) - byte-exact diff of each workflow template vs `.claude/skills/` and `.agents/skills/` installed copies.
4. CLI drift check (M04, 2026-04-17) via `goat-flow audit --check-drift` (search: `skillContentsEquivalent` in `src/cli/audit/check-drift.ts`) - YAML-aware normalisation so frontmatter key reorder and trailing whitespace do not false-positive; also detects orphan directories and deprecated skill names from `workflow/manifest.json:stale_names`.
5. Integration tests: `test/integration/preamble-sync.test.ts` covers shared docs; `test/integration/audit-drift.test.ts` covers the CLI path with tmpdir fixtures.

**Original evidence (historical):** The shared preamble (template at `workflow/skills/reference/skill-preamble.md`, installed at `.goat-flow/skill-docs/skill-preamble.md`) diverged between template and installed copy around a single-line change; discovered 2026-04-15 by multi-agent critique. Exact line numbers from that incident are no longer recorded here because the file has been edited since.
