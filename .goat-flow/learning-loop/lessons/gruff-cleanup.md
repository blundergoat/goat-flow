---
category: gruff-cleanup
last_reviewed: 2026-07-13
---

## Lesson: Nested template literals hide entire code regions from gruff-ts masking

**Status:** active | **Created:** 2026-06-11

**What happened:** `waste.unused-import` flagged `rename` in `test/integration/dashboard-projects-api.test.ts` even though `await rename(root, moved)` was plainly used later in the file. Probing `maskNonCode` from the installed gruff-ts showed the cause: a template literal nested inside another template's `${...}` interpolation corrupted the masker's interpolation-depth state, blanking roughly sixty lines of real code. Every line rule was blind to that region, so the import's only usage did not count - and any real finding in the blanked region would have been invisible too.

**Root cause:** gruff-ts's masking lexer tracks template interpolation depth without a nesting stack, so `` `${fn(`${a},${b}`)}` `` leaves the state dirty and a later code `}` flips the masker into template-body mode until the next backtick.

**Prevention:** When a gruff finding contradicts code you can see (an unused-import with a visible usage, or a rule silent where it clearly should fire), probe the masked source before trusting either side - import `maskNonCode` from the installed analyzer and count occurrences. Until gruff-ts masks nested templates correctly, hoist inner template literals into named consts (clearer code anyway) and report the masker bug upstream. Evidence anchor: `test/integration/dashboard-projects-api.test.ts` (search: `Hoisted out of the fetch template`).

## Lesson: Do not convert a fix request into threshold tuning

**Status:** active | **Created:** 2026-05-30

**What happened:** During the gruff cleanup, the user asked to fix `size` warnings. Instead of fixing code or asking before reclassifying the work as configuration, I raised `.gruff-ts.yaml` thresholds for `size.file-length`, `size.function-length`, and `size.stylesheet-length` so the findings disappeared. The user immediately corrected the scope with "dont change the numbers" and asked for this learning-loop entry.

**Root cause:** I treated "clear the gruff findings" as interchangeable with "make the report stop flagging them." That violated the requested fix intent. Threshold changes are policy changes, not code fixes, and they need explicit approval when the user asks to fix findings.

**Prevention:** For gruff cleanup, classify the action before editing: FIX code, IGNORE paths, BASELINE accepted debt, or TUNE config. If the user asks to "fix" a rule cluster, do not tune thresholds or other rule numbers unless they explicitly approve that policy change. If a finding cannot be fixed safely in the current scope, stop and say so instead of making the analyzer quieter. Evidence anchors: `.gruff-ts.yaml` (search: `size.file-length`), `CHANGELOG.md` (search: `gruff-ts size cleanup`).

## Lesson: Gruff JSON captures must not go through noisy npm output

**Status:** active | **Created:** 2026-06-10

**What happened:** During the M01 gruff cleanup, redirecting `npm run gruff-ts -- analyse --format json --fail-on none .` to `/tmp/goat-flow-gruff-ts-before.json` produced invalid JSON because npm wrote its script banner before the analyzer payload. Parsing failed even though the analyzer itself had completed.

**Root cause:** I treated an npm script as a transparent binary wrapper while capturing machine-readable output. npm can prepend lifecycle/script text unless invoked silently, which corrupts stdout-only JSON reports.

**Prevention:** For machine-readable gruff reports, use `node_modules/.bin/gruff-ts analyse --format json --fail-on none ...` or an explicitly silent npm invocation. Validate the capture with `JSON.parse` before grouping findings or writing plan evidence. Evidence anchors: `.goat-flow/plans/1.11.0/M01-gruff-ts-zero-findings.md` (search: `For JSON captures, use the local binary directly`).

## Lesson: Gruff error-behavior comments need rule vocabulary

**Status:** active | **Created:** 2026-06-10

**What happened:** During M01 gruff cleanup, extracting `src/cli/facts/fs.ts` cache helpers added comments that said "read errors cache and return null", "stat errors cache and return false", and "readdir errors cache and return []". Humans could infer the behavior, but `gruff-ts` still reported `docs.missing-error-behavior-doc` until the comments used the installed rule vocabulary: `swallows ... fallback`.

**Root cause:** I wrote comments that described the behavior semantically but did not satisfy the analyzer's marker vocabulary for error recovery.

**Prevention:** When `docs.missing-error-behavior-doc` survives a comment pass, read the installed rule vocabulary and use accepted recovery words such as `swallows`, `fallback`, or `recover` when truthful. Evidence anchors: `src/cli/facts/fs.ts` (search: `swallows read errors as a cached null fallback`) and `node_modules/@blundergoat/gruff-ts/src/context-doc-rules.ts` (search: `hasErrorBehaviorMarker`).

## Lesson: Do not leave generated gruff defaults after an init probe

**Status:** active | **Created:** 2026-06-09

**What happened:** After running `gruff-ts init --force` as a probe, I left the generated default `.gruff-ts.yaml` in place while continuing hook work. Preflight later failed `Learning-loop schema` because the generated config removed project-specific tuning anchors such as `repo-standard short names`, `dashboard state and CLI option DTOs`, and `test-quality.setup-bloat`.

**Root cause:** I treated `init --force` as a harmless command run instead of a policy rewrite. In goat-flow, `.gruff-ts.yaml` carries durable tuning plus semantic anchors referenced by lessons, so a generated-default reset can break verification even when the hook implementation is correct.

**Prevention:** Before running `gruff-ts init --force`, classify it as a config policy rewrite and capture/compare the diff immediately. If it was only a probe, restore the project-specific tuning anchors before broad verification. Evidence anchors: `.gruff-ts.yaml` (search: `repo-standard short names`), `.gruff-ts.yaml` (search: `dashboard state and CLI option DTOs`), `.gruff-ts.yaml` (search: `test-quality.setup-bloat`), `scripts/preflight-checks.sh` (search: `Learning-loop schema`).

## Lesson: Verify a gruff path-ignore by directory scan, not by naming the file

**Status:** active | **Created:** 2026-05-30

**What happened:** After adding `*.css` / `**/*.css` to `paths.ignore` in `.gruff-ts.yaml`, I tried to verify it by running `gruff-ts analyse src/dashboard/styles.css` directly. The file was still flagged with `size.stylesheet-length` and `paths.ignoredPaths` came back empty, which looked like the ignore was broken. It was not: passing a file explicitly as a CLI argument bypasses config path-ignores - gruff-ts treats a named path as "analyse this regardless." Re-running against the directory (`gruff-ts analyse src/dashboard`) listed `styles.css` under `ignoredPaths` with zero findings.

**Root cause:** Conflated two gruff-ts invocation modes. Config `paths.ignore` filters files discovered during directory/project traversal; it does not suppress a file the user names directly on the command line (the same distinction the `--include-ignored` flag notes when it says config ignores still apply only to discovered paths).

**Prevention:** Verify a path-ignore the way it is actually consumed - a directory or project scan (`gruff-ts analyse <dir>`), then confirm the file appears under `paths.ignoredPaths` and produces no findings. Never verify by passing the ignored file as an explicit argument; that path is analysed unconditionally and will read like a broken ignore. Evidence anchor: `.gruff-ts.yaml` (search: `**/*.css`); reproduction: `gruff-ts analyse src/dashboard --format json` -> `ignoredPaths: ["src/dashboard/styles.css"]`, zero `size.stylesheet-length` findings.

## Lesson: Confirm gruff unused-import findings before deleting imports

**Status:** active | **Created:** 2026-05-31

**What happened:** During the gruff findings cleanup, I treated `waste.unused-import` findings as safe mechanical removals. Removing `realpathSync` / `fileURLToPath` from `src/cli/cli.ts` broke `npm run typecheck`, and removing `rename` / `TERMINAL_UPLOAD_MAX_BODY_BYTES` from `test/integration/dashboard-server.test.ts` broke the focused dashboard-server test.

**Root cause:** The analyzer reported imports as unused even though the symbols were referenced later in large files. I trusted the finding before doing a local symbol search or running the focused test.

**Prevention:** For every gruff `waste.unused-import` finding, run `rg "<symbol>" <file>` before editing. Delete the import only when the import specifier is the sole hit, then run the focused typecheck or test that covers the file. Evidence anchors: `src/cli/cli.ts` (search: `realpathSync(fileURLToPath(import.meta.url))`), `test/integration/dashboard-server-dashboard-terminal-endpoints.test.ts` (search: `TERMINAL_UPLOAD_MAX_BODY_BYTES + 1`), failing output (search: `ReferenceError: rename is not defined`).

## Lesson: Check staged deletions after bulk gruff rewrites

**Status:** active | **Created:** 2026-05-31

**What happened:** During the gruff naming cleanup, a mechanical rewrite left unrelated test files staged as deleted. `git status --short` caught the problem before final verification; affected paths included `test/unit/audit-command/harness.test.ts` and `test/unit/dashboard-toast.test.ts` (both were later removed for real when the audit unit suites were regrouped under `test/unit/audit-harness/`, so they no longer exist in the tree).

**Root cause:** I treated a broad cleanup as a sequence of source edits and did not immediately inspect staged state after the mechanical step. Because the deletions were staged, a worktree-only restore was insufficient and the unexpected `D` entries remained until I checked status again.

**Prevention:** After any bulk gruff cleanup, run `git status --short` before formatting or tests. If unrelated deletes appear, restore both index and worktree state for only those paths, then re-run the targeted gruff rule to confirm no finding was reintroduced. Evidence anchors: `CHANGELOG.md` (search: `gruff-ts size cleanup`) for the bulk-rewrite campaign that staged these deletions, and `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Verification Gate`) for the post-cleanup verification discipline.

## Lesson: Run cheap style gates before expensive gruff verification

**Status:** active | **Created:** 2026-05-31

**What happened:** During the gruff naming cleanup, the full `npm test` run reached the installer round-trip fixture and failed its temp-repo preflight because local style gates still had issues: ESLint flagged a non-null assertion in `src/cli/cli-parser.ts`, and Prettier found an unformatted modified contract test.

**Root cause:** I verified the target gruff rule and typecheck first, then jumped to the expensive full suite before running the cheap local style gates that the round-trip preflight also enforces.

**Prevention:** After broad gruff edits, run `npx eslint src/cli src/dashboard` and `npm run format:check` before full tests or preflight. Treat any non-null assertion introduced during naming cleanup as unfinished parsing code; bind the typed value once and branch on it. Evidence anchors: `src/cli/skill-command-parser.ts` (search: `skillDraftValue`), `scripts/check-instruction-parity.mjs` (search: `CANONICAL_SECTIONS`).

## Lesson: Size refactors must preserve browser script load graphs in tests

**Status:** active | **Created:** 2026-05-31

**What happened:** While splitting dashboard and terminal classic-script files to clear gruff `size` findings, the first focused terminal-launch suite failed because the VM test helper still loaded only the old monolithic browser files. Production HTML loaded the new fragment files, but the test harness had its own source bundle list.

**Same-session recurrence:** The standalone dashboard-reader test later failed the same way: it evaluated `dashboard-readers.ts` without the split `dashboard-model-readers.ts`, so `readInjectedSupportedAgents` was undefined in the VM context.

**Root cause:** I treated a browser classic-script split like a TypeScript module split. These files do not import each other; the HTML script order is the dependency graph, and VM tests must mirror that graph explicitly.

**Prevention:** After splitting dashboard classic scripts, update `src/dashboard/index.html` and every VM helper source list in the same patch. Run the focused VM suites before expanding the refactor. Evidence anchors: `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/dashboard-terminal-launch/helpers.ts` (search: `readDashboardAppSource`), `test/unit/dashboard-readers.test.ts` (search: `MODEL_READERS_PATH`).

## Lesson: Static source-shape tests must follow helper extractions

**Status:** active | **Created:** 2026-06-10

**What happened:** During M01 dashboard state-fragment gruff cleanup, extracting the detached-terminal predicate from `dashboardAppFragment02` into `isTerminalDetached` cleared targeted gruff but the focused VM suite failed. `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` still asserted the old inline regex `s.id === session.id && s.status === "active"`.

**Root cause:** I treated the dashboard terminal VM suite as mostly behavioral coverage and did not pre-scan its `readDashboardAppSource()` assertions after moving source-shape logic into helpers.

**Prevention:** When extracting helpers from dashboard classic-script fragments, grep the focused VM tests for `readDashboardAppSource` and the moved expression or symbol before the first rerun. Update static assertions to the new stable helper/caller contract, then rerun the focused suite. Evidence anchors: `src/dashboard/dashboard-app-state-fragments.ts` (search: `function isTerminalDetached`), `test/unit/dashboard-terminal-launch/launch-flow-06.test.ts` (search: `serverSession\.id === session\.id`).

## Lesson: Dashboard asset renames need a clean dist build

**Status:** active | **Created:** 2026-05-31

**What happened:** While renaming dashboard app fragment files, `npm run build:dashboard` compiled the new descriptive `dashboard-app-*.js` files but left the old generated numbered fragment assets in `dist/dashboard`.

**Root cause:** `build:dashboard` runs the dashboard TypeScript compile and asset copy only; it does not remove `dist/dashboard` before compiling. The full `npm run build` does clean `dist` first.

**Prevention:** When verifying dashboard asset renames, run the full `npm run build` or clean `dist` before `npm run build:dashboard`. Then grep `dist` for the old filenames. Evidence anchors: `package.json` (search: "rmSync('dist', { recursive: true, force: true })"), `package.json` (search: "tsconfig.dashboard.json && node scripts/build-dashboard-assets.mjs").

## Lesson: Gruff cleanup automation must fit the hook surface

**Status:** active | **Created:** 2026-05-31

**What happened:** During the same size cleanup, several long inline Node shell snippets were blocked by the guardrail hook before they could run. The commands were meant to perform mechanical test-file edits, but their length and nested shell shape crossed the safety rules and slowed the cleanup.

**Root cause:** I optimized for one-off shell compactness instead of for the repository's hook contract. A command that is easy to paste can still be the wrong operational shape when hooks inspect chained segments and command substitution.

**Prevention:** For large mechanical rewrites, use `apply_patch` for hand edits or a small checked command with obvious arguments. Keep verification commands short enough that the hook can audit them directly, and split multi-step analysis into separate commands. Evidence anchors: `workflow/hooks/deny-dangerous.sh` (search: `more than 50 chained segments`), `.goat-flow/skill-docs/playbooks/gruff-code-quality.md` (search: `Verification Gate`).

## Lesson: Split tests must import their former shared scope explicitly

**Status:** active | **Created:** 2026-05-31

**What happened:** After splitting audit-drift integration cases out of the old grouped file, the renamed files ran as standalone test modules and failed with `ReferenceError: describe is not defined`, followed by missing helper constants. The code had relied on imports that existed only in the former parent module.

**Root cause:** I treated test-file extraction as a filename move. Node's test runner evaluates each `*.test.ts` file as its own module, so every split file needs its own `node:test`, assertion, filesystem, and helper imports.

**Prevention:** After splitting any test file, run the whole new file glob, not just one renamed slice. Add explicit imports before trusting the split, even when the old parent already imported the same helpers. Evidence anchors: `test/integration/audit-drift.helpers.ts` (search: `export {`), `test/integration/audit-drift-checkdrift-hook-templates.test.ts` (search: `COPILOT_GRUFF_HOOK_ENTRY`).

**Recurrence 2026-05-31:** Full preflight later found the same standalone-module failure in the setup installer split, plus contract tests still reading old unsplit dashboard/CLI files instead of the new owners. Evidence anchors: `test/integration/setup-install.helpers.ts` (search: `runCliInstaller`), `test/unit/dashboard-custom-prompts.test.ts` (search: `CUSTOM_PROMPTS_ACTIONS_PATH`), `src/dashboard/index.html` (search: `dashboard-app-merge.js`), `test/unit/quality-subcommands.test.ts` (search: `quality-command.ts`).

## Lesson: Parameterized matrix tests need named cases with direct assertions

**Status:** active | **Created:** 2026-07-13

**What happened:** The first M03 cross-agent install matrix wrapped assertions for all four agents inside two test-level loops. Gruff reported `test-quality.loop-in-test`; moving the work into named per-agent helpers then exposed `test-quality.no-assertions` because the visible test callbacks only called those helpers. The behavior suite passed both shapes, but its TAP output and analyzer evidence could not prove each named case owned an assertion.

**Root cause:** I optimized the matrix for short source instead of failure localization. A helper can centralize fixture work, but each user-visible test case still needs its own direct assertion so CI and static analysis can connect the case name to evidence.

**Prevention:** Register one named case per matrix value, return a concrete result from the shared scenario helper, and assert that result inside the test callback. Document temporary filesystem and subprocess side effects on helpers that perform installer flows. Evidence anchor: `test/integration/setup-install-agent-matrix.test.ts` (search: `Separate names make the failing agent visible`).
