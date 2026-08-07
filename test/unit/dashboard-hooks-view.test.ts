/**
 * Unit tests for the Hooks dashboard view support-disclosure contract.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { listHookSpecs } from "../../src/cli/server/hooks-registry.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOKS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "hooks.html",
);
const HOOKS_APP_FRAGMENT_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-app-hook-setup-fragments.ts",
);

describe("dashboard Hooks view", () => {
  it("renders unsupported agent reasons inline", () => {
    const html = readFileSync(HOOKS_VIEW_PATH, "utf-8");
    const appSource = readFileSync(HOOKS_APP_FRAGMENT_PATH, "utf-8");

    assert.match(html, /unsupportedHookAgents\(hook\)\.length > 0/);
    assert.match(html, /class="gf-hook-unsupported"/);
    assert.match(html, /class="gf-hook-unsupported-reason"/);
    assert.match(html, /x-text="agentId \+ ' unsupported'"/);
    assert.match(appSource, /unsupportedHookAgents\(hook: HookState\)/);
    assert.match(appSource, /!state\.supported && Boolean\(state\.reason\)/);
    assert.match(appSource, /if \(!state\.supported\) return "unsupported"/);
  });

  it("keeps Codex non-PreToolUse exclusions paired with reasons", () => {
    const codexUnsupportedHookEntries = listHookSpecs().filter(
      (hook) => hook.unsupportedAgents?.codex,
    );

    assert.ok(
      codexUnsupportedHookEntries.length > 0,
      "Codex should have explicit unsupported hook entries",
    );
    for (const hook of codexUnsupportedHookEntries) {
      assert.notEqual(hook.event, "PreToolUse");
      assert.match(hook.unsupportedAgents?.codex ?? "", /^Codex /);
    }
  });
});
