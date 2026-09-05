/**
 * Proves which project-memory paths the shipped `.goat-flow/.gitignore` keeps visible or local-only.
 * Use when changing `workflow/setup/reference/goat-flow-gitignore`, because Git and ignore-aware search tools interpret slash rules differently.
 *
 * The leading `*` ignores unknown local files, while `!` rules restore committed surfaces and slash rules keep their double-star-slash search prefix.
 * The logs guard prevents nested names from being re-included accidentally.
 * A real disposable repository pins every decision and proves both protections are load-bearing.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const TEMPLATE_DIR = join(PROJECT_ROOT, "workflow", "setup", "reference");
const GOAT_FLOW_TEMPLATE = readFileSync(
  join(TEMPLATE_DIR, "goat-flow-gitignore"),
  "utf8",
);
const PLANS_TEMPLATE = readFileSync(
  join(TEMPLATE_DIR, "plans-gitignore"),
  "utf8",
);
const SCRATCHPAD_TEMPLATE = readFileSync(
  join(TEMPLATE_DIR, "scratchpad-gitignore"),
  "utf8",
);
const LOGS_SUBDIRECTORY_GUARD = "**/logs/*/*/";

const LOG_DIRECTORIES = [
  "sessions",
  "quality",
  "events",
  "critiques",
  "review",
  "security",
] as const;
const COMMITTED_SURFACE_NAMES = [
  "hooks",
  "learning-loop",
  "plans",
  "scratchpad",
  "skill-docs",
] as const;

/** Every probed path (relative to `.goat-flow/`) with the decision Git must make: `??` visible (untracked), `!!` ignored. */
const EXPECTED_DECISIONS: ReadonlyArray<
  readonly [path: string, decision: "??" | "!!"]
> = [
  // Committed top-level files and directories stay visible.
  ["config.yaml", "??"],
  ["architecture.md", "??"],
  ["learning-loop/footguns/new.md", "??"],
  ["skill-docs/playbooks/new.md", "??"],
  ["hooks/new.sh", "??"],
  // Anchors that keep local-workspace paths present in a clone.
  ["plans/README.md", "??"],
  ["scratchpad/README.md", "??"],
  ["logs/sessions/.gitkeep", "??"],
  ...LOG_DIRECTORIES.map((name) => [`logs/${name}/README.md`, "??"] as const),
  // Local-only content stays ignored.
  ["plans/1.16.0/M99.md", "!!"],
  ["scratchpad/x/y.md", "!!"],
  ["write-claims/example.claim", "!!"],
  ["logs/sessions/2026.md", "!!"],
  ["logs/quality/r.json", "!!"],
  ["logs/review/r.txt", "!!"],
  ["logs/quality/nested/x.md", "!!"],
  ["stray.md", "!!"],
  // A directory named like a committed surface inside a re-included logs directory must not be re-included by the prefixed rules.
  ...LOG_DIRECTORIES.flatMap((log) =>
    COMMITTED_SURFACE_NAMES.map(
      (name) => [`logs/${log}/${name}/x.md`, "!!"] as const,
    ),
  ),
];

/**
 * Build a disposable repository and return Git's decision for every `.goat-flow/` probe.
 *
 * Side effects: writes suite-owned fixtures, spawns Git twice, and removes the repository in `finally`.
 * Invariant: results exclude `.gitignore` files and stay sorted for byte-stable comparison.
 *
 * @param goatFlowGitignore - root ignore text; empty content leaves root project-memory paths visible to Git
 * @returns `"<decision> <path>"` lines for every probed path, sorted, with the `.gitignore` files themselves excluded.
 */
function gitDecisions(goatFlowGitignore: string): string[] {
  const repositoryRoot = mkdtempSync(
    join(tmpdir(), "goat-flow-gitignore-shape-"),
  );
  try {
    const gitInitResult = spawnSync("git", ["init", "-q"], {
      cwd: repositoryRoot,
      encoding: "utf8",
    });
    assert.equal(gitInitResult.status, 0, gitInitResult.stderr);
    const goatFlowDirectory = join(repositoryRoot, ".goat-flow");
    mkdirSync(join(goatFlowDirectory, "plans"), { recursive: true });
    mkdirSync(join(goatFlowDirectory, "scratchpad"), { recursive: true });
    writeFileSync(join(goatFlowDirectory, ".gitignore"), goatFlowGitignore);
    writeFileSync(
      join(goatFlowDirectory, "plans", ".gitignore"),
      PLANS_TEMPLATE,
    );
    writeFileSync(
      join(goatFlowDirectory, "scratchpad", ".gitignore"),
      SCRATCHPAD_TEMPLATE,
    );
    // Each probe becomes a real empty file so Git reports the exact visibility a user would see from `git status`.
    for (const [fixturePath] of EXPECTED_DECISIONS) {
      mkdirSync(dirname(join(goatFlowDirectory, fixturePath)), {
        recursive: true,
      });
      writeFileSync(join(goatFlowDirectory, fixturePath), "");
    }
    const gitStatusResult = spawnSync(
      "git",
      ["status", "--porcelain", "--ignored", "-uall", ".goat-flow/"],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
      },
    );
    assert.equal(gitStatusResult.status, 0, gitStatusResult.stderr);
    return gitStatusResult.stdout
      .split("\n")
      .filter((line) => line.length > 0 && !line.endsWith(".gitignore"))
      .sort();
  } finally {
    // The repository belongs only to this probe, so cleanup never touches a user's project.
    rmSync(repositoryRoot, { recursive: true, force: true });
  }
}

const EXPECTED_LINES = EXPECTED_DECISIONS.map(
  ([path, decision]) => `${decision} .goat-flow/${path}`,
).sort();

describe("goat-flow gitignore shape", () => {
  // Pins Git's decision for every probed path so a re-anchored or reordered rule fails here, not in a consumer's `git add .`.
  it("keeps every recorded ignore decision for the shipped template", () => {
    assert.deepEqual(gitDecisions(GOAT_FLOW_TEMPLATE), EXPECTED_LINES);
  });

  // The guard is what keeps the prefixed re-includes from reaching collision directories under logs/<x>/; prove it is present and load-bearing.
  it("carries the logs subdirectory guard and depends on it", () => {
    const lines = GOAT_FLOW_TEMPLATE.split(/\r?\n/u).map((line) => line.trim());
    assert.ok(
      lines.includes(LOGS_SUBDIRECTORY_GUARD),
      `template must contain the ${LOGS_SUBDIRECTORY_GUARD} guard before the logs re-includes`,
    );
    const withoutGuard = lines
      .filter((line) => line !== LOGS_SUBDIRECTORY_GUARD)
      .join("\n");
    const decisions = gitDecisions(withoutGuard);
    assert.notDeepEqual(decisions, EXPECTED_LINES);
    assert.ok(
      decisions.includes("?? .goat-flow/logs/quality/hooks/x.md"),
      "without the guard a collision directory under logs/quality/ becomes visible to Git",
    );
  });

  // Deny-by-default is the safety property of the whole file; prove removing it leaks a stray root file.
  it("depends on the leading ignore-everything rule", () => {
    const lines = GOAT_FLOW_TEMPLATE.split(/\r?\n/u);
    const first = lines.findIndex((line) => line.trim() === "*");
    assert.ok(first >= 0, "template must open with a bare * rule");
    const withoutStar = [
      ...lines.slice(0, first),
      ...lines.slice(first + 1),
    ].join("\n");
    const decisions = gitDecisions(withoutStar);
    assert.notDeepEqual(decisions, EXPECTED_LINES);
    assert.ok(
      decisions.includes("?? .goat-flow/stray.md"),
      "without * a stray root file becomes visible to Git",
    );
  });
});
