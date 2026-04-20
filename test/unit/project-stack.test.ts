/**
 * Unit tests for project stack detection.
 * Pins the externalized table data so detector behavior stays stable.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectStack } from "../../src/cli/detect/project-stack.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

/** Build a minimal ReadonlyFS stub for stack-detection tests. */
function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  return {
    exists: () => false,
    readFile: () => null,
    lineCount: () => 0,
    readJson: () => null,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    ...overrides,
  };
}

describe("detectStack", () => {
  it("loads external detection tables and preserves stack inference", () => {
    const existing = new Set([
      "tsconfig.json",
      "sqlc.yaml",
      "Dockerfile",
      ".env.example",
      "README.md",
      "eslint.config.js",
    ]);
    const fs = stubFS({
      exists: (path) => existing.has(path),
      readJson: (path) =>
        path === "package.json"
          ? {
              dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
              devDependencies: {
                eslint: "^10.0.0",
                typescript: "^5.0.0",
              },
            }
          : null,
      readFile: (path) => {
        if (path === ".env.example") return "OPENAI_API_KEY=test";
        if (path === "README.md") return "HIPAA workflow";
        return null;
      },
      glob: (pattern) => {
        if (pattern === "src/**/*.ts") return ["src/app.ts"];
        if (pattern === "**/*.blade.php")
          return ["resources/views/home.blade.php"];
        if (pattern === "src/**/*.*") return ["src/app.ts"];
        return [];
      },
    });

    const stack = detectStack(fs);
    assert.deepEqual(stack.languages, [
      "javascript",
      "typescript",
      "react",
      "blade",
    ]);
    assert.equal(stack.signals.codeGenTools.includes("sqlc"), true);
    assert.equal(stack.signals.deployPlatforms.includes("docker"), true);
    assert.equal(stack.signals.llmIntegration, true);
    assert.equal(stack.signals.complianceSignals, true);
    assert.deepEqual(stack.signals.staticAnalysis, [
      { tool: "eslint", level: null },
    ]);
    assert.deepEqual(stack.signals.formatterGaps, ["javascript", "typescript"]);
    assert.equal(stack.sourceFileCount, 1);
  });

  it("falls back to markdown-only when no code stack is detected", () => {
    const fs = stubFS({
      glob: (pattern) =>
        pattern === "**/*.md" ? Array(6).fill("README.md") : [],
    });

    const stack = detectStack(fs);
    assert.deepEqual(stack.languages, ["markdown"]);
    assert.equal(stack.signals.codeGenTools.length, 0);
    assert.equal(stack.signals.deployPlatforms.length, 0);
  });
});
