/**
 * Unit tests for quality report extraction and capture.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureQualityResponse,
  extractQualityReport,
} from "../../src/cli/quality/capture.js";
import { QUALITY_REPORT_KIND } from "../../src/cli/quality/schema.js";

const disposables: string[] = [];

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-capture-"));
  mkdirSync(join(root, ".goat-flow", "logs", "quality"), { recursive: true });
  disposables.push(root);
  return root;
}

function makeReport(overrides: Record<string, unknown> = {}) {
  return {
    report_kind: QUALITY_REPORT_KIND,
    goat_flow_version: "1.2.0",
    agent: "claude",
    project_path: "/tmp/quality-project",
    run_date: "2026-04-18",
    audit_status: "pass",
    scores: {
      setup: {
        total: 75,
        accuracy: 20,
        relevance: 20,
        completeness: 20,
        friction: 15,
      },
      system: {
        total: 80,
        usefulness: 20,
        signal_to_noise: 20,
        adaptability: 20,
        learnability: 20,
      },
    },
    findings: [
      {
        type: "setup_quality",
        severity: "MAJOR",
        file: ".goat-flow/architecture.md",
        line: 12,
        summary: "Architecture doc drifts from the implemented command surface",
        detail: "The command list omits a shipped quality subcommand.",
        evidence_quality: "OBSERVED",
        delta_tag: null,
      },
    ],
    ...overrides,
  };
}

function renderResponse(report: Record<string, unknown>, prose = "Narrative") {
  return `${prose}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

describe("extractQualityReport", () => {
  it("selects the fenced json block whose report_kind matches", () => {
    const report = makeReport();
    const response = [
      "Intro text",
      "",
      "```json",
      JSON.stringify({ note: "ignore me" }),
      "```",
      "",
      "```json",
      JSON.stringify(report, null, 2),
      "```",
      "",
      "```json",
      JSON.stringify({ after: true }),
      "```",
    ].join("\n");

    const extracted = extractQualityReport(response);
    assert.equal(extracted.ok, true);
    if (!extracted.ok) return;
    assert.equal(extracted.extracted.report.report_kind, QUALITY_REPORT_KIND);
    assert.equal(
      extracted.extracted.report.findings[0]!.summary,
      "Architecture doc drifts from the implemented command surface",
    );
  });

  it("returns a helpful error for a sole malformed fenced json block", () => {
    const extracted = extractQualityReport("```json\n{\n```");
    assert.equal(extracted.ok, false);
    if (extracted.ok) return;
    assert.match(extracted.error, /Malformed goat-flow-quality-report block/i);
  });
});

describe("captureQualityResponse", () => {
  it("persists matched json and prose, attaching positional ids", () => {
    const root = makeTempProject();
    const captured = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({ project_path: root }),
        "Assessment prose",
      ),
    });

    assert.equal(captured.ok, true);
    if (!captured.ok) return;
    assert.equal(captured.result.id, "2026-04-18-claude");

    const savedJson = JSON.parse(
      readFileSync(captured.result.jsonPath, "utf-8"),
    );
    assert.equal(
      savedJson.findings[0].id,
      "setup_quality:goat-flow-architecture-md:12",
    );
    assert.equal(
      readFileSync(captured.result.markdownPath, "utf-8"),
      "Assessment prose\n",
    );
  });

  it("uses deterministic -02 suffix numbering for same-day recaptures", () => {
    const root = makeTempProject();

    const first = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({ project_path: root }),
        "First capture",
      ),
    });
    assert.equal(first.ok, true);

    const second = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({
          project_path: root,
          findings: [
            {
              type: "setup_quality",
              severity: "MAJOR",
              file: ".goat-flow/architecture.md",
              line: 12,
              summary:
                "Architecture doc drifts from the implemented command surface",
              detail: "The command list omits a shipped quality subcommand.",
              evidence_quality: "OBSERVED",
              delta_tag: "persisted",
            },
          ],
        }),
        "Second capture",
      ),
    });

    assert.equal(second.ok, true);
    if (!second.ok) return;
    assert.equal(second.result.id, "2026-04-18-claude-02");
  });

  it("rejects null delta tags once same-agent history exists", () => {
    const root = makeTempProject();
    const historyDir = join(root, ".goat-flow", "logs", "quality");
    writeFileSync(
      join(historyDir, "2026-04-01-claude.json"),
      `${JSON.stringify(
        {
          ...makeReport({
            run_date: "2026-04-01",
            findings: [
              {
                id: "setup_quality:goat-flow-architecture-md:12",
                type: "setup_quality",
                severity: "MAJOR",
                file: ".goat-flow/architecture.md",
                line: 12,
                summary:
                  "Architecture doc drifts from the implemented command surface",
                detail: "The command list omits a shipped quality subcommand.",
                evidence_quality: "OBSERVED",
                delta_tag: "new",
              },
            ],
          }),
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const captured = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({ project_path: root }),
        "Fresh response",
      ),
    });
    assert.equal(captured.ok, false);
    if (captured.ok) return;
    assert.match(
      captured.error,
      /delta_tag must be set to "new" or "persisted"/i,
    );
  });

  it("rejects reports emitted for a different project path", () => {
    const root = makeTempProject();
    const captured = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({ project_path: "/tmp/other-project" }),
        "Foreign project response",
      ),
    });
    assert.equal(captured.ok, false);
    if (captured.ok) return;
    assert.match(captured.error, /does not match the capture target/i);
  });

  it("uses the full file path in positional ids to avoid basename collisions", () => {
    const root = makeTempProject();
    const captured = captureQualityResponse({
      projectPath: root,
      responseText: renderResponse(
        makeReport({
          project_path: root,
          findings: [
            {
              type: "setup_quality",
              severity: "MAJOR",
              file: "src/web/index.ts",
              line: 12,
              summary: "web index issue",
              detail: "x",
              evidence_quality: "OBSERVED",
              delta_tag: null,
            },
            {
              type: "setup_quality",
              severity: "MAJOR",
              file: "src/api/index.ts",
              line: 12,
              summary: "api index issue",
              detail: "y",
              evidence_quality: "OBSERVED",
              delta_tag: null,
            },
          ],
        }),
        "Same basename response",
      ),
    });
    assert.equal(captured.ok, true);
    if (!captured.ok) return;
    assert.deepEqual(
      captured.result.report.findings.map((finding) => finding.id),
      [
        "setup_quality:src-web-index-ts:12",
        "setup_quality:src-api-index-ts:12",
      ],
    );
  });
});
