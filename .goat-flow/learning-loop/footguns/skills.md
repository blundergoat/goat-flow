---
category: skills
last_reviewed: 2026-09-05
---

## Footgun: Skill parity edits can miss `.github/skills/` and fail repo-level drift checks

**Status:** active | **Created:** 2026-04-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When editing `workflow/skills/*/SKILL.md`, update every installed mirror in `.claude/skills/`, `.agents/skills/`, and `.github/skills/` in the same change, deriving the roots from `workflow/manifest.json` or `getInstalledSkillRoots()` rather than memory. Re-run `test/integration/audit-drift.test.ts` or `goat-flow audit --check-drift` so a missed mirror fails immediately.

**Symptoms:** A skill edit looks complete because `workflow/skills/`, `.agents/skills/`, and `.claude/skills/` match, but `test/integration/audit-drift.test.ts` fails on the repo root because `.github/skills/` still differs.

**Why it happens:** The installed surface is broader than the two mirrors most edits cover. `workflow/manifest.json` (search: `"skills_dir": ".github/skills/"`) declares the GitHub agent root, `src/cli/manifest/manifest.ts` (search: `getInstalledSkillRoots`) exposes it to the drift fixture, and `scripts/check-path-integrity.sh` (search: `skill_dirs=".claude/skills .agents/skills .github/skills"`) treats it as a first-class mirror, so a hand-written file list that omits it is incomplete.

**Evidence:** `test/integration/audit-drift-checkdrift-this-repo.test.ts` (search: `goat-flow root should be drift-clean`) failed on 2026-04-21 with `goat-review: template (workflow/skills/goat-review/SKILL.md) and installed copy (.github/skills/goat-review/SKILL.md) differ`. Mirror budgets across all four roots are pinned by `test/contract/skill-hardening-contracts.test.ts` (search: `functional skills stay within the 2500-word cap across all mirrors`).

## Footgun: Shared reference edits can split workflow templates from installed runtime copies

**Status:** active | **Created:** 2026-04-25 | **Evidence:** ACTUAL_MEASURED

**Prevention:** When changing `skill-preamble.md`, `skill-conventions.md`, or topical files under `workflow/skills/reference/`, edit the workflow template and installed copy together; when changing playbooks under `workflow/skills/playbooks/`, update the matching `.goat-flow/skill-docs/playbooks/` surface too. Exception: the `skill-quality-testing` methodology starts at `workflow/skills/playbooks/skill-quality-testing.md` plus its topical files and installs to `.goat-flow/skill-docs/skill-quality-testing/README.md` plus the installed topical files. Re-run `bash scripts/preflight-checks.sh`, or at minimum `node --import tsx src/cli/cli.ts audit . --check-drift --format json`, before treating the change as complete.

**Symptoms:** An edit to shared skill guidance looks correct in the loaded runtime copy but leaves the workflow template behind, so projects installed from that template miss the rule and preflight or drift tests fail.

**Why it happens:** Shared reference files have two live surfaces, `workflow/skills/reference/` as the install source and `.goat-flow/skill-docs/` as the runtime copy this repo's agents load, and agents naturally edit the file they just read.

**Evidence:** `.goat-flow/skill-docs/skill-preamble.md` (search: `Routing rule`) is the runtime rule that triggered the drift; `workflow/skills/reference/skill-preamble.md` (search: `Learning-Loop Retrieval`) is its template source; `scripts/preflight-checks.sh` (search: `Skill Docs Sync`) fails when they differ; `src/cli/audit/check-artifact-integrity.ts` (search: `SHARED_ARTIFACT_MIRRORS`) owns the mirror registry the audit path uses.

## Footgun: Skill reference-pack merges can leave stale installed files behind

**Status:** active | **Created:** 2026-05-21 | **Evidence:** ACTUAL_MEASURED

**Prevention:** After any per-skill reference merge, rename, or deletion, update `workflow/manifest.json` `skills.references`, run an installer round-trip that starts with a stale reference file, and run `node --import tsx src/cli/cli.ts audit <target> --agent <id>` against a target holding the stale file to prove audit fails before reinstall and passes after.

**Symptoms:** A target upgraded to the current release has current `SKILL.md` files and manifest-listed references, but old per-skill Markdown files remain beside them, so agents that grep `references/` read superseded guidance with old `goat-flow-reference-version` frontmatter while setup and agent-skill audits pass.

**Why it happens:** Installation overwrites the files the manifest lists, and a copy-only upgrade never deletes files a merge removed from that list.

**Evidence:** A gruff-php upgrade on 2026-05-21 left `auth-authz.md`, `cicd-and-agent-surfaces.md`, `dependency-and-supply-chain.md`, and `secrets-and-data-exposure.md` under `.claude/skills/goat-security/references/` after they were merged into the v1.7.0 `identity-and-data.md` and `supply-chain-and-cicd.md` set. `workflow/install-goat-flow.sh` (search: `prune_unlisted_skill_references`) now removes unlisted Markdown from canonical `references/` directories before copying, and `src/cli/audit/check-agent-setup.ts` (search: `checkUnexpectedSkillReferences`) fails `agent-skills` when installed references are not listed.

---

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Installed skill files can reference framework-only ADRs that don't exist in consumer projects

**Status:** resolved | **Created:** 2026-05-02 | **Resolved:** 2026-05-02 | **Evidence:** ACTUAL_MEASURED

**Resolution:** All ADR references were removed from installed skill files in v1.4.0 and the rules restated inline with their rationale; `rg 'ADR-\d+' workflow/skills/` returns zero matches. Agents in consumer projects had been looking up ADR-021 and a removed ADR in `.goat-flow/learning-loop/decisions/` and either hallucinating content or losing context.

**Prevention retained:** Any file the installer copies to consumer projects states its rules and a one-line why inline and never cites a framework ADR; ADR references stay in framework-internal files (footguns, lessons, architecture, code-map, instruction files).

## Footgun: Installed skill copies can drift on punctuation-only edits and fail unrelated test runs

**Status:** resolved | **Created:** 2026-04-18 | **Resolved:** 2026-04-18 | **Evidence:** ACTUAL_MEASURED

**Resolution:** Installed copies under `.claude/skills/` and `.agents/skills/` are byte-identical with the templates. `npm test` had failed in `test/integration/audit-drift.test.ts` on an unrelated change because the tracked copies had Unicode em dashes where `workflow/skills/goat-plan/SKILL.md` (search: `## When to Use`) had ASCII hyphens; the preflight `Skill SKILL.md Parity` check and `goat-flow audit --check-drift` both catch byte-level divergence.

## Footgun: Workflow template source and installed copy can silently diverge

**Status:** resolved | **Created:** 2026-04-15 | **Resolved:** 2026-04-15 | **Updated:** 2026-04-17 | **Evidence:** ACTUAL_MEASURED

**Resolution:** The shared preamble template at `workflow/skills/reference/skill-preamble.md` and its installed copy at `.goat-flow/skill-docs/skill-preamble.md` had diverged by one line, discovered 2026-04-15 by multi-agent critique, so agents on consumer projects followed a different rule from agents in this repo. Guards: `scripts/preflight-checks.sh` (search: `Skill Docs Sync`) diffs preamble, conventions, and playbooks byte-exactly against templates and (search: `Skill SKILL.md Parity`) diffs each template against `.claude/skills/` and `.agents/skills/`; `goat-flow audit --check-drift` via `src/cli/audit/check-drift.ts` (search: `skillContentsEquivalent`) normalises frontmatter key order and trailing whitespace and detects orphan directories and deprecated names from the manifest's `stale_names`; `test/integration/preamble-sync.test.ts` and `test/integration/audit-drift.test.ts` cover both paths.
