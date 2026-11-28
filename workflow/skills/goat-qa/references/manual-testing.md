---
goat-flow-reference-version: "1.19.0"
---
# goat-qa Manual and Browser Testing

Read this reference before driving a browser for QA or writing manual test steps for a person. Each rule names what to check; `.goat-flow/skill-docs/playbooks/browser-use.md` owns the browser commands.

## Prove the Environment First

- Before the first step, prove the running app serves the changed code: reload, then confirm that text from the new code is present and text from the old code is absent. When the change is in a front-end bundle, disable the browser cache first.
- Take a "before" reading before the first edit, or against the original file. A reading taken after the edit is not a baseline.
- Treat implausible local state, such as an empty database, as a timing question first. Services started minutes ago may still be migrating or seeding, so read again before reporting it.
- Ask before restarting, rebuilding, or resetting shared services or data, because a person may be testing against them. Never run a reset or rebuild command the project marks off-limits.
- Finish fixture setup or rollback before testing, and discard any check that overlapped a reset.
- Find test records by a stable marker, not a saved ID; IDs do not survive a data rebuild.
- Learn how the project's test runs execute (fresh data per run, parallel workers, a shared database) before proposing a state or timing cause. A single local pass is directional only.

## Accounts and Sessions

- Log in as the account the test data belongs to. Before the first meaningful action, confirm the workspace, tenant, and role the app actually landed on; a successful login does not prove access to the data.
- Build URLs from identifiers the app shows after login, never from example IDs.
- Use an account and browser session no other run is driving. A shared login merges per-user state between runs.
- A seeded account's login challenge, such as a prefilled two-factor code, is a step to complete. Read the project's login helper and notes before asking a person. Never print codes or disable authentication.

## Reach the Feature the Way a User Does

- When behaviour is triggered by arriving at a URL, start in a fresh browser context and go straight there. Visiting related pages first changes the state under test.
- Open dialogs and panels from the page users click through, not only from an injected link or a bare test page.
- When the change sits on a shared path, re-test the unchanged options that now pass through it, including a multi-item case when the action fans out.
- Use test data that fits a believable history. A shape real data never takes tests a branch real users never reach.

## Drive the Page Reliably

- Before scripting a long flow, run one probe step to read the real selectors and the "done" signal from the page.
- Confirm an action was accepted (the input cleared, an item count grew, the request returned) before judging its result, and record acceptance separately from completion.
- Before a script writes to a record it created, wait for that record's URL or ID, and refuse an ID that existed before the run.
- Give each runner its own tab, and run timing probes one at a time.
- Ask before a step that really sends, publishes, or pays. Otherwise use the project's sandbox, or stub the request as the browser-use playbook describes.

## Judge the Result

- Visible means it has size. Assert geometry or computed display, not DOM presence or a class name.
- Derive expected values from the input, not from the output payload, and read text as it renders.
- A correct answer or summary does not prove its links work. Open each linked destination, and treat a failed content request behind a loaded page as a failure.
- A success status can hide a failure, such as a form re-rendered with errors or a login page served in place of data. Read the visible error or body before blaming the field under test.
- Match the result to the path that actually ran (route, handler, or log line), not to keywords in the response.
- Compare against a working case, not only the old build. The old build showing the same symptom can confirm the very bug the change was meant to fix.
- Repeat a measured action at least three times with the baseline's variants, and report the spread as "n of m".
- When an operation did not take effect, check the product before changing selectors, waits, or clicks in a test.
- After rebuilding a checker or runner, rerun a case that passed before and inspect its result before trusting a batch.
- Check every theme and viewport the change touches, using rendered styles.

## Steps for Human Testers

- Give every step the page (URL) and account it runs on, group steps by page, and put each follow-up under the step it follows.
- Keep reviewer questions out of the list testers type or submit, and strip setup notes from text they paste.
- "Manual" says how evidence is collected, not who collects it. With approved browser access, run the check yourself; only checks the user owns go to a person.

## Sensitive Data

- Read logs, fixtures, and seed data with exact, bounded lookups, never broad content searches.
- Never print personal data, credentials, or one-time codes. Mask names and long digit runs in screenshots and snippets before saving them.
