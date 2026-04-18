/**
 * Unit tests for quality history loading and diff classification.
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
import {
  buildQualityDiff,
  buildQualityHistoryRows,
  loadQualityHistory,
  renderQualityDiffText,
} from "../../src/cli/quality/history.js";

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
  const root = mkdtempSync(join(tmpdir(), "goat-flow-quality-history-"));
  mkdirSync(join(root, ".goat-flow", "logs", "quality"), { recursive: true });
  disposables.push(root);
  return root;
}

function installFixture(root: string, id: string): void {
  const content = readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf-8");
  writeFileSync(
    join(root, ".goat-flow", "logs", "quality", `${id}.json`),
    content,
  );
}

describe("loadQualityHistory", () => {
  it("warns and skips malformed files", () => {
    const root = makeTempProject();
    installFixture(root, "2026-04-01-claude");
    writeFileSync(
      join(root, ".goat-flow", "logs", "quality", "2026-04-30-claude.json"),
      "{\n",
      "utf-8",
    );

    const history = loadQualityHistory(root);
    assert.equal(history.entries.length, 1);
    assert.equal(history.warnings.length, 1);
    assert.match(
      history.warnings[0]!,
      /Skipping malformed quality history file/i,
    );
  });
});

describe("buildQualityHistoryRows", () => {
  it("calculates same-agent setup deltas from newest to oldest", () => {
    const root = makeTempProject();
    installFixture(root, "2026-04-01-claude");
    installFixture(root, "2026-04-15-claude");
    installFixture(root, "2026-04-29-claude");

    const history = loadQualityHistory(root);
    const rows = buildQualityHistoryRows(history.entries, {
      agent: "claude",
      limit: null,
    });

    assert.deepEqual(
      rows.map((row) => [row.id, row.setupDelta]),
      [
        ["2026-04-29-claude", 5],
        ["2026-04-15-claude", 10],
        ["2026-04-01-claude", null],
      ],
    );
  });
});

describe("buildQualityDiff", () => {
  it("derives resolved, new, persisted, and stuck from saved ids", () => {
    const root = makeTempProject();
    installFixture(root, "2026-04-01-claude");
    installFixture(root, "2026-04-15-claude");
    installFixture(root, "2026-04-29-claude");

    const history = loadQualityHistory(root);

    const firstDiff = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: "2026-04-01-claude:2026-04-15-claude",
    });
    assert.equal(firstDiff.ok, true);
    if (!firstDiff.ok) return;
    assert.equal(firstDiff.diff.resolved.length, 1);
    assert.equal(firstDiff.diff.newFindings.length, 1);
    assert.equal(firstDiff.diff.persisted.length, 1);

    const secondDiff = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: "2026-04-15-claude:2026-04-29-claude",
    });
    assert.equal(secondDiff.ok, true);
    if (!secondDiff.ok) return;
    assert.deepEqual(
      secondDiff.diff.stuck.map((row) => row.id),
      ["content_quality:goat-flow-architecture-md:49"],
    );
    assert.match(
      renderQualityDiffText(secondDiff.diff),
      /Stuck counter resets on history gaps/i,
    );
  });

  it("rejects cross-agent pairs", () => {
    const root = makeTempProject();
    installFixture(root, "2026-04-29-claude");
    const codexReport = JSON.parse(
      readFileSync(join(FIXTURE_DIR, "2026-04-29-claude.json"), "utf-8"),
    );
    writeFileSync(
      join(root, ".goat-flow", "logs", "quality", "2026-04-20-codex.json"),
      `${JSON.stringify(
        {
          ...codexReport,
          agent: "codex",
          run_date: "2026-04-20",
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );

    const history = loadQualityHistory(root);
    const diff = buildQualityDiff(history.entries, {
      agent: null,
      pair: "2026-04-29-claude:2026-04-20-codex",
    });
    assert.equal(diff.ok, false);
    if (diff.ok) return;
    assert.match(diff.error, /rejects cross-agent comparisons/i);
  });
});
