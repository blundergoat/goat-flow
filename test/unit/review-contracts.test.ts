import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseSecurityResult } from "../../src/contracts/goat-security-contract.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const SECURITY_FIXTURE_PATH = resolve(
  PROJECT_ROOT,
  "test",
  "fixtures",
  "reviews",
  "security-target-goat-flow.json",
);

function readFixture(): unknown {
  return JSON.parse(readFileSync(SECURITY_FIXTURE_PATH, "utf-8"));
}

describe("review/security contracts", () => {
  it("validates the committed security review fixture", () => {
    const parsed = parseSecurityResult(readFixture());
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    assert.equal(parsed.artifact.resultKind, "goat-flow-security-result");
    assert.equal(parsed.artifact.findings[0]?.source.tool, "agent");
    assert.equal(parsed.artifact.findings[0]?.source.pillar, "security");
    assert.equal(parsed.artifact.posture.rollupBySeverity.Medium, 1);
  });

  it("rejects structurally valid findings with unresolved placeholders", () => {
    const fixture = readFixture();
    assert.equal(typeof fixture, "object");
    assert.notEqual(fixture, null);
    const record = fixture as Record<string, unknown>;
    const findings = record.findings as Array<Record<string, unknown>>;
    findings[0] = { ...findings[0], body: "Investigate TBD route exposure." };

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /unresolved placeholder/);
  });
});
