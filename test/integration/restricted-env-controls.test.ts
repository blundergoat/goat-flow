/** Actual processes prove each import form observes denials and preload propagation. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  cleanupHookTestDirs,
  fixtureAnalyzerInvocation,
  writeMockGruff,
} from "./gruff-code-quality-smoke.helpers.js";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

// Keep generated consumer source separate from the parent fixture's filesystem writes.
function negativeControlScript(imports: string, absoluteBash: string): string {
  return (
    imports +
    `
        import assert from "node:assert/strict";
        const denied = (launch) => assert.throws(launch, { code: "GOAT_TEST_SPAWN_DENIED" });
        denied(() => cp.spawnSync("bash", ["-c", "exit 0"]));
        denied(() => cp.spawnSync(${JSON.stringify(absoluteBash)}, ["-c", "exit 0"]));
        denied(() => cp.spawnSync("jq", ["--version"]));
        denied(() => cp.execSync("echo harmless"));
        denied(() => cp.exec("echo harmless"));
        denied(() => cp.spawnSync(process.execPath, ["--version"], { shell: true }));
        denied(() => cp.spawn("bash", []));
        denied(() => cp.execFileSync("bash", []));
        denied(() => cp.execFile("bash", []));
        const child = cp.spawnSync(process.execPath, ["-e", 'try { require("node:child_process").spawnSync("bash", []); process.exit(99); } catch (error) { if (error.code !== "GOAT_TEST_SPAWN_DENIED") throw error; }'], { env: { PATH: process.env.PATH }, encoding: "utf8" });
        assert.equal(child.status, 0, child.stderr);
      `
  );
}

for (const form of ["named", "namespace", "require"]) {
  test(`restricted ${form} imports deny forbidden launches and retain stripped-child instrumentation`, () => {
    const directory = mkdtempSync(join(tmpdir(), "goat-spawn-controls-"));
    try {
      const environment = restrictedConsumerEnvironment(directory);
      const imports =
        form === "named"
          ? 'import { spawn, spawnSync, execSync, exec, execFile, execFileSync } from "node:child_process"; const cp = { spawn, spawnSync, execSync, exec, execFile, execFileSync };'
          : form === "namespace"
            ? 'import * as cp from "node:child_process";'
            : 'import { createRequire } from "node:module"; const cp = createRequire(import.meta.url)("node:child_process");';
      const absoluteBash =
        process.platform === "win32"
          ? "C:\\Program Files\\Git\\bin\\bash.exe"
          : "/bin/bash";
      const script = join(directory, "controls.mjs");
      writeFileSync(script, negativeControlScript(imports, absoluteBash));
      const result = spawnSync(process.execPath, [script], {
        env: environment,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, result.stderr);
      const events = readFileSync(
        join(directory, "spawn-journal.jsonl"),
        "utf8",
      )
        .trim()
        .split("\n")
        .map((row) => JSON.parse(row));
      assert.equal(
        events.filter((event) => event.event === "loaded").length,
        2,
      );
      assert.equal(
        events.filter((event) => event.event === "denied").length,
        10,
      );
      assert(
        events.some(
          (event) => event.event === "allowed" && event.api === "spawnSync",
        ),
      );
      process.stderr.write(
        `restricted-negative ${JSON.stringify({ form, node: process.version, platform: process.platform, events })}\n`,
      );
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test("clean restricted consumer journals allowed Node and Git with zero denials", () => {
  const directory = mkdtempSync(join(tmpdir(), "goat-spawn-clean-"));
  try {
    const binDirectory = writeMockGruff(directory);
    const analyzer = fixtureAnalyzerInvocation(join(binDirectory, "gruff-ts"));
    const environment = restrictedConsumerEnvironment(directory);
    const script = join(directory, "clean.mjs");
    writeFileSync(
      script,
      `import assert from "node:assert/strict";
      import { spawnSync } from "node:child_process";
      for (const [file, args] of [[process.execPath, ["--version"]], ["git", ["--version"]]]) {
        const result = spawnSync(file, args, { encoding: "utf8" });
        assert.equal(result.status, 0, result.stderr);
      }
      const missing = spawnSync("git", ["--version"], { env: { PATH: "" }, cwd: ${JSON.stringify(directory)}, encoding: "utf8" });
      assert.equal(missing.status, null);
      assert.equal(missing.error?.code, "ENOENT");
      const analyzer = ${JSON.stringify(analyzer)};
      const result = spawnSync(analyzer.executable, [...analyzer.args, "analyse", "--format", "json", "src/new-file.ts"], { encoding: "utf8", cwd: ${JSON.stringify(directory)} });
      assert.equal(result.status, 1, result.stderr);
      assert.equal(JSON.parse(result.stdout).findings[0].ruleId, "new.rule");
    `,
    );
    const result = spawnSync(process.execPath, [script], {
      env: environment,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
    const events = readFileSync(join(directory, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row));
    assert(events.some((event) => event.event === "loaded"));
    assert.equal(events.filter((event) => event.event === "allowed").length, 3);
    assert.equal(events.filter((event) => event.event === "denied").length, 0);
    assert.equal(
      events.filter((event) => event.event === "unavailable").length,
      1,
    );
    process.stderr.write(
      `restricted-proof ${JSON.stringify({ node: process.version, platform: process.platform, allowed: 3, denied: 0, events })}\n`,
    );
  } finally {
    cleanupHookTestDirs();
    rmSync(directory, { recursive: true, force: true });
  }
});
