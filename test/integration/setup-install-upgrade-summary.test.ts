/**
 * Run public installs in disposable targets to check the verified closing summary.
 * Local edits and disabled hooks exercise actual writes; child-only Node filesystem failures reproduce incomplete apply without changing production code.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { getPackageVersion } from "../../src/cli/paths.js";
import {
  git,
  makeTempProject,
  PROJECT_ROOT,
  recordStaleBaselineHashes,
  runCliInstaller,
  spawnSync,
} from "./setup-install.helpers.js";

const LOCAL_PATH = ".goat-flow/hooks/run-with-bash.mjs";
const SUMMARY = "Install verified for";

let codexFixturePath: string | undefined;

/** Build one real Codex install, then copy files and permissions into independent temporary targets. */
function installedCodexProject(): string {
  if (codexFixturePath === undefined) {
    const fixturePath = makeTempProject();
    const initial = runCliInstaller(fixturePath, "--agent", "codex");
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    codexFixturePath = fixturePath;
  }
  const projectPath = makeTempProject();
  const directories: Array<{ path: string; mode: number }> = [];
  cpSync(codexFixturePath, projectPath, {
    recursive: true,
    errorOnExist: true,
    force: false,
    // Reads directory modes so copied fixtures retain private permissions.
    filter(source, destination) {
      const stats = lstatSync(source);
      if (stats.isDirectory()) {
        directories.push({ path: destination, mode: stats.mode & 0o777 });
      }
      return true;
    },
  });
  for (const { path, mode } of directories) chmodSync(path, mode);
  return projectPath;
}

describe("verified install summary", () => {
  // A retained legacy baseline puts both renamed paths in the admitted preview before installer cleanup removes them.
  it("counts renamed managed playbook removals in the public closing summary", () => {
    const root = makeTempProject();
    const retired = ["writing-for-agents.md", "writing-style.md"].map(
      (name) => `.goat-flow/skill-docs/playbooks/${name}`,
    );
    const bytes = "Retired managed playbook fixture\n";
    for (const path of retired) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), bytes);
    }
    const state = join(root, ".goat-flow/state/install/codex.json");
    mkdirSync(dirname(state), { recursive: true });
    writeFileSync(
      state,
      JSON.stringify(
        {
          schemaVersion: "goat-flow.install-state.v1",
          agent: "codex",
          goatFlowVersion: "1.16.0",
          files: retired.map((path) => ({
            path,
            expectedSha256: createHash("sha256").update(bytes).digest("hex"),
          })),
        },
        null,
        2,
      ) + "\n",
    );
    const install = runCliInstaller(root, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.ok(retired.every((path) => !existsSync(join(root, path))));
    assert.match(
      install.stdout.slice(install.stdout.indexOf(SUMMARY)),
      /Files changed: .*2 removed;/u,
    );
  });

  it("names replaced local content and disabled registration removals after verification", () => {
    const projectPath = join(makeTempProject(), "project with spaces");
    mkdirSync(projectPath);
    git(projectPath, ["init", "--initial-branch", "fixture"]);
    const initial = runCliInstaller(projectPath, "--agent", "claude");
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
    const expectedBytes = readFileSync(join(projectPath, LOCAL_PATH), "utf-8");
    writeFileSync(
      join(projectPath, LOCAL_PATH),
      `${expectedBytes}\n// local edit\n`,
    );
    recordStaleBaselineHashes(projectPath, "claude", [LOCAL_PATH]);
    const configPath = join(projectPath, ".goat-flow/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf-8")
        .replace(
          /post-turn-safety:\n(\s*)enabled: true/u,
          "post-turn-safety:\n$1enabled: false",
        )
        .replace(
          /deny-dangerous:\n(\s*)enabled: true/u,
          "deny-dangerous:\n$1enabled: false",
        ),
    );
    const settingsPath = join(projectPath, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
    assert.match(JSON.stringify(settings.hooks), /post-turn-safety\.mjs/u);
    settings.userMarker = "keep";
    writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);

    const install = runCliInstaller(
      projectPath,
      "--agent",
      "claude",
      "--force-managed",
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.equal(
      readFileSync(join(projectPath, LOCAL_PATH), "utf-8"),
      expectedBytes,
    );
    assert.match(
      readFileSync(configPath, "utf-8"),
      /post-turn-safety:\n\s*enabled: false/u,
    );
    const finalSettings = readFileSync(settingsPath, "utf-8");
    assert.equal(JSON.parse(finalSettings).userMarker, "keep");
    assert.doesNotMatch(finalSettings, /post-turn-safety\.mjs/u);
    assert.match(finalSettings, /deny-dangerous\.mjs/u);
    assert.match(install.stdout, /Install verified for claude/u);
    const closing = install.stdout.slice(install.stdout.indexOf(SUMMARY));
    assert.ok(
      closing.includes(`Replaced local content: ${LOCAL_PATH}`),
      closing,
    );
    assert.match(closing, /claude\/post-turn-safety removed \(disabled\)/u);
    assert.doesNotMatch(closing, /claude\/deny-dangerous removed/u);
    assert.ok(
      install.stdout.indexOf(SUMMARY) > install.stdout.indexOf("HELPER DONE:"),
    );
    const pinned = `npx @blundergoat/goat-flow@${getPackageVersion()}`;
    const quotedTarget = `'${projectPath.replace(/\\/gu, "/")}'`;
    assert.ok(
      closing.includes(`${pinned} audit ${quotedTarget} --agent claude`),
      closing,
    );
    assert.ok(
      closing.includes(`${pinned} stats ${quotedTarget} --check`),
      closing,
    );
    assert.ok(
      closing.includes(
        `${pinned} hooks verify ${quotedTarget} --agent claude --trusted-target --scenario all`,
      ),
      closing,
    );
    assert.match(closing, /audit and runtime checks have not run/u);
    assert.doesNotMatch(install.stdout, /hooks sync/u);
  });

  it("preserves local content and does not report force authority as a replacement", () => {
    const projectPath = installedCodexProject();
    const localBytes = `${readFileSync(join(projectPath, LOCAL_PATH), "utf-8")}\n// preserved local edit\n`;
    writeFileSync(join(projectPath, LOCAL_PATH), localBytes);
    const install = runCliInstaller(
      projectPath,
      "--agent",
      "codex",
      "--force-managed",
    );
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.equal(
      readFileSync(join(projectPath, LOCAL_PATH), "utf-8"),
      localBytes,
    );
    assert.match(install.stdout, /Install verified for codex/u);
    const closing = install.stdout.slice(install.stdout.indexOf(SUMMARY));
    assert.match(closing, /1 local change\(s\) preserved/u);
    assert.doesNotMatch(closing, /Replaced local content:/u);
    assert.doesNotMatch(closing, /codex\/.* removed/u);
  });

  // Each wrapper changes only the child process; real install and verification retain ownership of the outcome.
  for (const failure of ["exit", "signal", "mismatch", "receipt"] as const) {
    it(
      `does not print verified completion after ${failure} failure`,
      {},
      () => {
        const projectPath = installedCodexProject();
        const statePath = join(
          projectPath,
          ".goat-flow/state/install/managed.json",
        );
        // Changed baseline history makes post-write corruption blocking rather than an intentionally preserved local edit.
        if (failure === "mismatch")
          recordStaleBaselineHashes(projectPath, "codex", [LOCAL_PATH]);
        // A healthy repeat install skips identical state bytes; missing selected history requires receipt publication.
        if (failure === "receipt") {
          const state = JSON.parse(readFileSync(statePath, "utf-8"));
          state.receipts = state.receipts.filter(
            (receipt: { agent: string }) => receipt.agent !== "codex",
          );
          writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
        }
        const oldState = readFileSync(statePath, "utf-8");
        const binaryDirectory = join(makeTempProject(), "bin");
        mkdirSync(binaryDirectory);
        const preload = join(binaryDirectory, "failure.cjs");
        writeFileSync(
          preload,
          `const fs = require("node:fs");
const failure = ${JSON.stringify(failure)};
const copy = fs.copyFileSync;
const rename = fs.renameSync;
fs.copyFileSync = (...args) => {
  if (failure === "exit") process.exit(71);
  if (failure === "signal") process.kill(process.pid, "SIGTERM");
  return copy(...args);
};
fs.renameSync = (source, destination) => {
  if (failure === "receipt" && destination === ${JSON.stringify(statePath)}) throw new Error("injected receipt failure");
  const result = rename(source, destination);
  if (failure === "mismatch" && destination === ${JSON.stringify(join(projectPath, LOCAL_PATH))}) fs.appendFileSync(destination, "\\n// interrupted bytes\\n");
  return result;
};
require("node:module").syncBuiltinESMExports();\n`,
        );
        const install = spawnSync(
          "node",
          [
            "--import",
            "tsx",
            join(PROJECT_ROOT, "src/cli/cli.ts"),
            "install",
            projectPath,
            "--agent",
            "codex",
          ],
          {
            cwd: PROJECT_ROOT,
            encoding: "utf-8",
            timeout: 30_000,
            env: {
              ...process.env,
              NODE_OPTIONS: `${process.env.NODE_OPTIONS ?? ""} --require ${JSON.stringify(preload)}`,
            },
          },
        );
        if (failure === "signal") {
          assert.notEqual(install.status, 0);
          if (process.platform !== "win32")
            assert.equal(install.signal, "SIGTERM");
        } else
          assert.equal(
            install.status,
            failure === "exit" ? 71 : 1,
            install.stderr || install.stdout,
          );
        assert.doesNotMatch(
          install.stdout,
          /Install verified for|Next steps:|Remaining review:/u,
        );
        assert.equal(readFileSync(statePath, "utf-8"), oldState);
        const expectedError = {
          exit: /.+/u,
          signal: /terminated by signal SIGTERM/u,
          mismatch: /do not match their templates/u,
          receipt: /install state was not recorded/u,
        }[failure];
        if (failure !== "exit" && failure !== "signal")
          assert.match(install.stderr, expectedError);
      },
    );
  }
});
