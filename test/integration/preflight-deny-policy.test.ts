/**
 * Exercise preflight's byte-parity gate and full-suite selection on real files and Bash processes.
 * Fixture hooks record executions; the real policy corpus remains owned by the umbrella preflight.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { afterEach, describe, it } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureDirectories: string[] = [];
const policies = ["deny-dangerous", "deny-git-mutations"];
const installedDirectory = ".goat-flow/hooks";

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Write fixture files and their parent directories inside the temporary project.
function writeFixture(directory: string, path: string, content: string) {
  const destination = join(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

// Harmless hooks expose scheduling without rerunning the real policy corpus for each drift case.
function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "goat-preflight-policy-"));
  fixtureDirectories.push(directory);
  writeFixture(
    directory,
    "workflow/manifest.json",
    JSON.stringify({
      agents: {
        codex: { hooks_dir: installedDirectory },
        claude: { hooks_dir: installedDirectory },
      },
    }),
  );
  for (const root of ["workflow/hooks", installedDirectory]) {
    for (const policy of policies) {
      writeFixture(
        directory,
        `${root}/${policy}.sh`,
        '#!/usr/bin/env bash\n[[ "$1" == --self-test=full ]] || exit 64\nprintf "%s\\n" "$0 $1" >> full-suite-runs\nprintf "%s\\n" "PASS: fixture full policy corpus"\n',
      );
    }
    for (const path of [
      "deny-dangerous/guard-runtime.sh",
      "deny-dangerous/deny-dangerous-self-test.sh",
      "gh-graphql-read.cjs",
      "vendor/graphql.cjs",
    ]) {
      writeFixture(directory, `${root}/${path}`, "fixture runtime bytes\n");
    }
  }
  return directory;
}

// Spawn Bash on production manifest discovery and policy checks, replacing only the report renderer.
function runPolicySection(directory: string) {
  const source = readFileSync(
    join(repositoryRoot, "scripts/preflight-checks.sh"),
    "utf8",
  );
  const manifestReader = source.match(
    /manifest_eval\(\) \{[\s\S]*?\nNODE\n\}/u,
  );
  const start = source.indexOf('section "Deny Policy"');
  const end = source.indexOf("# Runtime smoke test:", start);
  assert.ok(manifestReader && start >= 0 && end > start);
  return spawnSync(
    "bash",
    [
      "-c",
      `
set -euo pipefail
MANIFEST_PATH="$PWD/workflow/manifest.json"
failures=0
section(){ :; }
pass(){ printf 'PASS %s\\n' "$*"; }
fail(){ failures=$((failures + 1)); printf 'FAIL %s\\n' "$*"; }
skip(){ printf 'SKIP %s\\n' "$*"; }
details_pipe(){ cat; }
${manifestReader[0]}
${source.slice(start, end)}
[[ "$failures" -eq 0 ]]
`,
    ],
    { cwd: directory, encoding: "utf8", timeout: 10_000 },
  );
}

describe("preflight deny-policy deduplication", () => {
  it("runs each installed full corpus once after proving source parity", () => {
    const directory = createFixture();
    const result = runPolicySection(directory);
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.deepEqual(
      readFileSync(join(directory, "full-suite-runs"), "utf8")
        .trim()
        .split("\n")
        .sort(),
      policies
        .map((policy) => `${installedDirectory}/${policy}.sh --self-test=full`)
        .sort(),
    );
    assert.match(result.stdout, /runtime matches workflow\/hooks/u);
  });

  // Write or remove one runtime member per case; equal entrypoints alone cannot authorize reuse.
  it("rejects entrypoint, shared-runtime, corpus and GraphQL drift before executing suites", () => {
    const cases = [
      ["deny-dangerous.sh", "change"],
      ["deny-git-mutations.sh", "change"],
      ["deny-dangerous/guard-runtime.sh", "change"],
      ["deny-dangerous/deny-dangerous-self-test.sh", "change"],
      ["gh-graphql-read.cjs", "change"],
      ["vendor/graphql.cjs", "change"],
      ["deny-dangerous/unexpected.sh", "change"],
      ["deny-git-mutations.sh", "remove"],
      ["deny-dangerous", "remove"],
    ];
    for (const [path, mutation] of cases) {
      const directory = createFixture();
      const relativePath = `${installedDirectory}/${path}`;
      if (mutation === "remove") {
        rmSync(join(directory, relativePath), { recursive: true });
      } else {
        writeFixture(directory, relativePath, "different runtime bytes\n");
      }
      const result = runPolicySection(directory);
      assert.equal(
        result.status,
        1,
        `${path}: ${result.stdout}${result.stderr}`,
      );
      assert.match(result.stdout, /FAIL/u);
      assert.ok(result.stdout.includes(basename(path)), result.stdout);
      assert.equal(existsSync(join(directory, "full-suite-runs")), false, path);
    }
  });

  it("fails when the manifest declares no installed policy runtime", () => {
    const directory = createFixture();
    writeFixture(directory, "workflow/manifest.json", '{"agents":{}}');
    const result = runPolicySection(directory);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL .*installed.*hook/u);
    assert.equal(existsSync(join(directory, "full-suite-runs")), false);
  });

  it("preserves a failing corpus verdict and its captured diagnostics", () => {
    const directory = createFixture();
    for (const root of ["workflow/hooks", installedDirectory]) {
      writeFixture(
        directory,
        `${root}/deny-dangerous.sh`,
        '#!/usr/bin/env bash\nprintf "%s\\n" "FAIL: fixture policy regression" >&2\nexit 7\n',
      );
    }
    const result = runPolicySection(directory);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(
      result.stdout,
      /FAIL .*deny-dangerous\.sh full self-test \(exit 7\)/u,
    );
    assert.match(result.stdout, /FAIL: fixture policy regression/u);
    assert.match(result.stdout, /PASS .*deny-git-mutations\.sh/u);
  });

  // Execute the published command against complete, incomplete and consumer-only fixture trees.
  it("requires complete canonical runtime in the documented verification command", () => {
    const playbook = readFileSync(
      join(repositoryRoot, "workflow/skills/playbooks/hook-policy-testing.md"),
      "utf8",
    );
    const command = playbook.match(
      /### 4\. Verify installed policy and available canonical source[\s\S]*?```bash\n([\s\S]*?)\n```/u,
    )?.[1];
    assert.ok(
      command,
      "the playbook must supply its runnable verification command",
    );

    for (const state of ["complete", "missing-entrypoint", "consumer"]) {
      const directory = createFixture();
      if (state === "missing-entrypoint") {
        rmSync(join(directory, "workflow/hooks/deny-dangerous.sh"));
      } else if (state === "consumer") {
        rmSync(join(directory, "workflow/hooks"), { recursive: true });
      }
      const result = spawnSync("bash", ["-c", command], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(
        result.status,
        state === "missing-entrypoint" ? 2 : 0,
        `${state}: ${result.stdout}${result.stderr}`,
      );
      const runs = join(directory, "full-suite-runs");
      if (state === "missing-entrypoint") {
        assert.match(result.stderr, /workflow\/hooks\/deny-dangerous\.sh/u);
        assert.equal(existsSync(runs), false);
      } else {
        assert.deepEqual(
          readFileSync(runs, "utf8").trim().split("\n").sort(),
          policies
            .map(
              (policy) => `${installedDirectory}/${policy}.sh --self-test=full`,
            )
            .sort(),
        );
      }
    }
  });
});
