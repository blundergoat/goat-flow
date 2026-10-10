/** Real history admission rejects copied reports while preserving canonical project aliases and valid rows. */
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it, type TestContext } from "node:test";
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";
import {
  buildQualityHistoryRows,
  findLatestQualityReport,
  loadQualityHistory,
  loadQualityHistoryWindow,
} from "../../src/cli/quality/history.js";

/** Create only a disposable quality directory; each test owns its cleanup. */
function project(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "goat-quality-owner-"));
  mkdirSync(join(root, ".goat-flow/logs/quality"), { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Mixed owners exercise real persisted admission and prove rejected scores never reach comparisons.
it("rejects foreign and unresolvable project reports across history readers without mixing scores", (t) => {
  const root = project(t);
  const foreign = project(t);
  const reports = [
    ["2026-07-31-1000-claude-aaaaa", root],
    ["2026-07-31-1100-claude-bbbbb", foreign],
    ["2026-07-31-1200-claude-ccccc", join(foreign, "missing")],
  ] as const;
  for (const [id, owner] of reports) {
    writeFileSync(
      join(root, ".goat-flow/logs/quality", `${id}.json`),
      JSON.stringify(
        makeCurrentQualityReport(owner, "History ownership fixture"),
      ),
    );
  }
  for (const history of [
    loadQualityHistory(root),
    loadQualityHistoryWindow(root, { agent: "claude", limit: 1 }),
  ]) {
    assert.deepEqual(
      history.entries.map((entry) => entry.id),
      [reports[0][0]],
    );
    assert.equal(history.warnings.length, 2);
    assert.ok(
      history.warnings.every((warning) =>
        warning.includes("report project does not match"),
      ),
    );
    const rows = buildQualityHistoryRows(history.entries, {
      agent: "claude",
      limit: null,
    });
    assert.equal(rows[0].setupDelta, null);
    assert.equal(rows[0].repeatSpread, null);
  }
  const latest = findLatestQualityReport(root, "claude");
  assert.equal(latest.entry?.id, reports[0][0]);
  assert.equal(latest.warnings.length, 2);
});

it("retains project ownership through a real filesystem alias", (t) => {
  const root = project(t);
  const alias = join(project(t), "alias");
  symlinkSync(root, alias, process.platform === "win32" ? "junction" : "dir");
  const id = "2026-07-31-1000-claude-aaaaa";
  writeFileSync(
    join(root, ".goat-flow/logs/quality", `${id}.json`),
    JSON.stringify(makeCurrentQualityReport(alias, "Aliased history fixture")),
  );
  for (const selected of [root, alias]) {
    for (const history of [
      loadQualityHistory(selected),
      loadQualityHistoryWindow(selected, { agent: "claude", limit: 1 }),
    ]) {
      assert.deepEqual(
        history.entries.map((entry) => entry.id),
        [id],
      );
      assert.deepEqual(history.warnings, []);
    }
  }
});
