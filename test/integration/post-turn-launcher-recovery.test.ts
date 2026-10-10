/**
 * Exercises the Stop response an agent receives when infrastructure fails or hook output grows.
 *
 * Each test uses a disposable selected project and the shipped launcher, with no live provider or real user files.
 * Use this matrix to protect bounded retries, actionable findings and byte-safe delivery together.
 */
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";
import { symlinkTestOptions } from "../helpers/symlink-capability.js";
import {
  appendBoundedHookOutput,
  captureHookProcessUntilDeadline,
  compactHookResultEnvelope,
} from "../../workflow/hooks/hook-launch-runtime.mjs";
import {
  adaptHookResultForProvider,
  decodeHookResultOutput,
} from "../../workflow/hooks/hook-provider-adapters.mjs";

const launcherPath = resolve("workflow/hooks/run-with-bash.mjs");
const stopMode = "codex:post-turn:goat-flow.hook-result.v1:turn-stop:1:75000";
const scriptArgument = ".goat-flow/hooks/post-turn-safety.sh";

/** Run one user's Stop event through the canonical launcher; empty input deliberately exercises invalid context.
 *
 * Side effects: the launcher may write one allowance record under the disposable project's `.goat-flow/scratchpad`; nothing outside it changes.
 *
 * @param projectRoot - Disposable selected project; never empty.
 * @param turnId - Explicit user turn, independent of prompt text.
 * @param isContinuation - Whether another hook block resumed the same turn.
 * @param overrides - Optional session, raw input and environment; omitted values use valid fixture context.
 * @returns Completed launcher reply; empty stdout represents a clean provider response only.
 */
function launchStop(
  projectRoot: string,
  turnId: string,
  isContinuation = false,
  overrides: {
    sessionId?: string;
    input?: string;
    environment?: NodeJS.ProcessEnv;
  } = {},
) {
  return spawnSync(process.execPath, [launcherPath, scriptArgument, stopMode], {
    cwd: projectRoot,
    encoding: "utf8",
    timeout: 5000,
    input:
      overrides.input ??
      JSON.stringify({
        hook_event_name: "Stop",
        session_id: overrides.sessionId ?? "fixture-session",
        turn_id: turnId,
        stop_hook_active: isContinuation,
        last_assistant_message: "unchanged content",
      }),
    env: { ...process.env, ...overrides.environment },
  });
}

/** Supply the minimum scanner result so assertions isolate the response a user sees.
 *
 * @param outcome - Scanner decision; pass means the whole declared scope completed.
 * @param message - Actionable finding or infrastructure detail; empty text is not a valid finding.
 * @returns Complete neutral fixture envelope with explicit coverage and execution identity.
 */
function scanResult(
  outcome: "pass" | "block" | "incomplete" | "unavailable",
  message = "Git could not inspect changed files",
) {
  const isComplete = outcome === "pass" || outcome === "block";
  return {
    schema: "goat-flow.hook-result.v1",
    hookId: "post-turn-safety",
    event: "turn-stop",
    outcome,
    coverage: {
      status: isComplete ? "complete" : "none",
      attemptedUnits: 1,
      completedUnits: isComplete ? 1 : 0,
      skippedUnits: isComplete ? 0 : 1,
    },
    reasonCode:
      outcome === "pass"
        ? "completed-clean"
        : outcome === "block"
          ? "policy-blocked"
          : "coverage-incomplete",
    findings:
      outcome === "pass"
        ? []
        : [
            {
              code:
                outcome === "block" ? "secret-pattern" : "coverage-incomplete",
              message,
              target: "changed.php",
            },
          ],
    execution: {
      hookVersion: "fixture",
      provider: "codex",
      providerMode: "managed",
      adapterName: "codex-turn-stop",
      adapterVersion: "1",
      durationMs: 0,
    },
  };
}

/** Write the scanner behavior a user encounters on the next fresh Stop delivery.
 *
 * Side effects: writes the disposable project's hook directory and scanner script; shared user files are never passed.
 *
 * @param projectRoot - Disposable selected project; never empty.
 * @param scriptBody - Bash body; empty emits no result and is intentionally unavailable.
 * @returns No value; replaces only this test's owned script.
 */
function writeScanner(projectRoot: string, scriptBody: string) {
  mkdirSync(join(projectRoot, ".goat-flow/hooks"), { recursive: true });
  mkdirSync(join(projectRoot, ".goat-flow/hooks/vendor"), { recursive: true });
  writeFileSync(
    join(projectRoot, ".goat-flow/hooks/vendor/js-yaml.cjs"),
    readFileSync(resolve("workflow/hooks/vendor/js-yaml.cjs")),
  );
  writeFileSync(
    join(projectRoot, scriptArgument),
    "#!/usr/bin/env bash\n" + scriptBody + "\n",
  );
}

/** Run a test with guaranteed cleanup of its selected project.
 *
 * Side effects: mutates only one temporary project's filesystem and removes it after assertions.
 *
 * @param exercise - Assertions against the user's disposable project; no shared files are passed.
 * @returns No value; test failures still remove the owned fixture directory.
 */
function withProject(exercise: (projectRoot: string) => void) {
  const projectRoot = mkdtempSync(join(tmpdir(), "goat-m13-recovery-"));
  try {
    exercise(projectRoot);
  } finally {
    rmSync(projectRoot, { recursive: true, force: true });
  }
}

/** Require a valid blocking response, as a user would receive after a finding or first infrastructure failure.
 *
 * @param reply - Completed launcher result; empty stdout cannot represent this block.
 * @returns Parsed provider response with an actionable reason.
 */
function assertBlocked(reply: ReturnType<typeof launchStop>) {
  assert.equal(reply.error, undefined);
  assert.equal(reply.status, 0, reply.stderr);
  const response = JSON.parse(reply.stdout);
  assert.equal(response.decision, "block");
  assert.ok(response.reason.length > 0);
  return response;
}

/** Require a visible terminal warning that leaves another hook's block effective.
 *
 * @param reply - Completed launcher result; empty output would hide the unavailable check.
 * @param expectedReason - Recovery classification the user must see.
 * @returns Parsed warning without a stop override.
 */
function assertWarning(
  reply: ReturnType<typeof launchStop>,
  expectedReason = "bounded-reentry-ended",
) {
  assert.equal(reply.error, undefined);
  assert.equal(reply.status, 0, reply.stderr);
  const response = JSON.parse(reply.stdout);
  assert.equal(response.decision, undefined);
  assert.equal(response.continue, undefined);
  assert.match(response.systemMessage, new RegExp(expectedReason));
  assert.match(response.systemMessage, /no clean scan|coverage/i);
  return response;
}

/** Locate this test's retained allowance record without tying assertions to its private filename.
 *
 * @param projectRoot - Disposable selected project; never empty.
 * @returns Owned recovery paths; empty means no retry allowance was persisted.
 */
function recoveryPaths(projectRoot: string) {
  return readdirSync(join(projectRoot, ".goat-flow/scratchpad"))
    .filter((name) => name.startsWith("post-turn-launcher-recovery-v1-"))
    .map((name) => join(projectRoot, ".goat-flow/scratchpad", name));
}

describe("continuation recovery", () => {
  // Both scanner modes must end broken-check retries and still block the user's next real finding.
  for (const scannerMode of ["native", "compatibility"]) {
    it(
      "bounds real " +
        scannerMode +
        " scanner infrastructure and rescans new findings",
      () =>
        withProject((projectRoot) => {
          writeScanner(
            projectRoot,
            readFileSync(resolve("workflow/hooks/post-turn-safety.sh"), "utf8"),
          );
          writeFileSync(
            join(projectRoot, ".goat-flow/hooks/hook-launch-runtime.mjs"),
            readFileSync(resolve("workflow/hooks/hook-launch-runtime.mjs")),
          );
          const environment =
            scannerMode === "compatibility"
              ? { GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK: "1" }
              : {};
          assertBlocked(
            launchStop(projectRoot, "turn-one", false, { environment }),
          );
          assertWarning(
            launchStop(projectRoot, "turn-one", true, { environment }),
          );
          assertWarning(
            launchStop(projectRoot, "turn-one", true, { environment }),
          );
          assert.equal(
            spawnSync("git", ["init", "-q"], { cwd: projectRoot }).status,
            0,
          );
          // Installed projects ignore harness runtime; this fixture must scan only the user's changed file.
          writeFileSync(join(projectRoot, ".gitignore"), ".goat-flow/\n");
          writeFileSync(
            join(projectRoot, "changed.php"),
            "<<<<<<< HEAD\nfirst\n=======\nsecond\n>>>>>>> branch\n",
          );
          assert.match(
            assertBlocked(
              launchStop(projectRoot, "turn-one", true, { environment }),
            ).reason,
            /safety-hazard/,
          );
        }),
    );
  }
  it("blocks a missing scanner once, then warns on every fresh delivery in the same turn", () =>
    withProject((projectRoot) => {
      assertBlocked(launchStop(projectRoot, "turn-one"));
      assertWarning(launchStop(projectRoot, "turn-one", true));
      assertWarning(launchStop(projectRoot, "turn-one", true));
      assertBlocked(launchStop(projectRoot, "turn-two"));
    }));

  it(
    "gives a native Windows host without a POSIX owner the same single retry",
    {
      skip:
        process.platform === "win32"
          ? "simulates host identity; native Windows runs the missing-scanner recovery test"
          : false,
    },
    () =>
      withProject((projectRoot) => {
        const preloadPath = join(projectRoot, "host-identity.mjs");
        /** Writes the host identity preload and returns the environment that loads it before the launcher module. */
        const simulatedHostEnvironment = (preloadSource: string) => {
          writeFileSync(preloadPath, preloadSource);
          return {
            NODE_OPTIONS: `--import=${pathToFileURL(preloadPath).href}`,
          };
        };
        // Native Windows exposes no POSIX owner, so workspace ACLs replace the owner and mode checks.
        const windowsHostEnvironment = simulatedHostEnvironment(
          'Object.defineProperty(process, "platform", { value: "win32" });\nprocess.getuid = undefined;\n',
        );
        assertBlocked(
          launchStop(projectRoot, "turn-one", false, {
            environment: windowsHostEnvironment,
          }),
        );
        assertWarning(
          launchStop(projectRoot, "turn-one", true, {
            environment: windowsHostEnvironment,
          }),
        );
        // Any other host without an ownership check still warns as unavailable instead of guessing a retry.
        const ownerlessNonWindowsEnvironment = simulatedHostEnvironment(
          "process.getuid = undefined;\n",
        );
        assertWarning(
          launchStop(projectRoot, "turn-two", false, {
            environment: ownerlessNonWindowsEnvironment,
          }),
          "state-unavailable",
        );
      }),
  );

  it("does not renew the allowance when infrastructure failures alternate", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      writeScanner(projectRoot, "printf 'not JSON'");
      assertWarning(launchStop(projectRoot, "turn-one", true));
      writeScanner(projectRoot, "sleep 2");
      assertWarning(
        launchStop(projectRoot, "turn-one", true, {
          environment: { GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "40" },
        }),
      );
      assert.equal(recoveryPaths(projectRoot).length, 1);
    }));

  it("rescans changed content and preserves findings after the allowance is spent", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      assertWarning(launchStop(projectRoot, "turn-one", true));
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" + JSON.stringify(scanResult("block")) + "\nRESULT",
      );
      assert.match(
        assertBlocked(launchStop(projectRoot, "turn-one", true)).reason,
        /secret-pattern/,
      );
      writeScanner(projectRoot, "exit 4");
      assertWarning(launchStop(projectRoot, "turn-one", true));
    }));

  it("retains the spent allowance after a clean rescan and duplicate initial delivery", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" + JSON.stringify(scanResult("pass")) + "\nRESULT",
      );
      assert.equal(launchStop(projectRoot, "turn-one", true).stdout, "");
      writeScanner(projectRoot, "exit 3");
      assertWarning(launchStop(projectRoot, "turn-one"));
    }));

  it("removes week-old allowance records when a new explicit turn records its own", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "stale-turn"));
      const [staleRecord] = recoveryPaths(projectRoot);
      const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
      utimesSync(staleRecord, eightDaysAgo, eightDaysAgo);
      assertBlocked(launchStop(projectRoot, "fresh-turn"));
      // Only the week-old record disappears; the record just written for the fresh turn stays.
      assert.equal(recoveryPaths(projectRoot).includes(staleRecord), false);
      assert.equal(recoveryPaths(projectRoot).length, 1);
      // A current record from another turn is never pruned by a later turn.
      assertBlocked(launchStop(projectRoot, "third-turn"));
      assert.equal(recoveryPaths(projectRoot).length, 2);
    }));

  it("keeps declared coverage gaps blocking instead of treating them as infrastructure", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" +
          JSON.stringify(
            scanResult("incomplete", "Some changed files were skipped"),
          ) +
          "\nRESULT",
      );
      assert.match(
        assertBlocked(launchStop(projectRoot, "turn-one", true)).reason,
        /skipped/,
      );
    }));

  it("bounds classified scanner infrastructure through the same launcher allowance", () =>
    withProject((projectRoot) => {
      const result = scanResult("incomplete");
      Object.assign(result.execution, { failureClass: "infrastructure" });
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" + JSON.stringify(result) + "\nRESULT",
      );
      assertBlocked(launchStop(projectRoot, "turn-one"));
      assertWarning(launchStop(projectRoot, "turn-one", true));
      assertWarning(launchStop(projectRoot, "turn-one", true));
    }));

  it("separates projects, interleaved sessions and identical content on new explicit turns", () =>
    withProject((projectRoot) =>
      withProject((otherProject) => {
        writeScanner(projectRoot, "exit 3");
        writeScanner(otherProject, "exit 3");
        assertBlocked(
          launchStop(projectRoot, "same-turn", false, {
            sessionId: "session-a",
          }),
        );
        assertBlocked(
          launchStop(projectRoot, "same-turn", false, {
            sessionId: "session-b",
          }),
        );
        assertBlocked(
          launchStop(otherProject, "same-turn", false, {
            sessionId: "session-a",
          }),
        );
        assertWarning(
          launchStop(projectRoot, "same-turn", true, {
            sessionId: "session-a",
          }),
        );
        assertBlocked(
          launchStop(projectRoot, "new-turn", false, {
            sessionId: "session-a",
          }),
        );
        assertWarning(
          launchStop(projectRoot, "same-turn", true, {
            sessionId: "session-b",
          }),
        );
      }),
    ));

  it("warns without claiming exhaustion when the first observed delivery is already active", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertWarning(
        launchStop(projectRoot, "unobserved-turn", true),
        "state-unavailable",
      );
    }));

  it("forwards accepted Stop bytes unchanged to the scanner", () =>
    withProject((projectRoot) => {
      const input =
        ' { "session_id":"fixture-session", "turn_id":"turn-one", "stop_hook_active":false, "hook_event_name":"Stop" }\n';
      writeScanner(
        projectRoot,
        "cat > accepted-input\ncat <<'RESULT'\n" +
          JSON.stringify(scanResult("pass")) +
          "\nRESULT",
      );
      const reply = launchStop(projectRoot, "turn-one", false, { input });
      assert.equal(reply.status, 0, reply.stderr);
      assert.equal(reply.stdout, "");
      assert.equal(
        readFileSync(join(projectRoot, "accepted-input"), "utf8"),
        input,
      );
    }));

  it("scans a clean project when the Stop payload carries a final message above the old 64 KiB cap", () =>
    withProject((projectRoot) => {
      writeScanner(
        projectRoot,
        readFileSync(resolve("workflow/hooks/post-turn-safety.sh"), "utf8"),
      );
      writeFileSync(
        join(projectRoot, ".goat-flow/hooks/hook-launch-runtime.mjs"),
        readFileSync(resolve("workflow/hooks/hook-launch-runtime.mjs")),
      );
      assert.equal(
        spawnSync("git", ["init", "-q"], { cwd: projectRoot }).status,
        0,
      );
      writeFileSync(join(projectRoot, ".gitignore"), ".goat-flow/\n");
      const reply = launchStop(projectRoot, "long-message-turn", false, {
        input: JSON.stringify({
          hook_event_name: "Stop",
          session_id: "fixture-session",
          turn_id: "long-message-turn",
          stop_hook_active: false,
          last_assistant_message: "x".repeat(200_000),
        }),
      });
      // A long final message is ordinary context, so the real scanner runs and a clean project ends the turn quietly.
      assert.equal(reply.status, 0, reply.stderr);
      assert.equal(reply.stdout, "");
    }));

  it("blocks malformed, oversized, empty and incomplete context before running the scanner", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "touch scanner-ran\nexit 3");
      // An incomplete or oversized host event must not reach the scanner or change this user's files.
      for (const input of [
        "",
        "null",
        "{",
        JSON.stringify({ session_id: "s", stop_hook_active: false }),
        " ".repeat(1_048_577),
      ]) {
        assert.match(
          assertBlocked(launchStop(projectRoot, "turn-one", true, { input }))
            .reason,
          /input-invalid/,
        );
      }
      assert.equal(readdirSync(projectRoot).includes("scanner-ran"), false);
    }));

  it("warns on corrupt or publicly readable state without overwriting it", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      const [statePath] = recoveryPaths(projectRoot);
      writeFileSync(statePath, "corrupt");
      assertWarning(
        launchStop(projectRoot, "turn-one", true),
        "state-unavailable",
      );
      assert.equal(readFileSync(statePath, "utf8"), "corrupt");
      chmodSync(statePath, 0o644);
      assertWarning(
        launchStop(projectRoot, "turn-one", true),
        "state-unavailable",
      );
    }));

  it("refuses a hard-linked allowance without changing its other name", () =>
    withProject((projectRoot) => {
      writeScanner(projectRoot, "exit 3");
      assertBlocked(launchStop(projectRoot, "turn-one"));
      const [statePath] = recoveryPaths(projectRoot);
      linkSync(statePath, join(projectRoot, "other-state-name"));
      const before = readFileSync(statePath);
      assertWarning(
        launchStop(projectRoot, "turn-one", true),
        "state-unavailable",
      );
      assert.deepEqual(readFileSync(statePath), before);
    }));

  it(
    "refuses linked state directories without writing into the linked project",
    symlinkTestOptions(),
    () =>
      withProject((projectRoot) =>
        withProject((otherProject) => {
          writeScanner(projectRoot, "exit 3");
          symlinkSync(
            otherProject,
            join(projectRoot, ".goat-flow/scratchpad"),
            "dir",
          );
          assertWarning(
            launchStop(projectRoot, "turn-one"),
            "state-unavailable",
          );
          assert.deepEqual(readdirSync(otherProject), []);
        }),
      ),
  );
});

describe("output budgets", () => {
  // A controller check may outlive a shorter launcher deadline; verify cleanup rather than only the visible timeout message.
  it(
    "terminates detached controller children at the outer deadline without stopping unrelated work",
    {
      skip:
        process.platform === "win32"
          ? "POSIX process-group cleanup; native Windows uses taskkill"
          : false,
    },
    () =>
      withProject((projectRoot) => {
        const childRoot = join(projectRoot, "child");
        mkdirSync(childRoot);
        assert.equal(
          spawnSync("git", ["init", "-q"], { cwd: childRoot }).status,
          0,
        );
        const scanner = readFileSync(
          resolve("workflow/hooks/post-turn-safety.sh"),
          "utf8",
        ).replace(
          "SECONDS=0\n",
          // Keep Bash's $$ literal; a replacement string would turn the ready PID into a single dollar sign.
          () =>
            'SECONDS=0\nif [ "${GOAT_FLOW_POST_TURN_CONTROLLER_CHILD:-0}" = 1 ]; then\n' +
            'printf "%s" "$$" > child.pid\nsleep 30 &\nprintf "%s" "$!" > sleeper.pid\nwait\nfi\n',
        );
        writeScanner(projectRoot, scanner);
        // Installed controller imports must execute the actual launcher cleanup, including its shared runtime and adapter.
        for (const moduleName of [
          "run-with-bash.mjs",
          "hook-launch-runtime.mjs",
          "hook-provider-adapters.mjs",
        ]) {
          writeFileSync(
            join(projectRoot, ".goat-flow/hooks", moduleName),
            readFileSync(resolve("workflow/hooks", moduleName)),
          );
        }
        writeFileSync(
          join(projectRoot, ".goat-flow/config.yaml"),
          "hooks:\n  post-turn-safety:\n    scan-roots:\n      - child\n",
        );
        const unrelatedWork = spawn(
          process.execPath,
          ["-e", "setInterval(() => {}, 1000)"],
          { detached: true, stdio: "ignore" },
        );
        const unrelatedProcessId = unrelatedWork.pid;
        assert.ok(unrelatedProcessId);
        const ownedChildPids: number[] = [];
        try {
          const reply = launchStop(projectRoot, "cleanup-turn", false, {
            environment: { GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "1200" },
          });
          // Both readiness records are required; an unstarted child cannot prove the user's timeout cleanup works.
          for (const recordName of ["child.pid", "sleeper.pid"]) {
            const readyProcessId = Number(
              readFileSync(join(childRoot, recordName), "utf8"),
            );
            assert.ok(
              Number.isSafeInteger(readyProcessId) && readyProcessId > 0,
              "fixture readiness must identify a real process",
            );
            ownedChildPids.push(readyProcessId);
          }
          assert.match(assertBlocked(reply).reason, /execution-timeout/);
          // A killed process may remain as a zombie until its parent reaps it; neither running nor sleeping work may survive.
          for (const childPid of ownedChildPids) {
            const processState = spawnSync(
              "ps",
              ["-p", String(childPid), "-o", "stat="],
              { encoding: "utf8" },
            );
            assert.equal(processState.error, undefined);
            assert.ok(
              processState.status === 1 ||
                /^Z/u.test(processState.stdout.trim()),
              "owned controller work survived its deadline",
            );
          }
          assert.doesNotThrow(() => process.kill(unrelatedProcessId, 0));
        } finally {
          // A failing regression still removes its known fixture processes; it never targets another user's work.
          try {
            // Confirmed ready PIDs limit cleanup to the child processes owned by this test.
            for (const childPid of ownedChildPids) {
              // Group and direct-PID signals clean a failing fixture; an already-reaped target needs no further action.
              for (const cleanupTarget of [-childPid, childPid]) {
                try {
                  process.kill(cleanupTarget, "SIGKILL");
                } catch (cleanupError) {
                  // The cleanup under test may already have ended this target; report any unexpected failure to stop it.
                  if ((cleanupError as NodeJS.ErrnoException).code !== "ESRCH")
                    throw cleanupError;
                }
              }
            }
          } finally {
            unrelatedWork.kill("SIGKILL");
          }
        }
      }),
  );

  it("preserves controller child findings while draining ordinary diagnostic excess", () =>
    withProject((projectRoot) => {
      const childRoot = join(projectRoot, "child");
      mkdirSync(childRoot);
      assert.equal(
        spawnSync("git", ["init", "-q"], { cwd: childRoot }).status,
        0,
      );
      writeFileSync(
        join(childRoot, "changed.php"),
        "<<<<<<< HEAD\nfirst\n=======\nsecond\n>>>>>>> branch\n",
      );
      const scanner = readFileSync(
        resolve("workflow/hooks/post-turn-safety.sh"),
        "utf8",
      ).replace(
        "SECONDS=0\n",
        'SECONDS=0\nif [ "${GOAT_FLOW_POST_TURN_CONTROLLER_CHILD:-0}" = 1 ]; then\nnode -e \'process.stderr.write("x".repeat(70000))\'\nfi\n',
      );
      writeScanner(projectRoot, scanner);
      // Controller children use the installed launcher for the same process-tree cleanup as a single-project Stop.
      writeFileSync(
        join(projectRoot, ".goat-flow/hooks/run-with-bash.mjs"),
        readFileSync(launcherPath),
      );
      writeFileSync(
        join(projectRoot, ".goat-flow/hooks/hook-launch-runtime.mjs"),
        readFileSync(resolve("workflow/hooks/hook-launch-runtime.mjs")),
      );
      writeFileSync(
        join(projectRoot, ".goat-flow/config.yaml"),
        "hooks:\n  post-turn-safety:\n    scan-roots:\n      - child\n",
      );
      const reply = launchStop(projectRoot, "turn-one");
      const reason = assertBlocked(reply).reason;
      assert.match(reason, /safety-hazard/);
      // The scanner adds its own bounded status diagnostic, so the injected excess is a floor for the exact child total.
      const measuredChildBytes =
        /Child output: exact \d+ stdout \/ (\d+) stderr bytes/.exec(reason);
      assert.ok(Number(measuredChildBytes?.[1] ?? "0") >= 70000);
      assert.ok(Buffer.byteLength(reply.stderr) <= 4096);
    }));
  it("preserves twenty decisive findings and counts envelope omissions once when details are large", () => {
    const result = scanResult("block");
    result.findings = Array.from({ length: 25 }, (_, index) => ({
      code: "safety-hazard",
      message: "Confirmed conflict in changed content " + index,
      target: "資料/".repeat(2200) + index + ".php",
    }));
    const bounded = compactHookResultEnvelope(result);
    // The shared twenty-finding envelope leaves five of the twenty-five detected hazards in its omission count.
    assert.equal(bounded.findings.length, 20);
    assert.equal(bounded.summary.detectedFindings, 25);
    assert.equal(bounded.summary.envelopeOmittedFindings, 5);
    assert.equal(bounded.summary.presentationOmittedFindings, 0);
    assert.ok(Buffer.byteLength(JSON.stringify(bounded) + "\n") <= 65536);
    assert.equal(
      decodeHookResultOutput(JSON.stringify(bounded)).state,
      "valid",
    );
    const delivery = adaptHookResultForProvider(bounded, "codex", "turn-stop");
    assert.equal(delivery.state, "adapted");
    const response = JSON.parse(delivery.stdout);
    assert.equal(response.decision, "block");
    assert.match(response.reason, /5 finding\(s\) omitted from the envelope/);
    assert.match(response.reason, /safety-hazard/);
    assert.ok(Buffer.byteLength(delivery.stdout) <= 10000);
  });
  it("reports exact raw-byte counts while retaining a safe diagnostic prefix", async () => {
    const child = spawn(
      process.execPath,
      [
        "-e",
        'process.stdout.write("ok"); process.stderr.write("漢".repeat(2000));',
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    const result = await captureHookProcessUntilDeadline(
      child,
      { GOAT_FLOW_HOOK_PROVIDER_MODE: "managed" },
      1000,
      process.platform,
      appendBoundedHookOutput,
      (processToStop) => processToStop.kill("SIGKILL"),
    );
    assert.equal(result.status, 0);
    assert.equal(result.output.stdoutBytes, 2);
    // Each of the two thousand diagnostic characters occupies three UTF-8 bytes.
    assert.equal(result.output.stderrBytes, 6000);
    assert.equal(result.output.areByteCountsExact, true);
    assert.equal(result.output.isStderrTruncated, true);
    assert.ok(Buffer.byteLength(result.stderr) <= 4096);
    assert.doesNotMatch(result.stderr, /�/);
  });

  it("cannot use a valid envelope from a child that later times out", () =>
    withProject((projectRoot) => {
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" +
          JSON.stringify(scanResult("pass")) +
          "\nRESULT\nsleep 2",
      );
      assert.match(
        assertBlocked(
          launchStop(projectRoot, "turn-one", false, {
            environment: { GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS: "80" },
          }),
        ).reason,
        /execution-timeout/,
      );
    }));
  it("retains a completed block despite diagnostics exceeding the old shared limit", () =>
    withProject((projectRoot) => {
      writeScanner(
        projectRoot,
        "node -e 'process.stderr.write(\"x\".repeat(12000))'\ncat <<'RESULT'\n" +
          JSON.stringify(scanResult("block")) +
          "\nRESULT",
      );
      const reply = launchStop(projectRoot, "turn-one");
      assert.match(assertBlocked(reply).reason, /secret-pattern/);
      assert.ok(Buffer.byteLength(reply.stderr) <= 4096);
    }));

  it("retains a valid envelope larger than the presentation channel", () =>
    withProject((projectRoot) => {
      const result = scanResult("block", 'quoted "text" 漢字 '.repeat(1600));
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" + JSON.stringify(result) + "\nRESULT",
      );
      const reply = launchStop(projectRoot, "turn-one");
      assert.match(assertBlocked(reply).reason, /secret-pattern/);
      assert.ok(Buffer.byteLength(reply.stdout) <= 10000);
      assert.doesNotThrow(() => JSON.parse(reply.stdout));
    }));

  it("keeps a diagnostic flood unavailable even when valid JSON arrived first", () =>
    withProject((projectRoot) => {
      writeScanner(
        projectRoot,
        "cat <<'RESULT'\n" +
          JSON.stringify(scanResult("pass")) +
          "\nRESULT\nnode -e 'process.stderr.write(\"x\".repeat(1048577))'",
      );
      assert.match(
        assertBlocked(launchStop(projectRoot, "turn-one")).reason,
        /flood|limit/,
      );
    }));

  it("rejects incomplete child completion, empty output and multiple envelopes", () =>
    withProject((projectRoot) => {
      // A child with no result, two results or a failed exit cannot claim the user's safety check completed.
      for (const body of [
        "exit 0",
        "printf '{}{}'",
        "cat <<'RESULT'\n" +
          JSON.stringify(scanResult("pass")) +
          "\nRESULT\nexit 3",
      ]) {
        writeScanner(projectRoot, body);
        assertBlocked(launchStop(projectRoot, "turn-" + body.length));
      }
    }));

  it("keeps complete coverage and a decisive code when provider JSON must be summarized", () => {
    const result = scanResult("block", '"quoted" \\ 漢字 '.repeat(2000));
    const decoded = decodeHookResultOutput(JSON.stringify(result));
    assert.equal(decoded.state, "valid");
    const response = adaptHookResultForProvider(result, "codex", "turn-stop");
    assert.equal(response.state, "adapted");
    assert.match(JSON.parse(response.stdout).reason, /secret-pattern/);
    assert.match(JSON.parse(response.stdout).reason, /complete/);
    assert.ok(Buffer.byteLength(response.stdout) <= 10000);
  });
});

describe("UTF-8", () => {
  it("rejects damaged UTF-8 instead of accepting replacement characters inside a JSON message", () =>
    withProject((projectRoot) => {
      const bytes = Buffer.from(JSON.stringify(scanResult("block")));
      const messageOffset = bytes.indexOf(Buffer.from("Git could"));
      bytes[messageOffset] = 0xff;
      writeScanner(
        projectRoot,
        "node -e 'process.stdout.write(Buffer.from(\"" +
          bytes.toString("base64") +
          '", "base64"))\'',
      );
      assert.match(
        assertBlocked(launchStop(projectRoot, "turn-one")).reason,
        /not valid UTF-8/,
      );
    }));
  it("keeps identical managed stdout at the raw-byte ceiling across every character split", () => {
    const rawBytes = Buffer.from("a".repeat(65532) + "🐐");
    // A provider may split the final character anywhere; the user's finding text and byte limit must stay the same.
    for (
      let splitIndex = 65532;
      splitIndex < rawBytes.length;
      splitIndex += 1
    ) {
      const captured = { stdout: "", stderr: "", managed: true };
      assert.equal(
        appendBoundedHookOutput(
          captured,
          "stdout",
          rawBytes.subarray(0, splitIndex),
        ),
        true,
      );
      assert.equal(
        appendBoundedHookOutput(
          captured,
          "stdout",
          rawBytes.subarray(splitIndex),
        ),
        true,
      );
      assert.equal(captured.stdout, rawBytes.toString("utf8"));
      assert.equal(
        appendBoundedHookOutput(captured, "stdout", Buffer.from("x")),
        false,
      );
    }
  });
});
