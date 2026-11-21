/**
 * Protect the hook deadline a user sets with `GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS`, which every Node launcher reads through the shared runtime.
 *
 * For example, exporting `5000` so a stuck hook fails sooner gives a 5-second deadline, while `5s` is refused with a message naming the variable.
 * Launcher behaviour itself is covered by test/unit/hook-launch.test.ts and test/unit/run-hook.test.ts.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  describeInvalidHookLaunchTimeout,
  resolveHookLaunchTimeoutMs,
} from "../../workflow/hooks/hook-launch-runtime.mjs";

describe("hook launch timeout resolver", () => {
  it("resolves missing, empty, lower, and oversized overrides against the policy ceiling", () => {
    const policyCeiling = 25_000;
    // Missing and empty are the same shell state and both mean "use the ceiling".
    assert.equal(resolveHookLaunchTimeoutMs(policyCeiling, {}), policyCeiling);
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "",
      }),
      policyCeiling,
    );
    // A lower value is honoured; a higher one is clamped rather than turned into an outage.
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "5000",
      }),
      5_000,
    );
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "25001",
      }),
      policyCeiling,
    );
  });

  // Separate names show which malformed shape stopped being rejected by the resolver itself.
  for (const malformedTimeoutValue of ["0", "abc", "1.5", "+1", " 1"]) {
    it(`resolver rejects malformed override ${JSON.stringify(malformedTimeoutValue)}`, () => {
      assert.equal(
        resolveHookLaunchTimeoutMs(25_000, {
          GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: malformedTimeoutValue,
        }),
        null,
      );
    });
  }

  it("names the variable, value, and accepted range when an override is rejected", () => {
    assert.equal(
      describeInvalidHookLaunchTimeout(25_000, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "abc",
      }),
      'hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS="abc" must be a whole number of milliseconds from 1 to 25000',
    );
  });
});
