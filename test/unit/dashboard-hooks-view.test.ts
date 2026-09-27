/**
 * Protects the Hooks dashboard's effective-state and support disclosures.
 * Use these checks when hook labels, repair rows, summary counts, or provider
 * exclusions change so installed files cannot be rendered as proven coverage.
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
    assert.match(appSource, /return state\.effectiveStateLabel/);
  });

  // Enabled but incomplete chains need a dedicated filter, repair row, and non-green legend.
  it("renders canonical effective-state labels and repairs", () => {
    const html = readFileSync(HOOKS_VIEW_PATH, "utf-8");
    const appSource = readFileSync(HOOKS_APP_FRAGMENT_PATH, "utf-8");

    assert.match(html, />Effective surfaces</u);
    assert.match(html, />Ineffective hooks</u);
    assert.match(html, /hooksFilter === 'ineffective'/u);
    assert.match(html, /ineffectiveHookAgents\(hook\)\.length > 0/u);
    assert.match(html, /state\.repairCommand \|\| state\.repairSummary/u);
    assert.doesNotMatch(html, /installed and enforced/u);
    assert.match(appSource, /hookHasIneffectiveCoverage\(hook: HookState\)/u);
    assert.match(appSource, /state\.effectiveState\.status === "effective"/u);
    assert.match(appSource, /state\.effectiveState\.severity === "success"/u);
  });

  it("keeps current provider exclusions paired with reasons", () => {
    const providerExclusions = listHookSpecs().flatMap((hook) =>
      Object.entries(hook.unsupportedAgents ?? {}).map(
        ([providerId, reason]) => ({
          hookId: hook.id,
          event: hook.event,
          providerId,
          reason,
        }),
      ),
    );

    assert.deepEqual(
      providerExclusions
        .map(({ hookId, providerId }) => `${hookId}/${providerId}`)
        .sort(),
      [
        "gruff-code-quality/antigravity",
        "post-turn-safety/antigravity",
        "post-turn-safety/copilot",
      ],
    );
    // Every excluded provider gives the Hooks screen a practical reason beside its non-green state.
    for (const providerExclusion of providerExclusions) {
      const exclusionId = `${providerExclusion.hookId}/${providerExclusion.providerId}`;
      assert.notEqual(
        providerExclusion.event,
        "PreToolUse",
        `${exclusionId} excludes a PreToolUse hook`,
      );
      assert.match(
        providerExclusion.reason,
        /^(Antigravity|Copilot) /u,
        `${exclusionId} has no provider-named reason`,
      );
    }
  });
});
