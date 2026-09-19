/**
 * Integration tests for which edits the Gruff hook stays quiet about, and which results it must still show.
 * Edits Gruff has no work for complete silently. Project source the selected install cannot reach stays visible,
 * and that result, a finding and an analyzer failure all reach the model through the handler setup registers for Claude.
 */
import { after, describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { writeAgentHookState } from "../../src/cli/server/agent-hook-writer.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";
import {
  CLEAN_GRUFF_CONTRACT_ENVELOPE,
  FINDING_GRUFF_CONTRACT_ENVELOPE,
  cleanupHookTestDirs,
  initGit,
  makeEditedGruffContractProject,
  makeRoot,
  readMigratedGruffResult,
  runMigratedHook,
  sampleGruffEditPayload,
  writeContractGruffBinary,
} from "./gruff-code-quality-smoke.helpers.js";

const PROJECT_ROOT = join(import.meta.dirname, "..", "..");

after(cleanupHookTestDirs);

/** A disposable workspace: one Git project with a Gruff analyzer, and a plain sibling directory beside it. */
interface GruffWorkspace {
  workspaceRoot: string;
  projectRoot: string;
  siblingSourcePath: string;
}

/**
 * Writes the workspace a developer has when Claude opens a folder that holds several projects.
 * It creates a Git project whose own source file is dirty, an opted-out nested install inside it, and a sibling source file.
 *
 * @param analyzerEnvelope - text the project's mock analyzer prints for any analysed file
 * @returns the workspace paths; the sibling file is supported source outside the project
 */
function makeGruffWorkspace(analyzerEnvelope: string): GruffWorkspace {
  const workspaceRoot = makeRoot();
  const projectRoot = join(workspaceRoot, "project");
  writeContractGruffBinary(projectRoot, analyzerEnvelope);
  writeFileSync(join(projectRoot, ".gruff-ts.yaml"), "rules: {}\n");
  mkdirSync(join(projectRoot, "src"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "sample.ts"), "a\nb\nc\n");
  initGit(projectRoot);
  const optedOutRoot = join(projectRoot, "opted-out");
  mkdirSync(join(optedOutRoot, ".goat-flow"), { recursive: true });
  writeFileSync(
    join(optedOutRoot, ".goat-flow", "config.yaml"),
    "hooks:\n  gruff-code-quality:\n    enabled: false\n",
  );
  mkdirSync(join(optedOutRoot, "src"), { recursive: true });
  writeFileSync(join(optedOutRoot, "src", "kept.ts"), "a\n");
  const siblingSourcePath = join(workspaceRoot, "sibling", "src", "other.ts");
  mkdirSync(join(workspaceRoot, "sibling", "src"), { recursive: true });
  writeFileSync(siblingSourcePath, "a\n");
  return { workspaceRoot, projectRoot, siblingSourcePath };
}

/**
 * Registers Gruff for Claude the way setup does and returns the saved handler arguments.
 * It copies the shipped hook files into the project and writes `.claude/settings.json`.
 *
 * @param projectRoot - existing project that receives the install
 * @returns the registered `node` arguments, unchanged
 */
function registerClaudeGruffHandler(projectRoot: string): string[] {
  cpSync(
    join(PROJECT_ROOT, "workflow", "hooks"),
    join(projectRoot, ".goat-flow", "hooks"),
    { recursive: true },
  );
  mkdirSync(join(projectRoot, ".claude"));
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  writeFileSync(settingsPath, "{}\n");
  const gruffSpec = getHookSpec("gruff-code-quality");
  assert.ok(gruffSpec);
  writeAgentHookState(projectRoot, PROFILES.claude, gruffSpec, true);
  const settings = JSON.parse(readFileSync(settingsPath, "utf8")) as {
    hooks: {
      PostToolUse: Array<{ hooks: Array<{ command: string; args: string[] }> }>;
    };
  };
  const handler = settings.hooks.PostToolUse[0]!.hooks[0]!;
  // The registration names `node`; the replay uses this process's own Node with the registered arguments.
  assert.equal(handler.command, "node");
  return handler.args;
}

/**
 * Replays one edit through Claude's registered Gruff handler, launcher and adapter included.
 * It starts the handler as a child process and changes no file.
 *
 * @param projectRoot - project holding the registered install; also the working directory
 * @param providerDirectory - directory Claude exports as CLAUDE_PROJECT_DIR
 * @param editPayload - the completed tool call Claude sends on stdin
 * @returns the context Claude would show the model; a quiet handler fails here because silence proves no analysis
 */
function deliveredContext(
  projectRoot: string,
  providerDirectory: string,
  editPayload: unknown,
): string {
  const replay = spawnSync(
    process.execPath,
    registerClaudeGruffHandler(projectRoot),
    {
      cwd: projectRoot,
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: providerDirectory },
      input: JSON.stringify(editPayload),
      timeout: 60_000,
    },
  );
  assert.equal(replay.status, 0, replay.stderr);
  assert.notEqual(replay.stdout, "", "a quiet handler proves no analysis");
  const response = JSON.parse(replay.stdout) as {
    hookSpecificOutput: { additionalContext: string };
  };
  return response.hookSpecificOutput.additionalContext;
}

describe("gruff-code-quality hook quiets edits outside the analysed scope", () => {
  /**
   * Runs one named edit from the workspace's project, whose dirty source file would show a fallback to dirty files.
   * It writes a fresh workspace, and a symlink to the sibling directory from outside the workspace.
   *
   * @param namedPath - edited path; `<sibling>`, `<linked>` and `<outside>` expand to absolute paths beside, linked into and outside the workspace
   * @param providerDirectory - which directory Claude exports as CLAUDE_PROJECT_DIR; `none` exports nothing
   * @returns the neutral result and whether the project's analyzer ran
   */
  function runNamedEdit(
    namedPath: string,
    providerDirectory: "project" | "workspace" | "none",
  ): { result: Record<string, unknown>; analyzed: boolean } {
    const { workspaceRoot, projectRoot } = makeGruffWorkspace(
      CLEAN_GRUFF_CONTRACT_ENVELOPE,
    );
    const outsideRoot = makeRoot();
    // A symlink needs extra rights on Windows, and only the `<linked>` case, skipped there, reads it.
    if (process.platform !== "win32") {
      symlinkSync(join(workspaceRoot, "sibling"), join(outsideRoot, "linked"));
    }
    const filePath = namedPath
      .replace("<sibling>", join(workspaceRoot, "sibling"))
      .replace("<linked>", join(outsideRoot, "linked"))
      .replace("<outside>", join(outsideRoot, "scratch"));
    const providerDirectories = {
      project: projectRoot,
      workspace: workspaceRoot,
      none: "",
    };
    const hookRun = runMigratedHook(
      projectRoot,
      { tool_name: "Write", tool_input: { file_path: filePath } },
      "/usr/bin:/bin",
      { CLAUDE_PROJECT_DIR: providerDirectories[providerDirectory] },
    );
    return {
      result: readMigratedGruffResult(hookRun),
      analyzed: existsSync(join(projectRoot, "gruff-hook-args.log")),
    };
  }

  const quietCases = [
    ["a README in the project", "README.md", "project"],
    ["a planning note under .goat-flow", ".goat-flow/plans/note.md", "project"],
    ["skipped-directory source", "node_modules/pkg/index.ts", "project"],
    ["opted-out nested source", "opted-out/src/kept.ts", "project"],
    ["scratch outside the provider project", "<outside>/tool.py", "project"],
    ["outside path, no provider directory", "<sibling>/src/other.ts", "none"],
  ] as const;
  for (const [label, namedPath, providerDirectory] of quietCases) {
    it(`returns a quiet complete result for ${label}`, () => {
      const { result, analyzed } = runNamedEdit(namedPath, providerDirectory);
      assert.equal(result.outcome, "pass");
      assert.equal(result.reasonCode, "completed-clean");
      assert.deepEqual(result.findings, []);
      assert.equal(analyzed, false);
    });
  }

  const unreachableCases = [
    {
      label: "named by its own path",
      namedPath: "<sibling>/src/other.ts",
      needsSymlink: false,
    },
    {
      label: "named through a symlink from outside the provider project",
      namedPath: "<linked>/src/other.ts",
      needsSymlink: true,
    },
  ];
  for (const { label, namedPath, needsSymlink } of unreachableCases) {
    it(
      `reports supported source in the provider project but outside the selected install, ${label}`,
      { skip: needsSymlink && process.platform === "win32" },
      () => {
        const { result, analyzed } = runNamedEdit(namedPath, "workspace");
        const findings = result.findings as Array<{ code: string }>;
        assert.equal(result.outcome, "incomplete");
        assert.equal(result.reasonCode, "coverage-incomplete");
        assert.deepEqual(result.coverage, {
          status: "none",
          attemptedUnits: 1,
          completedUnits: 0,
          skippedUnits: 1,
        });
        assert.equal(findings[0]?.code, "edited-path-outside-project");
        assert.equal(analyzed, false);
      },
    );
  }

  it("still analyses the source file when the same edit also names a README", () => {
    const projectRoot = makeEditedGruffContractProject(
      FINDING_GRUFF_CONTRACT_ENVELOPE,
    );
    const mixedEdit = {
      tool_name: "multi_replace_file_content",
      tool_input: {
        edits: [{ file_path: "README.md" }, { file_path: "src/sample.ts" }],
      },
    };
    const result = readMigratedGruffResult(
      runMigratedHook(projectRoot, mixedEdit, "/usr/bin:/bin"),
    );
    const coverage = result.coverage as { attemptedUnits: number };
    assert.equal(result.outcome, "advisory");
    assert.equal(coverage.attemptedUnits, 1);
    assert.equal(
      readFileSync(join(projectRoot, "gruff-hook-args.log"), "utf8"),
      "hook --format json src/sample.ts\n",
    );
  });
});

describe("gruff-code-quality hook delivers source results through Claude's registered handler", () => {
  it("shows the model an analyzer finding on the edited line", () => {
    const projectRoot = makeEditedGruffContractProject(
      FINDING_GRUFF_CONTRACT_ENVELOPE,
    );
    const context = deliveredContext(
      projectRoot,
      projectRoot,
      sampleGruffEditPayload(),
    );
    assert.match(context, /gruff-code-quality: ADVISORY/u);
    assert.match(context, /naming\.short/u);
  });

  it("shows the model that a broken analyzer left the edit unchecked", () => {
    const projectRoot = makeEditedGruffContractProject("not json");
    const context = deliveredContext(
      projectRoot,
      projectRoot,
      sampleGruffEditPayload(),
    );
    assert.match(context, /gruff-code-quality: INCOMPLETE/u);
    assert.match(context, /analyzer-response-invalid/u);
  });

  it("shows the model that project source outside the selected install was not analysed", () => {
    const { workspaceRoot, projectRoot, siblingSourcePath } =
      makeGruffWorkspace(CLEAN_GRUFF_CONTRACT_ENVELOPE);
    const context = deliveredContext(projectRoot, workspaceRoot, {
      tool_name: "Write",
      tool_input: { file_path: siblingSourcePath },
    });
    assert.match(context, /gruff-code-quality: INCOMPLETE/u);
    assert.match(context, /edited-path-outside-project/u);
    assert.ok(context.includes(siblingSourcePath), context);
  });
});
