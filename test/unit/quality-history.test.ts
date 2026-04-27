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
  getLatestQualityHistoryEntry,
  loadQualityHistory,
  loadQualityHistoryWindow,
  renderQualityDiffText,
  selectQualityHistoryEntries,
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

function installFixtureAsMode(
  root: string,
  id: string,
  mode: string,
  outputId: string,
): void {
  const parsed = JSON.parse(
    readFileSync(join(FIXTURE_DIR, `${id}.json`), "utf-8"),
  ) as Record<string, unknown>;
  parsed.quality_mode = mode;
  writeFileSync(
    join(root, ".goat-flow", "logs", "quality", `${outputId}.json`),
    `${JSON.stringify(parsed, null, 2)}\n`,
    "utf-8",
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

  it("filters history rows and latest entry by quality mode", () => {
    const root = makeTempProject();
    installFixture(root, FIXTURE_IDS.april01);
    installFixtureAsMode(
      root,
      FIXTURE_IDS.april15,
      "skills",
      "2026-04-15-1000-claude-ddddd",
    );
    installFixtureAsMode(
      root,
      FIXTURE_IDS.april29,
      "harness",
      "2026-04-29-1100-claude-eeeee",
    );

    const history = loadQualityHistory(root);
    assert.deepEqual(
      selectQualityHistoryEntries(history.entries, {
        agent: "claude",
        qualityMode: "skills",
        limit: null,
      }).map((entry) => entry.id),
      ["2026-04-15-1000-claude-ddddd"],
    );
    assert.deepEqual(
      buildQualityHistoryRows(history.entries, {
        agent: "claude",
        qualityMode: "agent-setup",
        limit: null,
      }).map((row) => row.id),
      [FIXTURE_IDS.april01],
      "legacy reports without quality_mode should remain agent-setup history",
    );
    assert.equal(
      getLatestQualityHistoryEntry(history.entries, "claude", "harness")?.id,
      "2026-04-29-1100-claude-eeeee",
    );
  });
});

describe("loadQualityHistoryWindow", () => {
  it("loads only enough matching rows for dashboard deltas", () => {
    const root = makeTempProject();
    installFixture(root, FIXTURE_IDS.april01);
    installFixture(root, FIXTURE_IDS.april15);
    installFixture(root, FIXTURE_IDS.april29);
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "logs",
        "quality",
        "2026-03-01-0800-claude-zzzzz.json",
      ),
      "{\n",
      "utf-8",
    );

    const history = loadQualityHistoryWindow(root, {
      agent: "claude",
      qualityMode: "agent-setup",
      limit: 2,
    });
    assert.equal(
      history.warnings.length,
      0,
      "older files outside the requested window should not be parsed",
    );
    assert.deepEqual(
      history.entries.map((entry) => entry.id),
      [FIXTURE_IDS.april29, FIXTURE_IDS.april15, FIXTURE_IDS.april01],
      "limit=2 should load two displayed rows plus one prior row for deltas",
    );
    assert.deepEqual(
      buildQualityHistoryRows(history.entries, {
        agent: "claude",
        qualityMode: "agent-setup",
        limit: 2,
      }).map((row) => [row.id, row.setupDelta]),
      [
        [FIXTURE_IDS.april29, 5],
        [FIXTURE_IDS.april15, 10],
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

  it("isolates implicit and explicit diffs by quality mode", () => {
    const root = makeTempProject();
    installFixtureAsMode(
      root,
      FIXTURE_IDS.april01,
      "process",
      "2026-04-01-0900-claude-ddddd",
    );
    installFixtureAsMode(
      root,
      FIXTURE_IDS.april15,
      "skills",
      "2026-04-15-1000-claude-eeeee",
    );
    installFixtureAsMode(
      root,
      FIXTURE_IDS.april29,
      "skills",
      "2026-04-29-1100-claude-fffff",
    );

    const history = loadQualityHistory(root);
    const implicit = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: null,
    });
    assert.equal(implicit.ok, true);
    if (!implicit.ok) return;
    assert.equal(implicit.diff.from.report.quality_mode, "skills");
    assert.equal(implicit.diff.to.report.quality_mode, "skills");

    const filtered = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: null,
      qualityMode: "process",
    });
    assert.equal(filtered.ok, false);
    if (filtered.ok) return;
    assert.match(filtered.error, /process mode/i);

    const crossModePair = buildQualityDiff(history.entries, {
      agent: "claude",
      pair: "2026-04-01-0900-claude-ddddd:2026-04-15-1000-claude-eeeee",
    });
    assert.equal(crossModePair.ok, false);
    if (crossModePair.ok) return;
    assert.match(crossModePair.error, /cross-mode/i);
  });
});
