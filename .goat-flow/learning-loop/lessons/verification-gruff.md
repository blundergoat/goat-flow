---
category: verification-gruff
last_reviewed: 2026-08-09
---

## Lesson: Gruff comment fixes must satisfy both humans and the analyzer

**Status:** active | **Created:** 2026-05-25
**Incident count:** 3 | **Latest occurrence:** 2026-08-09
**Decision changed:** Treat a human-readable comment, boolean, compact test, or typed contract as unfinished until targeted and repository-wide analyzers accept the exact source shape.
**Trigger phase:** VERIFY

**What happened:** During gruff docs cleanup, comments in `src/cli/server/decoders.ts` made sense to a maintainer but still failed `docs.magic-threshold-without-rationale`, `docs.missing-error-behavior-doc`, and `docs.missing-why-for-complex-code`. In the same cleanup, renaming dashboard terminal paste metadata passed focused tests but left stale ambient and VM-test helper shapes caught by `npm run typecheck`.

**Recurrence (2026-08-09):** A hook-result cap had a plain-English rationale directly above it, but gruff-ts 0.4.0 still reported `docs.magic-threshold-without-rationale`. The same scan found eight boolean state fields without intent prefixes and one assertion loop. Using the rule's recognized same-line `Cap:` form, renaming the facts to `is...` and `has...`, and replacing the loop with explicit outcome assertions reduced the targeted result from 10 advisories to zero. Evidence anchors: `src/cli/hook-contracts.ts` (search: `Cap: matches both shipped hook limits`) and `test/unit/hook-result-contract.test.ts` (search: `assertHookOutcomeRemainsValid`).

**Second recurrence (2026-08-09):** Focused tests, TypeScript, and gruff-ts passed, but full preflight still rejected two contract functions above ESLint's complexity limit and eight exported component types without external fixture use. Splitting the user-facing support chain into named provider, install, and observed-state checks, then typing the fixtures with each public component contract, cleared both repository gates. Evidence anchors: `src/cli/hook-contracts.ts` (search: `classifyProviderEvidenceState`) and `test/integration/hook-provider-contracts.test.ts` (search: `DELIVERED_RESPONSE_CHANNELS`).

**Root cause:** I treated human-readable comments, compact boolean names, a local rename, and focused contract checks as complete before checking analyzer vocabulary, branch budgets, public type use, test structure, and parallel type surfaces.

**Prevention:** For gruff-driven comment work, read `code-comments.md`, patch one file or cohesive cluster, then rerun `npx gruff-ts analyse <path>`. If a clear comment remains flagged, inspect the installed rule before changing its wording or placement again. Keep internal boolean state in `is...`/`has...` grammar and give each small outcome set direct assertions instead of a test-level loop. For a new typed contract, run focused tests, `npm run typecheck`, ESLint, and Knip before the full preflight; split long decision chains by the user-facing gates they explain, and consume public component types in contract fixtures. If a rename replaces a comment, grep the old identifier. Evidence anchors: `src/cli/server/decoders.ts` (search: `Swallows parse errors into the shared decoder failure shape`), `src/cli/server/decoders.ts` (search: `This stays explicit because`), `src/dashboard/globals.d.ts` (search: `shouldDelaySubmit`), `.goat-flow/learning-loop/patterns/workflow.md` (search: `Gruff docs cleanup is a tight analyzer loop`).

## Lesson: Gruff hook compatibility probes need real configs and wrapper PATH

**Status:** active | **Created:** 2026-05-28

**What happened:** While verifying `workflow/hooks/gruff-code-quality.sh` against `/home/devgoat/projects/gruff-workspace/gruff-go`, `gruff-php`, `gruff-py`, and `gruff-rs`, the first hook-shaped probes failed or produced no output for reasons unrelated to JSON compatibility. Placeholder `.gruff-*.yaml` files such as `rules: {}` were invalid or too incomplete for several analyzers, and the Rust probe replaced `PATH` with only gruff binary directories plus `/usr/bin:/bin`, hiding `cargo` from `gruff-rs/bin/gruff-rs`.

**Root cause:** I treated sibling gruff CLIs as interchangeable binaries but skipped two runtime surfaces that are part of the hook contract: schema-bearing project config files and wrapper-script dependencies inherited from the caller's normal `PATH`.

**Prevention:** When testing `gruff-code-quality.sh` against sibling gruff implementations, copy or reference each project's real `.gruff-*.yaml`, preserve the normal `PATH` while prefixing local gruff binaries, and run both checks: direct `analyse --format json` schema probes and hook-shaped probes with changed ranges. Evidence anchors: `workflow/hooks/gruff-code-quality.sh` (search: `discover_binary`), `test/integration/gruff-code-quality-smoke.test.ts` (search: `changed line finding`).

## Lesson: Gruff doc comments can expose hidden complexity warnings

**Status:** active | **Created:** 2026-05-30

**What happened:** Adding a maintainer comment to `src/dashboard/app.ts` `_uploadTerminalImages` cleared a docs finding but exposed new `complexity.npath` and `design.god-function` warnings. The helper extraction then passed TypeScript but failed preflight ESLint on an unnecessary assertion.

**Root cause:** I checked only the targeted docs rule and assumed a comment-only patch could not change broader warning or lint counts.

**Prevention:** After a large gruff docs batch, run `npx gruff-ts analyse --format json --fail-on none` and compare warning count, then run the lint/preflight gate for any helper extraction. Do not remove a useful comment just to hide a surfaced warning. Evidence anchors: `src/dashboard/app.ts` (search: `encodeTerminalUploadFiles`), `src/dashboard/app.ts` (search: `showTerminalUploadResult`).

## Lesson: docs.missing-internal-function-doc must not be silenced; baseline the residue

**Status:** active | **Created:** 2026-05-29

**What happened:** Gruff-ts reported 337 `docs.missing-internal-function-doc` findings across 73 files. Adding boilerplate JSDoc to every short helper would satisfy the rule but violate the repo's "rewrite/rename before comment" doctrine.

**Root cause:** Two correct rules collide: gruff rules must not be disabled, but comments must only explain non-obvious WHY. This rule had no tuning options, leaving only fix, rename, or baseline.

**Prevention:** Triage `docs.missing-internal-function-doc` with the gruff-code-quality playbook. Add comments only when they meet the contract bar; otherwise rename or baseline with rationale. Revisit when gruff-ts gains threshold/name-match tuning. Evidence anchors: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Doc comments are mandatory under that playbook`), `scripts/preflight-checks.sh` (search: `Gruff Policy`).

## Lesson: Keep the binary path returned by the gruff availability check

**Status:** active | **Created:** 2026-08-03 | **Incident count:** 2 | **Latest occurrence:** 2026-08-09

**Decision changed:** Run later gruff commands through the exact `$found` path instead of guessing a global install location.

**Trigger phase:** VERIFY

**What happened:** The required availability check found the repo-local `node_modules/.bin/gruff-ts`, but the first analysis command discarded that result and invoked `$HOME/.local/bin/gruff-ts`. Bash reported `No such file or directory`, while the following `jq` stage returned zero and made the failed probe easy to misread as analyzer output.

**Recurrence (2026-08-09):** The same path guess recurred after discovery had already found `node_modules/.bin/gruff-ts`. Reusing the discovered path ran gruff-ts 0.4.0 and preserved its three advisory findings.

**Root cause:** I verified that a gruff binary existed but treated discovery as a boolean instead of preserving the executable path for the verification command. I also omitted pipeline failure propagation on a command whose analyzer output was piped through `jq`.

**Prevention:** Keep and reuse `$found` for the complete gruff loop, and enable `pipefail` whenever analyzer output is filtered. Confirm the analyzer emitted a JSON object before interpreting counts. Evidence anchor: `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `## Availability Check`).
