/**
 * Contract tests for M06 instruction file quality guards.
 * Validates the preflight guard patterns against fixture data.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const MANIFEST_PATH = resolve(PROJECT_ROOT, "workflow/manifest.json");

describe("instruction file line-count guard", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const lineTarget = manifest.instruction_file.line_target;
  const lineLimit = manifest.instruction_file.line_limit;

  it("reads thresholds from manifest", () => {
    assert.equal(lineTarget, 120);
    assert.equal(lineLimit, 150);
  });

  it("all live instruction files are under line_target", () => {
    for (const agent of Object.values(manifest.agents) as Array<{
      instruction_file: string;
    }>) {
      const ifile = resolve(PROJECT_ROOT, agent.instruction_file);
      const count = readFileSync(ifile, "utf-8").split(/\r?\n/).length - 1;
      assert.ok(
        count <= lineTarget,
        `${agent.instruction_file} has ${count} lines (wc-l), target is ${lineTarget}`,
      );
    }
  });

  it("detects a file over line_limit", () => {
    const tmp = mkdtempSync(join(tmpdir(), "goat-line-"));
    try {
      const over = Array.from(
        { length: lineLimit + 5 },
        (_, i) => `line ${i}`,
      ).join("\n");
      writeFileSync(join(tmp, "OVER.md"), over);
      const count = execSync(`wc -l < "${join(tmp, "OVER.md")}"`)
        .toString()
        .trim();
      assert.ok(
        Number(count) > lineLimit,
        `fixture should exceed line_limit (${count} > ${lineLimit})`,
      );
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("encyclopedia guard", () => {
  const patterns =
    "database schema|api reference|endpoint list|table definition|historical background|architecture history|full project overview";
  const regex = new RegExp(patterns, "i");

  it("matches known encyclopedia indicators", () => {
    assert.ok(regex.test("## Database Schema"));
    assert.ok(regex.test("See the API Reference below"));
    assert.ok(regex.test("Historical background of the project"));
    assert.ok(regex.test("Full project overview"));
  });

  it("does not match normal instruction content", () => {
    assert.ok(!regex.test("## Execution Loop: READ → SCOPE → ACT → VERIFY"));
    assert.ok(!regex.test("Router Table"));
    assert.ok(!regex.test("shellcheck scripts/*.sh"));
    assert.ok(!regex.test(".goat-flow/architecture.md"));
  });

  it("live instruction files have no encyclopedia hits", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    for (const agent of Object.values(manifest.agents) as Array<{
      instruction_file: string;
    }>) {
      const content = readFileSync(
        resolve(PROJECT_ROOT, agent.instruction_file),
        "utf-8",
      );
      for (const line of content.split("\n")) {
        assert.ok(
          !regex.test(line),
          `${agent.instruction_file} contains encyclopedia content: ${line.trim().slice(0, 80)}`,
        );
      }
    }
  });
});

describe("downstream-content guard", () => {
  const patterns =
    /healthkit|Halaxy|PracGroup|LinkPaG|\/home\/hxdev\/|\/home\/devgoat\/projects\/healthkit/i;

  it("matches downstream project names", () => {
    assert.ok(patterns.test("Use healthkit conventions"));
    assert.ok(patterns.test("Halaxy API"));
    assert.ok(patterns.test("/home/hxdev/projects/foo"));
  });

  it("live instruction files have no downstream hits", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    for (const agent of Object.values(manifest.agents) as Array<{
      instruction_file: string;
    }>) {
      const content = readFileSync(
        resolve(PROJECT_ROOT, agent.instruction_file),
        "utf-8",
      );
      assert.ok(
        !patterns.test(content),
        `${agent.instruction_file} contains downstream project content`,
      );
    }
  });

  it("live setup templates have no downstream hits", () => {
    const templates = [
      "workflow/setup/reference/execution-loop.md",
      "workflow/setup/02-instruction-file.md",
      "workflow/setup/agents/claude.md",
      "workflow/setup/agents/codex.md",
      "workflow/setup/agents/copilot.md",
      "workflow/setup/agents/gemini.md",
    ];
    for (const t of templates) {
      const path = resolve(PROJECT_ROOT, t);
      const content = readFileSync(path, "utf-8");
      assert.ok(
        !patterns.test(content),
        `${t} contains downstream project content`,
      );
    }
  });
});

describe("Router Table path parity", () => {
  function extractRouterPaths(content: string): Set<string> {
    const lines = content.split(/\r?\n/);
    let inSection = false;
    const paths = new Set<string>();
    for (const line of lines) {
      if (/^##\s+Router\s+Table/i.test(line)) {
        inSection = true;
        continue;
      }
      if (inSection && /^##\s/.test(line)) break;
      if (!inSection) continue;
      for (const m of line.matchAll(/`([^`]+)`/g)) {
        const raw = m[1];
        const wasDir = raw.endsWith("/");
        const p = raw.replace(/\/+$/, "");
        if (/^\.(claude|github|agents|codex|gemini)\//.test(p)) continue;
        if (
          p.includes("/") ||
          p.endsWith(".md") ||
          p.endsWith(".yaml") ||
          wasDir
        )
          paths.add(p);
      }
    }
    return paths;
  }

  function hasCoverage(pathSet: Set<string>, target: string): boolean {
    if (pathSet.has(target)) return true;
    for (const p of pathSet) {
      if (target.startsWith(p + "/")) return true;
    }
    return false;
  }

  it("extracts paths from a Router Table section", () => {
    const fixture = [
      "# Test",
      "## Router Table",
      "| Resource | Path |",
      "|----------|------|",
      "| Arch | `.goat-flow/architecture.md` |",
      "| Code | `src/cli/` |",
      "## Next Section",
    ].join("\n");
    const paths = extractRouterPaths(fixture);
    assert.ok(paths.has(".goat-flow/architecture.md"));
    assert.ok(paths.has("src/cli"));
    assert.equal(paths.size, 2);
  });

  it("parent directory covers child paths", () => {
    const paths = new Set([".goat-flow/skill-reference"]);
    assert.ok(hasCoverage(paths, ".goat-flow/skill-reference/README.md"));
    assert.ok(!hasCoverage(paths, ".goat-flow/footguns/runtime.md"));
  });

  it("detects missing path in a fixture set", () => {
    const fileA = extractRouterPaths(
      "## Router Table\n| A | `.goat-flow/architecture.md` |\n| B | `.goat-flow/footguns/` |\n## End",
    );
    const fileB = extractRouterPaths(
      "## Router Table\n| A | `.goat-flow/architecture.md` |\n| B | `.goat-flow/footguns/` |\n## End",
    );
    const fileC = extractRouterPaths(
      "## Router Table\n| A | `.goat-flow/architecture.md` |\n## End",
    );

    const allPaths = new Set<string>();
    for (const s of [fileA, fileB, fileC]) for (const p of s) allPaths.add(p);

    const missing: string[] = [];
    for (const p of allPaths) {
      const files = [fileA, fileB, fileC];
      const present = files.filter((f) => hasCoverage(f, p)).length;
      if (present >= 2 && present < 3) missing.push(p);
    }
    assert.ok(
      missing.includes(".goat-flow/footguns"),
      `Should detect .goat-flow/footguns missing from fileC, got: ${missing}`,
    );
  });

  it("live instruction files pass parity", () => {
    const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
    const files: Array<{ name: string; paths: Set<string> }> = [];
    for (const [id, agent] of Object.entries(manifest.agents) as Array<
      [string, { instruction_file: string }]
    >) {
      const content = readFileSync(
        resolve(PROJECT_ROOT, agent.instruction_file),
        "utf-8",
      );
      files.push({ name: id, paths: extractRouterPaths(content) });
    }

    const allPaths = new Set<string>();
    for (const f of files) for (const p of f.paths) allPaths.add(p);

    const majority = Math.ceil(files.length / 2);
    const gaps: string[] = [];
    for (const p of allPaths) {
      const present = files.filter((f) => hasCoverage(f.paths, p)).length;
      if (present >= majority && present < files.length) {
        const missing = files
          .filter((f) => !hasCoverage(f.paths, p))
          .map((f) => f.name);
        for (const m of missing) {
          const basename = manifest.agents[m]?.instruction_file || m;
          if (p === basename || p.endsWith("/" + basename)) continue;
          gaps.push(`${p} missing from ${m}`);
        }
      }
    }
    assert.equal(
      gaps.length,
      0,
      `Router Table path parity gaps: ${gaps.join("; ")}`,
    );
  });
});
