/**
 * Protects the explicit hook-runtime proof users request from terminals or CI.
 * Use these tests when verdicts, event metadata, or `hooks verify` grammar changes
 * so unavailable hooks never look successful and captured hook text never leaks.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { parseCLIArgs } from "../../src/cli/cli-parser.js";
import type { CreateEvidenceEnvelopeInput } from "../../src/cli/evidence/envelope.js";
import {
  executeManagedHookProbe,
  renderHookRuntimeReportJson,
  renderHookRuntimeReportText,
  verifyManagedDenyHook,
  type HookProbeExecution,
  type HookProbeScenario,
  type HookRuntimeDependencies,
  type ManagedDenyHookState,
} from "../../src/cli/hooks-runtime-evidence.js";

// Three deny checks plus one allow control define the complete fixed scenario group.
const DENY_HOOK_SCENARIO_COUNT = 4;

const CONFIGURED_HOOK_STATE: ManagedDenyHookState = {
  isSupported: true,
  enabled: true,
  installed: true,
  scriptPath: ".goat-flow/hooks/deny-dangerous.sh",
  reasonCode: null,
};

const BLOCKED_EXECUTION: HookProbeExecution = {
  exitCode: 2,
  stdout: "",
  stderr: "BLOCKED: Policy fixture: blocked by test policy",
  durationMs: 3,
  timedOut: false,
  hasSpawnError: false,
};

const ALLOWED_EXECUTION: HookProbeExecution = {
  exitCode: 0,
  stdout: "",
  stderr: "",
  durationMs: 2,
  timedOut: false,
  hasSpawnError: false,
};

/** Build deterministic probe dependencies without starting a shell process. */
function runtimeDependencies(
  overrides: Partial<HookRuntimeDependencies> = {},
): HookRuntimeDependencies {
  return {
    readDenyHookState: () => CONFIGURED_HOOK_STATE,
    executeProbe: (_projectPath, _scriptPath, scenario) =>
      scenario.expected === "blocked" ? BLOCKED_EXECUTION : ALLOWED_EXECUTION,
    recordEvidence: () => ({ ok: true, path: "/fixture/events.jsonl" }),
    ...overrides,
  };
}

/** Run the common configured Codex request used by user-visible verdict tests. */
function configuredReport(dependencies: HookRuntimeDependencies) {
  return verifyManagedDenyHook(
    {
      projectPath: "/fixture",
      agent: "codex",
      scenarioGroup: "deny-hook",
      isTargetUntrusted: false,
    },
    dependencies,
  );
}

describe("hooks runtime evidence", () => {
  for (const [flag, field] of [
    ["--help", "showHelp"],
    ["--version", "showVersion"],
  ] as const) {
    it(`accepts hooks ${flag} without a hooks subcommand`, () => {
      const parsed = parseCLIArgs(["hooks", flag]);
      assert.equal(parsed.command, "hooks");
      assert.equal(parsed[field], true);
    });
  }

  const PROBE_SCENARIO: HookProbeScenario = {
    id: "fixture-probe",
    label: "Fixture probe",
    expected: "blocked",
    command: "git push",
  };

  /** Fixture proves a symlinked hook script cannot smuggle execution outside the checkout. */
  it("rejects a symlinked hook script pointing outside the checkout", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-hook-symlink-"));
    const outsidePath = mkdtempSync(join(tmpdir(), "goat-flow-hook-outside-"));
    const markerPath = join(outsidePath, "executed.marker");
    const outsideScript = join(outsidePath, "outside-hook.sh");

    try {
      writeFileSync(
        outsideScript,
        `#!/usr/bin/env bash\ntouch "${markerPath}"\nexit 0\n`,
        { mode: 0o755 },
      );
      mkdirSync(join(projectPath, ".goat-flow", "hooks"), { recursive: true });
      symlinkSync(
        outsideScript,
        join(projectPath, ".goat-flow", "hooks", "deny-dangerous.sh"),
      );

      const execution = executeManagedHookProbe(
        projectPath,
        ".goat-flow/hooks/deny-dangerous.sh",
        PROBE_SCENARIO,
      );

      assert.equal(
        execution.hasSpawnError,
        true,
        "the probe must be rejected, not executed",
      );
      assert.equal(execution.exitCode, null);
      assert.ok(!existsSync(markerPath), "the outside script must never run");
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
      rmSync(outsidePath, { recursive: true, force: true });
    }
  });

  /** Control fixture keeps regular in-checkout hook scripts executable after the symlink guard. */
  it("still executes a regular in-checkout hook script", () => {
    const projectPath = mkdtempSync(join(tmpdir(), "goat-flow-hook-regular-"));

    try {
      mkdirSync(join(projectPath, ".goat-flow", "hooks"), { recursive: true });
      writeFileSync(
        join(projectPath, ".goat-flow", "hooks", "deny-dangerous.sh"),
        '#!/usr/bin/env bash\necho "BLOCKED: Policy fixture: blocked by test policy" >&2\nexit 2\n',
        { mode: 0o755 },
      );

      const execution = executeManagedHookProbe(
        projectPath,
        ".goat-flow/hooks/deny-dangerous.sh",
        PROBE_SCENARIO,
      );

      assert.equal(execution.hasSpawnError, false);
      assert.equal(execution.exitCode, 2);
      assert.match(execution.stderr, /BLOCKED: Policy fixture/u);
    } finally {
      rmSync(projectPath, { recursive: true, force: true });
    }
  });

  // A terminal user can choose one checkout, agent, and the bounded deny-hook scenario group.
  it("parses hooks verify without adding a top-level verify command", () => {
    const parsed = parseCLIArgs([
      "hooks",
      "verify",
      ".",
      "--agent",
      "codex",
      "--scenario",
      "deny-hook",
      "--format",
      "json",
    ]);

    assert.equal(parsed.command, "hooks");
    assert.equal(parsed.hookSubcommand, "verify");
    assert.equal(parsed.hookScenario, "deny-hook");
    assert.equal(parsed.projectPath, resolve("."));
    assert.equal(parsed.agent, "codex");
  });

  // An omitted scenario must stop before the CLI chooses a proof group on the user's behalf.
  it("requires an explicit hook verification scenario group", () => {
    assert.throws(
      () => parseCLIArgs(["hooks", "verify", ".", "--agent", "codex"]),
      /hooks verify requires --scenario "deny-hook"/iu,
    );
  });

  // Unknown scenario names must fail before a user believes an unimplemented proof ran.
  it("rejects unknown hook verification scenario groups", () => {
    assert.throws(
      () =>
        parseCLIArgs([
          "hooks",
          "verify",
          ".",
          "--agent",
          "codex",
          "--scenario",
          "full-agent-session",
        ]),
      /--scenario must be "deny-hook"/iu,
    );
  });

  // Four direct classifier results give users separate blocked and allowed controls.
  it("passes only when every fixed hook scenario matches its expected observation", () => {
    const recordedEvents: CreateEvidenceEnvelopeInput[] = [];
    const report = configuredReport(
      runtimeDependencies({
        recordEvidence: (event) => {
          recordedEvents.push(event);
          return { ok: true, path: "/fixture/events.jsonl" };
        },
      }),
    );
    const serializedEvents = JSON.stringify(recordedEvents);

    assert.equal(report.status, "pass");
    assert.deepEqual(report.summary, {
      pass: DENY_HOOK_SCENARIO_COUNT,
      fail: 0,
      unsupported: 0,
      notConfigured: 0,
      error: 0,
    });
    assert.deepEqual(
      recordedEvents.map((event) => event.eventType),
      ["hook.verify", "hook.verify", "hook.verify", "hook.verify"],
    );
    assert.doesNotMatch(
      serializedEvents,
      /git push|cat \.env|curl .* bash|stdout|stderr|raw_tool_output/iu,
    );
  });

  // A safe command being blocked or a risky command being allowed is a real failed proof.
  it("reports an expected-versus-observed mismatch as fail", () => {
    const report = configuredReport(
      runtimeDependencies({ executeProbe: () => ALLOWED_EXECUTION }),
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.fail, 3);
    assert.equal(report.summary.pass, 1);
  });

  // A runner that cannot host the managed hook is reported honestly without spawning anything.
  it("reports unsupported agents without counting a pass", () => {
    let executionCount = 0;
    const report = configuredReport(
      runtimeDependencies({
        readDenyHookState: () => ({
          ...CONFIGURED_HOOK_STATE,
          isSupported: false,
          installed: false,
          scriptPath: null,
          reasonCode: "agent-hook-unsupported",
        }),
        executeProbe: () => {
          executionCount += 1;
          return ALLOWED_EXECUTION;
        },
      }),
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.unsupported, DENY_HOOK_SCENARIO_COUNT);
    assert.equal(report.summary.pass, 0);
    assert.equal(executionCount, 0);
  });

  // A self-test file without the registered managed runtime surface is not configured proof.
  it("does not treat self-test presence as configured runtime evidence", () => {
    const report = configuredReport(
      runtimeDependencies({
        readDenyHookState: () => ({
          ...CONFIGURED_HOOK_STATE,
          installed: false,
          scriptPath: null,
          reasonCode: "hook-not-installed",
        }),
      }),
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.notConfigured, DENY_HOOK_SCENARIO_COUNT);
    assert.equal(report.summary.pass, 0);
  });

  // Missing policy dependencies return exit 2 too, so the unavailable marker must outrank BLOCKED.
  it("classifies an unavailable hook as error instead of a blocked pass", () => {
    const unavailableExecution: HookProbeExecution = {
      ...BLOCKED_EXECUTION,
      stderr: "Policy hook unavailable: required policy file is missing",
    };
    const report = configuredReport(
      runtimeDependencies({ executeProbe: () => unavailableExecution }),
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.error, DENY_HOOK_SCENARIO_COUNT);
    assert.equal(report.summary.pass, 0);
  });

  for (const { name, execution, reasonCode } of [
    {
      name: "reports a timed-out probe with the stable timeout reason",
      execution: { ...BLOCKED_EXECUTION, timedOut: true },
      reasonCode: "probe-timed-out",
    },
    {
      name: "reports a spawn failure with the stable execution-error reason",
      execution: {
        ...ALLOWED_EXECUTION,
        exitCode: null,
        hasSpawnError: true,
      },
      reasonCode: "probe-execution-error",
    },
    {
      name: "gives timeout precedence over simultaneous spawn-error evidence",
      execution: {
        ...BLOCKED_EXECUTION,
        exitCode: null,
        timedOut: true,
        hasSpawnError: true,
      },
      reasonCode: "probe-timed-out",
    },
  ] as const) {
    it(name, () => {
      const report = configuredReport(
        runtimeDependencies({ executeProbe: () => execution }),
      );

      assert.equal(report.status, "fail");
      assert.deepEqual(report.summary, {
        pass: 0,
        fail: 0,
        unsupported: 0,
        notConfigured: 0,
        error: DENY_HOOK_SCENARIO_COUNT,
      });
      for (const scenario of report.scenarios) {
        assert.equal(scenario.observed, "error");
        assert.equal(scenario.verdict, "error");
        assert.equal(scenario.reasonCode, reasonCode);
      }
    });
  }

  // An explicit untrusted-target choice suppresses checkout code execution and records no pass.
  it("skips target hook execution when the user marks the checkout untrusted", () => {
    let executionCount = 0;
    let evidenceRecordCount = 0;
    const report = verifyManagedDenyHook(
      {
        projectPath: "/fixture",
        agent: "codex",
        scenarioGroup: "deny-hook",
        isTargetUntrusted: true,
      },
      runtimeDependencies({
        executeProbe: () => {
          executionCount += 1;
          return ALLOWED_EXECUTION;
        },
        recordEvidence: () => {
          evidenceRecordCount += 1;
          return { ok: true, path: "/fixture/events.jsonl" };
        },
      }),
    );

    assert.equal(report.summary.unsupported, DENY_HOOK_SCENARIO_COUNT);
    assert.equal(report.summary.pass, 0);
    assert.equal(executionCount, 0);
    assert.equal(evidenceRecordCount, 0);
  });

  // A failed event append prevents a probe result from claiming complete local evidence.
  it("reports event-write failure instead of returning an unrecorded pass", () => {
    const report = configuredReport(
      runtimeDependencies({
        recordEvidence: () => ({
          ok: false,
          path: null,
          error: "fixture write failure",
        }),
      }),
    );

    assert.equal(report.status, "fail");
    assert.equal(report.summary.error, DENY_HOOK_SCENARIO_COUNT);
    assert.equal(report.summary.pass, 0);
    assert.equal(report.scenarios[0]?.reasonCode, "evidence-write-failed");
  });

  // Text and JSON explain proof scope without echoing the fixed command operands or hook output.
  it("renders bounded reports without raw command or process output", () => {
    const report = configuredReport(runtimeDependencies());
    const json = renderHookRuntimeReportJson(report);
    const text = renderHookRuntimeReportText(report);

    assert.equal(JSON.parse(json).schema, "goat-flow.hook-runtime-report.v1");
    assert.match(text, /managed hook classifier/iu);
    assert.doesNotMatch(
      `${json}\n${text}`,
      /git push|cat \.env|curl .* bash|BLOCKED: Policy|stdout|stderr/iu,
    );
  });
});
