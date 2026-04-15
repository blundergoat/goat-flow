/**
 * Contract tests: user-facing text contains no stale `scan` references.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  renderAuditText,
  renderAuditMarkdown,
} from "../../src/cli/audit/render.js";
import type { AuditReport } from "../../src/cli/audit/types.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

function makePassingReport(): AuditReport {
  return {
    command: "audit",
    harness: false,
    status: "pass",
    target: "/tmp/test",
    scopes: {
      setup: {
        status: "pass",
        checks: [],
        failures: [],
        summary: { skills: "7/7 installed" },
      },
      agent: {
        status: "pass",
        checks: [],
        failures: [],
        summary: {
          toolchain: "test + lint configured",
          hooks: "claude:deny installed",
        },
      },
      harness: null,
    },
    concerns: null,
    overall: { status: "pass" },
  };
}

// ---------------------------------------------------------------------------
// Audit text output contains no "scan" command references
// ---------------------------------------------------------------------------
describe("audit text output has no scan references", () => {
  it("renderAuditText does not mention scan", () => {
    const text = renderAuditText(makePassingReport());
    assert.ok(
      !/ scan /i.test(text),
      `Audit text should not reference "scan": ${text}`,
    );
  });

  it("renderAuditMarkdown does not mention scan", () => {
    const md = renderAuditMarkdown(makePassingReport());
    assert.ok(
      !/ scan /i.test(md),
      `Audit markdown should not reference "scan": ${md}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Step 06 references audit, not scanner
// ---------------------------------------------------------------------------
describe("step 06 references audit", () => {
  it("step 06 does not use scanner-era language", () => {
    const content = readFileSync(
      resolve(PROJECT_ROOT, "workflow/setup/06-final-verification.md"),
      "utf-8",
    );
    assert.ok(
      !content.includes("## Scanner"),
      "Should not have ## Scanner heading",
    );
    assert.ok(
      !content.includes("scanner reaches 100%"),
      "Should not reference scanner reaches 100%",
    );
    assert.ok(content.includes("## Audit"), "Should have ## Audit heading");
    assert.ok(
      content.includes("goat-flow audit"),
      "Should reference goat-flow audit",
    );
  });
});
