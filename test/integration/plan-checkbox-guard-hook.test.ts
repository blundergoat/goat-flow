/**
 * Integration tests for the universal plan checkbox guard.
 *
 * The hook must work in arbitrary Git repositories without project-specific
 * toolchain commands. These tests execute the shipped Bash script against temp
 * repos and assert that only ignored hook state is written.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const HOOK_PATH = resolve(
  PROJECT_ROOT,
  "workflow/hooks/plan-checkbox-guard.sh",
);

function withTempRepo(fn: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-plan-checkbox-guard-"));
  try {
    runGit(root, ["init", "-q"]);
    writeFile(root, ".goat-flow/.gitignore", "logs/plan-guard-state.json\n");
    writeFile(root, "README.md", "# fixture\n");
    stageAll(root);
    fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function writeFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

function appendFile(root: string, path: string, content: string): void {
  const target = join(root, path);
  writeFileSync(target, `${readFileSync(target, "utf8")}${content}`);
}

function runGit(root: string, args: string[]): string {
  const result = spawnSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  return result.stdout.trim();
}

function stageAll(root: string): void {
  runGit(root, ["add", "."]);
}

function statusPorcelain(root: string): string {
  return runGit(root, ["status", "--porcelain=v1", "-z"]);
}

function writeActivePlan(
  root: string,
  path = ".goat-flow/plans/1.12.0/M01.md",
): string {
  writeFile(root, ".goat-flow/plans/.active", "1.12.0\n");
  writeFile(
    root,
    path,
    [
      "# M01: Fixture plan",
      "",
      "**Status:** in-progress",
      "",
      "- [ ] Do the work",
      "",
    ].join("\n"),
  );
  stageAll(root);
  return path;
}

function runHook(
  root: string,
  payload: Record<string, unknown> = {
    session_id: "session-1",
    stop_hook_active: false,
  },
): ReturnType<typeof spawnSync> {
  const payloadPath = `${root}.payload.${process.pid}.${Date.now()}.json`;
  const stderrPath = `${root}.stderr.${process.pid}.${Date.now()}.txt`;
  writeFileSync(payloadPath, JSON.stringify(payload));
  try {
    const result = spawnSync(
      "bash",
      [
        "-c",
        'bash "$1" < "$2" 2> "$3"',
        "plan-checkbox-guard-test",
        HOOK_PATH,
        payloadPath,
        stderrPath,
      ],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    const capturedStderr = existsSync(stderrPath)
      ? readFileSync(stderrPath, "utf8")
      : "";
    return {
      ...result,
      stderr: `${result.stderr ?? ""}${capturedStderr}`,
    };
  } finally {
    rmSync(payloadPath, { force: true });
    rmSync(stderrPath, { force: true });
  }
}

function assertAllows(result: ReturnType<typeof spawnSync>): void {
  assert.equal(
    result.status,
    0,
    `hook should allow fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
}

function assertBlocks(
  result: ReturnType<typeof spawnSync>,
  planPath: string,
): void {
  assert.equal(
    result.status,
    2,
    `hook should block fixture\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.match(
    result.stderr,
    new RegExp(planPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
  );
  assert.match(result.stderr, /Tick completed tasks/u);
  assert.doesNotMatch(result.stderr, /validation|validated|tests passed/iu);
}

describe("plan-checkbox-guard hook", () => {
  it("baselines first sighting, then blocks repo changes when the active plan is unchanged", () => {
    withTempRepo((root) => {
      const planPath = writeActivePlan(root);
      const before = statusPorcelain(root);

      assertAllows(runHook(root));
      assert.equal(statusPorcelain(root), before);

      writeFile(root, "src/app.txt", "changed\n");

      assertBlocks(runHook(root), planPath);
    });
  });

  it("allows stopping after the plan file changes", () => {
    withTempRepo((root) => {
      const planPath = writeActivePlan(root);
      assertAllows(runHook(root));
      writeFile(root, "src/app.txt", "changed\n");
      assertBlocks(runHook(root), planPath);

      appendFile(root, planPath, "Out-of-plan: checked repo change\n");

      assertAllows(runHook(root));
    });
  });

  it("allows repos with no active open-checkbox plan", () => {
    withTempRepo((root) => {
      writeFile(root, ".goat-flow/plans/1.12.0/M01.md", "- [x] Done\n");
      stageAll(root);
      writeFile(root, "src/app.txt", "changed\n");

      assertAllows(runHook(root));
    });
  });

  it("does not write state when no active plan exists", () => {
    withTempRepo((root) => {
      writeFile(root, "src/app.txt", "changed\n");

      assertAllows(runHook(root));
      assert.equal(
        existsSync(join(root, ".goat-flow/logs/plan-guard-state.json")),
        false,
      );
    });
  });

  it("honors disabled plan-guard config", () => {
    withTempRepo((root) => {
      writeActivePlan(root);
      writeFile(
        root,
        ".goat-flow/config.yaml",
        "plan-guard:\n  enabled: false\n",
      );
      stageAll(root);
      writeFile(root, "src/app.txt", "changed\n");

      assertAllows(runHook(root));
    });
  });

  it("fails with a useful diagnostic when no stable session id is present", () => {
    withTempRepo((root) => {
      writeActivePlan(root);

      const result = runHook(root, { stop_hook_active: false });

      assert.equal(result.status, 1);
      assert.match(result.stderr, /no session_id or transcript_path/u);
    });
  });

  it("skips retry Stop payloads before requiring session fields", () => {
    withTempRepo((root) => {
      writeActivePlan(root);

      assertAllows(runHook(root, { stop_hook_active: true }));
    });
  });

  it("recovers from corrupt state by recording a fresh baseline", () => {
    withTempRepo((root) => {
      writeActivePlan(root);
      writeFile(root, ".goat-flow/logs/plan-guard-state.json", "not json\n");

      const result = runHook(root);

      assertAllows(result);
      assert.match(result.stderr, /state file was corrupt/u);
    });
  });

  it("detects edits to files that were already dirty at baseline", () => {
    withTempRepo((root) => {
      const planPath = writeActivePlan(root);
      writeFile(root, "src/app.txt", "dirty before baseline\n");
      assertAllows(runHook(root));
      writeFile(root, "src/app.txt", "dirty before baseline\nchanged again\n");

      assertBlocks(runHook(root), planPath);
    });
  });

  it("tracks overlapping sessions independently", () => {
    withTempRepo((root) => {
      const planPath = writeActivePlan(root);

      assertAllows(runHook(root, { session_id: "session-a" }));
      writeFile(root, "src/app.txt", "session a movement\n");

      assertAllows(runHook(root, { session_id: "session-b" }));
      assertAllows(runHook(root, { session_id: "session-b" }));
      assertBlocks(runHook(root, { session_id: "session-a" }), planPath);
    });
  });

  it("detects untracked paths with spaces and deletion-only changes", () => {
    withTempRepo((root) => {
      const planPath = writeActivePlan(root);
      writeFile(root, "delete-me.txt", "safe\n");
      stageAll(root);
      assertAllows(runHook(root));

      writeFile(root, "src/file with spaces.txt", "untracked movement\n");
      assertBlocks(runHook(root), planPath);

      appendFile(root, planPath, "Out-of-plan: recorded untracked movement\n");
      assertAllows(runHook(root));
      rmSync(join(root, "delete-me.txt"));

      assertBlocks(runHook(root), planPath);
    });
  });

  it("does not select stale roadmap plans without an active marker", () => {
    withTempRepo((root) => {
      writeFile(root, ".goat-flow/plans/1.13.0/M01.md", "- [ ] Future work\n");
      writeFile(root, ".goat-flow/plans/2.0.0/M01.md", "- [ ] Later work\n");
      stageAll(root);
      const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      utimesSync(join(root, ".goat-flow/plans/1.13.0/M01.md"), old, old);
      utimesSync(join(root, ".goat-flow/plans/2.0.0/M01.md"), old, old);
      writeFile(root, "src/app.txt", "changed\n");

      assertAllows(runHook(root));
    });
  });

  it("the installed mirror matches the workflow hook source", () => {
    assert.equal(
      readFileSync(
        resolve(PROJECT_ROOT, ".goat-flow/hooks/plan-checkbox-guard.sh"),
        "utf8",
      ),
      readFileSync(HOOK_PATH, "utf8"),
    );
  });
});
