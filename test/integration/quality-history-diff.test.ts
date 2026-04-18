/**
 * Integration tests for the shipped quality capture/history/diff CLI surfaces.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { QUALITY_REPORT_KIND } from "../../src/cli/quality/schema.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const CLI_PATH = join(PROJECT_ROOT, "src", "cli", "cli.ts");
const TSX_LOADER_PATH = join(
  PROJECT_ROOT,
  "node_modules",
  "tsx",
  "dist",
  "loader.mjs",
);
const FIXTURE_DIR = resolve(
  import.meta.dirname,
  "..",
  "fixtures",
  "quality-history",
);
const disposables: string[] = [];

after(() => {
  for (const dir of disposables) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-cli-"));
  mkdirSync(join(root, ".goat-flow", "logs", "quality"), { recursive: true });
  disposables.push(root);
  return root;
}

function runCLI(
  cwd: string,
  args: string[],
): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--import", TSX_LOADER_PATH, CLI_PATH, ...args],
    {
      cwd,
      encoding: "utf-8",
      timeout: 20000,
    },
  );
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function makeResponse(report: Record<string, unknown>, prose: string): string {
  return `${prose}\n\n\`\`\`json\n${JSON.stringify(report, null, 2)}\n\`\`\`\n`;
}

describe("quality capture CLI", () => {
  it("captures responses and increments same-day ids", () => {
    const root = makeTempProject();
    const response1Path = join(root, "response-1.md");
    const response2Path = join(root, "response-2.md");

    const response1 = makeResponse(
      {
        report_kind: QUALITY_REPORT_KIND,
        goat_flow_version: "1.2.0",
        agent: "claude",
        project_path: root,
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
            summary:
              "Architecture doc drifts from the implemented command surface",
            detail: "The command list omits a shipped quality subcommand.",
            evidence_quality: "OBSERVED",
            delta_tag: null,
          },
        ],
      },
      "First capture",
    );
    const response2 = makeResponse(
      {
        report_kind: QUALITY_REPORT_KIND,
        goat_flow_version: "1.2.0",
        agent: "claude",
        project_path: root,
        run_date: "2026-04-18",
        audit_status: "pass",
        scores: {
          setup: {
            total: 80,
            accuracy: 20,
            relevance: 20,
            completeness: 20,
            friction: 20,
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
            summary:
              "Architecture doc drifts from the implemented command surface",
            detail: "The command list omits a shipped quality subcommand.",
            evidence_quality: "OBSERVED",
            delta_tag: "persisted",
          },
          {
            type: "framework_flaw",
            severity: "MINOR",
            file: "src/cli/cli.ts",
            line: 72,
            summary: "History examples are easy to miss in help text",
            detail: "Operators need a clearer diff/history discovery path.",
            evidence_quality: "OBSERVED",
            delta_tag: "new",
          },
        ],
      },
      "Second capture",
    );

    writeFileSync(response1Path, response1, "utf-8");
    writeFileSync(response2Path, response2, "utf-8");

    const first = runCLI(root, [
      "quality",
      "capture",
      "--from-file",
      response1Path,
      "--format",
      "json",
    ]);
    assert.equal(first.status, 0, first.stderr);
    const firstPayload = JSON.parse(first.stdout);
    assert.equal(firstPayload.id, "2026-04-18-claude");
    assert.equal(existsSync(firstPayload.jsonPath), true);
    assert.equal(existsSync(firstPayload.markdownPath), true);

    const second = runCLI(root, [
      "quality",
      "capture",
      "--from-file",
      response2Path,
      "--format",
      "json",
    ]);
    assert.equal(second.status, 0, second.stderr);
    const secondPayload = JSON.parse(second.stdout);
    assert.equal(secondPayload.id, "2026-04-18-claude-02");
    const persisted = JSON.parse(readFileSync(secondPayload.jsonPath, "utf-8"));
    assert.equal(
      persisted.findings[0].id,
      "setup_quality:goat-flow-architecture-md:12",
    );
  });
});

describe("quality history and diff CLI", () => {
  it("renders history text and filtered history/diff json from saved reports", () => {
    const root = makeTempProject();
    for (const id of [
      "2026-04-01-claude",
      "2026-04-15-claude",
      "2026-04-29-claude",
    ]) {
      writeFileSync(
        join(root, ".goat-flow", "logs", "quality", `${id}.json`),
        readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf-8"),
        "utf-8",
      );
    }
    const codexFixture = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "2026-04-29-claude.json"), "utf-8"),
    );
    writeFileSync(
      join(root, ".goat-flow", "logs", "quality", "2026-04-20-codex.json"),
      `${JSON.stringify(
        {
          ...codexFixture,
          agent: "codex",
          run_date: "2026-04-20",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const history = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--format",
      "text",
    ]);
    assert.equal(history.status, 0, history.stderr);
    assert.match(
      history.stdout,
      /2026-04-29 \| claude \| 85 \(\+5\) \| 80 \| 1 \| 1 \| 0/,
    );
    assert.match(history.stdout, /Use `--all` to lift the 20-run default/i);

    const historyJson = runCLI(root, [
      "quality",
      "history",
      "--agent",
      "claude",
      "--format",
      "json",
    ]);
    assert.equal(historyJson.status, 0, historyJson.stderr);
    const historyPayload = JSON.parse(historyJson.stdout);
    assert.deepEqual(
      historyPayload.reports.map((report: { report: { agent: string } }) => {
        return report.report.agent;
      }),
      ["claude", "claude", "claude"],
    );
    assert.deepEqual(
      historyPayload.deltas.map((delta: { id: string }) => delta.id),
      ["2026-04-29-claude", "2026-04-15-claude", "2026-04-01-claude"],
    );

    const diff = runCLI(root, [
      "quality",
      "diff",
      "2026-04-01-claude:2026-04-15-claude",
      "--format",
      "json",
    ]);
    assert.equal(diff.status, 0, diff.stderr);
    const diffPayload = JSON.parse(diff.stdout);
    assert.equal(diffPayload.resolved.length, 1);
    assert.equal(diffPayload.newFindings.length, 1);
    assert.equal(diffPayload.persisted.length, 1);
    assert.equal(diffPayload.from.id, "2026-04-01-claude");
    assert.equal(diffPayload.to.id, "2026-04-15-claude");
  });
});
