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
  runHook,
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

function assertManagedEnvelope(result: ReturnType<typeof runHook>) {
  assert.equal(result.status, 0, result.stderr);
  assert.notEqual(result.stdout.trim(), "", result.stderr);
  return JSON.parse(result.stdout);
}

describe("post-turn-safety hook: non-Git controller fan-out", () => {
  for (const scannerVariant of POST_TURN_SCANNER_VARIANTS) {
    it(`aggregates clean immediate repositories with the ${scannerVariant.displayName}`, () => {
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

  it("names a synthetic child failure once in the aggregate target", () => {
    withTempController([], (controllerRoot) => {
      const childRoot = join(controllerRoot, "kid");
      const detachedGitDirectory = join(controllerRoot, "detached-git");
      mkdirSync(childRoot);
      mkdirSync(detachedGitDirectory);
      symlinkSync(detachedGitDirectory, join(childRoot, ".git"), "dir");

      const result = runHook(
        controllerRoot,
        MANAGED_STOP_ENV,
        buildStopPayload("controller-synthetic-target", false),
      );
      const envelope = assertManagedEnvelope(result);

      assert.equal(envelope.outcome, "incomplete");
      assert.equal(envelope.findings.length, 1);
      assert.equal(envelope.findings[0].target, "kid");

      // The same child must be named once in the direct-shell diagnostics users read.
      const directResult = runHook(
        controllerRoot,
        {},
        buildStopPayload("controller-synthetic-target-direct", false),
      );
      assert.equal(directResult.status, 2, directResult.stderr);
      assert.match(directResult.stderr, /post-turn-safety: kid: /u);
      assert.doesNotMatch(directResult.stderr, /kid\/kid/u);
    });
  });

  it("ignores nested and symlinked repositories outside the immediate-root contract", () => {
    withTempController(["gruff-go"], (controllerRoot, childRoots) => {
      const nestedRoot = join(controllerRoot, "group", "nested-repo");
      mkdirSync(nestedRoot, { recursive: true });
      createCommittedRepo(nestedRoot);
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

  it("retains the fail-closed root result when no immediate child is eligible", () => {
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
