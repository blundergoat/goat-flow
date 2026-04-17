/**
 * Integration tests for M04 `goat-flow audit --check-drift`.
 *
 * Builds a tmpdir that looks like goat-flow itself (templateRoot) plus a
 * project layout (.claude/skills, .agents/skills, .goat-flow/) and runs
 * checkDrift against it. Mirrors the preflight skill-parity check but with
 * normalized frontmatter/body comparison.
 *
 * Also runs checkDrift against this repo's own root to confirm the live
 * state stays pass.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkDrift } from "../../src/cli/audit/check-drift.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { SKILL_NAMES } from "../../src/cli/constants.js";

const SKILL_STUB = (name: string): string =>
  `---\nname: ${name}\ndescription: stub for drift test\n---\n# ${name}\nbody\n`;

const SHARED_STUB = "# shared\nbody\n";

function setupFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-drift-"));
  // Template root layout
  mkdirSync(join(root, "workflow", "skills", "reference"), { recursive: true });
  writeFileSync(
    join(root, "workflow", "skills", "reference", "skill-preamble.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "skill-conventions.md"),
    SHARED_STUB,
  );
  for (const name of SKILL_NAMES) {
    mkdirSync(join(root, "workflow", "skills", name), { recursive: true });
    writeFileSync(
      join(root, "workflow", "skills", name, "SKILL.md"),
      SKILL_STUB(name),
    );
  }
  // Project installed copies
  for (const agentDir of [".claude/skills", ".agents/skills"]) {
    for (const name of SKILL_NAMES) {
      mkdirSync(join(root, agentDir, name), { recursive: true });
      writeFileSync(join(root, agentDir, name, "SKILL.md"), SKILL_STUB(name));
    }
  }
  mkdirSync(join(root, ".goat-flow"), { recursive: true });
  writeFileSync(join(root, ".goat-flow", "skill-preamble.md"), SHARED_STUB);
  writeFileSync(join(root, ".goat-flow", "skill-conventions.md"), SHARED_STUB);
  return root;
}

describe("checkDrift: clean fixture", () => {
  let root: string;
  before(() => {
    root = setupFixture();
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("reports pass with zero findings when templates and installed copies match", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "pass");
    assert.deepEqual(report.findings, []);
    // 7 skills * 2 agent dirs + 2 shared files = 16 comparisons
    assert.equal(report.checked, SKILL_NAMES.length * 2 + 2);
  });
});

describe("checkDrift: body edit in one skill", () => {
  let root: string;
  before(() => {
    root = setupFixture();
    // Mutate one installed copy's body (not frontmatter).
    writeFileSync(
      join(root, ".claude", "skills", "goat", "SKILL.md"),
      SKILL_STUB("goat") + "\n# drift injected\n",
    );
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("detects content drift", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "fail");
    const drift = report.findings.find((f) => f.kind === "content");
    assert.ok(drift, "expected a content drift finding");
    assert.match(drift!.path, /\.claude\/skills\/goat\/SKILL\.md/);
  });
});

describe("checkDrift: frontmatter key reorder is not a false positive", () => {
  let root: string;
  before(() => {
    root = setupFixture();
    // Reorder frontmatter keys only — semantic equivalence must hold.
    writeFileSync(
      join(root, ".claude", "skills", "goat", "SKILL.md"),
      "---\ndescription: stub for drift test\nname: goat\n---\n# goat\nbody\n",
    );
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("does not flag reordered frontmatter as drift", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "pass");
    assert.deepEqual(report.findings, []);
  });
});

describe("checkDrift: missing installed copy", () => {
  let root: string;
  before(() => {
    root = setupFixture();
    // Remove one installed copy entirely.
    rmSync(join(root, ".claude", "skills", "goat"), {
      recursive: true,
      force: true,
    });
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("detects a missing install as drift", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "fail");
    const missing = report.findings.find((f) => f.kind === "missing");
    assert.ok(missing, "expected a missing finding");
    assert.match(missing!.path, /\.claude\/skills\/goat\/SKILL\.md/);
  });
});

describe("checkDrift: orphan and deprecated directory detection", () => {
  let root: string;
  before(() => {
    root = setupFixture();
    // Orphan: name not in SKILL_NAMES and not in manifest.stale_names.
    mkdirSync(join(root, ".claude", "skills", "goat-unknown"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".claude", "skills", "goat-unknown", "SKILL.md"),
      "# orphan\n",
    );
    // Deprecated: name in manifest.stale_names (goat-audit is listed).
    mkdirSync(join(root, ".agents", "skills", "goat-audit"), {
      recursive: true,
    });
    writeFileSync(
      join(root, ".agents", "skills", "goat-audit", "SKILL.md"),
      "# deprecated\n",
    );
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags orphans and deprecated separately", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "fail");
    const orphan = report.findings.find(
      (f) => f.kind === "orphan" && f.path.includes("goat-unknown"),
    );
    const deprecated = report.findings.find(
      (f) => f.kind === "deprecated" && f.path.includes("goat-audit"),
    );
    assert.ok(orphan, "expected orphan finding for goat-unknown");
    assert.ok(deprecated, "expected deprecated finding for goat-audit");
  });
});

describe("checkDrift: v1.2.0 stale names (goat-sbao, goat-test)", () => {
  let root: string;
  before(() => {
    root = setupFixture();
    for (const agentDir of [".claude/skills", ".agents/skills"]) {
      for (const staleName of ["goat-sbao", "goat-test"]) {
        mkdirSync(join(root, agentDir, staleName), { recursive: true });
        writeFileSync(
          join(root, agentDir, staleName, "SKILL.md"),
          `# ${staleName}\n`,
        );
      }
    }
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("flags goat-sbao and goat-test as deprecated per manifest.stale_names", () => {
    const report = checkDrift({
      fs: createFS(root),
      projectPath: root,
      templateRoot: root,
    });
    assert.equal(report.status, "fail");
    const deprecatedSbao = report.findings.find(
      (f) => f.kind === "deprecated" && f.path.includes("goat-sbao"),
    );
    const deprecatedTest = report.findings.find(
      (f) => f.kind === "deprecated" && f.path.includes("goat-test"),
    );
    assert.ok(deprecatedSbao, "expected deprecated finding for goat-sbao");
    assert.ok(deprecatedTest, "expected deprecated finding for goat-test");
  });
});

describe("checkDrift: this repo", () => {
  it("reports pass on goat-flow's own root (templates match installed)", () => {
    const projectPath = resolve(import.meta.dirname, "..", "..");
    const report = checkDrift({
      fs: createFS(projectPath),
      projectPath,
    });
    assert.equal(
      report.status,
      "pass",
      `goat-flow root should be drift-clean, findings=${JSON.stringify(report.findings)}`,
    );
  });
});
