import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ReviewResult } from "../../src/contracts/goat-review-contract.js";
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

function readFixtureRecord(): Record<string, unknown> {
  const fixture = readFixture();
  assert.equal(typeof fixture, "object");
  assert.notEqual(fixture, null);
  return fixture as Record<string, unknown>;
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
    const record = readFixtureRecord();
    const findings = record.findings as Array<Record<string, unknown>>;
    findings[0] = { ...findings[0], body: "Investigate TBD route exposure." };

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /unresolved placeholder/);
  });

  it("allows literal HTML in security finding bodies", () => {
    const record = readFixtureRecord();
    const findings = record.findings as Array<Record<string, unknown>>;
    findings[0] = {
      ...findings[0],
      body: "XSS payload <script>alert(1)</script> reaches the DOM.",
    };

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    assert.match(parsed.artifact.findings[0]?.body ?? "", /<script>/);
  });

  it("rejects integrity filesOpened counts greater than total", () => {
    const record = readFixtureRecord();
    const integrity = record.integrity as Record<string, unknown>;
    integrity.filesOpened = {
      opened: 2,
      total: 1,
      paths: ["src/a.ts", "src/b.ts"],
    };

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /opened must be less than or equal to total/);
  });

  it("accepts tool-limited integrity conclusions for security reviews", () => {
    const record = readFixtureRecord();
    const integrity = record.integrity as Record<string, unknown>;
    integrity.conclusion = "tool-limited";

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    assert.equal(parsed.artifact.integrity.conclusion, "tool-limited");
  });

  it("preserves optional security finding diff metadata", () => {
    const record = readFixtureRecord();
    const findings = record.findings as Array<Record<string, unknown>>;
    findings[0] = {
      ...findings[0],
      diffMetadata: {
        changedFileCount: 1,
        riskyBuckets: ["auth"],
        introduction: "modified",
      },
    };

    const parsed = parseSecurityResult(record);
    assert.equal(parsed.ok, true, parsed.ok ? undefined : parsed.error);
    assert.deepEqual(parsed.artifact.findings[0]?.diffMetadata, {
      changedFileCount: 1,
      riskyBuckets: ["auth"],
      introduction: "modified",
    });
  });

  it("keeps the review result contract available for typed artifacts", () => {
    const artifact = {
      resultKind: "goat-flow-review-result",
      contractVersion: "1",
      generatedAt: "2026-06-06T00:00:00.000Z",
      target: {
        projectPath: "/tmp/project",
        base: "main",
        head: "feature",
        source: "diff",
      },
      integrity: {
        filesOpened: { opened: 1, total: 1, paths: ["src/example.ts"] },
        observed: 1,
        inferred: 0,
        degradationFlags: [],
        conclusion: "confident",
        refutationsLogged: 0,
        size: { files: 1, lines: 12, chunked: null },
      },
      findings: [
        {
          id: "R-01",
          kind: "review",
          file: "src/example.ts",
          anchor: "exampleAnchor",
          lines: null,
          title: "Example",
          body: "Concrete review finding body.",
          severity: "SHOULD",
          action: "patch",
          proofClass: "STATIC",
          evidence: "OBSERVED",
          footgun: null,
          source: { tool: "agent", ruleId: null, pillar: null },
          overlapTag: null,
        },
      ],
      specDrift: [],
      refuter: {
        ran: false,
        confirmed: 0,
        refuted: 0,
        unresolved: 0,
        leadsVerifiedByHost: 0,
        model: null,
      },
      shipVerdict: {
        decision: "SHIP_WITH_CONDITIONS",
        confidence: "HIGH",
        reasoning: "One SHOULD finding remains.",
        conditions: ["Apply R-01."],
      },
    } satisfies ReviewResult;

    assert.equal(artifact.findings[0]?.action, "patch");
    assert.equal(artifact.shipVerdict.conditions[0], "Apply R-01.");
  });
});
