/**
 * Unit tests for project stack detection.
 * Use these fixtures to verify the setup UI reports frameworks and languages
 * from observable files without depending on a developer's real workspace.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { performance } from "node:perf_hooks";
import {
  detectSetupStack,
  detectStack,
} from "../../src/cli/detect/project-stack.js";
import {
  PROJECT_STACK_DEPLOYMENT_SIGNALS,
  PROJECT_STACK_NODE_FRAMEWORKS,
} from "../../src/cli/detect/project-stack-data.js";
import {
  hasAnyGlob,
  hasAnyPath,
  readFirstExistingFile,
} from "../../src/cli/detect/project-stack-files.js";
import {
  countSourceFiles,
  detectProjectSignals,
} from "../../src/cli/detect/project-stack-signals.js";
import { createFS } from "../../src/cli/facts/fs.js";
import type { ReadonlyFS } from "../../src/cli/types.js";

/** Build a minimal ReadonlyFS stub for stack-detection tests. */
function stubFS(overrides: Partial<ReadonlyFS> = {}): ReadonlyFS {
  const fs = {
    exists: () => false,
    readFile: () => null,
    lineCount: () => 0,
    readJson: () => null,
    isReadableDirectory: () => false,
    listDir: () => [],
    isExecutable: () => false,
    glob: () => [],
    ...overrides,
  };
  return {
    ...fs,
    existsGlob:
      overrides.existsGlob ??
      ((pattern: string) => fs.glob(pattern).length > 0),
  };
}

/** Write a nested file inside a temp project, creating parent directories first. */
async function writeFileInProject(
  root: string,
  path: string,
  content = "",
): Promise<void> {
  const fullPath = join(root, path);
  await mkdir(dirname(fullPath), { recursive: true });
  await writeFile(fullPath, content);
}

/** Build the mixed-stack fixture that exercises table-driven stack detection. */
function mixedStackDetectionFS(): ReadonlyFS {
  const existing = new Set([
    "tsconfig.json",
    "sqlc.yaml",
    "Dockerfile",
    ".env.example",
    "README.md",
    "eslint.config.js",
  ]);
  return stubFS({
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
      if (pattern === "**/*.blade.php") {
        return ["resources/views/home.blade.php"];
      }
      if (pattern === "src/**/*.*") return ["src/app.ts"];
      return [];
    },
  });
}

describe("detectStack", () => {
  it("keeps low-level stack helpers aligned with table-driven detection", () => {
    const fs = mixedStackDetectionFS();

    assert.equal(hasAnyPath(fs, ["missing", "tsconfig.json"]), true);
    assert.equal(hasAnyGlob(fs, ["missing/**", "src/**/*.ts"]), true);
    assert.equal(
      readFirstExistingFile(fs, ["missing", "README.md"]),
      "HIPAA workflow",
    );
    assert.equal(countSourceFiles(fs), 1);
    assert.equal(
      detectProjectSignals(fs, ["typescript"], null).llmIntegration,
      true,
    );
    assert.ok(
      PROJECT_STACK_NODE_FRAMEWORKS.some(
        (framework) => framework.language === "react",
      ),
    );
    assert.ok(
      PROJECT_STACK_DEPLOYMENT_SIGNALS.some(
        (signal) => signal.tool === "docker",
      ),
    );
  });

  it("loads external detection tables and preserves stack inference", () => {
    const stack = detectStack(mixedStackDetectionFS());
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

  it("detects PHP Symfony and PHPStan without losing static-analysis signals", () => {
    const fs = stubFS({
      readJson: (path) =>
        path === "composer.json"
          ? {
              require: { "symfony/framework-bundle": "^7.0" },
              scripts: { test: "phpunit", analyse: "phpstan analyse" },
            }
          : null,
      readFile: (path) => (path === "phpstan.neon" ? "level: max" : null),
    });

    const stack = detectStack(fs);
    assert.deepEqual(stack.languages, ["php", "symfony"]);
    assert.equal(stack.testCommand, "phpunit");
    assert.deepEqual(stack.signals.staticAnalysis, [
      { tool: "phpstan", level: "max" },
    ]);
  });

  it("detects Python from subdirectory manifests", () => {
    const fs = stubFS({
      existsGlob: (pattern) => pattern === "*/pyproject.toml",
    });

    const stack = detectStack(fs);
    assert.deepEqual(stack.languages, ["python"]);
    assert.equal(stack.testCommand, null);
  });

  it("detects Twig templates and Terraform deployment signals", () => {
    const fs = stubFS({
      existsGlob: (pattern) => pattern === "**/*.twig" || pattern === "**/*.tf",
    });

    const stack = detectStack(fs);
    assert.equal(stack.languages.includes("twig"), true);
    assert.equal(stack.signals.deployPlatforms.includes("terraform"), true);
  });

  it("uses existsGlob for existence-only recursive stack checks", () => {
    const existsGlobCalls: string[] = [];
    const fs = stubFS({
      exists: (path) => path === "tsconfig.json",
      existsGlob: (pattern) => {
        existsGlobCalls.push(pattern);
        return pattern === "**/*.sh";
      },
      glob: (pattern) => {
        if (
          [
            "**/*.html",
            "**/*.md",
            "src/**/*.*",
            "lib/**/*.*",
            "app/**/*.*",
            "packages/**/*.*",
          ].includes(pattern)
        ) {
          return [];
        }
        throw new Error(`unexpected collect-all glob: ${pattern}`);
      },
    });

    const stack = detectStack(fs);
    assert.equal(stack.languages.includes("bash"), true);
    assert.equal(existsGlobCalls.includes("**/*.sh"), true);
    assert.equal(existsGlobCalls.includes("**/*.csproj"), true);
  });

  it("stays under the synthetic large-tree stack-detection budget", async () => {
    const root = await mkdtemp(join(tmpdir(), "goat-flow-stack-tests-"));
    try {
      await writeFileInProject(
        root,
        "package.json",
        JSON.stringify({
          scripts: { test: "node --test", build: "tsc" },
          devDependencies: { typescript: "^5.0.0" },
        }),
      );
      await writeFileInProject(root, "tsconfig.json", "{}\n");
      for (let i = 0; i < 1200; i++) {
        await writeFileInProject(
          root,
          `src/group-${Math.floor(i / 100)}/file-${i}.ts`,
          `export const value${i} = ${i};\n`,
        );
      }

      const start = performance.now();
      const stack = detectStack(createFS(root));
      const durationMs = performance.now() - start;

      assert.equal(stack.languages.includes("typescript"), true);
      assert.ok(
        durationMs < 1500,
        `detectStack took ${durationMs.toFixed(3)}ms on synthetic large tree`,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("detectSetupStack", () => {
  it("derives setup languages, frameworks, and commands from the canonical stack", () => {
    const fs = stubFS({
      exists: (path) => path === "tsconfig.json" || path === "sqlc.yaml",
      readJson: (path) =>
        path === "package.json"
          ? {
              dependencies: {
                react: "^18.0.0",
                "react-dom": "^18.0.0",
                next: "^14.0.0",
              },
              devDependencies: { typescript: "^5.0.0" },
              scripts: {
                build: "next build",
                lint: "next lint",
                test: "vitest run",
                format: "prettier --check .",
              },
            }
          : null,
      readFile: (path) => {
        if (path === "README.md") return "HIPAA workflow";
        return null;
      },
      glob: (pattern) => {
        if (pattern === "src/**/*.ts") return ["src/app.ts"];
        if (pattern === "src/**/*.*") return ["src/app.ts"];
        return [];
      },
    });

    const setup = detectSetupStack(fs);
    assert.deepEqual(setup.languages, ["JavaScript", "TypeScript"]);
    assert.deepEqual(setup.frameworks, ["React", "Next.js"]);
    assert.deepEqual(setup.commands, {
      build: "next build",
      test: "vitest run",
      lint: "next lint",
      format: "prettier --check .",
    });
  });
});
