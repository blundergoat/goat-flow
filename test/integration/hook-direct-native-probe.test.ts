/** Direct classifier transport proof uses real Node children; no policy parser or live provider delivery is credited. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

// Consumer runners use the built CLI so compilation stays outside the restricted process tree.
const PROBE_MODULE = pathToFileURL(
  resolve(import.meta.dirname, "../../dist/cli/hooks-runtime-evidence.js"),
).href;
const DENIED_OPERAND = "native fixture deny '$&| (literal) 🐐";
const ALLOWED_OPERAND = "native fixture allow '$&| (literal) 🐐";

/** Writes a disposable project and runner, then spawns the real probe owner under child-process restrictions. */
function runRestrictedProbe(assertions: string) {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-native-direct-")),
  );
  const project = join(parent, "goat's probe & (native) [fixture] 🐐");
  const nativePath = join(project, ".goat-flow/hooks/deny-dangerous.mjs");
  const legacyPath = join(project, ".goat-flow/hooks/deny-dangerous.sh");
  const outsidePath = join(parent, "outside.mjs");
  const marker = join(parent, "outside-ran");
  try {
    mkdirSync(join(project, ".goat-flow/hooks"), { recursive: true });
    writeFileSync(
      nativePath,
      `
      import { argv, cwd, env } from "node:process";
      process.stdout.write(JSON.stringify({args:argv.slice(2),cwd:cwd(),hasSecret:env.GOAT_PROBE_SECRET!==undefined})+"\\n");
      process.stderr.write("native fixture diagnostic\\n");
      process.exitCode=argv.at(-1)===${JSON.stringify(DENIED_OPERAND)}?2:0;
    `,
    );
    writeFileSync(legacyPath, "#!/usr/bin/env bash\nexit 99\n");
    writeFileSync(
      outsidePath,
      `import { writeFileSync } from "node:fs"; writeFileSync(${JSON.stringify(marker)},"ran");`,
    );
    const runner = join(parent, "probe-runner.mjs");
    writeFileSync(
      runner,
      `
      import assert from "node:assert/strict";
      import { existsSync } from "node:fs";
      import { executeManagedHookProbe } from ${JSON.stringify(PROBE_MODULE)};
      const project=${JSON.stringify(project)};
      const nativePath=${JSON.stringify(nativePath)};
      const legacyPath=${JSON.stringify(legacyPath)};
      const outsidePath=${JSON.stringify(outsidePath)};
      const marker=${JSON.stringify(marker)};
      const deniedOperand=${JSON.stringify(DENIED_OPERAND)};
      const allowedOperand=${JSON.stringify(ALLOWED_OPERAND)};
      ${assertions}
    `,
    );
    const environment = restrictedConsumerEnvironment(parent);
    const result = spawnSync(process.execPath, [runner], {
      cwd: project,
      encoding: "utf8",
      timeout: 15000,
      env: { ...environment, GOAT_PROBE_SECRET: "fixture-secret-canary" },
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.signal, null);
    const events = readFileSync(join(parent, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.event === "denied").length, 0);
    return events;
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Writes a real evaluator fixture; exact argv and captured streams reveal native transport or environment regressions.
test("native direct probes preserve inert operands, selected root, status and diagnostics without Bash", () => {
  const events = runRestrictedProbe(`
    for (const [command, expectedExit] of [[deniedOperand,2],[allowedOperand,0]]) {
      const scenario={id:"transport-only",label:"native fixture",expected:expectedExit===2?"blocked":"allowed",command};
      const result=executeManagedHookProbe(project,nativePath,scenario,"node");
      assert.equal(result.exitCode,expectedExit,command);
      assert.equal(result.hasSpawnError,false,command);
      assert.equal(result.timedOut,false,command);
      assert.equal(result.stderr,"native fixture diagnostic\\n",command);
      assert.deepEqual(JSON.parse(result.stdout),{args:["--root",project,"--check",command],cwd:project,hasSecret:false});
      assert.ok(result.durationMs>=0);
    }
  `);
  assert.equal(
    events.filter(
      (event) => event.event === "allowed" && event.api === "spawnSync",
    ).length,
    2,
  );
});

// Writes owned legacy/outside fixtures, but candidate admission must refuse them before a child can run.
test("native direct probes reject Bash, missing and escaped files instead of falling back", () => {
  const events = runRestrictedProbe(`
    const scenario={id:"admission-only",label:"native fixture",expected:"allowed",command:allowedOperand};
    for (const path of [legacyPath,nativePath+".missing.mjs",outsidePath]) {
      const result=executeManagedHookProbe(project,path,scenario,"node");
      assert.deepEqual(result,{exitCode:null,stdout:"",stderr:"",durationMs:0,timedOut:false,hasSpawnError:true},path);
    }
    assert.equal(existsSync(marker),false);
  `);
  assert.equal(events.filter((event) => event.event === "allowed").length, 0);
});
