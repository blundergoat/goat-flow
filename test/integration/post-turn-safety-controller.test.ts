/**
 * Controller-root integration coverage for post-turn-safety.
 * These cases use real independent Git repositories beneath one non-Git directory.
 */
import assert from "node:assert/strict";
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import {
  buildStopPayload,
  createCommittedRepo,
  FORCE_BASH3_ENV_KEY,
  TEST_API_TOKEN,
  withCommandShim,
  withTempController,
  writeFile,
  writePostTurnScanRoots,
  runHook,
  withTempRepo,
} from "./post-turn-safety-hook.helpers.js";

const POST_TURN_SCANNER_VARIANTS = [
  { displayName: "native scanner", forceBash3Fallback: "0" },
  { displayName: "Bash 3 compatibility scanner", forceBash3Fallback: "1" },
] as const;

const MANAGED_STOP_ENV = {
  GOAT_FLOW_HOOK_PROVIDER: "codex",
  GOAT_FLOW_HOOK_EVENT: "turn-stop",
  GOAT_FLOW_HOOK_PROVIDER_MODE: "managed",
  GOAT_FLOW_HOOK_ADAPTER_VERSION: "1",
  GOAT_FLOW_HOOK_RESULT_PROTOCOL: "goat-flow.hook-result.v1",
};

// Assert the hook returned a usable managed envelope, since an empty or failed response would leave the agent with no decision.
function assertManagedEnvelope(result: ReturnType<typeof runHook>) {
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
}

describe("post-turn-safety hook: explicit non-Git controller roots", () => {
  for (const scannerVariant of POST_TURN_SCANNER_VARIANTS) {
    it(`aggregates clean configured repositories with the ${scannerVariant.displayName}`, () => {
      withTempController(["gruff-go", "gruff-php"], (controllerRoot) => {
        const result = runHook(
          controllerRoot,
          {
            ...MANAGED_STOP_ENV,
            [FORCE_BASH3_ENV_KEY]: scannerVariant.forceBash3Fallback,
          },
          buildStopPayload("controller-clean", false),
        );
        const envelope = assertManagedEnvelope(result);

        assert.equal(envelope.outcome, "pass");
        assert.deepEqual(envelope.coverage, {
          status: "complete",
          attemptedUnits: 2,
          completedUnits: 2,
          skippedUnits: 0,
        });
        assert.deepEqual(envelope.findings, []);
      });
    });
  }

  it("prefixes a child finding and keeps aggregate coverage complete", () => {
    withTempController(
      ["gruff-go", "gruff-php"],
      (controllerRoot, childRoots) => {
        writeFile(
          childRoots["gruff-php"],
          ".env",
          `API_KEY=${TEST_API_TOKEN}\n`,
        );

        const result = runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-finding", false),
        );
        const envelope = assertManagedEnvelope(result);

        assert.equal(envelope.outcome, "block");
        assert.deepEqual(envelope.coverage, {
          status: "complete",
          attemptedUnits: 2,
          completedUnits: 2,
          skippedUnits: 0,
        });
        assert.ok(envelope.findings.length > 0);
        assert.equal(
          envelope.findings.every(
            (finding: { target: string }) =>
              finding.target === "gruff-php/.env",
          ),
          true,
        );
        assert.equal(result.stdout.includes(TEST_API_TOKEN), false);
      },
    );
  });

  it("preserves the direct shell status contract for controller findings", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      writeFile(childRoots["gruff-go"], ".env", `API_KEY=${TEST_API_TOKEN}\n`);

      const result = runHook(controllerRoot);

      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /gruff-go\/\.env/u);
      assert.equal(result.stderr.includes(TEST_API_TOKEN), false);
    });
  });

  it("keeps one incomplete child visible in aggregate coverage", () => {
    withTempController(
      ["gruff-go", "gruff-php"],
      (controllerRoot, childRoots) => {
        writeFile(
          childRoots["gruff-php"],
          "binary.dat",
          Buffer.from([0, 98, 105, 110, 97, 114, 121, 10]),
        );

        const result = runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-incomplete", false),
        );
        const envelope = assertManagedEnvelope(result);

        assert.equal(envelope.outcome, "incomplete");
        assert.deepEqual(envelope.coverage, {
          status: "partial",
          attemptedUnits: 2,
          completedUnits: 1,
          skippedUnits: 1,
        });
        assert.equal(envelope.findings[0].target, "gruff-php/binary.dat");
      },
    );
  });

  it("ends one unchanged child command failure only on its active re-entry", () => {
    withTempController(["gruff-go"], (controllerRoot) => {
      withCommandShim(
        "git",
        'if [ "${1:-}" = diff ]; then exit 70; fi',
        (shimEnvironment) => {
          const sessionIdentifier = "controller-command-failure";
          const firstResult = assertManagedEnvelope(
            runHook(
              controllerRoot,
              { ...MANAGED_STOP_ENV, ...shimEnvironment },
              buildStopPayload(sessionIdentifier, false),
            ),
          );
          assert.equal(firstResult.reasonCode, "coverage-incomplete");

          const repeatedResult = assertManagedEnvelope(
            runHook(
              controllerRoot,
              { ...MANAGED_STOP_ENV, ...shimEnvironment },
              buildStopPayload(sessionIdentifier, true),
            ),
          );
          assert.equal(repeatedResult.outcome, "incomplete");
          assert.equal(repeatedResult.reasonCode, "bounded-reentry-ended");

          const nextResult = assertManagedEnvelope(
            runHook(
              controllerRoot,
              { ...MANAGED_STOP_ENV, ...shimEnvironment },
              buildStopPayload(sessionIdentifier, true),
            ),
          );
          assert.equal(nextResult.reasonCode, "coverage-incomplete");
        },
      );
    });
  });

  it("ends an exhausted child re-entry on a legacy host with no provider adapter", () => {
    withTempController(["gruff-go"], (controllerRoot) => {
      withCommandShim(
        "git",
        'if [ "${1:-}" = diff ]; then exit 70; fi',
        (shimEnvironment) => {
          const sessionIdentifier = "controller-legacy-reentry";
          const firstResult = runHook(
            controllerRoot,
            shimEnvironment,
            buildStopPayload(sessionIdentifier, false),
          );
          assert.equal(firstResult.status, 2, firstResult.stderr);
          assert.match(firstResult.stderr, /controller scan incomplete/u);

          // Without the adapter the controller must end its own cycle, or the turn never stops.
          const repeatedResult = runHook(
            controllerRoot,
            shimEnvironment,
            buildStopPayload(sessionIdentifier, true),
          );
          assert.equal(repeatedResult.status, 0, repeatedResult.stderr);
          assert.match(repeatedResult.stderr, /ending repeated Stop/u);
          assert.doesNotMatch(
            repeatedResult.stderr,
            /controller scan incomplete/u,
          );
        },
      );
    });
  });

  it("keeps an invalid configured root failure at project scope", () => {
    withTempController([], (controllerRoot) => {
      writePostTurnScanRoots(controllerRoot, ["kid"]);

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-synthetic-target", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.equal(envelope.findings.length, 1);
      assert.equal(envelope.findings[0].target, "project");

      // The direct-shell path must name the root failure without inventing a child scan.
      const directResult = runHook(
        controllerRoot,
        {},
        buildStopPayload("controller-synthetic-target-direct", false),
      );
      assert.equal(directResult.status, 2, directResult.stderr);
      assert.match(directResult.stderr, /git repository root unavailable/u);
      assert.doesNotMatch(directResult.stderr, /post-turn-safety: kid:/u);
    });
  });

  it("keeps an escaping configured root fail closed", () => {
    withTempController([], (controllerRoot) => {
      writePostTurnScanRoots(controllerRoot, ["../outside"]);

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-escaping-root", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.equal(envelope.reasonCode, "coverage-incomplete");
      assert.equal(envelope.findings[0].target, "project");
    });
  });

  it("keeps a configured non-Git directory fail closed", () => {
    withTempController([], (controllerRoot) => {
      mkdirSync(join(controllerRoot, "notes"));
      writeFile(controllerRoot, "notes/readme.txt", "not a repository\n");
      writePostTurnScanRoots(controllerRoot, ["notes"]);

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-non-git-root", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.equal(envelope.reasonCode, "coverage-incomplete");
      assert.equal(envelope.findings[0].target, "project");
    });
  });

  it("does not discover unlisted nested or symlinked repositories", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      const nestedRoot = join(controllerRoot, "group", "nested-repo");
      mkdirSync(nestedRoot, { recursive: true });
      createCommittedRepo(nestedRoot);
      writeFile(nestedRoot, ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      symlinkSync(
        childRoots["gruff-go"],
        join(controllerRoot, "linked-repo"),
        "dir",
      );

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-boundary", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "pass");
      assert.deepEqual(envelope.coverage, {
        status: "complete",
        attemptedUnits: 1,
        completedUnits: 1,
        skippedUnits: 0,
      });
    });
  });

  it("scans a configured nested repository without discovering its siblings", () => {
    withTempController([], (controllerRoot) => {
      const nestedRoot = join(controllerRoot, "group", "nested-repo");
      const siblingRoot = join(controllerRoot, "sibling-repo");
      createCommittedRepo(nestedRoot);
      createCommittedRepo(siblingRoot);
      writeFile(nestedRoot, ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writeFile(siblingRoot, ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writePostTurnScanRoots(controllerRoot, ["group/nested-repo"]);

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-explicit-nested", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "block");
      assert.deepEqual(envelope.coverage, {
        status: "complete",
        attemptedUnits: 1,
        completedUnits: 1,
        skippedUnits: 0,
      });
      assert.equal(envelope.findings[0].target, "group/nested-repo/.env");
      assert.doesNotMatch(result.stdout, /sibling-repo/u);
    });
  });

  it("accepts quoted controller and scan-root keys", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      writeFile(childRoots["gruff-go"], ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writeFile(
        controllerRoot,
        ".goat-flow/config.yaml",
        [
          '"hooks":',
          '  "post-turn-safety":',
          '    "enabled": true',
          '    "scan-roots": ["gruff-go"]',
          "",
        ].join("\n"),
      );

      const envelope = assertManagedEnvelope(
        runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-quoted-keys", false),
        ),
      );

      assert.equal(envelope.outcome, "block");
      assert.equal(envelope.findings[0].target, "gruff-go/.env");
    });
  });

  it("scans a child configured through a flow-style hooks mapping", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      writeFile(childRoots["gruff-go"], ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writeFile(
        controllerRoot,
        ".goat-flow/config.yaml",
        'hooks: { "post-turn-safety": { enabled: true, "scan-roots": ["gruff-go"] } }\n',
      );

      const envelope = assertManagedEnvelope(
        runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-flow-hooks-mapping", false),
        ),
      );

      assert.equal(envelope.outcome, "block");
      assert.equal(envelope.findings[0].target, "gruff-go/.env");
    });
  });

  it("scans a child configured through a flow-style hook entry", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      writeFile(childRoots["gruff-go"], ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writeFile(
        controllerRoot,
        ".goat-flow/config.yaml",
        [
          "version: 1",
          "hooks:",
          '  post-turn-safety: { enabled: true, scan-roots: ["gruff-go"] }',
          "",
        ].join("\n"),
      );

      const envelope = assertManagedEnvelope(
        runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-flow-hook-entry", false),
        ),
      );

      assert.equal(envelope.outcome, "block");
      assert.equal(envelope.findings[0].target, "gruff-go/.env");
    });
  });

  it("keeps a deciding later-child finding visible through the findings cap", () => {
    withTempController(
      ["gruff-go", "gruff-php"],
      (controllerRoot, childRoots) => {
        for (let index = 0; index < 20; index += 1) {
          writeFile(
            childRoots["gruff-go"],
            `binary-${index}.dat`,
            Buffer.from([0, 98, 105, 110, index, 10]),
          );
        }
        writeFile(
          childRoots["gruff-php"],
          ".env",
          `API_KEY=${TEST_API_TOKEN}\n`,
        );

        const envelope = assertManagedEnvelope(
          runHook(
            controllerRoot,
            MANAGED_STOP_ENV,
            buildStopPayload("controller-capped-block", false),
          ),
        );

        assert.equal(envelope.outcome, "block");
        assert.ok(envelope.findings.length <= 20);
        assert.equal(
          envelope.findings.some(
            (finding: { target: string }) =>
              finding.target === "gruff-php/.env",
          ),
          true,
          "the finding that caused the block must survive the cap",
        );
      },
    );
  });

  it("keeps a nested controller scoped to its configured child repositories", () => {
    withTempRepo((outerRepository) => {
      const controllerRoot = join(outerRepository, "controller");
      const childRoot = join(controllerRoot, "gruff-go");
      createCommittedRepo(childRoot);
      writeFile(childRoot, ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writePostTurnScanRoots(controllerRoot, ["gruff-go"]);

      const envelope = assertManagedEnvelope(
        runHook(
          controllerRoot,
          MANAGED_STOP_ENV,
          buildStopPayload("controller-inside-unrelated-git", false),
        ),
      );

      assert.equal(envelope.outcome, "block");
      assert.deepEqual(envelope.coverage, {
        status: "complete",
        attemptedUnits: 1,
        completedUnits: 1,
        skippedUnits: 0,
      });
      assert.equal(envelope.findings[0].target, "gruff-go/.env");
    });
  });

  it("does not partially scan a mixed valid and non-Git root list", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      mkdirSync(join(controllerRoot, "notes"));
      writeFile(controllerRoot, "notes/readme.txt", "not a repository\n");
      writeFile(childRoots["gruff-go"], ".env", `API_KEY=${TEST_API_TOKEN}\n`);
      writePostTurnScanRoots(controllerRoot, ["gruff-go", "notes"]);

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-mixed-invalid", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.deepEqual(envelope.coverage, {
        status: "none",
        attemptedUnits: 1,
        completedUnits: 0,
        skippedUnits: 1,
      });
      assert.doesNotMatch(result.stdout, /gruff-go\/\.env/u);
    });
  });

  it("retains the fail-closed root result when scan roots are absent", () => {
    withTempController([], (controllerRoot) => {
      const ordinaryDirectory = join(controllerRoot, "notes");
      mkdirSync(ordinaryDirectory);
      writeFile(controllerRoot, "notes/readme.txt", "not a repository\n");

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-empty", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.deepEqual(envelope.coverage, {
        status: "none",
        attemptedUnits: 1,
        completedUnits: 0,
        skippedUnits: 1,
      });
      assert.match(
        envelope.findings[0].message,
        /Git repository root could not be opened/u,
      );
    });
  });
});
