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

// A managed hook file the tests edit to stand in for a user's local change.
const LOCAL_PATH = ".goat-flow/hooks/run-hook.mjs";
const SUMMARY = "Install verified for";

// Groups a fresh install registers for each agent: Gruff is opt-in, and Antigravity and Copilot cannot host the post-turn hook.
const DEFAULT_REGISTERED_GROUPS: Record<string, string[]> = {
  claude: ["deny-hook", "git-mutations-hook", "post-turn-hook"],
  codex: ["deny-hook", "git-mutations-hook", "post-turn-hook"],
  antigravity: ["deny-hook", "git-mutations-hook"],
  copilot: ["deny-hook", "git-mutations-hook"],
};

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

/**
 * Run hooks verify from this checkout for one agent and group; the printed command pins the npm release, which a checkout cannot run.
 * Spawns a Node subprocess whose hook probes run inside the fixture and record their verification events there.
 *
 * @param projectPath - installed fixture whose hooks are verified
 * @param agent - agent whose configured hooks run
 * @param scenario - one scenario group, or `all`
 * @param extraArgs - further CLI flags, such as `--format json`
 * @returns the spawned CLI result
 */
function runHooksVerify(
  projectPath: string,
  agent: string,
  scenario: string,
  ...extraArgs: string[]
) {
  return spawnSync(
    "node",
    [
      "--import",
      "tsx",
      join(PROJECT_ROOT, "src/cli/cli.ts"),
      "hooks",
      "verify",
      projectPath,
      "--agent",
      agent,
      "--trusted-target",
      "--scenario",
      scenario,
      ...extraArgs,
    ],
    { cwd: PROJECT_ROOT, encoding: "utf-8", timeout: 60_000 },
  );
}

/**
 * Read the scenario each `hooks verify` line of one closing summary recommends.
 *
 * @param output - install stdout holding the closing summary
 * @returns recommended scenario values in printed order; empty when no verify line is printed
 */
function recommendedScenarios(output: string): string[] {
  const closing = output.slice(output.indexOf(SUMMARY));
  return [
    ...closing.matchAll(
      / hooks verify .* --trusted-target --scenario (\S+)$/gmu,
    ),
  ].map((match) => match[1] ?? "");
}

/**
 * Write two renamed playbooks with an older release's install record, so the next install deletes both.
 * Writes both playbooks and a Codex per-agent record under root.
 * Invariant: the recorded hashes match the written bytes, so install treats both copies as unedited.
 *
 * @param root - disposable project that receives the files and the record
 * @returns the two playbook paths install will remove
 */
function seedRetiredPlaybooks(root: string): string[] {
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
  return retired;
}

describe("verified install summary", () => {
  // A retained legacy baseline puts both renamed paths in the admitted preview before installer cleanup removes them.
  it("counts renamed managed playbook removals in the public closing summary", () => {
    const root = makeTempProject();
    const retired = seedRetiredPlaybooks(root);
    const install = runCliInstaller(root, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.ok(retired.every((path) => !existsSync(join(root, path))));
    const closing = install.stdout.slice(install.stdout.indexOf(SUMMARY));
    assert.match(closing, /Files changed: .*2 removed;/u);
    // Outside Git nothing is tracked, so the staging notice stays silent.
    assert.doesNotMatch(closing, /Tracked files removed/u);
  });

  // Commits the same playbooks in a fresh Git project; a `git ls-files` gate fails on deletions nobody staged.
  it("lists tracked files the install removed and says to stage the deletions", () => {
    const root = makeTempProject();
    git(root, ["init", "--initial-branch", "fixture"]);
    const retired = seedRetiredPlaybooks(root);
    git(root, ["add", "--", ...retired]);
    git(root, ["commit", "--message", "fixture playbooks"]);
    const install = runCliInstaller(root, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const closing = install.stdout.slice(install.stdout.indexOf(SUMMARY));
    assert.match(
      closing,
      /^Tracked files removed \(stage the deletions before you commit\):$/mu,
    );
    const lines = closing.split("\n");
    assert.deepEqual(
      retired.filter((path) => !lines.includes(`  ${path}`)),
      [],
      closing,
    );
  });

  // Makes two installed files executable in a copied Codex project; reinstall writes them back as data files with the same bytes.
  it(
    "reports files whose mode changed while their content did not",
    { skip: process.platform === "win32" ? "POSIX file modes" : false },
    () => {
      const projectPath = installedCodexProject();
      const paths = [
        ".agents/skills/goat/SKILL.md",
        ".goat-flow/hooks/hook-policy-state.cjs",
      ];
      for (const path of paths) chmodSync(join(projectPath, path), 0o755);
      const install = runCliInstaller(projectPath, "--agent", "codex");
      assert.equal(install.status, 0, install.stderr || install.stdout);
      const closing = install.stdout.slice(install.stdout.indexOf(SUMMARY));
      assert.match(closing, /^File modes changed \(content unchanged\):$/mu);
      const lines = closing.split("\n");
      assert.deepEqual(
        paths.filter((path) => !lines.includes(`  ${path}: 755 -> 644`)),
        [],
        closing,
      );
    },
  );

  // A default install leaves the Gruff hook off, and two providers cannot host every hook, so one all-groups run would exit 1 here.
  for (const [agent, groups] of Object.entries(DEFAULT_REGISTERED_GROUPS)) {
    // Writes a fresh Git project, installs one agent and spawns every verify command its summary recommends.
    it(`recommends only ${agent}'s registered scenario groups, and each one passes`, () => {
      const projectPath = makeTempProject();
      git(projectPath, ["init", "--initial-branch", "fixture"]);
      const install = runCliInstaller(projectPath, "--agent", agent);
      assert.equal(install.status, 0, install.stderr || install.stdout);
      assert.deepEqual(recommendedScenarios(install.stdout), groups);
      const outcomes = groups.map((group) => {
        const verify = runHooksVerify(projectPath, agent, group);
        return {
          group,
          status: verify.status,
          output: verify.status === 0 ? "" : verify.stdout,
        };
      });
      assert.deepEqual(
        outcomes,
        groups.map((group) => ({ group, status: 0, output: "" })),
      );
    });
  }

  // Writes a fresh Git project, turns the opt-in Gruff hook on, reinstalls and spawns the single recommended all-groups run.
  it("recommends one all-groups run once every group is registered, and it passes", () => {
    const projectPath = makeTempProject();
    git(projectPath, ["init", "--initial-branch", "fixture"]);
    const install = runCliInstaller(projectPath, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const configPath = join(projectPath, ".goat-flow/config.yaml");
    writeFileSync(
      configPath,
      readFileSync(configPath, "utf-8").replace(
        /gruff-code-quality:\n(\s*)enabled: false/u,
        "gruff-code-quality:\n$1enabled: true",
      ),
    );
    const reinstall = runCliInstaller(projectPath, "--agent", "claude");
    assert.equal(reinstall.status, 0, reinstall.stderr || reinstall.stdout);
    assert.deepEqual(recommendedScenarios(reinstall.stdout), ["all"]);
    const verifyAll = runHooksVerify(projectPath, "claude", "all");
    assert.equal(verifyAll.status, 0, `${verifyAll.stdout}${verifyAll.stderr}`);
  });

  // Installs Codex into a fresh Git project (the post-turn hook registers only there), edits that hook and spawns hooks verify.
  it("names a locally edited hook as diverged in runtime verification", () => {
    const projectPath = makeTempProject();
    git(projectPath, ["init", "--initial-branch", "fixture"]);
    const install = runCliInstaller(projectPath, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const hookPath = join(projectPath, ".goat-flow/hooks/post-turn-safety.mjs");
    writeFileSync(
      hookPath,
      `${readFileSync(hookPath, "utf-8")}\n// local edit\n`,
    );
    const verify = runHooksVerify(
      projectPath,
      "codex",
      "post-turn-hook",
      "--format",
      "json",
    );
    assert.equal(verify.status, 1, verify.stderr || verify.stdout);
    const report = JSON.parse(verify.stdout) as {
      scenarios: Array<{ reasonCode: string }>;
    };
    assert.deepEqual(
      [...new Set(report.scenarios.map((scenario) => scenario.reasonCode))],
      ["installed-content-diverged"],
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
    // The disabled post-turn hook has no registration, so an all-groups run would fail; each registered group gets its own line.
    assert.ok(
      closing.includes(
        `${pinned} hooks verify ${quotedTarget} --agent claude --trusted-target --scenario deny-hook`,
      ),
      closing,
    );
    assert.doesNotMatch(closing, /--scenario (?:all|post-turn-hook)\b/u);
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
