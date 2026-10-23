/** Configured audit transport fixtures exercise saved provider handlers, without crediting policy parity or live delivery. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
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
import { spawnConfiguredHookProbe } from "../../src/cli/audit/check-agent-deny-runtime.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  buildAgentHookDescriptor,
  entryCarriesHandlerDescriptor,
  isAgentHookJsonObject,
  type AgentHookHandlerDescriptor,
  type AgentHookJsonObject,
} from "../../src/cli/server/agent-hook-command.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

const PROVIDERS = ["claude", "codex", "copilot", "antigravity"] as const;
type Provider = (typeof PROVIDERS)[number];
// Consumer runners use the built CLI so compilation stays outside the restricted process tree.
const AUDIT_MODULE = pathToFileURL(
  resolve(
    import.meta.dirname,
    "../../dist/cli/audit/check-agent-deny-runtime.js",
  ),
).href;

/** Finds an exact descriptor in the public writer's saved configuration. */
function findHandler(
  configNode: unknown,
  provider: Provider,
  descriptor: AgentHookHandlerDescriptor,
): AgentHookJsonObject | undefined {
  if (
    isAgentHookJsonObject(configNode) &&
    entryCarriesHandlerDescriptor(configNode, provider, descriptor)
  )
    return configNode;
  if (configNode === null || typeof configNode !== "object") return undefined;
  for (const child of Object.values(configNode)) {
    const found = findHandler(child, provider, descriptor);
    if (found) return found;
  }
  return undefined;
}

/** Writes one real registration and a transport-only evaluator, then reads back the exact saved invocation. */
function createFixture(parent: string, provider: Provider) {
  const root = join(parent, provider + "'s audit & (quoted) [fixture] 🐐");
  const hooks = join(root, ".goat-flow/hooks");
  mkdirSync(hooks, { recursive: true });
  cpSync(resolve(import.meta.dirname, "../../workflow/hooks"), hooks, {
    recursive: true,
  });
  const initialized = spawnSync("git", ["init", "-q", root], {
    encoding: "utf8",
  });
  assert.equal(initialized.status, 0, initialized.stderr);
  const spec = getHookSpec("deny-dangerous");
  assert.ok(spec);
  writeAgentHookState(root, PROFILES[provider], spec, true);
  const installed = buildAgentHookDescriptor(
    provider,
    ".goat-flow/hooks",
    spec,
  );
  const native = buildAgentHookDescriptor(provider, ".goat-flow/hooks", spec);
  const configRelativePath = PROFILES[provider].hookConfigFile;
  assert.ok(configRelativePath);
  const configPath = join(root, configRelativePath);
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const row = findHandler(config, provider, installed);
  assert.ok(row, "public writer must create the installed row first");
  if (provider === "copilot") {
    row.bash = native.command;
    row.powershell = native.command;
  } else {
    row.command = native.command;
    if (native.form === "argv") {
      row.args = native.args;
      row.bash = native.bash;
      row.powershell = native.powershell;
    } else if (native.commandWindows !== undefined)
      row.commandWindows = native.commandWindows;
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const saved = findHandler(
    JSON.parse(readFileSync(configPath, "utf8")),
    provider,
    native,
  );
  assert.ok(saved, "complete native identity must survive save/reload");
  assert.equal(entryCarriesHandlerDescriptor(saved, provider, installed), true);
  const configured = {
    command: (provider === "copilot" ? saved.bash : saved.command) as string,
    commandWindows:
      typeof saved.commandWindows === "string" ? saved.commandWindows : null,
    args: native.form === "argv" ? (saved.args as string[]) : null,
    scriptFile: "deny-dangerous.mjs",
    scriptPath: ".goat-flow/hooks/deny-dangerous.mjs",
    configPath,
  };
  const observedPath = join(root, "observed.jsonl");
  const evaluator = join(hooks, "deny-dangerous.mjs");
  writeFileSync(
    evaluator,
    String.raw`
    import assert from "node:assert/strict";
    import { readFileSync, appendFileSync } from "node:fs";
    import { argv, cwd } from "node:process";
    const input=readFileSync(0,"utf8"), parsed=JSON.parse(input), provider=${JSON.stringify(provider)};
    const command=parsed.tool_input?.command??parsed.toolArgs?.command??parsed.toolCall?.args?.CommandLine;
    const shape=provider==="copilot"?{toolName:"bash",toolArgs:{command}}:provider==="antigravity"?{hookEventName:"PreToolUse",toolCall:{name:"run_command",args:{CommandLine:command}}}:{tool_name:"Bash",tool_input:{command}};
    assert.deepEqual(parsed,shape);
    assert.deepEqual(argv.slice(2),["--root",${JSON.stringify(root)}]);
    assert.equal(cwd(),${JSON.stringify(root)});
    appendFileSync(${JSON.stringify(observedPath)},JSON.stringify({input})+"\n");
    const blocked=command==="native fixture deny";
    if(provider==="copilot")process.stdout.write(JSON.stringify({permissionDecision:blocked?"deny":"allow"})+"\n");
    else if(provider==="antigravity")process.stdout.write(JSON.stringify({decision:blocked?"deny":"allow"})+"\n");
    else if(blocked){process.stderr.write("BLOCKED: Policy native fixture\n");process.exitCode=2;}
  `,
  );
  const nested = join(root, "nested's cwd & (literal)");
  mkdirSync(nested);
  return {
    provider,
    root,
    nested,
    configured,
    observedPath,
    evaluator,
    installed,
  };
}

/** Writes and spawns an audit runner under restricted child controls; all evaluator input remains inert JSON. */
function runScenario(kind: "responses" | "failures") {
  const parent = realpathSync.native(
    mkdtempSync(join(tmpdir(), "goat-audit-configured-")),
  );
  try {
    const fixtures = PROVIDERS.map((provider) =>
      createFixture(parent, provider),
    );
    const runner = join(parent, "runner.mjs");
    writeFileSync(
      runner,
      String.raw`
      import assert from "node:assert/strict";
      import { readFileSync, rmSync } from "node:fs";
      import { spawnConfiguredHookProbe } from ${JSON.stringify(AUDIT_MODULE)};
      for(const fixture of ${JSON.stringify(fixtures)}) {
        const {provider,root,nested,configured,installed}=fixture;
        const payload=(command)=>JSON.stringify(provider==="copilot"?{toolName:"bash",toolArgs:{command}}:provider==="antigravity"?{hookEventName:"PreToolUse",toolCall:{name:"run_command",args:{CommandLine:command}}}:{tool_name:"Bash",tool_input:{command}})+"\n";
        const probe=(input)=>({hookInput:input,expectedOutcome:"block",expectedStatus:2,expectedStream:"stderr",expectedPattern:/BLOCKED/u});
        if(${JSON.stringify(kind)}==="responses") {
          const expected=[];
          for(const cwd of [root,nested])for(const command of ["native fixture allow '$&| (literal) 🐐","native fixture deny"]) {
            const input=payload(command), blocked=command==="native fixture deny";
            const result=spawnConfiguredHookProbe(configured,probe(input),cwd);
            assert.equal(
              result.status,
              blocked&&(provider==="claude"||provider==="codex")?2:0,
              JSON.stringify({
                provider,
                cwd:cwd===root?"root":"nested",
                command,
                status:result.status,
                signal:result.signal,
                errorCode:result.error?.code??null,
                errorMessage:result.error?.message??null,
                stdout:result.stdout,
                stderr:result.stderr,
              }),
            );
            assert.equal(result.signal,null);
            if(provider==="copilot")assert.equal(JSON.parse(result.stdout).permissionDecision,blocked?"deny":"allow");
            else if(provider==="antigravity")assert.equal(JSON.parse(result.stdout).decision,blocked?"deny":"allow");
            else {assert.equal(result.stdout,"");assert.equal(result.stderr,blocked?"BLOCKED: Policy native fixture\n":"");}
            expected.push({input});
          }
          assert.deepEqual(readFileSync(fixture.observedPath,"utf8").trim().split("\n").map(JSON.parse),expected);
        } else {
          const legacy={...configured,scriptFile:"deny-dangerous.sh",scriptPath:".goat-flow/hooks/deny-dangerous.sh"};
          assert.throws(()=>spawnConfiguredHookProbe(legacy,probe(payload("native fixture deny")),root),/native replay requires/u);
          rmSync(fixture.evaluator);
          const missing=spawnConfiguredHookProbe(configured,probe(payload("native fixture deny")),root);
          assert.match(missing.stdout+missing.stderr,/hook unavailable/u);
          assert.equal(missing.signal,null);
        }
      }
    `,
    );
    const result = spawnSync(process.execPath, [runner], {
      cwd: parent,
      env: restrictedConsumerEnvironment(parent),
      encoding: "utf8",
      timeout: 30000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    assert.equal(result.signal, null);
    const events = readFileSync(join(parent, "spawn-journal.jsonl"), "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return events.filter((event) => event.event === "denied");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Writes four real registrations and invokes audit's configured owner; correct replies alone cannot hide lost stdin or the wrong selected root.
test("native configured audit preserves saved provider forms, exact input and root from root and nested cwd without Bash", () => {
  assert.deepEqual(runScenario("responses"), []);
});

// Removes owned evaluators after checking installed-operand refusal; startup failure remains visible through each saved provider handler.
test("native configured audit refuses installed operands and exposes unavailable evaluators", () => {
  assert.deepEqual(runScenario("failures"), []);
});

// Spawns an inert argv control to protect the omitted-flag route and keep the exported owner visible to static dependency checks.
test("configured audit preserves literal exec argv and stdin", () => {
  const hookInput = "literal '$&| 🐐\n";
  const result = spawnConfiguredHookProbe(
    {
      command: process.execPath,
      commandWindows: null,
      args: [
        "-e",
        "process.stdout.write(require('node:fs').readFileSync(0,'utf8'))",
      ],
      scriptFile: "fixture.mjs",
      scriptPath: "fixture.mjs",
      configPath: "fixture.json",
    },
    {
      hookInput,
      expectedOutcome: "allow",
      expectedStatus: 0,
      expectedStream: "stdout",
      expectedPattern: /literal/u,
    },
    process.cwd(),
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, hookInput);
  assert.equal(result.stderr, "");
});
