/**
 * Run public installs in disposable targets to check the verified closing summary.
 * Local edits and disabled hooks exercise actual writes; child-only Bash wrappers reproduce incomplete apply without changing production code.
 */
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
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

describe("verified install summary", () => {
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
    assert.match(JSON.stringify(settings.hooks), /post-turn-safety\.sh/u);
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
    assert.doesNotMatch(finalSettings, /post-turn-safety\.sh/u);
    assert.match(finalSettings, /deny-dangerous\.sh/u);
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
    const projectPath = makeTempProject();
    const initial = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(initial.status, 0, initial.stderr || initial.stdout);
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
      {
        skip:
          process.platform === "win32" ? "POSIX Bash wrapper fixture" : false,
      },
      () => {
        const projectPath = makeTempProject();
        const initial = runCliInstaller(projectPath, "--agent", "codex");
        assert.equal(initial.status, 0, initial.stderr || initial.stdout);
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
        const bashLookup = spawnSync("bash", ["-c", "command -v bash"], {
          encoding: "utf-8",
        });
        assert.equal(bashLookup.status, 0, bashLookup.stderr);
        const realBash = bashLookup.stdout.trim();
        const boundary = {
          exit: "exit 71",
          signal: 'kill -TERM "$$"',
          mismatch: `printf '\\n// interrupted bytes\\n' >> "$2/${LOCAL_PATH}"`,
          receipt: 'mkdir "$2/.goat-flow/state/install/managed.json.tmp-$PPID"',
        }[failure];
        const wrapperPath = join(binaryDirectory, "bash");
        writeFileSync(
          wrapperPath,
          [
            `#!${realBash}`,
            "set -uo pipefail",
            'if [[ "${1:-}" == */workflow/install-goat-flow.sh ]]; then',
            ...(failure === "exit" || failure === "signal"
              ? []
              : ['  "$GOAT_FLOW_TEST_REAL_BASH" "$@" || exit $?']),
            `  ${boundary}`,
            "  exit 0",
            "fi",
            'exec "$GOAT_FLOW_TEST_REAL_BASH" "$@"',
            "",
          ].join("\n"),
        );
        chmodSync(wrapperPath, 0o755);
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
              PATH: `${binaryDirectory}${delimiter}${process.env.PATH ?? ""}`,
              GOAT_FLOW_TEST_REAL_BASH: realBash,
            },
          },
        );
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
        if (failure !== "exit") assert.match(install.stderr, expectedError);
      },
    );
  }
});
