/** Report-level coverage and assurance contracts for audit --check-content. */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeContent } from "../../src/cli/audit/audit-content.js";
import { runAudit } from "../../src/cli/audit/audit.js";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  renderAuditJson,
  renderAuditMarkdown,
  renderAuditSarif,
  renderAuditText,
} from "../../src/cli/audit/render.js";
import { makeCtx, stubFS } from "../fixtures/projects/index.js";
import { makeAuditReport, PROJECT_ROOT } from "./audit-command/helpers.js";
import { assertExists } from "../helpers/assert-exists.ts";

/** Supply one instruction file so the report exercises real scanners with bounded inputs. */
function scanInstruction(text: string) {
  const files = new Map([["AGENTS.md", text]]);
  return computeContent(
    makeCtx({
      fs: stubFS({
        exists: (path) => files.has(path),
        readFile: (path) => files.get(path) ?? null,
      }),
    }),
  );
}

describe("content-audit coverage", () => {
  const cases = [
    {
      name: "empty passing scan",
      text: "",
      status: "pass",
      warnings: 0,
      infos: 0,
    },
    {
      name: "info-only passing scan",
      text: "Handle errors properly.",
      status: "pass",
      warnings: 0,
      infos: 1,
    },
    {
      name: "warning scan",
      text: "Follow best practices.",
      status: "fail",
      warnings: 1,
      infos: 0,
    },
  ] as const;

  for (const scenario of cases) {
    it(`explains coverage without changing ${scenario.name}`, () => {
      const content = scanInstruction(scenario.text);
      assert.equal(content.status, scenario.status);
      assert.equal(content.warnings, scenario.warnings);
      assert.equal(content.infos, scenario.infos);
      assert.equal(content.filesScanned, 1);
      assertExists(content.coverage);
      assert.equal(content.coverage.scanners.length, 3);
      assert.match(
        content.coverage.scanners[0] ?? "",
        /Prose.*semantic anchors/,
      );
      assert.match(content.coverage.scanners[1] ?? "", /framework.*registries/);
      assert.match(content.coverage.scanners[2] ?? "", /Release.*snapshots/);
      assert.match(
        content.coverage.limitation,
        /Does not verify arbitrary project or domain facts/,
      );

      const report = {
        ...makeAuditReport("/tmp/content-audit-target", content.status),
        content,
      };
      for (const output of [
        renderAuditText(report),
        renderAuditMarkdown(report),
      ]) {
        assert.ok(output.includes(content.coverage.limitation));
        for (const scanner of content.coverage.scanners) {
          assert.ok(output.includes(scanner));
        }
        for (const finding of content.findings) {
          assert.ok(output.includes(finding.rule));
          assert.ok(output.includes(finding.message));
        }
      }
      assert.deepEqual(JSON.parse(renderAuditJson(report)).content, content);
    });
  }

  it("omits content coverage when the scan is disabled", () => {
    const report = runAudit(createFS(PROJECT_ROOT), PROJECT_ROOT, {
      harness: false,
      agentFilter: "claude",
      checkContent: false,
    });
    assert.equal(report.content, null);
    assert.equal(JSON.parse(renderAuditJson(report)).content, null);
    for (const output of [
      renderAuditText(report),
      renderAuditMarkdown(report),
    ]) {
      assert.ok(!output.includes("Cold-Path Content Lint"));
      assert.ok(
        !output.includes("Does not verify arbitrary project or domain facts"),
      );
    }
  });

  it("renders older content reports without coverage metadata", () => {
    const { coverage: _coverage, ...content } = scanInstruction("");
    const report = {
      ...makeAuditReport("/tmp/content-audit-target", content.status),
      content,
    };
    for (const output of [
      renderAuditText(report),
      renderAuditMarkdown(report),
    ]) {
      assert.ok(output.includes("No content issues detected."));
      assert.ok(
        !output.includes("Does not verify arbitrary project or domain facts"),
      );
    }
  });

  it("keeps SARIF findings unchanged when coverage metadata is present", () => {
    const content = scanInstruction("Follow best practices.");
    const { coverage: _coverage, ...withoutCoverage } = content;
    const report = {
      ...makeAuditReport("/tmp/content-audit-target", content.status),
      content,
    };
    assert.equal(
      renderAuditSarif(report),
      renderAuditSarif({ ...report, content: withoutCoverage }),
    );
    const sarif = JSON.parse(renderAuditSarif(report));
    assert.equal(sarif.runs[0].results.length, content.findings.length);
    assert.equal(sarif.runs[0].results[0].level, "warning");
  });
});
