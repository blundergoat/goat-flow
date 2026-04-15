/**
 * Integration tests for `goat-flow audit` build checks across setup and harness scopes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SETUP_CHECKS } from "../../src/cli/audit/check-goat-flow.js";
import { AGENT_CHECKS } from "../../src/cli/audit/check-agent-setup.js";

const BUILD_CHECKS = [...SETUP_CHECKS, ...AGENT_CHECKS];
import {
  makeCtx,
  stubAgentFacts,
  stubConfig,
} from "../fixtures/projects/index.js";

// ---------------------------------------------------------------------------
// Both scopes pass when project is well-configured
// ---------------------------------------------------------------------------
describe("audit build: all scopes pass on healthy project", () => {
  it("no failures when all checks pass", () => {
    const ctx = makeCtx();
    for (const check of BUILD_CHECKS) {
      const result = check.run(ctx);
      assert.equal(
        result,
        null,
        `Check ${check.id} should pass but got: ${result?.message}`,
      );
    }
  });
});

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Harness scope: missing deny patterns
// ---------------------------------------------------------------------------
describe("audit build: harness scope fails on missing deny", () => {
  it("agent-deny-dangerous check fails when no deny configured", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "agent-deny-dangerous")!;
    const ctx = makeCtx({
      agentFilter: "claude",
      agents: [
        stubAgentFacts({
          settings: {
            exists: true,
            valid: true,
            parsed: {},
            hasDenyPatterns: false,
          },
          hooks: {
            ...stubAgentFacts().hooks,
            denyExists: false,
          },
        }),
      ],
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when no deny patterns");
    assert.equal(check.scope, "agent");
    assert.ok(result!.howToFix, "Should include howToFix");
  });
});

// ---------------------------------------------------------------------------
// Build checks cover both scopes
// ---------------------------------------------------------------------------
describe("audit build: scope coverage", () => {
  it("build checks cover setup and agent scopes", () => {
    const scopes = new Set(BUILD_CHECKS.map((c) => c.scope));
    assert.ok(scopes.has("setup"), "Should have setup scope checks");
    assert.ok(scopes.has("agent"), "Should have agent scope checks");
  });
});
