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

const FIXTURE_IDS = {
  april01: "2026-04-01-0900-claude-aaaaa",
  april15: "2026-04-15-1000-claude-bbbbb",
  april29: "2026-04-29-1100-claude-ccccc",
} as const;

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
    installFixture(root, FIXTURE_IDS.april01);
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-04-30-1200-claude-zzzzz.json",
      ),
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
    installFixture(root, FIXTURE_IDS.april01);
    installFixture(root, FIXTURE_IDS.april15);
    installFixture(root, FIXTURE_IDS.april29);

    const history = loadQualityHistory(root);
    const rows = buildQualityHistoryRows(history.entries, {
      agent: "claude",
      limit: null,
    });

    assert.deepEqual(
      rows.map((row) => [row.id, row.setupDelta]),
      [
        [FIXTURE_IDS.april29, 5],
        [FIXTURE_IDS.april15, 10],
        [FIXTURE_IDS.april01, null],
      ],
    );
  });
});

describe("buildQualityDiff", () => {
  it("derives resolved, new, persisted, and stuck from saved ids", () => {
    const root = makeTempProject();
    installFixture(root, FIXTURE_IDS.april01);
    installFixture(root, FIXTURE_IDS.april15);
    installFixture(root, FIXTURE_IDS.april29);

    const history = loadQualityHistory(root);

    const firstDiff = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: `${FIXTURE_IDS.april01}:${FIXTURE_IDS.april15}`,
    });
    assert.equal(firstDiff.ok, true);
    if (!firstDiff.ok) return;
    assert.equal(firstDiff.diff.resolved.length, 1);
    assert.equal(firstDiff.diff.newFindings.length, 1);
    assert.equal(firstDiff.diff.persisted.length, 1);

    const secondDiff = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: `${FIXTURE_IDS.april15}:${FIXTURE_IDS.april29}`,
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
    installFixture(root, FIXTURE_IDS.april29);
    const codexReport = JSON.parse(
      readFileSync(join(FIXTURE_DIR, `${FIXTURE_IDS.april29}.json`), "utf-8"),
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
      pair: `${FIXTURE_IDS.april29}:2026-04-20-1200-codex-ddddd`,
    });
    assert.equal(diff.ok, false);
    if (diff.ok) return;
    assert.match(diff.error, /rejects cross-agent comparisons/i);
  });
});
