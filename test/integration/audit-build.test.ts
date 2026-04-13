/**
 * Integration tests for `goat-flow audit` build checks across setup and harness scopes.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { BUILD_CHECKS } from "../../src/cli/audit/agent-setup-checks.js";
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
// Setup scope: missing instruction file
// ---------------------------------------------------------------------------
describe("audit build: setup scope fails on missing instruction file", () => {
  it("instruction-files check fails when instruction file is missing", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "instruction-files")!;
    const ctx = makeCtx({
      agents: [
        stubAgentFacts({
          instruction: {
            exists: false,
            content: null,
            lineCount: 0,
            sections: new Map(),
          },
        }),
      ],
    });
    const result = check.run(ctx);
    assert.notEqual(
      result,
      null,
      "Should fail when instruction file is missing",
    );
    assert.equal(check.scope, "setup");
    assert.ok(result!.howToFix, "Should include howToFix");
  });
});

// ---------------------------------------------------------------------------
// Harness scope: missing toolchain commands
// ---------------------------------------------------------------------------
describe("audit build: harness scope fails on missing toolchain", () => {
  it("toolchain-commands check fails when no commands configured", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "toolchain-commands")!;
    const ctx = makeCtx({
      config: stubConfig({
        toolchain: { test: [], lint: [], build: [], package: [], format: [] },
      }),
    });
    const result = check.run(ctx);
    assert.notEqual(result, null, "Should fail when toolchain is empty");
    assert.equal(check.scope, "harness");
    assert.ok(
      result!.message.includes("test"),
      "Should mention missing test command",
    );
    assert.ok(result!.howToFix, "Should include howToFix");
  });
});

// ---------------------------------------------------------------------------
// Harness scope: missing deny patterns
// ---------------------------------------------------------------------------
describe("audit build: harness scope fails on missing deny", () => {
  it("deny-patterns check fails when no deny configured", () => {
    const check = BUILD_CHECKS.find((c) => c.id === "deny-patterns")!;
    const ctx = makeCtx({
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
    assert.equal(check.scope, "harness");
    assert.ok(result!.howToFix, "Should include howToFix");
  });
});

// ---------------------------------------------------------------------------
// Build checks cover both scopes
// ---------------------------------------------------------------------------
describe("audit build: scope coverage", () => {
  it("build checks cover setup and harness scopes", () => {
    const scopes = new Set(BUILD_CHECKS.map((c) => c.scope));
    assert.ok(scopes.has("setup"), "Should have setup scope checks");
    assert.ok(scopes.has("harness"), "Should have harness scope checks");
  });
});
