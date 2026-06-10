/**
 * Integration tests for `goat-flow audit --check-drift`.
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
import { assertExists } from "../helpers/assert-exists.ts";
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

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const INSTALL_FIXTURE_SKILL = "skill-with-references";
export const INSTALL_FIXTURE_FILES = [
  "SKILL.md",
  "references/sample.md",
] as const;

export const SKILL_STUB = (name: string): string =>
  `---\nname: ${name}\ndescription: stub for drift test\n---\n# ${name}\nbody\n`;

export const SHARED_STUB = "# shared\nbody\n";
export const HOOK_STUB = "#!/usr/bin/env bash\n# deny hook stub\n";
export const COPILOT_HOOK_CONFIG_STUB =
  '{\n  "version": 1,\n  "hooks": { "preToolUse": [] }\n}\n';
export const COPILOT_GRUFF_HOOK_ENTRY = {
  type: "command",
  bash: ".goat-flow/hooks/gruff-code-quality.sh",
  powershell:
    'if (Get-Command bash -ErrorAction SilentlyContinue) { bash .goat-flow/hooks/gruff-code-quality.sh } else { Write-Output \'{"permissionDecision":"deny","permissionDecisionReason":"Bash, Git Bash, or WSL is required to run .goat-flow/hooks/gruff-code-quality.sh on Windows."}\' }',
  timeoutSec: 90,
};

/** Captured subprocess result used by install-roundtrip drift assertions. */
export interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
  output: string;
}

/**
 * Write canonical skill stubs (SKILL.md plus shared reference files) for one skill into a
 * template or installed mirror under the fixture root, so drift comparison sees matching copies.
 *
 * @param root - the temp fixture root the files are written beneath
 * @param baseDir - skills directory relative to root (e.g. "workflow/skills" or an installed dir)
 * @param name - skill name; selects the SKILL.md stub and names its directory
 */
export function writeSkillFiles(
  root: string,
  baseDir: string,
  name: string,
): void {
  for (const relativeFile of getSkillFiles(name)) {
    const fullPath = join(root, baseDir, name, relativeFile);
    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(
      fullPath,
      relativeFile === "SKILL.md" ? SKILL_STUB(name) : SHARED_STUB,
    );
  }
}

/**
 * Build a complete filesystem drift fixture: workflow template references, playbooks, and skill
 * sources, plus their installed mirrors under .goat-flow, so checkDrift sees a fully-parity tree.
 *
 * @returns the temp fixture root path; the caller is responsible for cleaning it up
 */
export function setupFixture(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-drift-"));
  // Template: meta references stay under workflow/skills/reference/
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
  // Template: standalone playbooks live under workflow/skills/playbooks/
  mkdirSync(join(root, "workflow", "skills", "playbooks"), { recursive: true });
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "README.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "browser-use.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "code-comments.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "gruff-code-quality.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "observability.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "changelog.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "page-capture.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "release-notes.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "skill-quality-testing.md"),
    SHARED_STUB,
  );
  mkdirSync(
    join(root, "workflow", "skills", "playbooks", "skill-quality-testing"),
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
        "playbooks",
        "skill-quality-testing",
        `${topical}.md`,
      ),
      SHARED_STUB,
    );
  }
  for (const name of SKILL_NAMES) {
    writeSkillFiles(root, join("workflow", "skills"), name);
  }
  // Project installed copies of skill files
  for (const agentDir of getInstalledSkillRoots()) {
    for (const name of SKILL_NAMES) {
      writeSkillFiles(root, agentDir, name);
    }
  }
  // Installed: meta references under .goat-flow/skill-docs/
  mkdirSync(join(root, ".goat-flow", "skill-docs"), { recursive: true });
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "README.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "skill-preamble.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "skill-conventions.md"),
    SHARED_STUB,
  );
  // Installed: standalone playbooks under .goat-flow/skill-docs/playbooks/
  mkdirSync(join(root, ".goat-flow", "skill-docs", "playbooks"), {
    recursive: true,
  });
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "README.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "browser-use.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "code-comments.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(
      root,
      ".goat-flow",
      "skill-docs",
      "playbooks",
      "gruff-code-quality.md",
    ),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "observability.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "changelog.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "page-capture.md"),
    SHARED_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "skill-docs", "playbooks", "release-notes.md"),
    SHARED_STUB,
  );
  mkdirSync(join(root, ".goat-flow", "skill-docs", "skill-quality-testing"), {
    recursive: true,
  });
  writeFileSync(
    join(
      root,
      ".goat-flow",
      "skill-docs",
      "skill-quality-testing",
      "README.md",
    ),
    SHARED_STUB,
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
        "skill-docs",
        "skill-quality-testing",
        `${topical}.md`,
      ),
      SHARED_STUB,
    );
  }
  return root;
}

/**
 * Write deny-dangerous hook fixtures - workflow source hooks plus the installed central hooks
 * under .goat-flow/hooks - so drift checks that compare hook manifests find parity.
 * Writes files and creates directories on the filesystem under root.
 *
 * @param root - the temp fixture root the hook source and installed copies are written beneath
 */
export function writeHookFixtures(root: string): void {
  mkdirSync(join(root, "workflow", "hooks", "agent-config"), {
    recursive: true,
  });
  mkdirSync(join(root, "workflow", "hooks", "deny-dangerous"), {
    recursive: true,
  });
  writeFileSync(
    join(root, "workflow", "hooks", "deny-dangerous.sh"),
    HOOK_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "gruff-code-quality.sh"),
    HOOK_STUB,
  );
  for (const hookLibFile of [
    "patterns-shell.sh",
    "patterns-paths.sh",
    "patterns-writes.sh",
    "deny-dangerous-self-test.sh",
  ]) {
    writeFileSync(
      join(root, "workflow", "hooks", "deny-dangerous", hookLibFile),
      HOOK_STUB,
    );
  }
  mkdirSync(join(root, ".goat-flow", "hooks", "deny-dangerous"), {
    recursive: true,
  });
  writeFileSync(
    join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
    HOOK_STUB,
  );
  for (const hookLibFile of [
    "patterns-shell.sh",
    "patterns-paths.sh",
    "patterns-writes.sh",
    "deny-dangerous-self-test.sh",
  ]) {
    writeFileSync(
      join(root, ".goat-flow", "hooks", "deny-dangerous", hookLibFile),
      HOOK_STUB,
    );
  }
  writeFileSync(
    join(root, ".goat-flow", "hooks", "gruff-code-quality.sh"),
    HOOK_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "agent-config", "copilot-hooks.json"),
    COPILOT_HOOK_CONFIG_STUB,
  );
  mkdirSync(join(root, ".github", "hooks"), { recursive: true });
  writeFileSync(
    join(root, ".github", "hooks", "hooks.json"),
    COPILOT_HOOK_CONFIG_STUB,
  );
}

/**
 * Clone this repo into a temp fixture and git-init it, so install-then-drift round trips run
 * against a real tree. Writes the copied tree to the filesystem, skipping .git/node_modules/
 * log-session dirs, and spawns git init; symlinks node_modules back to the source to avoid a slow
 * copy. Asserts git init succeeds.
 *
 * @returns the cloned repo root inside the temp fixture; the caller cleans up its parent dir
 */
export function setupInstallRoundTripFixture(): string {
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
  const git = spawnSync("git", ["init", "-q"], {
    cwd: root,
    encoding: "utf-8",
  });
  assert.equal(
    git.status,
    0,
    `temp round-trip repo should initialize git:\n${git.stderr ?? ""}`,
  );
  return root;
}

/**
 * Patch the cloned fixture so install round-trip tests include a reference skill: register the
 * fixture skill in manifest.json and constants.ts, stub package.json's test script with canned
 * TAP, and copy the skill source in. Mutates files inside the fixture root.
 *
 * @param root - the cloned fixture repo root produced by setupInstallRoundTripFixture
 * @returns the agent ids and deduped installed skill-root dirs read from the patched manifest
 */
export function patchInstallRoundTripFixture(root: string): {
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

export function runCommand(
  cwd: string,
  command: "bash" | "node" | "npx",
  args: string[],
  timeout = 60000,
): CommandResult {
  const spawnOptions = {
    cwd,
    encoding: "utf-8",
    timeout,
  } as const;
  const result =
    command === "bash"
      ? spawnSync("bash", args, spawnOptions)
      : command === "node"
        ? spawnSync("node", args, spawnOptions)
        : spawnSync("npx", args, spawnOptions);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}`,
  };
}

export {
  describe,
  it,
  before,
  after,
  assert,
  spawnSync,
  assertExists,
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
  tmpdir,
  dirname,
  join,
  relative,
  resolve,
  sep,
  checkDrift,
  createFS,
  SKILL_NAMES,
  getInstalledSkillRoots,
  getSkillFiles,
};
