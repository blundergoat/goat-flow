/**
 * Check review capture with real Git while the caller has trace destinations in its environment.
 * A reviewer selecting staged evidence must not create trace files in the selected project.
 *
 * The disposable repository makes those filesystem side effects observable.
 */
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { it } from "node:test";

import { withEnv } from "../helpers/global-fixtures.js";
import { capture, repository } from "../unit/review-validate.helpers.js";

const traceEnvironmentCases = [
  {
    label: "uppercase",
    traceKey: "GIT_TRACE",
    trace2Key: "GIT_TRACE2_EVENT",
    windowsOnly: false,
  },
  {
    label: "mixed-case",
    traceKey: "git_trace",
    trace2Key: "Git_Trace2_Event",
    windowsOnly: true,
  },
];

// Separate cases identify which terminal-setting spelling reached Git; mixed-case names have Git meaning only on Windows.
for (const scenario of traceEnvironmentCases) {
  it(
    `does not create inherited Git trace destinations during snapshot capture (${scenario.label})`,
    { skip: scenario.windowsOnly && process.platform !== "win32" },
    async (test) => {
      const { root } = repository(test);
      const tracePath = join(root, "git-trace.txt");
      const trace2Path = join(root, "git-trace2.txt");
      await withEnv(
        { [scenario.traceKey]: tracePath, [scenario.trace2Key]: trace2Path },
        () => {
          capture(root, { kind: "staged", base: "HEAD" });
        },
      );
      assert.equal(existsSync(tracePath), false);
      assert.equal(existsSync(trace2Path), false);
    },
  );
}
