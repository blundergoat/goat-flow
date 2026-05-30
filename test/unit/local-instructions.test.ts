/**
 * Unit tests for project-local instruction fact extraction.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { extractLocalInstructions } from "../../src/cli/facts/shared/local-instructions.js";
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
    assert.equal(facts.fileCount, 3);
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
