/** Mechanism audit fixtures prove native parser/self-test transport, without crediting the future policy corpus or provider delivery. */
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
const MECHANISM_MODULE = pathToFileURL(
  resolve(
    import.meta.dirname,
    "../../dist/cli/audit/check-agent-deny-mechanism.js",
  ),
).href;

/** Writes owned native checks, then spawns the real audit owners under restricted child instrumentation. */
function runNativeMechanism(kind: "syntax" | "self-test") {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-audit-mechanism-")),
  );
  const root = join(parent, "goat's native & (audit) [fixture] 🐐");
  const hooks = join(root, ".goat-flow/hooks");
  try {
    mkdirSync(join(hooks, "deny-dangerous"), { recursive: true });
    const marker = join(parent, "syntax-executed");
    writeFileSync(
      join(hooks, "parse.mjs"),
      `import { writeFileSync } from "node:fs";writeFileSync(${JSON.stringify(marker)},"executed");`,
    );
    writeFileSync(join(hooks, "invalid.mjs"), "const = ;\n");
    writeFileSync(join(hooks, "parse.sh"), "exit 99\n");
    const observed = join(parent, "observed.jsonl");
    for (const policy of ["deny-dangerous", "deny-git-mutations"]) {
      writeFileSync(
        join(hooks, policy + ".mjs"),
        String.raw`
        import { appendFileSync } from "node:fs";
        import { argv, env } from "node:process";
        appendFileSync(${JSON.stringify(observed)},JSON.stringify({path:argv[1],args:argv.slice(2)})+"\n");
        process.exitCode=env.GOAT_MECHANISM_FIXTURE_FAIL==="1"?1:0;
      `,
      );
    }
    const selfTest = join(hooks, "deny-dangerous/deny-dangerous-self-test.mjs");
    writeFileSync(
      selfTest,
      String.raw`
      import assert from "node:assert/strict";
      import { spawnSync } from "node:child_process";
      import { argv, env, execPath } from "node:process";
      assert.deepEqual(argv.slice(2),["--self-test=smoke"]);
      assert.ok(env.GOAT_DENY_DANGEROUS_HOOK.endsWith(".mjs"));
      const result=spawnSync(execPath,[env.GOAT_DENY_DANGEROUS_HOOK,"--self-test=smoke"],{env,encoding:"utf8",timeout:5000});
      assert.equal(result.signal,null);
      process.exitCode=result.status??1;
    `,
    );
    const runner = join(parent, "runner.mjs");
    writeFileSync(
      runner,
      String.raw`
      import assert from "node:assert/strict";
      import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { env } from "node:process";
      import { checkHookFileSyntax, checkHookSelfTest } from ${JSON.stringify(MECHANISM_MODULE)};
      const root=${JSON.stringify(root)}, hooks=${JSON.stringify(hooks)};
      const ctx={projectPath:root,agents:["claude","codex","copilot","antigravity"].map(id=>({agent:{id,hooksDir:".goat-flow/hooks"}})),fs:{readFile:(path)=>{try{return readFileSync(join(root,path),"utf8");}catch{return null;}}}};
      if(${JSON.stringify(kind)}==="syntax") {
        assert.deepEqual(checkHookFileSyntax(ctx,".goat-flow/hooks","parse.mjs","node"),{status:"ok"});
        assert.deepEqual(checkHookFileSyntax(ctx,".goat-flow/hooks","invalid.mjs","node"),{status:"syntax-error",path:".goat-flow/hooks/invalid.mjs"});
        for(const filename of ["missing.mjs","parse.sh"]) {
          const unavailable=checkHookFileSyntax(ctx,".goat-flow/hooks",filename,"node");
          assert.equal(unavailable.status,"spawn-failure");
          assert.match(unavailable.failure.message,/existing \.mjs hook/u);
        }
        assert.equal(existsSync(${JSON.stringify(marker)}),false,"syntax checks must not execute the module");
      } else {
        assert.equal(checkHookSelfTest(ctx,"node"),null);
        const observations=readFileSync(${JSON.stringify(observed)},"utf8").trim().split("\n").map(JSON.parse);
        assert.deepEqual(observations,["deny-dangerous","deny-git-mutations"].map(policy=>({path:join(hooks,policy+".mjs"),args:["--self-test=smoke"]})),"shared dispatchers run once across all four agents");
        env.GOAT_MECHANISM_FIXTURE_FAIL="1";
        const failed=checkHookSelfTest(ctx,"node");
        assert.match(failed.message,/self-test.*failed for claude/u);
        assert.match(failed.howToFix,/Run node .*\.mjs/u);
        delete env.GOAT_MECHANISM_FIXTURE_FAIL;
        const dispatcher=join(hooks,"deny-dangerous.mjs"), saved=readFileSync(dispatcher,"utf8");
        rmSync(dispatcher);
        assert.match(checkHookSelfTest(ctx,"node").message,/dispatcher is unavailable/u);
        writeFileSync(dispatcher,saved);
        rmSync(${JSON.stringify(selfTest)});
        assert.match(checkHookSelfTest(ctx,"node").message,/self-test is unavailable/u);
      }
    `,
    );
    const result = spawnSync(process.execPath, [runner], {
      cwd: parent,
      encoding: "utf8",
      env: restrictedConsumerEnvironment(parent),
      timeout: 20000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.signal, null);
    return readFileSync(join(parent, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((event) => event.event === "denied");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Writes executable module text but invokes only Node's parser; invalid, absent and Bash candidates remain distinguishable.
test("native mechanism syntax checks parse without executing and refuse missing or Bash files", () => {
  assert.deepEqual(runNativeMechanism("syntax"), []);
});

// Writes a real self-test driver and dispatchers so native environment paths, smoke argv, deduplication and failures cross actual child boundaries.
test("native mechanism self-tests select both dispatchers once and report failure or unavailable candidates without Bash", () => {
  assert.deepEqual(runNativeMechanism("self-test"), []);
});
