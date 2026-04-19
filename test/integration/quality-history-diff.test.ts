/**
 * Integration tests for the shipped quality history/diff CLI surfaces.
 *
 * Agents write reports directly to `.goat-flow/logs/quality/` under the new
 * `<YYYY-MM-DD>-<HHMM>-<agent>-<rand5>.json` filename scheme. These tests seed
 * that directory from the fixtures and exercise `history` + `diff`.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

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

describe("quality history and diff CLI", () => {
  it("renders history text and filtered history/diff json from saved reports", () => {
    const root = makeTempProject();
    const fixtures = [
      "2026-04-01-0900-claude-aaaaa",
      "2026-04-15-1000-claude-bbbbb",
      "2026-04-29-1100-claude-ccccc",
    ];
    for (const id of fixtures) {
      writeFileSync(
        join(root, ".goat-flow", "logs", "quality", `${id}.json`),
        readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf-8"),
        "utf-8",
      );
    }
    // Seed a codex-agent entry by cloning the latest claude fixture so history
    // filtering has cross-agent data to discriminate.
    const codexSource = JSON.parse(
      readFileSync(
        join(FIXTURE_DIR, "2026-04-29-1100-claude-ccccc.json"),
        "utf-8",
      ),
    );
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-04-20-1200-codex-ddddd.json",
      ),
      `${JSON.stringify(
        {
          ...codexSource,
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
      [
        "2026-04-29-1100-claude-ccccc",
        "2026-04-15-1000-claude-bbbbb",
        "2026-04-01-0900-claude-aaaaa",
      ],
    );

    const diff = runCLI(root, [
      "quality",
      "diff",
      "2026-04-01-0900-claude-aaaaa:2026-04-15-1000-claude-bbbbb",
      "--format",
      "json",
    ]);
    assert.equal(diff.status, 0, diff.stderr);
    const diffPayload = JSON.parse(diff.stdout);
    assert.equal(diffPayload.resolved.length, 1);
    assert.equal(diffPayload.newFindings.length, 1);
    assert.equal(diffPayload.persisted.length, 1);
    assert.equal(diffPayload.from.id, "2026-04-01-0900-claude-aaaaa");
    assert.equal(diffPayload.to.id, "2026-04-15-1000-claude-bbbbb");
  });
});
