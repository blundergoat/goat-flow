---
goat-flow-reference-version: "1.19.0"
---
# goat-qa Execution

Read this reference before goat-qa runs a command, drives a browser, replays a fix, or captures a screenshot. The skill decides when a run happens; this file says how to run it and what to record.

## Existing Checks

1. **Select** from the target project's instruction Essential Commands, `package.json` scripts, or documented runner: focused tests for the changed behaviour plus checks the project marks required. Skip optional suites unless requested; ask before a required check that is slow, networked, or credentialed. Name each check skipped.
2. **Run** each from the target project root, never the harness repository; never edit, add, skip, or delete tests or application code, or change configuration to pass. Before and after, compare tracked-file status and diff and the untracked-file list; a changed tracked file or a removed untracked file is a mutation: stop and report it.
3. **Record** command, directory, exit status, runner pass/fail/skip counts, and unverified scope. A test run with zero tests or no counts is unverified, not passed.
4. **New failure:** stop dependent work, keep the output, and hand off to `/goat-debug`. Never fix, rerun until green, or hide skips.

## Browser Checks

The shared preamble already sends browser-visible work to `.goat-flow/skill-docs/playbooks/browser-use.md`. When the change alters a page or flow, exercise each affected journey there as well as running the existing checks, and:

1. **Prepare** with `references/manual-testing.md`: prove the environment, account and served code before the first step.
2. **Record** per journey: page, steps, expected, observed, evidence, and status `verified`, `failed`, `blocked`, or `untested`.
3. **Unobserved:** a journey with no approved browser or target is `blocked` or `untested`, with the reason. A passing test suite never stands in for an unobserved journey.

## Fix Replay

Use this for an explicit request to verify a claimed fix; it replaces Phases 1-3.

1. **Find** the fix's recorded reproduction: a bug report, issue, failing test, or earlier report with steps, input, and the expected and observed results.
2. **Replay** those steps on the current code, following Browser Checks when the original failure was browser-visible, and record what you observe against the recorded original failure.
3. **Regressions:** run the existing checks that own the behaviour, following Existing Checks.
4. **Verdict:** `verified` only when the replay shows the expected result and those checks pass; otherwise `failed`, or `unverified` with the missing evidence named.
5. **No recorded reproduction:** report the claim `unverified` and ask for the steps. Never write a reproduction and present it as the original.

## Screenshot Evidence

Capture only when a claim needs visible state, layout, an original visual symptom, or a failure record. A value or text claim needs no screenshot.

1. **Destination:** when the request names a plan, save under that plan's `evidence/<milestone>-<scenario-slug>-<YYYYMMDDTHHMMZ>/screenshots/<step>-<page-or-flow>-<observed-state>-<width>x<height>.png`; take the stamp from `date -u '+%Y%m%dT%H%MZ'` and add a collision suffix rather than replace a file. Without a named plan, use the session destination in `.goat-flow/skill-docs/playbooks/page-capture.md`. Never infer or change `.active`.
2. **Capture** headless with the approved browser, or follow `page-capture.md`, writing to a temporary path first.
3. **Review** each image for the claimed state and for sensitive content; keep only a reviewed capture at its final path.
4. **Record** a `meta.json` in the run folder with target, capture time, viewport, browser and headless mode, step, and expected versus observed, and link each kept image from the report with the same fields.
5. **Preserve** earlier evidence: never overwrite or delete an existing capture.
