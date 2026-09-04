---
category: hook-scanning
last_reviewed: 2026-09-04
---

**Scope:** What a hook-driven scanner can and cannot see - changed-file enumeration, diff and rename detection, gitignore and gitattribute interactions, and language/block parsing. Hook registration, launcher runtime, and policy-module behavior live in `hooks.md`; installation and per-agent config live in `hook-installation.md`.

## Footgun: Destination-only Git pathspecs disguise renames as full-file additions

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Resolve rename identity before deriving edit ranges from a path-limited diff.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Git rename detection needs both sides of the move. Query full `--name-status --find-renames` output first, then diff the matched source and destination together before parsing positive hunks. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `rename_source_for_path`) and `test/integration/gruff-code-quality-contract.test.ts` (search: `classifies rename-only Git changes as not applicable`).

A Git diff limited to a rename destination can hide the source path and render an unchanged rename as a full-file addition. Edit-time analysis then treats every line as user-authored and may report a clean scan or unrelated debt instead of a not-applicable rename.

## Footgun: Changed-range scoping makes a quality hook structurally blind to file-level rules

**Status:** active | **Created:** 2026-08-05 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 5 | **Latest occurrence:** 2026-08-10
**Decision changed:** Keep edit-time attribution and release-time repository enforcement as separate layers: the hook reports findings attributable to touched files/ranges, while preflight owns a full-repository accepted-debt ratchet.
**Trigger phase:** SCOPE
**Caught at:** VERIFY

**Prevention:** Keep PostToolUse fast and attributable, but expose incomplete coverage explicitly when the analyzer is missing, times out, emits invalid JSON, or reports zero analyzed files. In preflight, run the repo-local analyzer once in JSON mode and compare findings by `stableIdentity` against reviewed accepted debt; fail on analyzer errors, new warnings, worsened size metadata, stale baseline state, or degraded scan coverage while reporting unchanged accepted findings. Do not use the composite grade or raw finding count as the ratchet, and do not clear the gate by disabling rules or raising thresholds. Evidence anchors: `scripts/preflight-checks.sh` (search: `No gruff-ts rules disabled (satisfy or tune)`), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: "Prefer `stableIdentity` for finding diffs"), `.gruff-ts.yaml` (search: `size.file-length`).

A per-edit quality hook that scopes findings to changed lines cannot report any rule that anchors to the file rather than to a line. `size.file-length`, `docs.missing-file-overview`, and `design.circular-import` all report at line 1 with `scope=file`, and passing `--changed-ranges` makes the analyzer drop them before the hook ever sees them. The result reads exactly like success: every edit to an oversized file reports clean, so the file keeps growing and no warning is ever emitted for an agent to ignore.

Measured on 2026-08-05: editing `test/unit/hook-registrar.test.ts` (1,139 lines, threshold 750) produced no hook output at all, while `gruff-ts analyse` on the same file reported `size.file-length` immediately. Twenty files had crossed the gate this way. The nearby trap is fixing only half of it - scoping the whole file when the changed range already covers it repairs the new-file case but leaves the far more common "editing an existing oversized file" case still silent.

The fix trades symbol-aware scoping for structural visibility: request the whole file and select scopes in the hook, keeping `scope=file`/`scope=project` findings unconditionally while confining line and symbol findings to the edited ranges. Symbol widening is lost, which is a real cost, but a rule nobody can ever see is worth less than one that occasionally reports a sibling function. Residual gap: the fix covers only the `gruff.hook.v1` contract path (gruff-ts today). The legacy `analyse` path still delegates ranges to analyzers advertising the native trio, and those cannot express finding scope, so partial edits to oversized files stay silent until those analyzers expose scope-aware results. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `hook_v1_report`), `workflow/hooks/gruff-code-quality.sh` (search: `A file-scope finding describes the file the agent is editing right now`).

Recurrence on 2026-08-05 exposed the adjacent release gate gap. A fresh gruff-ts 0.4.0 full-repository scan at commit `9f1bb2be` reported 36 findings: 14 `size.file-length` warnings, 4 `security.process-exec` warnings, and 18 documentation advisories. Preflight still reported `PASS   79 checks · 0 warnings` because its Gruff Policy check only rejects disabled rules; it never runs the analyzer. The per-edit hook also cannot be expected to enumerate untouched repository debt. Neither result proves a clean repository, even though both surfaces can be read that way.

Recurrence on 2026-08-08 showed that the ratchet's downward path is part of completing a fix. Replacing history-derived commit guidance shortened `src/cli/cli-handlers.ts` from 759 to 747 lines, below the 750-line threshold. Full preflight then failed on stale accepted identity `4348d703d920ab92` until only that baseline entry was removed; rule thresholds and enabled state stayed unchanged. A change that eliminates a warning must reconcile the accepted-debt manifest in the same proof pass. Evidence anchors: `scripts/gruff-warning-ratchet-checks.mjs` (search: `The finding is gone`) enforces stale-entry removal; `src/cli/prompt/commit-guidance.ts` (search: `emitCommitGuidanceInstallResult`) now owns that guidance reporting, moved out of `src/cli/cli-handlers.ts` when the same threshold was crossed again on 2026-08-10.

Recurrence on 2026-08-09: a changed-range scan showed only three advisories, while full preflight found three task-local file-length warnings. Moving matrix checks into existing helper/suite files and compacting the runtime audit cleared them without accepting debt. Evidence: `test/unit/hook-registrar.helpers.ts` (search: `verifyAgentHookRegistrationMatrix`) and `src/cli/audit/check-agent-deny-runtime.ts` (search: `configuredRuntimeProbes`).

Recurrence on 2026-08-10: source and packed consumer canaries passed after launcher-owned failures gained provider feedback, but a whole-file Gruff scan measured the edited adapter and launcher at 827 and 836 lines, above the 750-line limit. Moving lifecycle capture and timeout selection into the launch runtime restored the adapter to 742 lines and the launcher to 746; changed-range feedback alone would not enforce that file-level limit. Evidence anchors: `workflow/hooks/hook-launch-runtime.mjs` (search: `captureHookProcessUntilDeadline`) and `test/integration/packaged-hook-install.test.ts` (search: `npm archive must contain the candidate launch runtime bytes`).

## Footgun: Blocking Stop scanners can wedge on gitignored local state

**Status:** active | **Created:** 2026-06-14 | **Evidence:** OBSERVED

**Prevention:**
1. For default blocking Stop hooks, define "changed content" as committable content. Do not add `git ls-files --others -i --exclude-standard` scans unless the hook is explicitly opt-in or advisory.
2. Preserve staged-diff scanning so `git add -f .env` still blocks even though the path is ignored.
3. Pair every scanner expansion with block/allow tests: one real staged hazard that must block and one ignored local-state fixture that must not wedge the agent.

**Symptoms:** A Claude turn cannot stop even though the tracked/staged repo changes are safe. The Stop hook repeatedly reports findings under ignored generated output, scratch material, caches, or mutation-test sandboxes; every attempted "holding" response re-runs the Stop hook and repeats the block.

**Why it happens:** A blocking Stop hook runs at turn-end, not at commit time. If it scans gitignored files, it treats local runtime state as work the agent must fix before it can yield. That is too broad for a default hook: ignored paths commonly include real local `.env` files, `_temp/`, coverage output, caches, and test sandboxes. The safety boundary for `post-turn-safety` is committable content: tracked diffs, staged diffs, and untracked non-ignored files.

**Evidence:**
- 2026-06-14 live loop: `post-turn-safety` scanned ignored mutation-test sandbox copies of an environment example and blocked placeholder assignments such as `NOTION_TOKEN="ntn_your_notion_token_here"`, causing Claude Stop to re-fire repeatedly.
- Current hook scope: `workflow/hooks/post-turn-safety.sh` (search: `scan_tracked_changes`) and (search: `scan_untracked_changes`) scan tracked/staged/non-ignored changes only; there is no ignored-file scan.
- Regression coverage: `test/integration/post-turn-safety-hook-scanning.test.ts` (search: `allows ignored env files that are not staged`) and (search: `blocks ignored env files once they are force-staged`) lock the boundary: local ignored files are skipped, force-staged ignored files still block.

## Footgun: Gitignored local artifacts make repository scans diverge between local and CI

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED
**Incident count:** 2 | **Latest occurrence:** 2026-09-04

**Prevention:** A shared scan contract may cover only files every environment can reproduce. Build declared generated artifacts before the scan in every environment, verify accepted-debt paths against tracked or deliberately generated inputs, and reproduce the gate from a clean tracked-tree fixture instead of trusting an existing developer build.

**Trap:** A full-repository analyzer can silently depend on gitignored local state. Local `dist/cli/cli.js` satisfied the package binary check while a fresh CI checkout ran the warning ratchet before building `dist/` and reported `design.package-bin-missing`. Local verification was green only because the developer tree contained generated files absent from the clean checkout.

**Evidence:** Measured from a clean `git archive` on 2026-08-07: the ratchet emitted stable identity `75483f7900f8f4f6` before the build, then passed after `npm run build` with 449 analysed files. Anchors: `scripts/check-gruff-warning-ratchet.mjs` (search: `minimumAnalysedFiles`) and `.github/workflows/ci.yml` (search: `Build package binary`).

**Recurrence 2026-09-04:** M15's installer round-trip fixture copied the live checkout while filtering repository metadata, dependencies, and session logs, but inherited its gitignored managed-install receipt. The disposable repo then failed its first-install assumption at the managed-state admission guard; a clean CI checkout would not contain that local receipt. The fixture now excludes the entire install-state directory before copying. Evidence anchor: `test/integration/audit-drift.helpers.ts` (search: `localInstallStateDirectory`).

## Footgun: Nested template literals can blind the gruff-ts block scanner to everything after them

**Status:** active | **Created:** 2026-08-07 | **Evidence:** ACTUAL_MEASURED

**Prevention:** Treat a suspiciously clean gruff result on a file with nested template literals as unparsed, not clean. Prefer plain concatenation or an extracted variable over templates nested inside interpolations in analyzed source. If a size/complexity finding names a function far smaller than the reported span, suspect scanner blinding before refactoring the named function.

**Trap:** A template literal nested inside another template's `${...}` interpolation (for example `` `${JSON.stringify({ reason: `text ${value}` })}` ``) breaks gruff-ts 0.4.0 function-block detection: the scanner treats the inner backtick as closing the outer template, misreads the following braces, and attributes the rest of the file to the enclosing function. Findings inside the blinded region simply never appear, so the file reads cleaner than it is - the launcher's argv `spawnSync` calls produced no `security.process-exec` finding at all until the nesting was removed, and the phantom mega-function only surfaced when added lines pushed it over `size.function-length`.

**Evidence:** Measured on 2026-08-07: with nested templates in `reportUnavailable`, the analyzer reported `size.function-length` of 226 lines attributed to `reportUnavailable` (a ~40-line function) and zero process-exec findings for the file; after replacing the nested template with plain concatenation, the phantom finding disappeared and the file's real `spawnSync` warning appeared for the first time. Anchors: `workflow/hooks/run-with-bash.mjs` (search: `a template literal`) and (search: `const windowsTreeKillResult = spawnSync`).

---

## Footgun: A `-diff` gitattribute blinds content scanners that enumerate changed paths

**Status:** active | **Created:** 2026-08-10 | **Evidence:** ACTUAL_MEASURED

**Prevention:** To keep a generated file out of review noise without blinding scanners, use `text linguist-generated=true`, which collapses the diff in GitHub review while leaving numstat counts intact. Reserve `-diff` for genuinely unreadable content. After changing a lockfile attribute, confirm with `git diff --numstat -- <path>` that real counts appear.

**Symptoms:** A post-turn or pre-commit content scanner reports a changed path as unscannable and refuses to claim coverage, even though the file is plain text. Marking it `text` alone does not clear the report.

**Evidence:**
- `.goat-flow/hooks/post-turn-safety.sh` (search: `binary changed path not scanned`) builds its inventory from `git diff --numstat` and treats every `-\t-\t<path>` record as a coverage gap.
- `.gitattributes` (search: `package-lock.json`) previously carried `binary`. `git diff --numstat` emitted `-\t-\tpackage-lock.json` while `file` reported JSON text data with zero NUL bytes.
- Switching to `text -diff` did **not** fix it: `-diff` alone still suppresses numstat counts. Only removing `-diff` restored `2\t2\tpackage-lock.json`.

**Why it happens:** `binary` is shorthand for `-text -diff`, and it is `-diff` - not `-text` - that makes numstat report a path as uncountable. A scanner reading numstat therefore cannot distinguish a real binary from a text file whose diff is merely suppressed.

---

## Footgun: Gruff `docs.*` rules prove a comment exists, not that it describes the symbol beneath it

**Status:** active | **Created:** 2026-08-16 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Whether a clean or near-clean `gruff-ts analyse` result counts as evidence that a file's doc comments are attributed to the right symbol and factually true.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Read the symbol under each docblock you touch; a clean analyzer is not attribution evidence, and ADR-059 already treats a Gruff documentation finding as a candidate rather than a mandate. Two comment blocks with nothing between them mean one is orphaned - find the symbol it was written for instead of deleting it. Treat `@param` and `@return` accuracy on non-exported functions as wholly unchecked, and confirm a repeated tag line still describes each site before trusting any copy of it. When `docs.stale-param-tag` does fire, count the tags against the signature before editing, because the reported symbol may already be correct.

**Trap:** The documentation rules answer "does a comment exist here" and "does this docblock's tag list match this signature". Neither question asks whether the prose describes the symbol it sits above. A docblock that drifts onto a neighbouring function, or a copy-pasted `@param` line that keeps describing its original donor, satisfies every enabled rule and reads as clean. Two coverage holes widen it: a docblock stacked directly above another docblock still satisfies the presence rule for the symbol below, and `docs.missing-param-tag` / `docs.stale-param-tag` fire only on an `export function` that already carries a `/** */`, so tag accuracy on internal functions is never inspected at all.

**Evidence:** Measured 2026-08-16 against HEAD `4bed4404`. `gruff-ts analyse src --format json` over 224 TypeScript files returned 17 findings, none of which named an attribution or accuracy defect, while a direct scan of the same files found:

- Three docblocks sitting above the wrong symbol. Only one produced any finding, and only as a side effect: the stranded block satisfied the presence rule for its neighbour, leaving `docs.missing-internal-function-doc` on the function it had been written for. The other two produced nothing, because presence was satisfied twice over.
- Twelve copies of one `@param _warnings` line in `src/cli/config/reader-validators.ts`, seven of which named a parameter that does not exist and called a used accumulator unused. `docs.stale-param-tag` reported none of the seven, because every one of those validators is an internal `function`. The rule fired exactly once in `src/`, as a false positive on the exported `validateFindingLine`, whose six tags map one-to-one to its six parameters.

All instances above were corrected in the same session; the trap is the rule surface, not an open defect list. Anchors: `src/cli/cli-parser.ts` (search: `Return whether a raw \`parseArgs\` boolean flag was explicitly set`), `src/cli/config/reader-validators.ts` (search: `accumulator this block's unrecognized nested keys are appended to`), `src/cli/review-validate-anchors.ts` (search: `export function validateFindingLine`), rule enablement in `.gruff-ts.yaml` (search: `docs.stale-param-tag`).

## Resolved Entries

## Footgun: Fail-soft analyzer skips can silently uncover a configured language

**Status:** resolved | **Created:** 2026-06-09 | **Resolved:** 2026-07-17 | **Evidence:** OBSERVED

**Resolution:** The hook still exits silently when project configuration is missing, but now emits a targeted stderr diagnostic when a matching `.gruff-<lang>.yaml` has no discoverable analyzer, while preserving fail-soft exit 0. The focused regression `test/integration/gruff-code-quality-smoke.test.ts` (search: `exits silently when project config is missing and diagnoses configured languages without a binary`) verifies both sides of that boundary.

**Original symptoms:** A project had a root `.gruff-<lang>.yaml` config, the matching language file was edited, and the PostToolUse hook exited 0 with no output. The agent saw no gruff feedback and could infer the changed lines were clean while the analyzer never ran.

**Why it happened:** `gruff-code-quality.sh` is intentionally fail-soft for missing config, unsupported files, no `jq`, and no changed-line range. It was dangerous when a matching config existed but `discover_binary` missed the analyzer, because the project had opted that language into gruff coverage. In a measured monorepo incident, `gruff-py` lived only under `strands_agents/.venv/bin/gruff-py`; ADR-032 correctly rejected automatic `*/.venv/bin` discovery, so the old hook returned 0 silently and left Python uncovered.

**Durable anchors:**
- Diagnostic path: `workflow/hooks/gruff-code-quality.sh` (search: `present but %s not found on search paths`).
- Config-error path: `workflow/hooks/gruff-code-quality.sh` (search: `config_error_message`).
- Explicit override coverage: `test/integration/gruff-code-quality-smoke.test.ts` (search: `uses an explicit env override for a non-standard monorepo gruff binary`).
- Security constraint: `.goat-flow/learning-loop/decisions/ADR-032-scope-gruff-hook-binary-discovery.md` (search: `Scope gruff-code-quality hook binary discovery to standard install locations`).

**Prevention:** Keep config-present/binary-absent visible while preserving fail-soft exit 0 and ADR-032's no-recursive-discovery rule. Monorepos with managed analyzers outside standard paths must use an explicit executable override.
