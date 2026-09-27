/**
 * Shared filesystem fixtures for stats integration tests.
 * Each helper writes only to registered temporary projects removed after the test run.
 */
import { after } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createFS } from "../../src/cli/facts/fs.js";
import {
  extractFootgunFacts,
  extractLearningLoopEntries,
  extractLessonsFacts,
} from "../../src/cli/facts/shared/learning-loop.js";
import {
  buildDecisionsSection,
  buildStatsReport,
} from "../../src/cli/stats/stats.js";
import type {
  LoadedConfig,
  GoatFlowConfig,
} from "../../src/cli/config/types.js";

/**
 * Build valid selected-project config for a stats scenario.
 *
 * @param overrides - Config fields the scenario intentionally replaces.
 * @returns A valid loaded config with the fixture defaults applied.
 */
export function stubConfig(
  overrides: Partial<GoatFlowConfig> = {},
): LoadedConfig {
  return {
    exists: true,
    valid: true,
    config: {
      version: "1.2.3",
      footguns: { path: ".goat-flow/learning-loop/footguns/" },
      lessons: { path: ".goat-flow/learning-loop/lessons/" },
      decisions: { path: ".goat-flow/learning-loop/decisions/" },
      plans: { path: ".goat-flow/plans/", maxActiveMilestones: 1 },
      logs: { path: ".goat-flow/logs/" },
      agents: null,
      skills: { install: "all" },
      lineLimits: { target: 125, limit: 150 },
      toolchain: {
        test: [],
        lint: [],
        build: [],
        package: [],
        format: [],
      },
      userRole: "developer",
      telemetry: false,
      learningLoop: { autoCapture: { enabled: false, targets: [] } },
      knownGaps: [],
      skillOverrides: {},
      harness: { acknowledge: [] },
      terminal: { idleTimeoutMinutes: 480 },
      hooks: {},
      ...overrides,
    },
    warnings: [],
    errors: [],
    parseError: null,
  };
}

/**
 * Build a disposable project with the memory buckets a stats user would inspect.
 * Omitted buckets are empty. Filesystem side effects: writes real temporary
 * directories and files; callers must register the returned root for teardown.
 *
 * @param spec - Exact learning-loop bucket files to write into the project.
 * @returns The absolute path to the temporary project root.
 */
export function makeFixtureRepo(spec: {
  footguns: Record<string, string>;
  lessons: Record<string, string>;
  patterns?: Record<string, string>;
  decisions?: Record<string, string>;
}): string {
  const fixtureProjectRoot = mkdtempSync(join(tmpdir(), "goatflow-stats-"));
  const footgunDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/footguns",
  );
  const lessonDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/lessons",
  );
  const decisionDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/decisions",
  );
  const patternDirectory = join(
    fixtureProjectRoot,
    ".goat-flow/learning-loop/patterns",
  );
  mkdirSync(footgunDirectory, { recursive: true });
  mkdirSync(lessonDirectory, { recursive: true });
  mkdirSync(patternDirectory, { recursive: true });
  mkdirSync(decisionDirectory, { recursive: true });
  for (const [bucketFilename, bucketContent] of Object.entries(spec.footguns)) {
    writeFileSync(join(footgunDirectory, bucketFilename), bucketContent);
  }
  for (const [bucketFilename, bucketContent] of Object.entries(spec.lessons)) {
    writeFileSync(join(lessonDirectory, bucketFilename), bucketContent);
  }
  for (const [bucketFilename, bucketContent] of Object.entries(
    spec.patterns ?? {},
  )) {
    writeFileSync(join(patternDirectory, bucketFilename), bucketContent);
  }
  for (const [decisionFilename, decisionContent] of Object.entries(
    spec.decisions ?? {},
  )) {
    writeFileSync(join(decisionDirectory, decisionFilename), decisionContent);
  }
  return fixtureProjectRoot;
}

export const pinnedNow = new Date("2026-04-18T12:00:00Z");
export const disposableProjectDirectories: string[] = [];

after(() => {
  for (const disposableProjectDirectory of disposableProjectDirectories) {
    rmSync(disposableProjectDirectory, { recursive: true, force: true });
  }
});

/**
 * Load the complete stats path from one seeded temporary project.
 * Registers the project root for teardown after the test run.
 *
 * @param spec - Exact learning-loop bucket files to write before extraction.
 * @returns The stats report built from the seeded project.
 */
export function loadReport(spec: Parameters<typeof makeFixtureRepo>[0]) {
  const fixtureProjectRoot = makeFixtureRepo(spec);
  disposableProjectDirectories.push(fixtureProjectRoot);
  const projectFiles = createFS(fixtureProjectRoot);
  const configState = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState, pinnedNow),
    lessons: extractLessonsFacts(projectFiles, configState, pinnedNow),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
    learningLoopEntries: extractLearningLoopEntries(projectFiles, configState),
  });
}

/**
 * Load the setup failure produced when a project has no memory directories.
 * Registers the project root for teardown after the test run.
 *
 * @returns The stats report built from an otherwise empty project.
 */
export function loadReportWithoutLoopDirs() {
  const fixtureProjectRoot = mkdtempSync(
    join(tmpdir(), "goatflow-stats-missing-"),
  );
  disposableProjectDirectories.push(fixtureProjectRoot);
  const projectFiles = createFS(fixtureProjectRoot);
  const configState = stubConfig();
  return buildStatsReport({
    footguns: extractFootgunFacts(projectFiles, configState, pinnedNow),
    lessons: extractLessonsFacts(projectFiles, configState, pinnedNow),
    decisions: buildDecisionsSection(
      projectFiles,
      configState.config.decisions.path,
    ),
  });
}
