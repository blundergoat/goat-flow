---
category: npm-publishing
last_reviewed: 2026-09-28
---

## Lesson: A profile query is not a publishing capability check

**Status:** active | **Created:** 2026-09-28 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Do not make account-profile access a prerequisite for publishing; test unavailable auxiliary endpoints before relying on them as preflight gates.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Use `npm whoami` to check login and let `npm publish` enforce package permissions and 2FA. Keep npm's diagnostic output visible: a failed lookup may mean unavailable service, not invalid credentials. Keep release checks and the tarball guard independent of account-profile access. Mocked CLI tests establish script control flow, not the registry's authentication contract.

**What happened:** The agent added a mandatory `npm profile get "two-factor auth"` check to `scripts/npm-publish.sh` (search: `verify_publish_auth`). The maintainer's login succeeded, but the profile query failed and the script exited before accepting a 2FA code. The initial test shim always returned a successful profile mode, so it concealed that dependency. The underlying registry error was hidden by stderr redirection; a later live diagnostic was blocked by DNS, so its cause remains unverified.

**Evidence:** `test/integration/npm-publish.test.ts` (search: `continues with interactive 2FA when login succeeds but profile access is unavailable`) reproduced `unable to verify npm account 2FA before the release check` with a successful login and a failed profile command. Removing the profile prerequisite made the same case pass. The adjacent `stops before the expensive gate when npm is not authenticated` case preserves the login gate.

## Lesson: OTP tests must exercise npm's configuration precedence

**Status:** active | **Created:** 2026-09-28 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Verify credential configuration through npm's real parser instead of having a test shim read one assumed environment variable.
**Incident count:** 2
**Latest occurrence:** 2026-09-28
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Clear inherited OTP settings with `--otp=` for both browser login and publishing. A configured OTP can force npm's login into legacy authentication even when `--auth-type=web` is supplied. Exercise these choices with the real `npm config get auth-type otp` parser in an isolated fixture; keep actual login and publishing mocked. Check other behavior-changing settings through that parser too: the confirmed publish must pass `--dry-run=false` to override inherited preview settings.

**What happened:** The agent's publish tests read only `NPM_CONFIG_OTP`, concealing how npm merges configuration. Local probes with npm 10.9.4 showed that reversing the uppercase and lowercase environment assignments changed the selected OTP. Empty environment values were ignored. The script also left inherited OTP settings intact when the user pressed Enter for npm's own prompt.

**Evidence:** `test/integration/npm-publish.test.ts` (search: `overrides stale OTP settings with`) resolves the effective OTP through real npm configuration in a temporary workspace. The original empty-response case failed until `scripts/npm-publish.sh` (search: `npm publish --otp=`) cleared it explicitly. When the custom code prompt was removed, the fresh-code and empty-response cases were replaced by a browser-authentication case. It verifies that inherited uppercase, lowercase, and file settings leave login in web mode and publishing without a supplied OTP.

**Recurrence 2026-09-28:** A follow-up review found that the test shim recognized only the explicit `--dry-run` argument, concealing inherited preview settings. `test/integration/npm-publish.test.ts` (search: `performs the confirmed publish despite inherited dry-run settings`) used npm's parser and observed `publish-dry-run:true` on the final command while the script reported success. Passing `--dry-run=false` made that same case resolve false. The package preview remains a dry run; no live publish was performed.

## Lesson: Let npm handle passkey verification in its browser flow

**Status:** active | **Created:** 2026-09-28 | **Evidence:** OBSERVED
**Decision changed:** Check the provider's current authentication flow before adding credential prompts; use npm's browser login and native publish challenge for passkey users.
**Trigger phase:** READ
**Caught at:** VERIFY

**Prevention:** Use `npm login --auth-type=web --otp=` before release checks and keep `npm publish --otp=` attached to the terminal so npm can open its browser challenge. Do not ask passkey users to supply an authenticator or recovery code. Preserve npm's error output and distinguish cancelled browser authentication from an account security hold when explaining retries. Script tests prove the handoff and config precedence, not successful registry authentication.

**What happened:** The agent added a generic 2FA-code prompt to `scripts/npm-publish.sh` (search: `verify_publish_auth`) and offered fresh-code retries after any publish failure. The maintainer reported that npm only offered passkey setup, that they tried a recovery code while following the code prompt, and that publishing returned a temporary account suspension. The exact recovery action and hold start time were not verified. [npm's recovery documentation](https://docs.npmjs.com/recovering-your-2fa-enabled-account/) describes a 72-hour publishing hold after recovery-code login; it does not establish that submitting a code to the script caused this hold.

**Evidence:** `scripts/npm-publish.sh` (search: `npm login --auth-type=web --otp=`) now delegates login to npm and has no custom code collector. `test/integration/npm-publish.test.ts` (search: `continues with interactive 2FA when login succeeds but profile access is unavailable`) completes the mocked flow using only the authentication choice and publish confirmation. The `stops before the expensive gate when browser login is cancelled` case verifies that failed login prevents release checks. No live passkey login or publish was exercised.

## Lesson: Test setup failures at the shell function's call site

**Status:** active | **Created:** 2026-09-28 | **Evidence:** ACTUAL_MEASURED
**Decision changed:** Reproduce failed credential setup through its actual caller before relying on `set -e` to stop publishing.
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** A shell function invoked as an `if` condition does not stop at intermediate failures under `set -e`. Call credential setup directly when its failures must terminate the script, or handle every failing operation explicitly. Test failed temporary-file creation and ensure no authentication or publish command follows it.

**What happened:** The agent reviewed `scripts/npm-publish.sh` (search: `configure_token_from_env`) without testing filesystem failures. Its caller used `if configure_token_from_env`, so a failed `mktemp` did not stop the function. It continued through failed config writes, reported the token as selected, and reached publishing with a different or missing credential config.

**Evidence:** `test/integration/npm-publish.test.ts` (search: `stops before authentication when temporary token config creation fails`) injected a failing `mktemp`. The original script completed the mocked publish with status 0. Calling setup directly made the same test exit 1 before `npm whoami`, release checks, or publishing. The existing `accepts one bypass token without asking for an OTP` case also verifies npm's selected config path and removal of the temporary config after success.
