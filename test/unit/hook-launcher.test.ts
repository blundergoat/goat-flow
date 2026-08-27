/**
 * How managed hooks behave after an agent launches them: deadlines bound the user's wait,
 * response modes stay stable, and unsafe script shapes fail closed.
 * Every case runs the canonical launcher against a disposable project so the result matches
 * what an agent and user would see without touching a real project.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { windowsTaskkillExecutablePath } from "../../workflow/hooks/run-with-bash.mjs";
import {
  describeInvalidHookLaunchTimeout,
  resolveHookLaunchTimeoutMs,
} from "../../workflow/hooks/hook-launch-runtime.mjs";
import {
  HOOK_RESULT_OUTPUT_LIMIT_BYTES,
  HOOK_RESULT_SCHEMA,
} from "../../workflow/hooks/hook-provider-adapters.mjs";

import {
  HOOK_TIMEOUT_MODES,
  launcherDiagnostics,
  withTempProject,
} from "./hook-registrar.helpers.js";

describe("hook launcher script validation", () => {
  const HOOK_LAUNCHER_PATH = resolve(
    import.meta.dirname,
    "..",
    "..",
    "workflow",
    "hooks",
    "run-with-bash.mjs",
  );

  /**
   * Run the canonical launcher exactly as agent configs do.
   * Use this to observe the status and message an agent receives from a fixture hook.
   *
   * @param fixtureProjectPath - Non-empty project path; an empty path cannot host the fixture hook.
   * @param hookScriptRelativePath - Non-empty managed hook path shown to the launcher.
   * @param responseMode - Agent response format; empty or omitted uses fail-closed policy output.
   * @param hookEnvironment - Launch environment; missing keys keep the user's current environment.
   * @returns Completed launcher result; empty output is valid for a hook that has nothing to report.
   */
  function runLauncherProcess(
    fixtureProjectPath: string,
    hookScriptRelativePath: string,
    responseMode = "policy",
    hookEnvironment: NodeJS.ProcessEnv = process.env,
  ) {
    return spawnSync(
      process.execPath,
      [HOOK_LAUNCHER_PATH, hookScriptRelativePath, responseMode],
      {
        cwd: fixtureProjectPath,
        encoding: "utf8" as const,
        env: hookEnvironment,
      },
    );
  }

  /**
   * Create the managed hooks directory inside a fixture project.
   * Use this before writing the hook a simulated agent will launch.
   * Side effect: writes only the fixture directory tree the test removes afterward.
   *
   * @param fixtureProjectPath - Non-empty project path; empty would escape the intended fixture.
   * @returns Created hook directory; never empty because it is rooted in the fixture project.
   */
  function createManagedHookDirectory(fixtureProjectPath: string): string {
    const managedHookDirectoryPath = join(
      fixtureProjectPath,
      ".goat-flow",
      "hooks",
    );
    mkdirSync(managedHookDirectoryPath, { recursive: true });
    return managedHookDirectoryPath;
  }

  /**
   * Write a hook that exits immediately and return the path an agent would launch.
   * Use this when only timeout configuration, not hook work, is under test.
   * Side effects: writes one executable-shaped script inside the disposable project.
   *
   * @param fixtureProjectPath - Non-empty fixture root; empty would escape test cleanup.
   * @returns Non-empty project-relative hook path used by the launcher.
   */
  function writeQuickHook(fixtureProjectPath: string): string {
    const hookScriptRelativePath = ".goat-flow/hooks/quick.sh";
    const managedHookDirectoryPath =
      createManagedHookDirectory(fixtureProjectPath);
    writeFileSync(
      join(managedHookDirectoryPath, "quick.sh"),
      "#!/usr/bin/env bash\nexit 0\n",
    );
    return hookScriptRelativePath;
  }

  /** Proves Windows cleanup uses the OS utility instead of a project-local executable. */
  it("resolves Windows tree termination from the system root", () => {
    assert.equal(
      windowsTaskkillExecutablePath({ SystemRoot: "D:\\Windows" }),
      "D:\\Windows\\System32\\taskkill.exe",
    );
    // An empty primary value still lets the user's host supply its equivalent WINDIR setting.
    assert.equal(
      windowsTaskkillExecutablePath({
        SystemRoot: "",
        WINDIR: "E:\\Windows",
      }),
      "E:\\Windows\\System32\\taskkill.exe",
    );
    // A missing system root must not turn project PATH or cwd into an executable source.
    assert.equal(windowsTaskkillExecutablePath({}), null);
    // A relative root could name a project folder, so it is rejected like a missing value.
    assert.equal(
      windowsTaskkillExecutablePath({ SystemRoot: "project-tools" }),
      null,
    );
  });

  // Every supported agent mode must turn the same deadline into its own user-facing response.
  for (const fixture of HOOK_TIMEOUT_MODES) {
    /**
     * Starts a disposable busy-loop hook because every agent mode must render the same deadline.
     * Fixture purpose: exposes the exact timeout status and message a user receives.
     */
    it(`bounds ${fixture.mode} hooks with a timeout-specific response`, () => {
      withTempProject((root) => {
        const scriptRel = ".goat-flow/hooks/slow.sh";
        const hookDir = createManagedHookDirectory(root);
        writeFileSync(
          join(hookDir, "slow.sh"),
          "#!/usr/bin/env bash\nwhile :; do :; done\n",
        );
        const startedAt = Date.now();
        const result = runLauncherProcess(root, scriptRel, fixture.mode, {
          ...process.env,
          GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "1",
        });

        assert.equal(
          result.status,
          fixture.status,
          launcherDiagnostics(result),
        );
        assert.match(result[fixture.stream], fixture.pattern);
        assert.match(
          result[fixture.stream],
          /exceeded its deadline; process-tree termination was requested/u,
        );
        assert.ok(Date.now() - startedAt < 1_500, launcherDiagnostics(result));
      });
    });
  }

  /*
   * A user's hook may start a formatter child before its deadline expires.
   * The agent must receive its timeout response without waiting for that child to finish.
   * Fixture purpose: the marker distinguishes a started child from an early Bash kill.
   * Side effects: writes a marker and starts a sleeping child inside a disposable project.
   */
  it("returns promptly after a started hook descendant exceeds its deadline", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/started-child.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      const childStartedMarkerPath = join(
        managedHookDirectoryPath,
        "child-started.marker",
      );
      // Fixture purpose: the marker proves a user's slower formatter child started before timeout.
      writeFileSync(
        join(managedHookDirectoryPath, "started-child.sh"),
        "#!/usr/bin/env bash\nsleep 2 &\nprintf 'started\\n' > .goat-flow/hooks/child-started.marker\nwait\n",
      );
      const launchStartedAt = Date.now();
      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        "gruff",
        {
          ...process.env,
          GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "250",
        },
      );
      const userWaitMilliseconds = Date.now() - launchStartedAt;

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      assert.match(
        launcherResult.stderr,
        /exceeded its deadline; process-tree termination was requested/u,
      );
      assert.equal(readFileSync(childStartedMarkerPath, "utf8"), "started\n");
      assert.ok(
        userWaitMilliseconds < 1_500,
        `${launcherDiagnostics(launcherResult)}\nelapsed_ms=${userWaitMilliseconds}`,
      );
    });
  });

  // Fixture purpose: prove direct output parity. Side effects: writes and starts one script.
  it("preserves legacy hook output without adapter translation", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/legacy-output.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      writeFileSync(
        join(managedHookDirectoryPath, "legacy-output.sh"),
        "#!/usr/bin/env bash\nprintf 'legacy stdout\\n'\nprintf 'legacy stderr\\n' >&2\nexit 0\n",
      );

      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        "gruff",
      );

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      assert.equal(launcherResult.stdout, "legacy stdout\n");
      assert.equal(launcherResult.stderr, "legacy stderr\n");
    });
  });

  // Fixture purpose: prove Claude-visible advice. Side effects: writes and starts one script.
  it("adapts a bounded neutral result at the final launcher boundary", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/envelope-result.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      const hookResultEnvelope = JSON.stringify({
        schema: HOOK_RESULT_SCHEMA,
        hookId: "fixture-quality",
        event: "post-tool",
        outcome: "advisory",
        coverage: {
          status: "complete",
          attemptedUnits: 1,
          completedUnits: 1,
          skippedUnits: 0,
        },
        reasonCode: "findings-reported",
        findings: [
          {
            code: "fixture-finding",
            message: "Review the changed file",
            target: "src/example.ts",
          },
        ],
        execution: {
          hookVersion: "1.15.1",
          provider: "claude",
          providerMode: "fixture",
          adapterName: "claude-post-tool",
          adapterVersion: "1",
          durationMs: 12,
        },
      });
      writeFileSync(
        join(managedHookDirectoryPath, "envelope-result.sh"),
        `#!/usr/bin/env bash\nprintf '%s\\n' '${hookResultEnvelope}'\n`,
      );

      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        `claude:gruff:${HOOK_RESULT_SCHEMA}:post-tool:1:75000`,
      );

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      assert.match(launcherResult.stdout, /"hookEventName":"PostToolUse"/u);
      assert.match(launcherResult.stdout, /"additionalContext"/u);
      assert.doesNotMatch(launcherResult.stdout, /"schema"/u);
    });
  });

  /**
   * Prove hooks receive registry-owned identity because ambient user values are untrusted.
   * Side effects: writes and starts one hook, which writes a disposable environment receipt.
   */
  it("injects the decoded provider contract into migrated hook execution", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/environment-result.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      const environmentReceiptPath = join(
        fixtureProjectPath,
        "hook-environment-receipt.txt",
      );
      const cleanHookResult = JSON.stringify({
        schema: HOOK_RESULT_SCHEMA,
        hookId: "fixture-quality",
        event: "post-tool",
        outcome: "pass",
        coverage: {
          status: "complete",
          attemptedUnits: 1,
          completedUnits: 1,
          skippedUnits: 0,
        },
        reasonCode: "completed-clean",
        findings: [],
        execution: {
          hookVersion: "1.15.1",
          provider: "claude",
          providerMode: "managed",
          adapterName: "claude-post-tool",
          adapterVersion: "1",
          durationMs: 1,
        },
      });
      writeFileSync(
        join(managedHookDirectoryPath, "environment-result.sh"),
        [
          "#!/usr/bin/env bash",
          `printf '%s\\n' \"$GOAT_FLOW_HOOK_PROVIDER|$GOAT_FLOW_HOOK_EVENT|$GOAT_FLOW_HOOK_PROVIDER_MODE|$GOAT_FLOW_HOOK_ADAPTER_VERSION|$GOAT_FLOW_HOOK_RESULT_PROTOCOL\" > '${environmentReceiptPath}'`,
          `printf '%s\\n' '${cleanHookResult}'`,
          "",
        ].join("\n"),
      );

      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        `claude:gruff:${HOOK_RESULT_SCHEMA}:post-tool:1:75000`,
        {
          ...process.env,
          GOAT_FLOW_HOOK_PROVIDER: "untrusted-ambient-value",
        },
      );

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      assert.equal(
        readFileSync(environmentReceiptPath, "utf8"),
        `claude|post-tool|managed|1|${HOOK_RESULT_SCHEMA}\n`,
      );
    });
  });

  // Fixture purpose: reject old plain output. Side effects: writes and starts one script.
  it("reports migrated legacy output as unavailable", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/malformed-result.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      writeFileSync(
        join(managedHookDirectoryPath, "malformed-result.sh"),
        "#!/usr/bin/env bash\nprintf 'legacy finding\\n'\n",
      );

      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        `claude:gruff:${HOOK_RESULT_SCHEMA}:post-tool:1:75000`,
      );

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      const providerResponse = JSON.parse(launcherResult.stdout) as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      const modelVisibleContext =
        providerResponse.hookSpecificOutput?.additionalContext ?? "";
      // Empty context would hide the malformed legacy result from the active coding agent.
      assert.notEqual(modelVisibleContext, "");
      assert.match(modelVisibleContext, /gruff-code-quality: UNAVAILABLE/iu);
      assert.match(modelVisibleContext, /adapter-delivery-failed/iu);
      assert.match(modelVisibleContext, /not one JSON object/iu);
      assert.equal(launcherResult.stderr, "");
    });
  });

  // Fixture purpose: bound flooded stdout. Side effects: starts and stops one script.
  it("stops migrated child output beyond the shared result limit", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = ".goat-flow/hooks/oversized-result.sh";
      const managedHookDirectoryPath =
        createManagedHookDirectory(fixtureProjectPath);
      const oversizedHookOutput = "x".repeat(
        HOOK_RESULT_OUTPUT_LIMIT_BYTES + 1,
      );
      writeFileSync(
        join(managedHookDirectoryPath, "oversized-result.sh"),
        `#!/usr/bin/env bash\nprintf '%s' '${oversizedHookOutput}'\n`,
      );

      const launcherResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        `claude:gruff:${HOOK_RESULT_SCHEMA}:post-tool:1:75000`,
      );

      assert.equal(
        launcherResult.status,
        0,
        launcherDiagnostics(launcherResult),
      );
      const providerResponse = JSON.parse(launcherResult.stdout) as {
        hookSpecificOutput?: { additionalContext?: string };
      };
      const modelVisibleContext =
        providerResponse.hookSpecificOutput?.additionalContext ?? "";
      // Empty context would make an output flood look clean after the launcher stops it.
      assert.notEqual(modelVisibleContext, "");
      assert.match(modelVisibleContext, /gruff-code-quality: UNAVAILABLE/iu);
      assert.match(modelVisibleContext, /adapter-delivery-failed/iu);
      assert.match(modelVisibleContext, /exceeded the 10000-byte limit/iu);
      assert.equal(launcherResult.stderr, "");
    });
  });

  const invalidPolicyTimeoutValues = ["0", "1.5", "+1", " 1", "invalid"];
  // Separate names show exactly which mistyped user setting stopped being rejected.
  for (const invalidTimeoutMilliseconds of invalidPolicyTimeoutValues) {
    /** Starts a disposable quick hook because malformed settings must fail before user work begins. */
    it(`rejects invalid policy timeout ${JSON.stringify(invalidTimeoutMilliseconds)}`, () => {
      withTempProject((fixtureProjectPath) => {
        const hookScriptRelativePath = writeQuickHook(fixtureProjectPath);
        const launcherResult = runLauncherProcess(
          fixtureProjectPath,
          hookScriptRelativePath,
          "policy",
          {
            ...process.env,
            GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: invalidTimeoutMilliseconds,
          },
        );

        assert.equal(
          launcherResult.status,
          2,
          launcherDiagnostics(launcherResult),
        );
        // The message must let the user repair the one setting without reading launcher source.
        assert.match(
          launcherResult.stderr,
          /timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS=.+ must be a whole number of milliseconds from 1 to 25000/u,
        );
        assert.ok(
          launcherResult.stderr.includes(
            JSON.stringify(invalidTimeoutMilliseconds),
          ),
          `stderr should quote the rejected value: ${launcherResult.stderr}`,
        );
      });
    });
  }

  // `export VAR=` and an oversized value are ordinary shell states; either one used to wedge every tool call.
  const usableNonLoweringTimeoutValues = ["", "25001", "99999999999999999999"];
  for (const usableTimeoutMilliseconds of usableNonLoweringTimeoutValues) {
    /** Starts a disposable quick hook to prove an empty or oversized override still runs the policy hook. */
    it(`accepts policy timeout override ${JSON.stringify(usableTimeoutMilliseconds)} without blocking the command`, () => {
      withTempProject((fixtureProjectPath) => {
        const hookScriptRelativePath = writeQuickHook(fixtureProjectPath);
        const launcherResult = runLauncherProcess(
          fixtureProjectPath,
          hookScriptRelativePath,
          "policy",
          {
            ...process.env,
            GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: usableTimeoutMilliseconds,
          },
        );

        assert.equal(
          launcherResult.status,
          0,
          launcherDiagnostics(launcherResult),
        );
        assert.equal(launcherResult.stderr, "");
      });
    });
  }

  it("resolves missing, empty, lower, and oversized overrides against the policy ceiling", () => {
    const policyCeiling = 25_000;
    // Missing and empty are the same shell state and both mean "use the ceiling".
    assert.equal(resolveHookLaunchTimeoutMs(policyCeiling, {}), policyCeiling);
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "",
      }),
      policyCeiling,
    );
    // A lower value is honoured; a higher one is clamped rather than turned into an outage.
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "5000",
      }),
      5_000,
    );
    assert.equal(
      resolveHookLaunchTimeoutMs(policyCeiling, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "25001",
      }),
      policyCeiling,
    );
  });

  // Separate names show which malformed shape stopped being rejected by the resolver itself.
  for (const malformedTimeoutValue of ["0", "abc", "1.5", "+1", " 1"]) {
    it(`resolver rejects malformed override ${JSON.stringify(malformedTimeoutValue)}`, () => {
      assert.equal(
        resolveHookLaunchTimeoutMs(25_000, {
          GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: malformedTimeoutValue,
        }),
        null,
      );
    });
  }

  it("names the variable, value, and accepted range when an override is rejected", () => {
    assert.equal(
      describeInvalidHookLaunchTimeout(25_000, {
        GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "abc",
      }),
      'hook timeout configuration is invalid: GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS="abc" must be a whole number of milliseconds from 1 to 25000',
    );
  });

  /** Starts a disposable quick hook to prove the user's policy ceiling remains accepted. */
  it("accepts the policy timeout ceiling", () => {
    withTempProject((fixtureProjectPath) => {
      const hookScriptRelativePath = writeQuickHook(fixtureProjectPath);
      const policyCeilingResult = runLauncherProcess(
        fixtureProjectPath,
        hookScriptRelativePath,
        "policy",
        {
          ...process.env,
          GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "25000",
        },
      );
      assert.equal(
        policyCeilingResult.status,
        0,
        launcherDiagnostics(policyCeilingResult),
      );
    });
  });

  const feedbackResponseModes = ["gruff", "post-turn"];
  // Separate names show whether a user-facing feedback mode changed its larger ceiling.
  for (const feedbackResponseMode of feedbackResponseModes) {
    /** Starts a disposable quick hook to prove the documented feedback ceiling remains usable. */
    it(`accepts the ${feedbackResponseMode} timeout ceiling`, () => {
      withTempProject((fixtureProjectPath) => {
        const hookScriptRelativePath = writeQuickHook(fixtureProjectPath);
        const launcherResult = runLauncherProcess(
          fixtureProjectPath,
          hookScriptRelativePath,
          feedbackResponseMode,
          {
            ...process.env,
            GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "75000",
          },
        );

        assert.equal(
          launcherResult.status,
          0,
          launcherDiagnostics(launcherResult),
        );
      });
    });

    /** Starts a disposable quick hook because a value above the feedback ceiling must clamp, not stop the turn. */
    it(`clamps values above the ${feedbackResponseMode} timeout ceiling instead of failing closed`, () => {
      withTempProject((fixtureProjectPath) => {
        const hookScriptRelativePath = writeQuickHook(fixtureProjectPath);
        const launcherResult = runLauncherProcess(
          fixtureProjectPath,
          hookScriptRelativePath,
          feedbackResponseMode,
          {
            ...process.env,
            GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "75001",
          },
        );

        assert.equal(
          launcherResult.status,
          0,
          launcherDiagnostics(launcherResult),
        );
        assert.doesNotMatch(
          `${launcherResult.stdout}${launcherResult.stderr}`,
          /timeout configuration is invalid/u,
        );
      });
    });
  }

  it("fails closed when the managed hook script is a symlink", () => {
    withTempProject((root) => {
      const hookDir = createManagedHookDirectory(root);
      const redirectTarget = join(root, "innocent-looking.sh");
      writeFileSync(redirectTarget, "#!/usr/bin/env bash\nexit 0\n");
      symlinkSync(redirectTarget, join(hookDir, "deny-dangerous.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /symlink/u);
    });
  });

  it("fails closed when the managed hook path is not a regular file", () => {
    withTempProject((root) => {
      const hookDir = createManagedHookDirectory(root);
      mkdirSync(join(hookDir, "deny-dangerous.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /regular file/u);
    });
  });

  it("fails closed when the managed hook script has extra hard links", () => {
    withTempProject((root) => {
      const hookDir = createManagedHookDirectory(root);
      const scriptPath = join(hookDir, "deny-dangerous.sh");
      writeFileSync(scriptPath, "#!/usr/bin/env bash\nexit 0\n");
      linkSync(scriptPath, join(root, "second-name.sh"));

      const result = runLauncherProcess(
        root,
        ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.equal(result.status, 2, launcherDiagnostics(result));
      assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
      assert.match(result.stderr, /hard link/u);
    });
  });

  // The hook path text stays inside the project, so only resolving the symlinked parent directory
  // reveals that the script really lives elsewhere. This fixture writes a project plus an outside
  // directory and spawns the launcher, because path text alone cannot prove containment.
  it("fails closed when a symlinked parent directory escapes the project root", () => {
    withTempProject((root) => {
      const outsideHooks = mkdtempSync(join(tmpdir(), "goat-flow-outside-"));
      try {
        writeFileSync(
          join(outsideHooks, "deny-dangerous.sh"),
          "#!/usr/bin/env bash\nexit 0\n",
        );
        mkdirSync(join(root, ".goat-flow"), { recursive: true });
        symlinkSync(outsideHooks, join(root, ".goat-flow", "hooks"));

        const result = runLauncherProcess(
          root,
          ".goat-flow/hooks/deny-dangerous.sh",
        );
        assert.equal(result.status, 2, launcherDiagnostics(result));
        assert.match(result.stderr, /BLOCKED: Policy hook unavailable/u);
        assert.match(result.stderr, /escaped the project root/u);
      } finally {
        rmSync(outsideHooks, { recursive: true, force: true });
      }
    });
  });

  /*
   * Fixture purpose: invokes the launcher and an in-project hook through symlinked root spellings,
   * then writes an outside control target to prove physical normalization does not widen trust.
   * Side effects: creates and removes symlink hosts plus child Node and Bash processes.
   */
  it("executes through a symlinked project root while rejecting a physical escape", () => {
    withTempProject((root) => {
      const linkedHookExitStatus = 7;
      const linkHost = mkdtempSync(join(tmpdir(), "goat-flow-linked-root-"));
      const outsideHooks = mkdtempSync(join(tmpdir(), "goat-flow-outside-"));
      try {
        const hookDir = createManagedHookDirectory(root);
        const hookPath = join(hookDir, "exit-seven.sh");
        writeFileSync(
          hookPath,
          `#!/usr/bin/env bash\nprintf 'linked launch ran\\n'\nexit ${linkedHookExitStatus}\n`,
        );
        const linkedProjectRoot = join(linkHost, "project");
        const linkedLauncherPath = join(linkHost, "run-with-bash.mjs");
        symlinkSync(root, linkedProjectRoot, "dir");
        symlinkSync(HOOK_LAUNCHER_PATH, linkedLauncherPath);

        const linkedResult = spawnSync(
          process.execPath,
          [
            linkedLauncherPath,
            join(linkedProjectRoot, ".goat-flow", "hooks", "exit-seven.sh"),
            "gruff",
          ],
          {
            cwd: linkedProjectRoot,
            encoding: "utf8",
          },
        );
        assert.equal(
          linkedResult.status,
          linkedHookExitStatus,
          launcherDiagnostics(linkedResult),
        );
        assert.equal(linkedResult.stdout, "linked launch ran\n");

        writeFileSync(
          join(outsideHooks, "outside.sh"),
          "#!/usr/bin/env bash\nexit 0\n",
        );
        symlinkSync(outsideHooks, join(root, "outside-hooks"), "dir");
        const escapingResult = spawnSync(
          process.execPath,
          [
            linkedLauncherPath,
            join(linkedProjectRoot, "outside-hooks", "outside.sh"),
            "policy",
          ],
          {
            cwd: linkedProjectRoot,
            encoding: "utf8",
          },
        );
        assert.equal(
          escapingResult.status,
          2,
          launcherDiagnostics(escapingResult),
        );
        assert.match(escapingResult.stderr, /escaped the project root/u);
      } finally {
        rmSync(linkHost, { recursive: true, force: true });
        rmSync(outsideHooks, { recursive: true, force: true });
      }
    });
  });
});
