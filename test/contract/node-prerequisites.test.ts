/**
 * Check the Node version gate a contributor meets before installing dependencies or starting development.
 *
 * Run only each script's prerequisite section; setup and installation steps never execute in these cases.
 * The matrix covers unsupported releases, the minimum supported release, and newer Node versions.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const prerequisiteScripts = [
  "scripts/setup-initial.sh",
  "scripts/dependency-install.sh",
  "scripts/start-dev.sh",
];

// Exercise every entry point a contributor can use to install dependencies or prepare this checkout.
for (const script of prerequisiteScripts) {
  // Keep patch and major-version cases separate so the minimum minor version cannot be bypassed.
  for (const [version, expectedStatus] of [
    ["19.9.0", 1],
    ["20.11.0", 1],
    ["20.11.99", 1],
    ["20.12.0", 0],
    ["20.12.1", 0],
    ["22.0.0", 0],
  ] as const) {
    // A contributor receives the same supported-runtime decision whichever setup entry point they run.
    test(`${script} ${expectedStatus === 0 ? "accepts" : "rejects"} Node ${version}`, () => {
      const prerequisiteSource = readFileSync(
        resolve(repositoryRoot, script),
        "utf8",
      );
      // The second step begins installation; truncate there so this check cannot install or create workspace files.
      const installationStepOffset = prerequisiteSource.indexOf("# 2. ");
      assert.ok(
        installationStepOffset > 0,
        "prerequisites precede installation",
      );
      const result = spawnSync(
        "bash",
        [
          "-c",
          [
            "node() {",
            '  if [[ "$1" == "--version" ]]; then printf "v%s\\n" "$GOAT_TEST_NODE_VERSION";',
            '  else "$GOAT_TEST_NODE_EXECUTABLE" -e "Object.defineProperty(process.versions,\'node\',{value:process.env.GOAT_TEST_NODE_VERSION});$2"; fi',
            "}",
            prerequisiteSource.slice(0, installationStepOffset),
          ].join("\n"),
        ],
        {
          cwd: repositoryRoot,
          encoding: "utf8",
          env: {
            ...process.env,
            GOAT_TEST_NODE_VERSION: version,
            GOAT_TEST_NODE_EXECUTABLE: process.execPath,
          },
        },
      );
      assert.equal(result.status, expectedStatus, result.stderr);
      // Unsupported Node versions must tell the contributor which minimum release to install.
      if (expectedStatus !== 0)
        assert.match(result.stderr, /Node\.js v20\.12\.0\+ required/u);
    });
  }
}
