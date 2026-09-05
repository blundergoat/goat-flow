---
category: hook-scanning
last_reviewed: 2026-09-05
---

**Scope:** What a hook-driven scanner can and cannot see: changed-file enumeration, diff and rename detection, gitignore and gitattribute interactions, and language or block parsing. Hook registration, launcher runtime, and policy-module behaviour live in `hooks.md`; installation and per-agent config live in `hook-installation.md`.

## Footgun: Destination-only Git pathspecs disguise renames as full-file additions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Resolve rename identity before deriving edit ranges from a path-limited diff.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Git rename detection needs both sides of the move. Query full `--name-status --find-renames` output first, then diff the matched source and destination together before parsing positive hunks. Anchors: `workflow/hooks/gruff-code-quality.sh` (search: `rename_source_for_path`) and `test/integration/gruff-code-quality-contract.test.ts` (search: `classifies rename-only Git changes as not applicable`).

**Symptoms:** A diff limited to a rename destination hides the source path and renders an unchanged rename as a full-file addition, so edit-time analysis treats every line as user-authored and reports a clean scan or unrelated debt instead of a not-applicable rename.

## Footgun: Changed-range scoping makes a quality hook structurally blind to file-level rules

**Status:** active | **Created:** 2026-08-05 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 5 | **Latest occurrence:** 2026-08-10
**Decision changed:** Keep edit-time attribution and release-time repository enforcement as separate layers: the hook reports findings attributable to touched files/ranges, while preflight owns a full-repository accepted-debt ratchet.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Keep PostToolUse fast and attributable, but expose incomplete coverage explicitly when the analyzer is missing, times out, emits invalid JSON, or reports zero analyzed files. In preflight, run the repo-local analyzer once in JSON mode and compare findings by `stableIdentity` against reviewed accepted debt; fail on analyzer errors, new warnings, worsened size metadata, stale baseline state, or degraded scan coverage while reporting unchanged accepted findings. Never use the composite grade or raw finding count as the ratchet, and never clear the gate by disabling rules or raising thresholds. A change that eliminates a warning reconciles the accepted-debt manifest in the same proof pass. Anchors: `scripts/preflight-checks.sh` (search: `No gruff-ts rules disabled (satisfy or tune)`), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: "Prefer `stableIdentity` for finding diffs"), `.gruff-ts.yaml` (search: `size.file-length`), `scripts/gruff-warning-ratchet-checks.mjs` (search: `The finding is gone`).

**Symptoms:** Every edit to an oversized file reports clean, so the file keeps growing and no warning is ever emitted for an agent to ignore. Measured 2026-08-05: editing `test/unit/hook-registrar.test.ts` at 1,139 lines against a 750 threshold produced no hook output while `gruff-ts analyse` reported `size.file-length` immediately, and twenty files had crossed the gate that way. A full-repository scan the same day found 36 findings while preflight reported `PASS   79 checks · 0 warnings`, because its Gruff Policy check only rejects disabled rules and never runs the analyzer.

**Why it happens:** `size.file-length`, `docs.missing-file-overview`, and `design.circular-import` report at line 1 with `scope=file`, and `--changed-ranges` makes the analyzer drop them before the hook sees them. The fix requests the whole file and selects scopes in the hook, keeping `scope=file` and `scope=project` findings unconditionally while confining line and symbol findings to edited ranges; symbol widening is lost, and the legacy `analyse` path still delegates ranges to analyzers that cannot express scope. Anchors: `workflow/hooks/gruff-code-quality.sh` (search: `hook_v1_report`) and (search: `A file-scope finding describes the file the agent is editing right now`).

**Incident ledger:**
- **Recurrence 2026-08-08:** shortening `src/cli/cli-handlers.ts` from 759 to 747 lines made preflight fail on stale accepted identity `4348d703d920ab92` until that baseline entry was removed; `src/cli/prompt/commit-guidance.ts` (search: `emitCommitGuidanceInstallResult`) later took the guidance reporting when the threshold was crossed again on 2026-08-10.
- **Recurrence 2026-08-09:** a changed-range scan showed three advisories while full preflight found three task-local file-length warnings, cleared by moving matrix checks into `test/unit/hook-registrar.helpers.ts` (search: `verifyAgentHookRegistrationMatrix`) and compacting `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredRuntimeProbes`).
- **Recurrence 2026-08-10:** a whole-file scan measured the edited adapter and launcher at 827 and 836 lines; moving lifecycle capture and timeout selection into `workflow/hooks/hook-launch-runtime.mjs` (search: `captureHookProcessUntilDeadline`) restored 742 and 746, pinned by `test/integration/packaged-hook-install.test.ts` (search: `npm archive must contain the candidate launch runtime bytes`).

## Footgun: Blocking Stop scanners can wedge on gitignored local state

**Status:** active | **Created:** 2026-06-14 | **Evidence:** OBSERVED

**Prevention:** For default blocking Stop hooks, define "changed content" as committable content: tracked diffs, staged diffs, and untracked non-ignored files. Do not add `git ls-files --others -i --exclude-standard` scans unless the hook is opt-in or advisory, keep staged-diff scanning so `git add -f .env` still blocks, and pair every scanner expansion with one real staged hazard that must block and one ignored local-state fixture that must not wedge the agent.

**Symptoms:** A Claude turn cannot stop although the tracked and staged changes are safe. The Stop hook keeps reporting findings under ignored output, scratch material, caches, or mutation-test sandboxes, and every "holding" response re-runs it.

**Why it happens:** A blocking Stop hook runs at turn end, not commit time, so scanning ignored files treats local runtime state, including real local `.env` files and coverage output, as work the agent must fix before it can yield.

**Evidence:** 2026-06-14 live loop: `post-turn-safety` scanned ignored mutation-test sandbox copies of an environment example and blocked placeholders such as `NOTION_TOKEN="ntn_your_notion_token_here"`. `workflow/hooks/post-turn-safety.sh` (search: `scan_tracked_changes`) and (search: `scan_untracked_changes`) scan committable changes only; `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `allows ignored env files that are not staged`) and (search: `blocks ignored env files once they are force-staged`) lock the boundary.

## Footgun: Gitignored local artifacts make repository scans diverge between local and CI

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-09-04

**Prevention:** A shared scan contract covers only files every environment can reproduce. Build declared generated artifacts before the scan in every environment, verify accepted-debt paths against tracked or deliberately generated inputs, and reproduce the gate from a clean tracked-tree fixture instead of trusting an existing developer build.

**Symptoms:** Local `dist/cli/cli.js` satisfied the package binary check while a fresh CI checkout ran the warning ratchet before building `dist/` and reported `design.package-bin-missing`.

**Why it happens:** A full-repository analyzer silently depends on gitignored local state that the developer tree has and a clean checkout lacks.

**Evidence:** Measured from a clean `git archive` on 2026-08-07: the ratchet emitted stable identity `75483f7900f8f4f6` before the build and passed after `npm run build` with 449 analysed files. Anchors: `scripts/check-gruff-warning-ratchet.mjs` (search: `minimumAnalysedFiles`) and `.github/workflows/ci.yml` (search: `Build package binary`). **Recurrence 2026-09-04:** M15's installer round-trip fixture copied the live checkout and inherited its gitignored managed-install receipt, so the disposable repo failed its first-install assumption at the admission guard; the fixture now excludes the install-state directory, per `test/integration/audit-drift.helpers.ts` (search: `localInstallStateDirectory`).

## Footgun: Nested template literals can blind the gruff-ts block scanner to everything after them

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Treat a suspiciously clean gruff result on a file with nested template literals as unparsed, not clean. Prefer plain concatenation or an extracted variable over templates nested inside interpolations, and when a size or complexity finding names a function far smaller than the reported span, suspect scanner blinding before refactoring that function.

**Symptoms:** A template nested inside another template's `${...}`, such as `` `${JSON.stringify({ reason: `text ${value}` })}` ``, makes gruff-ts 0.4.0 read the inner backtick as closing the outer template, misread the following braces, and attribute the rest of the file to the enclosing function, so findings in the blinded region never appear.

**Evidence:** Measured 2026-08-07: with nested templates in `reportUnavailable`, the analyzer reported `size.function-length` of 226 lines for a roughly 40-line function and zero process-exec findings for the file; replacing the nesting with concatenation removed the phantom finding and surfaced the file's real `spawnSync` warning. Anchors: `workflow/hooks/run-with-bash.mjs` (search: `a template literal`) and (search: `const windowsTreeKillResult = spawnSync`).

---

## Footgun: A `-diff` gitattribute blinds content scanners that enumerate changed paths

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED

**Prevention:** To keep a generated file out of review noise without blinding scanners, use `text linguist-generated=true`, which collapses the GitHub diff while leaving numstat counts intact; reserve `-diff` for unreadable content. After changing a lockfile attribute, confirm real counts with `git diff --numstat -- <path>`.

**Symptoms:** A post-turn or pre-commit scanner reports a plain-text path as unscannable and refuses to claim coverage, and marking it `text` alone does not clear the report.

**Why it happens:** `binary` is shorthand for `-text -diff`, and `-diff`, not `-text`, makes numstat report `-\t-\t<path>`, so a numstat-driven scanner cannot tell a binary from text whose diff is merely suppressed.

**Evidence:** `.goat-flow/hooks/post-turn-safety.sh` (search: `binary changed path not scanned`) builds its inventory from `git diff --numstat`; `.gitattributes` (search: `package-lock.json`) previously carried `binary`, so numstat emitted `-\t-\tpackage-lock.json` while `file` reported JSON text with zero NUL bytes. Switching to `text -diff` did not fix it; only removing `-diff` restored `2\t2\tpackage-lock.json`.

---

## Footgun: Gruff `docs.*` rules prove a comment exists, not that it describes the symbol beneath it

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a clean or near-clean `gruff-ts analyse` result counts as evidence that a file's doc comments are attributed to the right symbol and factually true.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Read the symbol under each docblock you touch; a clean analyzer is not attribution evidence, and ADR-059 treats a Gruff documentation finding as a candidate, not a mandate. Two comment blocks with nothing between them mean one is orphaned; find the symbol it was written for instead of deleting it. Treat `@param` and `@return` accuracy on non-exported functions as unchecked, confirm a repeated tag line still describes each site, and when `docs.stale-param-tag` fires, count the tags against the signature before editing because the reported symbol may already be correct.

**Symptoms:** A docblock that drifted onto a neighbouring function, or a copy-pasted `@param` line still describing its donor, satisfies every enabled rule and reads as clean.

**Why it happens:** The documentation rules ask whether a comment exists and whether a docblock's tag list matches its signature, never whether the prose describes the symbol below it. A docblock stacked directly above another still satisfies the presence rule for the symbol below, and `docs.missing-param-tag` and `docs.stale-param-tag` fire only on an `export function` that already carries a `/** */`.

**Evidence:** Measured 2026-08-16 at HEAD `4bed4404`: `gruff-ts analyse src --format json` over 224 files returned 17 findings with no attribution or accuracy defect, while a direct scan found three docblocks above the wrong symbol (only one produced a finding, as a side-effect `docs.missing-internal-function-doc` on the orphaned function) and twelve copies of one `@param _warnings` line in `src/cli/config/reader-validators.ts`, seven naming a parameter that does not exist, none reported because those validators are internal; the rule fired once in `src/`, as a false positive on the exported `validateFindingLine`. All were corrected in the same session. Anchors: `src/cli/cli-parser.ts` (search: `Return whether a raw \`parseArgs\` boolean flag was explicitly set`), `src/cli/config/reader-validators.ts` (search: `accumulator this block's unrecognized nested keys are appended to`), `src/cli/review-validate-anchors.ts` (search: `export function validateFindingLine`), `.gruff-ts.yaml` (search: `docs.stale-param-tag`).

## Resolved Entries

> Historical record. These entries are no longer active traps.

## Footgun: Fail-soft analyzer skips can silently uncover a configured language

**Status:** resolved | **Created:** 2026-06-09 | **Resolved:** 2026-07-17 | **Evidence:** OBSERVED

**Resolution:** The hook still exits silently when project configuration is missing, but emits a targeted stderr diagnostic when a matching `.gruff-<lang>.yaml` has no discoverable analyzer, preserving fail-soft exit 0. `test/integration/gruff-code-quality-smoke.test.ts` (search: `exits silently when project config is missing and diagnoses configured languages without a binary`) verifies both sides.

**Original symptoms:** A project with a root `.gruff-<lang>.yaml` edited a matching file and the PostToolUse hook exited 0 with no output, so the agent could infer the lines were clean while the analyzer never ran. In a monorepo incident `gruff-py` lived only under `strands_agents/.venv/bin/`, and ADR-032 correctly rejects automatic `*/.venv/bin` discovery.

**Anchors:** `workflow/hooks/gruff-code-quality.sh` (search: `present but %s not found on search paths`) and (search: `config_error_message`); `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses an explicit env override for a non-standard monorepo gruff binary`); `.goat-flow/learning-loop/decisions/ADR-032-scope-gruff-hook-binary-discovery.md` (search: `Scope gruff-code-quality hook binary discovery to standard install locations`).

**Prevention retained:** Keep config-present/binary-absent visible while preserving fail-soft exit 0 and ADR-032's no-recursive-discovery rule; monorepos with analyzers outside standard paths use an explicit executable override.
