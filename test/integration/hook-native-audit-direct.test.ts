/** Direct audit transport fixtures preserve provider stdin and replies; configured launch and policy parity remain separate proof. */
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
const AUDIT_MODULE = pathToFileURL(
  resolve(
    import.meta.dirname,
    "../../dist/cli/audit/check-agent-deny-runtime.js",
  ),
).href;
const PROVIDERS = ["claude", "codex", "copilot", "antigravity"] as const;

/** Writes an owned native evaluator and runner, then invokes the real audit fallback under process restrictions. */
function runNativeAuditScenario(caseKind: "responses" | "failures") {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-native-audit-")),
  );
  const project = join(parent, "goat's audit & (native) [fixture] 🐐");
  try {
    const hooks = join(project, ".goat-flow/hooks");
    mkdirSync(hooks, { recursive: true });
    const observedPath = join(parent, "observed.jsonl");
    const evaluator = `
      import assert from "node:assert/strict";
      import { readFileSync, appendFileSync } from "node:fs";
      import { argv, cwd, env } from "node:process";
      const input=readFileSync(0,"utf8"), parsed=JSON.parse(input);
      assert.deepEqual(argv.slice(2),["--root",${JSON.stringify(project)}]);
      assert.equal(cwd(),${JSON.stringify(project)});
      const command=parsed.tool_input?.command??parsed.toolArgs?.command??parsed.toolCall?.args?.CommandLine;
      const expected=argv[1].endsWith("deny-git-mutations.mjs")?"git push origin main":"rm -rf /";
      assert.equal(command,expected);
      const provider=env.GOAT_AUDIT_FIXTURE_PROVIDER;
      const expectedPayload=provider==="copilot"?{toolName:"bash",toolArgs:{command:expected}}:provider==="antigravity"?{hookEventName:"PreToolUse",toolCall:{name:"run_command",args:{CommandLine:expected}}}:{tool_name:"Bash",tool_input:{command:expected}};
      assert.deepEqual(parsed,expectedPayload);
      appendFileSync(${JSON.stringify(observedPath)},JSON.stringify({input,command})+"\\n");
      if(${JSON.stringify(caseKind)}==="failures")process.exitCode=1;
      else if(provider==="copilot")process.stdout.write(JSON.stringify({permissionDecision:"deny",permissionDecisionReason:"Policy repository: native fixture"})+"\\n");
      else if(provider==="antigravity")process.stdout.write(JSON.stringify({decision:"deny",reason:"Policy repository: native fixture"})+"\\n");
      else {process.stderr.write("BLOCKED: Policy repository: native fixture\\n");process.exitCode=2;}
    `;
    for (const hook of ["deny-dangerous", "deny-git-mutations"]) {
      writeFileSync(join(hooks, hook + ".mjs"), evaluator);
      writeFileSync(
        join(hooks, hook + ".sh"),
        "#!/usr/bin/env bash\nexit 99\n",
      );
    }
    const runner = join(parent, "audit-runner.mjs");
    writeFileSync(
      runner,
      `
      import assert from "node:assert/strict";
      import { env } from "node:process";
      import { verifyDirectHookRuntime } from ${JSON.stringify(AUDIT_MODULE)};
      const ctx={projectPath:${JSON.stringify(project)}};
      for (const provider of ${JSON.stringify(PROVIDERS)}) {
        env.GOAT_AUDIT_FIXTURE_PROVIDER=provider;
        const facts={agent:{id:provider}};
        if(${JSON.stringify(caseKind)}==="responses") {
          for (const hook of ["deny-dangerous","deny-git-mutations"]) {
            const result=verifyDirectHookRuntime(ctx,facts,".goat-flow/hooks/"+hook+".mjs","node");
            assert.equal(result.ok,true,provider+":"+hook+":"+JSON.stringify(result));
          }
        } else {
          const legacy=verifyDirectHookRuntime(ctx,facts,".goat-flow/hooks/deny-dangerous.sh","node");
          assert.equal(legacy.ok,false,provider);
          assert.match(legacy.message,/requires a \\.mjs hook/u);
          const missing=verifyDirectHookRuntime(ctx,facts,".goat-flow/hooks/missing.mjs","node");
          assert.equal(missing.ok,false,provider);
          const failed=verifyDirectHookRuntime(ctx,facts,".goat-flow/hooks/deny-dangerous.mjs","node");
          assert.equal(failed.ok,false,provider);
        }
      }
    `,
    );
    const environment = restrictedConsumerEnvironment(parent);
    const result = spawnSync(process.execPath, [runner], {
      cwd: project,
      encoding: "utf8",
      timeout: 15000,
      env: environment,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.signal, null);
    const events = readFileSync(join(parent, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    assert.equal(events.filter((event) => event.event === "denied").length, 0);
    assert.equal(
      events.filter(
        (event) => event.event === "allowed" && event.api === "spawnSync",
      ).length,
      8,
    );
    return readFileSync(observedPath, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Writes policy-specific stdin/reply fixtures so a Git probe cannot accidentally certify the dangerous-command guard's input.
test("native direct audit preserves each provider's blocked input and reply for both policies without Bash", () => {
  const observed = runNativeAuditScenario("responses");
  assert.equal(observed.length, 8);
  assert.equal(
    observed.filter((row) => row.command === "git push origin main").length,
    PROVIDERS.length,
  );
  assert.equal(
    observed.filter((row) => row.command === "rm -rf /").length,
    PROVIDERS.length,
  );
});

// Writes then replays failing and absent native fixtures; a completed error or installed Bash file cannot supply native proof.
test("native direct audit refuses Bash and never passes a missing or failing evaluator", () => {
  const observed = runNativeAuditScenario("failures");
  assert.equal(observed.length, PROVIDERS.length);
});
