/** Real filesystem regressions for untrusted evidence and history inputs. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { it } from "node:test";
import { readProjectTextFile } from "../../src/cli/project-file.js";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  findLatestQualityReport,
  loadQualityHistory,
  loadQualityHistoryWindow,
} from "../../src/cli/quality/history.js";
import { makeCurrentQualityReport } from "../fixtures/quality-report.js";

it("bounds regular evidence reads and refuses linked parents, linked leaves and FIFOs", (t) => {
  const root = mkdtempSync(join(tmpdir(), "goat-evidence-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, "source"));
  writeFileSync(join(root, "source/proof.md"), "verified");
  assert.equal(readProjectTextFile(root, "source/proof.md", 8), "verified");
  assert.throws(
    () => readProjectTextFile(root, "source/proof.md", 7),
    /exceeds/,
  );
  assert.throws(() => readProjectTextFile(root, "../outside.md"), /inside/);
  if (process.platform === "win32") return;
  symlinkSync(join(root, "source"), join(root, "linked"));
  symlinkSync(join(root, "source/proof.md"), join(root, "proof.md"));
  const fifo = spawnSync("mkfifo", [join(root, "pipe.md")]);
  assert.equal(fifo.status, 0, String(fifo.stderr));
  for (const path of ["linked/proof.md", "proof.md", "pipe.md"]) {
    assert.throws(() => readProjectTextFile(root, path), /regular|unlinked/);
    assert.equal(createFS(root, { boundedReads: true }).readFile(path), null);
  }
});

it("all quality history readers skip unsafe and oversized entries with visible warnings", (t) => {
  const root = mkdtempSync(join(tmpdir(), "goat-history-inputs-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, ".goat-flow/logs/quality");
  mkdirSync(directory, { recursive: true });
  const valid = join(directory, "2026-09-21-1000-codex-aaaaa.json");
  writeFileSync(valid, JSON.stringify(makeCurrentQualityReport(root)));
  const oversized = join(directory, "2026-09-21-1100-codex-bbbbb.json");
  writeFileSync(oversized, "");
  truncateSync(oversized, 2 * 1024 * 1024 + 1);
  let rejected = 1;
  if (process.platform !== "win32") {
    symlinkSync(valid, join(directory, "2026-09-21-1200-codex-ccccc.json"));
    assert.equal(
      spawnSync("mkfifo", [join(directory, "2026-09-21-1300-codex-ddddd.json")])
        .status,
      0,
    );
    rejected += 2;
  }
  for (const result of [
    loadQualityHistory(root),
    loadQualityHistoryWindow(root, { agent: "codex", limit: 10 }),
  ]) {
    assert.equal(result.entries.length, 1, result.warnings.join("\n"));
    assert.equal(result.warnings.length, rejected);
  }
  const latest = findLatestQualityReport(root, "codex");
  assert.equal(latest.entry?.path, valid, latest.warnings.join("\n"));
  assert.equal(latest.warnings.length, rejected);
});
