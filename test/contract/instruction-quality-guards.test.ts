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
const SETUP_AGENT_GUIDES = [
  "workflow/setup/agents/claude.md",
  "workflow/setup/agents/codex.md",
  "workflow/setup/agents/copilot.md",
  "workflow/setup/agents/antigravity.md",
];
const CANONICAL_SETUP_SECTIONS = [
  "Truth Order",
  "Autonomy Tiers",
  "Hard Rules",
  "Key Resources",
  "Essential Commands",
  "Execution Loop",
  "Definition of Done",
  "Artifact Routing",
  "Router Table",
];

function h2Sections(content: string): string[] {
  return Array.from(content.matchAll(/^##\s+(.+)$/gm), (m) => {
    const heading = m[1].trim();
    return /^Execution Loop\b/i.test(heading) ? "Execution Loop" : heading;
  });
}

describe("instruction file line-count guard", () => {
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf-8"));
  const lineTarget = manifest.instruction_file.line_target;
  const lineLimit = manifest.instruction_file.line_limit;

  it("reads thresholds from manifest", () => {
    assert.equal(lineTarget, 125);
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

describe("setup agent guide structure", () => {
  it("all setup agent guides follow the canonical policy-first order", () => {
    for (const guide of SETUP_AGENT_GUIDES) {
      const content = readFileSync(resolve(PROJECT_ROOT, guide), "utf-8");
      assert.deepEqual(h2Sections(content), CANONICAL_SETUP_SECTIONS, guide);
    }
  });

  it("all setup agent guides point at the shared instruction skeleton", () => {
    for (const guide of SETUP_AGENT_GUIDES) {
      const content = readFileSync(resolve(PROJECT_ROOT, guide), "utf-8");
      assert.match(content, /workflow\/setup\/reference\/execution-loop\.md/);
      assert.match(content, /workflow\/setup\/02-instruction-file\.md/);
    }
  });

  it("the shared skeleton names every required hot-path section", () => {
    const content = readFileSync(
      resolve(PROJECT_ROOT, "workflow/setup/reference/execution-loop.md"),
      "utf-8",
    );
    for (const section of CANONICAL_SETUP_SECTIONS) {
      assert.match(content, new RegExp(`\\b${section}\\b`), section);
    }
  });

  it("setup references stay generic and avoid controlling-workspace router rows", () => {
    const checkedFiles = [
      "workflow/setup/reference/execution-loop.md",
      "workflow/setup/02-instruction-file.md",
      ...SETUP_AGENT_GUIDES,
    ];
    const repoOnly =
      /src\/cli|src\/dashboard|This repo is the goat-flow controlling workspace/;
    for (const file of checkedFiles) {
      const content = readFileSync(resolve(PROJECT_ROOT, file), "utf-8");
      assert.ok(
        !repoOnly.test(content),
        `${file} contains goat-flow-only rows`,
      );
    }
  });

  it("Copilot setup preserves standalone hot-path guidance", () => {
    const content = readFileSync(
      resolve(PROJECT_ROOT, "workflow/setup/agents/copilot.md"),
      "utf-8",
    );
    assert.match(content, /\.github\/copilot-instructions\.md` is standalone/);
    assert.match(content, /must not defer to `AGENTS\.md`/);
    assert.match(content, /125-line target/);
    assert.match(content, /150-line hard limit/);
  });
});

describe("instruction parity script", () => {
  it("passes for setup guides and live hot-path instruction files", () => {
    const output = execSync("node scripts/check-instruction-parity.mjs", {
      cwd: PROJECT_ROOT,
      encoding: "utf-8",
    });
    assert.match(output, /Instruction parity passed/);
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
        if (/^\.(claude|github|agents|codex)\//.test(p)) continue;
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
