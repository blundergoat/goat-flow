/**
 * checkDrift installer round-trip: clones the repo, installs a fixture-backed reference skill for
 * every agent, then asserts the skill files land, preflight passes, and a real `audit --check-drift`
 * run reports zero drift - the end-to-end guard that install output matches what drift expects.
 */
import {
  after,
  assert,
  before,
  describe,
  existsSync,
  INSTALL_FIXTURE_FILES,
  INSTALL_FIXTURE_SKILL,
  it,
  join,
  patchInstallRoundTripFixture,
  PROJECT_ROOT,
  rmSync,
  runCommand,
  setupInstallRoundTripFixture,
} from "./audit-drift.helpers.ts";
import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

/** One dependency-tree request observed by the fixture-local npm audit endpoint. */
interface LocalAuditRequest {
  method: string;
  path: string;
  bytes: number;
}

/** Running localhost endpoint and the requests it has reported to the parent test. */
interface LocalAuditRegistry {
  process: ChildProcessWithoutNullStreams;
  registryUrl: string;
  requests: LocalAuditRequest[];
  stderr: () => string;
}

/**
 * Start a separate-process HTTP endpoint so it can answer npm while this test waits in spawnSync.
 * The endpoint implements only npm's bulk-advisory route and records the real request shape.
 * Side effect: spawns a localhost server child that the caller must stop.
 */
function startLocalAuditRegistry(): Promise<LocalAuditRegistry> {
  const serverSource = String.raw`
    const http = require("node:http");
    const server = http.createServer((request, response) => {
      let bytes = 0;
      request.on("data", (chunk) => { bytes += chunk.length; });
      request.on("end", () => {
        const record = { kind: "request", method: request.method, path: request.url, bytes };
        process.stdout.write(JSON.stringify(record) + "\n");
        if (request.method !== "POST" || request.url !== "/-/npm/v1/security/advisories/bulk") {
          response.writeHead(404, { "content-type": "application/json" });
          response.end(JSON.stringify({ error: "fixture route not found" }));
          return;
        }
        response.writeHead(200, { "content-type": "application/json" });
        response.end("{}");
      });
    });
    server.listen(0, "127.0.0.1", () => {
      process.stdout.write(JSON.stringify({ kind: "ready", port: server.address().port }) + "\n");
    });
    process.on("SIGTERM", () => server.close(() => process.exit(0)));
  `;
  const registryProcess = spawn(process.execPath, ["-e", serverSource]);
  registryProcess.stdin.end();
  registryProcess.stdout.setEncoding("utf-8");
  registryProcess.stderr.setEncoding("utf-8");
  const requests: LocalAuditRequest[] = [];
  let stdoutBuffer = "";
  let stderr = "";
  let hasStarted = false;

  registryProcess.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  return new Promise((resolveRegistry, rejectRegistry) => {
    const startupTimer = setTimeout(() => {
      registryProcess.kill("SIGKILL");
      rejectRegistry(
        new Error(`local npm audit registry did not start:\n${stderr}`),
      );
    }, 5_000);

    registryProcess.once("error", (error) => {
      clearTimeout(startupTimer);
      rejectRegistry(error);
    });
    registryProcess.once("exit", (status, signal) => {
      if (hasStarted) return;
      clearTimeout(startupTimer);
      rejectRegistry(
        new Error(
          `local npm audit registry exited before ready (${status ?? signal}):\n${stderr}`,
        ),
      );
    });
    registryProcess.stdout.on("data", (chunk: string) => {
      stdoutBuffer += chunk;
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.length === 0) continue;
        const record = JSON.parse(line) as
          | { kind: "ready"; port: number }
          | ({ kind: "request" } & LocalAuditRequest);
        if (record.kind === "request") {
          requests.push(record);
          continue;
        }
        if (hasStarted) continue;
        hasStarted = true;
        clearTimeout(startupTimer);
        resolveRegistry({
          process: registryProcess,
          registryUrl: `http://127.0.0.1:${record.port}/`,
          requests,
          stderr: () => stderr,
        });
      }
    });
  });
}

/** Stop the fixture endpoint, escalating only if a clean server close misses its short deadline. */
async function stopLocalAuditRegistry(
  registry: LocalAuditRegistry,
): Promise<void> {
  if (
    registry.process.exitCode !== null ||
    registry.process.signalCode !== null
  ) {
    return;
  }
  const exitPromise = new Promise<void>((resolveExit) => {
    registry.process.once("exit", () => resolveExit());
  });
  registry.process.kill("SIGTERM");
  const stoppedCleanly = await Promise.race([
    exitPromise.then(() => true),
    delay(1_000, false),
  ]);
  if (!stoppedCleanly) {
    registry.process.kill("SIGKILL");
    await exitPromise;
  }
}

/** Wait briefly for the child-process stdout event that follows npm's completed HTTP request. */
async function waitForAuditRequest(
  registry: LocalAuditRegistry,
): Promise<LocalAuditRequest> {
  const deadline = Date.now() + 2_000;
  while (registry.requests.length === 0 && Date.now() < deadline) {
    await delay(10);
  }
  const request = registry.requests[0];
  assert.ok(
    request,
    `expected npm to call the local bulk-advisory endpoint:\n${registry.stderr()}`,
  );
  return request;
}

/** Required offline proofs that let the fixture's audit show real effective coverage. */
const REQUIRED_EFFECTIVE_HOOK_PROOFS = [
  { agentId: "claude", scenario: "deny-hook" },
  { agentId: "codex", scenario: "deny-hook" },
  { agentId: "antigravity", scenario: "deny-hook" },
  { agentId: "copilot", scenario: "deny-hook" },
  { agentId: "claude", scenario: "gruff-hook" },
  { agentId: "copilot", scenario: "gruff-hook" },
  { agentId: "claude", scenario: "post-turn-hook" },
] as const;

describe("checkDrift: installer round-trip fixture", () => {
  let root: string;
  before(() => {
    assert.ok(
      existsSync(join(PROJECT_ROOT, "node_modules")),
      "node_modules must exist for temp-repo preflight coverage",
    );
    assert.ok(
      existsSync(join(PROJECT_ROOT, "dist", "cli", "cli.js")),
      "run npm run build before this test",
    );
    root = setupInstallRoundTripFixture();
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it(
    "installs fixture-backed references, passes preflight, and reports zero drift",
    { timeout: 400000 },
    async () => {
      const { agentIds, skillRoots } = patchInstallRoundTripFixture(root);
      const format = runCommand(
        root,
        "npx",
        [
          "prettier",
          "--write",
          "workflow/manifest.json",
          "src/cli/constants.ts",
          "package.json",
        ],
        60000,
      );
      assert.equal(
        format.status,
        0,
        `prettier should format temp round-trip files:\n${format.output}`,
      );

      // A user can install several agents before asking one audit to assess shared coverage.
      for (const agentId of agentIds) {
        const install = runCommand(
          root,
          "bash",
          ["workflow/install-goat-flow.sh", root, "--agent", agentId],
          60000,
        );
        assert.equal(
          install.status,
          0,
          `install for ${agentId} should pass:\n${install.output}`,
        );
      }

      // Every selected agent should receive the same fixture-backed reference skill.
      for (const skillRoot of skillRoots) {
        // Each required file must exist before the user sees that skill as installed.
        for (const relativeFile of INSTALL_FIXTURE_FILES) {
          assert.ok(
            existsSync(
              join(root, skillRoot, INSTALL_FIXTURE_SKILL, relativeFile),
            ),
            `expected ${skillRoot}/${INSTALL_FIXTURE_SKILL}/${relativeFile} to exist after install`,
          );
        }
      }

      // Explicit offline scenarios provide the runtime evidence a normal audit never executes.
      for (const requiredHookProof of REQUIRED_EFFECTIVE_HOOK_PROOFS) {
        const hookProof = runCommand(
          root,
          "node",
          [
            "dist/cli/cli.js",
            "hooks",
            "verify",
            ".",
            "--agent",
            requiredHookProof.agentId,
            "--scenario",
            requiredHookProof.scenario,
            "--trusted-target",
          ],
          60000,
        );
        assert.equal(
          hookProof.status,
          0,
          `${requiredHookProof.agentId}/${requiredHookProof.scenario} proof should pass:\n${hookProof.output}`,
        );
      }

      const inheritedRegistry = process.env.npm_config_registry;
      const auditRegistry = await startLocalAuditRegistry();
      try {
        const preflight = runCommand(
          root,
          "bash",
          ["scripts/preflight-checks.sh", "--verbose", "--no-color"],
          400000,
          { npm_config_registry: auditRegistry.registryUrl },
        );
        assert.equal(
          preflight.status,
          0,
          `preflight should pass in temp round-trip repo:\n${preflight.output}`,
        );
        assert.match(
          preflight.output,
          /^\s*PASS(?: \(with warnings\))?\s+\d+\s+checks/m,
        );
        assert.match(
          preflight.output,
          /All installed skill files match workflow templates/,
        );
        assert.match(preflight.output, /npm audit \(0 vulnerabilities\)/);

        const auditRequest = await waitForAuditRequest(auditRegistry);
        assert.equal(auditRequest.method, "POST");
        assert.equal(auditRequest.path, "/-/npm/v1/security/advisories/bulk");
        assert.ok(
          auditRequest.bytes > 0,
          "npm audit should send a package tree",
        );
        assert.equal(auditRegistry.requests.length, 1);
        assert.equal(process.env.npm_config_registry, inheritedRegistry);
      } finally {
        await stopLocalAuditRegistry(auditRegistry);
      }

      const drift = runCommand(
        root,
        "node",
        ["dist/cli/cli.js", "audit", ".", "--check-drift", "--format", "json"],
        60000,
      );
      assert.equal(
        drift.status,
        0,
        `drift audit should pass after round-trip install:\n${drift.output}`,
      );

      const report = JSON.parse(drift.stdout) as {
        status: string;
        drift: { status: string; findings: unknown[] } | null;
      };
      assert.equal(report.status, "pass");
      assert.equal(report.drift?.status, "pass");
      assert.deepEqual(report.drift?.findings ?? [], []);
    },
  );
});
