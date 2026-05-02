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
import { spawnSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { checkDrift } from "../../src/cli/audit/check-drift.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { SKILL_NAMES } from "../../src/cli/constants.js";
import {
  getInstalledSkillRoots,
  getSkillFiles,
} from "../../src/cli/manifest/manifest.js";

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const INSTALL_FIXTURE_SKILL = "skill-with-references";
const INSTALL_FIXTURE_FILES = ["SKILL.md", "references/sample.md"] as const;

const SKILL_STUB = (name: string): string =>
  `---\nname: ${name}\ndescription: stub for drift test\n---\n# ${name}\nbody\n`;

const SHARED_STUB = "# shared\nbody\n";
const HOOK_STUB = "#!/usr/bin/env bash\n# deny hook stub\n";
const COPILOT_HOOK_CONFIG_STUB =
  '{\n  "version": 1,\n  "hooks": { "preToolUse": [] }\n}\n';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

function writeSkillFiles(root: string, baseDir: string, name: string): void {
  for (const relativeFile of getSkillFiles(name)) {
    const fullPath = join(root, baseDir, name, relativeFile);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(
      fullPath,
      relativeFile === "SKILL.md" ? SKILL_STUB(name) : SHARED_STUB,
    );
  }
}

function setupFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-drift-"));
  // Template root layout
  mkdirSync(join(root, "workflow", "skills", "reference"), { recursive: true });
  writeFileSync(
    join(root, "workflow", "skills", "reference", "README.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "skill-preamble.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "skill-conventions.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "browser-use.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "page-capture.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "reference", "skill-quality-testing.md"),
    SHARED_STUB,
  );
  mkdirSync(
    join(root, "workflow", "skills", "reference", "skill-quality-testing"),
    { recursive: true },
  );
  for (const topical of [
    "tdd-iteration",
    "adversarial-framing",
    "deployment",
  ]) {
    writeFileSync(
      join(
        root,
        "workflow",
        "skills",
        "reference",
        "skill-quality-testing",
        `${topical}.md`,
      ),
      SHARED_STUB,
    );
  }
  for (const name of SKILL_NAMES) {
    writeSkillFiles(root, join("workflow", "skills"), name);
  }
  // Project installed copies
  for (const agentDir of getInstalledSkillRoots()) {
    for (const name of SKILL_NAMES) {
      writeSkillFiles(root, agentDir, name);
    }
  }
  mkdirSync(join(root, ".goat-flow", "skill-reference"), { recursive: true });
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "README.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "skill-preamble.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "skill-conventions.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "browser-use.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "page-capture.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-reference", "skill-quality-testing.md"),
    SHARED_STUB,
  );
  mkdirSync(
    join(root, ".goat-flow", "skill-reference", "skill-quality-testing"),
    { recursive: true },
  );
  for (const topical of [
    "tdd-iteration",
    "adversarial-framing",
    "deployment",
  ]) {
    writeFileSync(
      join(
        root,
        ".goat-flow",
        "skill-reference",
        "skill-quality-testing",
        `${topical}.md`,
      ),
      SHARED_STUB,
    );
  }
  return root;
}

function writeHookFixtures(root: string): void {
  mkdirSync(join(root, "workflow", "hooks", "agent-config"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "workflow", "hooks", "deny-dangerous.sh"),
    HOOK_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "agent-config", "copilot-hooks.json"),
    COPILOT_HOOK_CONFIG_STUB,
  );
  for (const hooksDir of [
    ".claude/hooks",
    ".codex/hooks",
    ".gemini/hooks",
    ".github/hooks",
  ]) {
    mkdirSync(join(root, hooksDir), { recursive: true });
    writeFileSync(join(root, hooksDir, "deny-dangerous.sh"), HOOK_STUB);
  }
  writeFileSync(
    join(root, ".github", "hooks", "hooks.json"),
    COPILOT_HOOK_CONFIG_STUB,
  );
}

function setupInstallRoundTripFixture(): string {
  const parent = mkdtempSync(join(tmpdir(), "goat-flow-install-roundtrip-"));
  const root = join(parent, "repo");
  cpSync(PROJECT_ROOT, root, {
    recursive: true,
    filter: (src) => {
      const rel = relative(PROJECT_ROOT, src);
      if (rel === "") return true;
      const [topLevel] = rel.split(sep);
      if (topLevel === ".git" || topLevel === "node_modules") return false;
      return rel !== join(".goat-flow", "logs", "sessions");
    },
  });
  symlinkSync(join(PROJECT_ROOT, "node_modules"), join(root, "node_modules"));
  return root;
}

function patchInstallRoundTripFixture(root: string): {
  agentIds: string[];
  skillRoots: string[];
} {
  const manifestPath = join(root, "workflow", "manifest.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
    agents: Record<string, { skills_dir: string }>;
    skills: {
      canonical: string[];
      references?: Record<string, string[]>;
    };
  };

  if (!manifest.skills.canonical.includes(INSTALL_FIXTURE_SKILL)) {
    manifest.skills.canonical.push(INSTALL_FIXTURE_SKILL);
  }
  manifest.skills.references = {
    ...(manifest.skills.references ?? {}),
    [INSTALL_FIXTURE_SKILL]: [...INSTALL_FIXTURE_FILES].filter(
      (file) => file !== "SKILL.md",
    ),
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

  const constantsPath = join(root, "src", "cli", "constants.ts");
  const constants = readFileSync(constantsPath, "utf8");
  if (!constants.includes(`"${INSTALL_FIXTURE_SKILL}"`)) {
    writeFileSync(
      constantsPath,
      constants.replace(
        /\] as const;/,
        `  "${INSTALL_FIXTURE_SKILL}",\n] as const;`,
      ),
    );
  }

  const packagePath = join(root, "package.json");
  const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
  };
  pkg.scripts = {
    ...(pkg.scripts ?? {}),
    test: 'node -e "console.log(`# tests 1\\n# pass 1\\n# fail 0`)"',
  };
  writeFileSync(packagePath, JSON.stringify(pkg, null, 2) + "\n");

  cpSync(
    join(PROJECT_ROOT, "test", "fixtures", INSTALL_FIXTURE_SKILL),
    join(root, "workflow", "skills", INSTALL_FIXTURE_SKILL),
    { recursive: true },
  );

  return {
    agentIds: Object.keys(manifest.agents),
    skillRoots: [
      ...new Set(
        Object.values(manifest.agents).map((agent) =>
          agent.skills_dir.replace(/\/$/, ""),
        ),
      ),
    ],
  };
}

function runCommand(
  cwd: string,
  command: string,
  args: string[],
  timeout = 60000,
): CommandResult {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf-8",
    timeout,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
  };
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
    const expectedSkillComparisons =
      SKILL_NAMES.reduce(
        (total, name) => total + getSkillFiles(name).length,
        0,
      ) * getInstalledSkillRoots().length;
    assert.equal(report.checked, expectedSkillComparisons + 9);
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
    // Reorder frontmatter keys only - semantic equivalence must hold.
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

describe("checkDrift: hook templates", () => {
  it("reports pass when installed hook scripts and Copilot config match templates", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(
        report.status,
        "pass",
        `expected hook fixture drift-clean, findings=${JSON.stringify(report.findings)}`,
      );
      assert.ok(
        report.checked >= 5,
        `expected hook comparisons to contribute to checked count, got ${report.checked}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports hook content drift for changed installed scripts", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".codex", "hooks", "deny-dangerous.sh"),
        `${HOOK_STUB}\n# local drift\n`,
      );
      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(report.status, "fail");
      assert.ok(
        report.findings.some(
          (finding) =>
            finding.kind === "content" &&
            finding.path === ".codex/hooks/deny-dangerous.sh",
        ),
        `expected .codex hook drift, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports missing installed hook scripts", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      rmSync(join(root, ".gemini", "hooks", "deny-dangerous.sh"), {
        force: true,
      });
      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(report.status, "fail");
      assert.ok(
        report.findings.some(
          (finding) =>
            finding.kind === "missing" &&
            finding.path === ".gemini/hooks/deny-dangerous.sh",
        ),
        `expected missing .gemini hook finding, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("compares Copilot hooks.json against the agent-config template", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        '{\n  "version": 1,\n  "hooks": { "preToolUse": [{ "type": "changed" }] }\n}\n',
      );
      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(report.status, "fail");
      assert.ok(
        report.findings.some(
          (finding) =>
            finding.kind === "content" &&
            finding.path === ".github/hooks/hooks.json" &&
            finding.message.includes(
              "workflow/hooks/agent-config/copilot-hooks.json",
            ),
        ),
        `expected Copilot hook-config drift, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
    for (const agentDir of getInstalledSkillRoots()) {
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

describe("checkDrift: installer round-trip fixture", () => {
  let root: string;
  before(() => {
    assert.ok(
      existsSync(join(PROJECT_ROOT, "node_modules")),
      "node_modules must exist for temp-repo preflight coverage",
    );
    assert.ok(
      existsSync(join(PROJECT_ROOT, "dist", "cli", "cli.js")),
      "run npm run build before this test",
    );
    root = setupInstallRoundTripFixture();
  });
  after(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it(
    "installs fixture-backed references, passes preflight, and reports zero drift",
    { timeout: 400000 },
    () => {
      const { agentIds, skillRoots } = patchInstallRoundTripFixture(root);
      const format = runCommand(
        root,
        "npx",
        [
          "prettier",
          "--write",
          "workflow/manifest.json",
          "src/cli/constants.ts",
          "package.json",
        ],
        60000,
      );
      assert.equal(
        format.status,
        0,
        `prettier should format temp round-trip files:\n${format.output}`,
      );

      for (const agentId of agentIds) {
        const install = runCommand(
          root,
          "bash",
          ["workflow/install-goat-flow.sh", root, "--agent", agentId],
          60000,
        );
        assert.equal(
          install.status,
          0,
          `install for ${agentId} should pass:\n${install.output}`,
        );
      }

      for (const skillRoot of skillRoots) {
        for (const relativeFile of INSTALL_FIXTURE_FILES) {
          assert.ok(
            existsSync(
              join(root, skillRoot, INSTALL_FIXTURE_SKILL, relativeFile),
            ),
            `expected ${skillRoot}/${INSTALL_FIXTURE_SKILL}/${relativeFile} to exist after install`,
          );
        }
      }

      const preflight = runCommand(
        root,
        "bash",
        ["scripts/preflight-checks.sh"],
        400000,
      );
      assert.equal(
        preflight.status,
        0,
        `preflight should pass in temp round-trip repo:\n${preflight.output}`,
      );
      assert.match(preflight.output, /PREFLIGHT PASSED/);
      assert.match(
        preflight.output,
        /All installed skill files match workflow templates/,
      );

      const drift = runCommand(
        root,
        "node",
        ["dist/cli/cli.js", "audit", ".", "--check-drift", "--format", "json"],
        60000,
      );
      assert.equal(
        drift.status,
        0,
        `drift audit should pass after round-trip install:\n${drift.output}`,
      );

      const report = JSON.parse(drift.stdout) as {
        status: string;
        drift: { status: string; findings: unknown[] } | null;
      };
      assert.equal(report.status, "pass");
      assert.equal(report.drift?.status, "pass");
      assert.deepEqual(report.drift?.findings ?? [], []);
    },
  );
});

describe("checkDrift: this repo", () => {
  it("reports pass on goat-flow's own root (templates match installed)", () => {
    const report = checkDrift({
      fs: createFS(PROJECT_ROOT),
      projectPath: PROJECT_ROOT,
    });
    assert.equal(
      report.status,
      "pass",
      `goat-flow root should be drift-clean, findings=${JSON.stringify(report.findings)}`,
    );
  });
});
