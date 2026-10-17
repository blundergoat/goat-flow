/**
 * Replays disposable native registrations with literal input and restricted child processes.
 * These transport fixtures prove saved descriptor identity and provider responses, not policy parsing or live delivery.
 */
import assert from "node:assert/strict";
import {
  spawnSync,
  type SpawnSyncOptionsWithStringEncoding,
} from "node:child_process";
import {
  closeSync,
  cpSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after, describe, it } from "node:test";
import { PROFILES } from "../../src/cli/detect/agents.js";
import {
  agentHookSpawnDescriptor,
  buildAgentHookDescriptor,
  entryCarriesHandlerDescriptor,
  isAgentHookJsonObject,
  type AgentHookHandlerDescriptor,
  type AgentHookJsonObject,
} from "../../src/cli/server/agent-hook-command.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import { restrictedConsumerEnvironment } from "../helpers/restricted-consumer-env.js";

const WORKFLOW_HOOKS = resolve(import.meta.dirname, "../../workflow/hooks");
const disposableParents: string[] = [];

/** Spawns the handler and captures its exact bytes through private files, retaining the child's process metadata. */
function runWithFileStreams(
  command: string,
  args: string[],
  options: SpawnSyncOptionsWithStringEncoding,
  payload?: string,
) {
  const directory = mkdtempSync(join(tmpdir(), "goat-spawn-matrix-streams-"));
  const stdoutPath = join(directory, "stdout");
  const stderrPath = join(directory, "stderr");
  const descriptors: number[] = [];
  try {
    let stdin: number | "ignore" = "ignore";
    if (payload !== undefined) {
      const inputPath = join(directory, "stdin");
      writeFileSync(inputPath, payload, { flag: "wx", mode: 0o600 });
      stdin = openSync(inputPath, "r");
      descriptors.push(stdin);
    }
    const stdout = openSync(stdoutPath, "wx", 0o600);
    descriptors.push(stdout);
    const stderr = openSync(stderrPath, "wx", 0o600);
    descriptors.push(stderr);
    const result = spawnSync(command, args, {
      ...options,
      stdio: [stdin, stdout, stderr],
    });
    return {
      ...result,
      stdout: readFileSync(stdoutPath, "utf8"),
      stderr: readFileSync(stderrPath, "utf8"),
    };
  } finally {
    for (const descriptor of descriptors) closeSync(descriptor);
    rmSync(directory, { recursive: true, force: true });
  }
}

/** Require successful Git setup even when completed children carry sandbox EPERM metadata. */
function initializeGit(projectRoot: string): void {
  const result = runWithFileStreams("git", ["init", "-q", projectRoot], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.equal(result.signal, null);
  assert.ok(
    !result.error || ("code" in result.error && result.error.code === "EPERM"),
    result.error?.message,
  );
}

/** Remove every fixture tree after the suite so hostile-named roots never linger. */
after(() => {
  // Each recorded parent is a suite-owned temporary directory, never a user workspace.
  for (const disposableParent of disposableParents) {
    rmSync(disposableParent, { recursive: true, force: true });
  }
});

/** Keep the proposed shell text inert inside one provider event. */
function denyPayload(shellCommand: string): string {
  return JSON.stringify({
    tool_name: "Bash",
    tool_input: { command: shellCommand },
  });
}

const NATIVE_FIXTURE_AGENTS = [
  "claude",
  "codex",
  "copilot",
  "antigravity",
] as const;
type NativeFixtureAgent = (typeof NATIVE_FIXTURE_AGENTS)[number];

/** Find the exact canonical row inside a fixture's real provider configuration. */
function nativeFixtureEntry(
  value: unknown,
  agent: NativeFixtureAgent,
  descriptor: AgentHookHandlerDescriptor,
): AgentHookJsonObject | undefined {
  if (
    isAgentHookJsonObject(value) &&
    entryCarriesHandlerDescriptor(value, agent, descriptor)
  )
    return value;
  if (value === null || typeof value !== "object") return undefined;
  for (const child of Object.values(value)) {
    const found = nativeFixtureEntry(child, agent, descriptor);
    if (found) return found;
  }
  return undefined;
}

/** Writes a disposable provider registration and transport-only Node policy fixture; no policy corpus is credited. */
function createNativePolicyFixture(agent: NativeFixtureAgent) {
  const parent = realpathSync.native(
    mkdtempSync(join(tmpdir(), "goat-native-replay-")),
  );
  disposableParents.push(parent);
  const projectRoot = join(parent, "native's flow & (quoted) [fixture] 🐐");
  const hooks = join(projectRoot, ".goat-flow/hooks");
  mkdirSync(hooks, { recursive: true });
  cpSync(WORKFLOW_HOOKS, hooks, { recursive: true });
  initializeGit(projectRoot);
  const spec = getHookSpec("deny-dangerous");
  assert.ok(spec);
  writeAgentHookState(projectRoot, PROFILES[agent], spec, true);
  const installed = buildAgentHookDescriptor(agent, ".goat-flow/hooks", spec);
  const candidate = buildAgentHookDescriptor(
    agent,
    ".goat-flow/hooks",
    spec,
    "node",
  );
  const configRelativePath = PROFILES[agent].hookConfigFile;
  assert.ok(configRelativePath);
  const configPath = join(projectRoot, configRelativePath);
  const config: unknown = JSON.parse(readFileSync(configPath, "utf8"));
  const row = nativeFixtureEntry(config, agent, installed);
  assert.ok(
    row,
    "public writer must create the canonical row before fixture conversion",
  );
  if (agent === "copilot") {
    row.bash = candidate.command;
    row.powershell = candidate.command;
  } else {
    row.command = candidate.command;
    if (candidate.form === "argv") {
      row.args = candidate.args;
      row.bash = candidate.bash;
      row.powershell = candidate.powershell;
    } else if (candidate.commandWindows !== undefined) {
      row.commandWindows = candidate.commandWindows;
    }
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
  const saved = nativeFixtureEntry(
    JSON.parse(readFileSync(configPath, "utf8")),
    agent,
    candidate,
  );
  assert.ok(saved);
  assert.equal(entryCarriesHandlerDescriptor(saved, agent, installed), false);
  const descriptor = { ...candidate };
  descriptor.command = (
    agent === "copilot" ? saved.bash : saved.command
  ) as string;
  if (descriptor.form === "argv") descriptor.args = saved.args as string[];
  else if (typeof saved.commandWindows === "string")
    descriptor.commandWindows = saved.commandWindows;
  const observedPath = join(projectRoot, "native-observed.jsonl");
  writeFileSync(
    join(hooks, "deny-dangerous.mjs"),
    `
    import { readFileSync, appendFileSync } from "node:fs";
    import { argv, cwd } from "node:process";
    const input=readFileSync(0,"utf8");
    appendFileSync(${JSON.stringify(observedPath)},JSON.stringify({input,args:argv.slice(2),cwd:cwd()})+"\\n");
    const blocked=JSON.parse(input).tool_input.command==="native fixture deny";
    const agent=${JSON.stringify(agent)};
    if(agent==="copilot")process.stdout.write(JSON.stringify({permissionDecision:blocked?"deny":"allow"})+"\\n");
    else if(agent==="antigravity")process.stdout.write(JSON.stringify({decision:blocked?"deny":"allow"})+"\\n");
    else if(blocked){process.stderr.write("BLOCKED: Policy native fixture\\n");process.exitCode=2;}
  `,
  );
  const environment = restrictedConsumerEnvironment(parent);
  delete environment.CLAUDE_PROJECT_DIR;
  return { parent, projectRoot, hooks, descriptor, observedPath, environment };
}

/** Spawns the saved native fixture and reads its restricted journal without invoking a provider CLI. */
function runNativePolicyFixture(
  fixture: ReturnType<typeof createNativePolicyFixture>,
  input: string,
  cwd = fixture.projectRoot,
) {
  const journal = join(fixture.parent, "spawn-journal.jsonl");
  writeFileSync(journal, "");
  const selected = agentHookSpawnDescriptor(
    fixture.descriptor,
    process.platform,
    "node",
  );
  const result = runWithFileStreams(
    selected.command,
    selected.args,
    {
      cwd,
      encoding: "utf8",
      env: { ...fixture.environment, ...selected.env },
      timeout: 15000,
    },
    input,
  );
  const events = readFileSync(journal, "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  assert.equal(events.filter((event) => event.event === "denied").length, 0);
  return { ...result, events };
}

describe("native candidate registered policy replay", () => {
  // Writes real registrations and evaluator fixtures; literal stdin and Node journals expose quoting, root or extra-process regressions.
  it("preserves hostile roots, literal input and the two/three-process descriptor families without Bash", () => {
    for (const agent of NATIVE_FIXTURE_AGENTS) {
      const fixture = createNativePolicyFixture(agent);
      const child = join(fixture.projectRoot, "child's cwd & (literal)");
      mkdirSync(child);
      const input = denyPayload("native fixture allow '$&| (literal) 🐐");
      const result = runNativePolicyFixture(fixture, input, child);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stderr, "");
      const observed = JSON.parse(readFileSync(fixture.observedPath, "utf8"));
      assert.equal(observed.input, input);
      assert.deepEqual(observed.args, ["--root", fixture.projectRoot]);
      assert.equal(observed.cwd, fixture.projectRoot);
      assert.equal(
        result.events.filter((event) => event.event === "loaded").length,
        agent === "claude" ? 2 : 3,
      );
      if (agent === "antigravity")
        assert.equal(JSON.parse(result.stdout).decision, "allow");
      else if (agent === "copilot")
        assert.equal(JSON.parse(result.stdout).permissionDecision, "allow");
      else assert.equal(result.stdout, "");
    }
  });

  // Writes transport-only denial fixtures so each provider's registered response is exercised independently of the unported policy parser.
  it("preserves each provider's denial reply through its saved native descriptor", () => {
    for (const agent of NATIVE_FIXTURE_AGENTS) {
      const fixture = createNativePolicyFixture(agent);
      const result = runNativePolicyFixture(
        fixture,
        denyPayload("native fixture deny"),
      );
      assert.equal(
        result.status,
        agent === "claude" || agent === "codex" ? 2 : 0,
        result.stderr,
      );
      assert.equal(
        result.events.filter((event) => event.event === "loaded").length,
        agent === "claude" ? 2 : 3,
      );
      if (agent === "antigravity")
        assert.equal(JSON.parse(result.stdout).decision, "deny");
      else if (agent === "copilot")
        assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
      else assert.match(result.stderr, /BLOCKED: Policy native fixture/u);
    }
  });

  // Writes then removes one fixture entry; the bootstrap must refuse before any evaluator can record a scan.
  it("reports missing native launchers and evaluators without recording a scan", () => {
    for (const agent of NATIVE_FIXTURE_AGENTS) {
      for (const missing of ["run-hook.mjs", "deny-dangerous.mjs"]) {
        const fixture = createNativePolicyFixture(agent);
        rmSync(join(fixture.hooks, missing));
        const result = runNativePolicyFixture(
          fixture,
          denyPayload("native fixture allow"),
        );
        assert.equal(
          result.status,
          agent === "claude" || agent === "codex" ? 2 : 0,
          result.stderr,
        );
        if (agent === "antigravity")
          assert.equal(JSON.parse(result.stdout).decision, "deny");
        else if (agent === "copilot")
          assert.equal(JSON.parse(result.stdout).permissionDecision, "deny");
        else assert.match(result.stderr, /managed root incomplete/u);
        assert.equal(
          result.events.filter((event) => event.event === "loaded").length,
          1,
        );
        assert.throws(() => readFileSync(fixture.observedPath), {
          code: "ENOENT",
        });
      }
    }
  });
});
