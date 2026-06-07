/**
 * Unit tests for project-local instruction fact extraction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
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
