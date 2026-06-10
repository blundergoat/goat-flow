/**
 * Unit tests for skill quality scoring, evidence parsing, and report shaping.
 */
import { describe, it } from "node:test";
import type { TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

/**
 * Symlink helper that skips blocked Windows fixtures and throws for unexpected symlink failures.
 *
 * @param testContext - the running test, marked skipped when the host forbids unprivileged symlinks
 * @param target - existing path the symlink should point at
 * @param link - path of the symlink to create
 * @returns true when the symlink was created; false after skipping on an EPERM host; throws on any other error so
 *   a genuine failure is not silently swallowed
 */
export function symlinkOrSkip(
  testContext: TestContext,
  target: string,
  link: string,
): boolean {
  try {
    symlinkSync(target, link);
    return true;
  } catch (err) {
    if (
      err instanceof Error &&
      (err as NodeJS.ErrnoException).code === "EPERM"
    ) {
      testContext.skip(
        "Skipped: host blocks unprivileged symlinks (Windows without Developer Mode)",
      );
      return false;
    }
    throw err;
  }
}

import { discoverArtifacts, findArtifact } from "../../src.js";
import { scoreArtifact, scoreAllArtifacts } from "../../src.js";
import { evaluateContent, evaluateUploadedBundle } from "../../src.js";
import { cloneQualityConfig, DEFAULT_QUALITY_CONFIG } from "../../src.js";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..", "..");
export const FULL_DISPATCHER_WORKFLOW_SCORE = 5;
export const FULL_TOOL_DEPENDENCY_SCORE = 10;
export const MIN_HUMAN_STOP_GATE_SCORE = 10;
export const FULL_GATE_QUALITY_SCORE = 10;
export const MIN_PLAYBOOK_TOOL_SCORE = 8;
export const FALLBACK_CLASSIFICATION_CONFIDENCE = 0.3;
export const EXPECTED_METRIC_COUNT = 9;
export const FULL_TRIGGER_CLARITY_SCORE = 15;
export const ARTIFACT_TRUNCATION_BYTES = 262_144;
export const SNAPSHOT_FIXTURE = resolve(
  PROJECT_ROOT,
  "test/fixtures/skill-quality/expected-scores.json",
);
export const SANITISED_PLAYWRIGHT_SHAPED_SKILL = [
  "---",
  "name: browser-runbook",
  'description: "Browser-test a staging feature using Playwright MCP."',
  'goat-flow-skill-version: "1.6.1"',
  "---",
  "# /browser-runbook",
  "",
  "Use the Playwright MCP tools to browser-test a feature on the staging environment.",
  "",
  "## Prerequisites",
  "",
  "- Browser MCP tools are available in the active agent session.",
  "",
  "## Environment",
  "",
  "- Base URL: `https://staging.example.test`",
  "- Test account: use a seeded non-production account from the project test-data docs.",
  "",
  "## Step 0 - Start the browser",
  "",
  "Run `browser_navigate` to open `/login`.",
  "",
  "## Step 1 - Interact with the page",
  "",
  "Use `browser_snapshot` to find controls, then `browser_fill_form` for fields and `browser_evaluate` for app-specific widgets.",
  "",
  "## Step 2 - Capture evidence",
  "",
  "Use `browser_network_requests` to confirm the request returns 200 and `browser_console_messages` to check for unexpected errors.",
  "",
  "## Common Gotchas",
  "",
  "| Symptom | Fix |",
  "|---|---|",
  "| Widget click misses | Use `browser_evaluate` against the stable selector. |",
  "| Modal content loads late | Wait for visible text before querying nested controls. |",
  "",
  "## Quick Reference",
  "",
  "- `browser_resize` before screenshots.",
  "- Prefer visible text waits over fixed sleeps.",
].join("\n");

/**
 * Keep skill-quality fixture projects isolated from the real repo tree.
 *
 * @returns the absolute path of a fresh temp directory to use as a fixture project root
 */
export function makeTempProject(): string {
  return mkdtempSync(join(tmpdir(), "goat-flow-skill-quality-"));
}

/**
 * Writes fixture files while preserving nested artifact directory shapes.
 *
 * @param path - absolute target file path; any missing parent directories are created first
 * @param content - exact file contents to write
 */
export function writeText(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

/**
 * Place a test skill at the installed Claude skill path the scanner expects.
 *
 * @param projectRoot - fixture project root the skill is written under
 * @param name - skill directory name, becoming .claude/skills/<name>/SKILL.md
 * @param content - SKILL.md body to write
 */
export function writeSkill(
  projectRoot: string,
  name: string,
  content: string,
): void {
  writeText(join(projectRoot, ".claude/skills", name, "SKILL.md"), content);
}

// ---------------------------------------------------------------------------
// Cached repo artifact discovery + scoring - both walk the entire repo tree
// and `scoreAllArtifacts` additionally scores every installed skill/reference.
// Lazy-caching avoids repeating the same expensive walk in 10+ tests. Tests
// must treat the returned data as read-only.
// ---------------------------------------------------------------------------

export let cachedRepoArtifacts: ReturnType<typeof discoverArtifacts> | null =
  null;
/**
 * Reuse whole-repo discovery because artifact walks dominate this suite.
 *
 * @returns the lazily-cached result of discovering every artifact under the repo root; callers must treat it as
 *   read-only since the same instance is shared across tests
 */
export function getRepoArtifacts(): ReturnType<typeof discoverArtifacts> {
  if (cachedRepoArtifacts === null) {
    cachedRepoArtifacts = discoverArtifacts(PROJECT_ROOT);
  }
  return cachedRepoArtifacts;
}

export let cachedRepoScoredArtifacts: ReturnType<
  typeof scoreAllArtifacts
> | null = null;
/**
 * Reuse whole-repo scoring because each run evaluates every installed skill.
 *
 * @returns the lazily-cached result of scoring every artifact under the repo root; callers must treat it as
 *   read-only since the same instance is shared across tests
 */
export function getRepoScoredArtifacts(): ReturnType<typeof scoreAllArtifacts> {
  if (cachedRepoScoredArtifacts === null) {
    cachedRepoScoredArtifacts = scoreAllArtifacts(PROJECT_ROOT);
  }
  return cachedRepoScoredArtifacts;
}

export {
  describe,
  it,
  assert,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
  tmpdir,
  dirname,
  join,
  resolve,
  discoverArtifacts,
  evaluateContent,
  evaluateUploadedBundle,
  findArtifact,
  scoreArtifact,
  scoreAllArtifacts,
  cloneQualityConfig,
  DEFAULT_QUALITY_CONFIG,
};
