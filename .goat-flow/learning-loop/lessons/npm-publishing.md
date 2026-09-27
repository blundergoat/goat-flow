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
**Trigger phase:** ACT
**Caught at:** VERIFY

**Prevention:** Set both `NPM_CONFIG_OTP` and `npm_config_otp` when passing a fresh code through the environment. For an empty response, use `--otp=` so npm's own prompt does not inherit a stale code from environment or config files. Exercise these choices with the real `npm config get otp` command in an isolated fixture; keep actual publishing mocked.

**What happened:** The agent's publish tests read only `NPM_CONFIG_OTP`, concealing how npm merges configuration. Local probes with npm 10.9.4 showed that reversing the uppercase and lowercase environment assignments changed the selected OTP. Empty environment values were ignored. The script also left inherited OTP settings intact when the user pressed Enter for npm's own prompt.

**Evidence:** `test/integration/npm-publish.test.ts` (search: `overrides stale OTP settings with`) now resolves the effective OTP through real npm configuration in a temporary workspace. The empty-response case failed with the previous script and passed after `scripts/npm-publish.sh` (search: `npm publish --otp=`) cleared it explicitly. The fresh-code case verifies that entered input takes precedence over inherited settings.
