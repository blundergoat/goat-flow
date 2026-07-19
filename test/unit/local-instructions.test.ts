/**
 * Exercises project-local instruction discovery and hot-path parity contracts.
 * Use these fixtures when routing, extraction, or release metadata changes so
 * users see only real paths and current instruction provenance.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { describe, it } from "node:test";
import {
  extractInstructionFacts,
  extractSection,
} from "../../src/cli/facts/agent/instruction.js";
import {
  extractRouterFacts,
  pushUniquePath,
} from "../../src/cli/facts/agent/routing.js";
import { extractGitignoreFacts } from "../../src/cli/facts/shared/ci.js";
import { extractLocalInstructions } from "../../src/cli/facts/shared/local-instructions.js";
import type { AgentProfile } from "../../src/cli/types.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

/** Build a small in-memory project tree for one user-visible instruction scenario. */
function stubFS(
  files: Record<string, string>,
  dirs: Record<string, string[]>,
): ReadonlyFS {
  return {
    exists: (path) =>
      Object.prototype.hasOwnProperty.call(files, path) ||
      Object.prototype.hasOwnProperty.call(dirs, path),
    readFile: (path) => files[path] ?? null,
    lineCount: (path) =>
      files[path] === undefined ? 0 : files[path]!.split("\n").length,
    readJson: () => null,
    isReadableDirectory: (path) =>
      Object.prototype.hasOwnProperty.call(dirs, path),
    listDir: (path) => dirs[path] ?? [],
    isExecutable: () => false,
    glob: () => [],
    existsGlob: () => false,
  };
}

const AGENT_PROFILE: AgentProfile = {
  id: "claude",
  name: "Claude Code",
  instructionFile: "CLAUDE.md",
  skillsDir: ".claude/skills",
  localPattern: "*/CLAUDE.md",
  denyMechanism: {
    type: "deny-script",
    path: ".goat-flow/hooks/deny-dangerous.sh",
  },
  denyHookFile: ".goat-flow/hooks/deny-dangerous.sh",
};

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");

/** Provide a representative project-conventions document for extraction tests. */
function conventionsContent(): string {
  return [
    "# Project Conventions",
    "",
    "## Commands",
    "```bash",
    "npm test",
    "npm run typecheck",
    "```",
    "",
    "## Conventions",
    "Do: run focused checks first.",
    "Do: keep evidence concrete.",
    "Don't: skip failing checks.",
    "",
    "## Review",
    "Use direct file evidence.",
    "Keep findings scoped.",
  ].join("\n");
}

describe("extractLocalInstructions", () => {
  it("extracts agent instruction, router, and gitignore facts from local files", () => {
    const instruction = [
      "# Agent",
      "",
      "## Router Table",
      "`src/cli/index.ts`",
      "[docs](docs/cli.md)",
      "",
      "## Verify",
      "Run npm test.",
    ].join("\n");
    const fs = stubFS(
      {
        "CLAUDE.md": instruction,
        ".gitignore": ".env\nsettings.local.json\n",
      },
      {},
    );
    const paths: string[] = [];

    pushUniquePath(paths, "src/cli/index.ts");
    pushUniquePath(paths, "src/cli/index.ts");

    assert.equal(extractSection(instruction, "verify"), "Run npm test.");
    assert.equal(extractInstructionFacts(fs, AGENT_PROFILE).lineCount, 8);
    assert.deepEqual(extractRouterFacts(fs, instruction).paths, [
      "src/cli/index.ts",
      "docs/cli.md",
    ]);
    assert.deepEqual(paths, ["src/cli/index.ts"]);
    assert.equal(extractGitignoreFacts(fs).hasRequiredEntries, true);
  });

  it("returns an empty payload when no local instruction directory exists", () => {
    const facts = extractLocalInstructions(stubFS({}, {}));

    assert.equal(facts.dirExists, false);
    assert.equal(facts.location, null);
    assert.equal(facts.githubDirExists, false);
    assert.equal(facts.fileCount, 0);
    assert.equal(facts.hasValidRouter, false);
    assert.equal(facts.path, ".github/instructions");
  });

  it("detects .github/instructions files, flags, content, and line counts", () => {
    const expectedInstructionFileCount = 3;
    const content = conventionsContent();
    const fs = stubFS(
      {
        ".github/instructions/conventions.instructions.md": content,
        ".github/instructions/frontend.md": "# Frontend\n",
        ".github/instructions/code-review.instructions.md": "# Review\n",
      },
      {
        ".github/instructions": [
          "conventions.instructions.md",
          "frontend.md",
          "code-review.instructions.md",
          "notes.txt",
        ],
      },
    );

    const facts = extractLocalInstructions(fs);

    assert.equal(facts.dirExists, true);
    assert.equal(facts.location, "github");
    assert.equal(facts.githubDirExists, true);
    assert.equal(facts.fileCount, expectedInstructionFileCount);
    assert.equal(facts.hasConventions, true);
    assert.equal(facts.conventionsHasContent, true);
    assert.equal(facts.hasFrontend, true);
    assert.equal(facts.hasBackend, false);
    assert.equal(facts.hasCodeReview, true);
    assert.equal(facts.hasGitCommit, false);
    assert.equal(facts.conventionsContent, content);
    assert.deepStrictEqual(facts.localFileSizes, [
      {
        path: ".github/instructions/conventions.instructions.md",
        lines: 16,
      },
      { path: ".github/instructions/frontend.md", lines: 2 },
      {
        path: ".github/instructions/code-review.instructions.md",
        lines: 2,
      },
    ]);
  });
});

describe("instruction release metadata", () => {
  it("rejects a live instruction header date that differs from the changelog release", () => {
    const fixtureRoot = mkdtempSync(
      join(tmpdir(), "goat-flow-instruction-parity-"),
    );
    const fixtureFiles = [
      "package.json",
      "CHANGELOG.md",
      "CLAUDE.md",
      "AGENTS.md",
      ".github/copilot-instructions.md",
      "workflow/setup/agents/claude.md",
      "workflow/setup/agents/codex.md",
      "workflow/setup/agents/copilot.md",
      "workflow/setup/agents/antigravity.md",
    ];

    try {
      for (const relativePath of fixtureFiles) {
        const destination = join(fixtureRoot, relativePath);
        mkdirSync(dirname(destination), { recursive: true });
        cpSync(join(PROJECT_ROOT, relativePath), destination);
      }

      const agentsPath = join(fixtureRoot, "AGENTS.md");
      const agentsContent = readFileSync(agentsPath, "utf8");
      writeFileSync(
        agentsPath,
        agentsContent.replace(
          /^(# AGENTS\.md - v\d+\.\d+\.\d+) \(\d{4}-\d{2}-\d{2}\)$/m,
          "$1 (1999-01-01)",
        ),
      );

      const result = spawnSync(
        process.execPath,
        [join(PROJECT_ROOT, "scripts/check-instruction-parity.mjs")],
        { cwd: fixtureRoot, encoding: "utf8" },
      );

      assert.equal(result.status, 1, result.stdout);
      assert.match(result.stderr, /AGENTS\.md: header must end with/);
      assert.match(result.stderr, /1999-01-01/);
    } finally {
      rmSync(fixtureRoot, { recursive: true, force: true });
    }
  });
});
