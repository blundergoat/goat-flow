/**
 * Build temporary projects for the CLI's audit --check-drift flow.
 *
 * Use when changing installed skills, playbooks or hooks; matching fixture copies isolate the user's edits from missing setup.
 * Round-trip helpers also exercise installation in a disposable Git project, separate from the developer's checkout.
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
import {
  dirname,
  join,
  relative,
  resolve,
  sep,
  toNamespacedPath,
} from "node:path";
import { checkDrift } from "../../src/cli/audit/check-drift.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { getSkillNames } from "../../src/cli/constants.js";
import {
  getInstalledSkillRoots,
  getSkillFiles,
} from "../../src/cli/manifest/manifest.js";
import { buildAgentHookDescriptor } from "../../src/cli/server/agent-hook-command.js";
import {
  getHookSpec,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";

export const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
export const INSTALL_FIXTURE_SKILL = "skill-with-references";
export const INSTALL_FIXTURE_FILES = [
  "SKILL.md",
  "references/sample.md",
] as const;

/**
 * Supply a minimal skill for tests that compare installed files with their shipped templates.
 * Use matching source and installed stubs so content differences describe drift, rather than skill behavior.
 *
 * @param name - skill name written into both the frontmatter and the heading
 * @returns the stub skill markdown
 */
export const SKILL_STUB = (name: string): string =>
  `---\nname: ${name}\ndescription: stub for drift test\n---\n# ${name}\nbody\n`;

export const SHARED_STUB = "# shared\nbody\n";
const SHARED_PLAYBOOK_FILENAMES = [
  "README.md",
  "browser-use.md",
  "changelog.md",
  "code-comments.md",
  "gruff-code-quality.md",
  "hook-policy-testing.md",
  "naming-and-placement.md",
  "observability.md",
  "page-capture.md",
  "release-notes.md",
  "skill-playbook-authoring-sync.md",
  "test-selection.md",
  "writing-agent-facing-instructions.md",
  "writing-fidelity-audit.md",
  "writing-sentence-diagnostics.md",
  "writing-structure-diagnostics.md",
  "writing-human-facing-prose.md",
] as const;
export const HOOK_STUB = "#!/usr/bin/env bash\n# deny hook stub\n";
export const HOOK_LAUNCHER_STUB =
  "// goat-flow-hook-version: 1.15.0\n// hook launcher stub\n";
export const COPILOT_HOOK_CONFIG_STUB =
  '{\n  "version": 1,\n  "hooks": { "preToolUse": [] }\n}\n';
const COPILOT_GRUFF_SPEC = getHookSpec("gruff-code-quality");
assert.ok(COPILOT_GRUFF_SPEC);
const COPILOT_GRUFF_DESCRIPTOR = buildAgentHookDescriptor(
  "copilot",
  ".goat-flow/hooks",
  COPILOT_GRUFF_SPEC,
);
assert.ok(
  COPILOT_GRUFF_DESCRIPTOR.form === "shell" &&
    COPILOT_GRUFF_DESCRIPTOR.commandWindows !== undefined,
);
// Copilot runs the Bash command on Unix and the literal PowerShell override on Windows.
export const COPILOT_GRUFF_HOOK_ENTRY = {
  type: "command",
  bash: COPILOT_GRUFF_DESCRIPTOR.command,
  powershell: COPILOT_GRUFF_DESCRIPTOR.commandWindows,
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
 * Write canonical skill stubs and references into the fixture filesystem so drift checks start from matching copies.
 * Use matching copies to prove that audit reports edited files rather than incomplete setup.
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
  // Every declared file lets the fixture model the complete skill a user installs.
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
 * Create a directory and write the complete playbook pack to the temporary filesystem.
 * Use for either canonical source or the installed copy users load.
 */
function writeSharedPlaybookFixtures(playbookDirectory: string): void {
  mkdirSync(playbookDirectory, { recursive: true });
  // Every registered filename keeps the fixture aligned with user installations.
  for (const playbookFilename of SHARED_PLAYBOOK_FILENAMES) {
    writeFileSync(join(playbookDirectory, playbookFilename), SHARED_STUB);
  }
}

/**
 * Create a temporary filesystem whose shipped templates and installed files match.
 * Use before changing one fixture file to model what a user edited, removed or added after setup.
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
  // Canonical playbooks represent what a future user receives from setup.
  writeSharedPlaybookFixtures(join(root, "workflow", "skills", "playbooks"));
  writeFileSync(
    join(root, "workflow", "skills", "playbooks", "skill-quality-testing.md"),
    SHARED_STUB,
  );
  mkdirSync(
    join(root, "workflow", "skills", "playbooks", "skill-quality-testing"),
    { recursive: true },
  );
  // Each authoring topic keeps the canonical methodology pack complete.
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
  // Every canonical skill contributes the files compared across agent mirrors.
  for (const name of getSkillNames()) {
    writeSkillFiles(root, join("workflow", "skills"), name);
  }
  // Each supported agent starts with the complete installed skill pack before a test introduces drift.
  for (const agentDir of getInstalledSkillRoots()) {
    // Every skill must exist under each selected agent directory.
    for (const name of getSkillNames()) {
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
  // Installed playbooks represent the exact references an agent opens for a user.
  writeSharedPlaybookFixtures(
    join(root, ".goat-flow", "skill-docs", "playbooks"),
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
  // Each installed authoring topic mirrors its canonical user guidance.
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
  writeHookFixtures(root);
  return root;
}

/**
 * Write matching source and installed hook files to the temporary filesystem for audit drift checks.
 * Use when checking registrations or file parity; these stubs model installed files without running production policies.
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
  writeFileSync(
    join(root, "workflow", "hooks", "post-turn-safety.sh"),
    HOOK_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "run-with-bash.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "hook-provider-adapters.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  writeFileSync(
    join(root, "workflow", "hooks", "hook-launch-runtime.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  // Canonical policy modules represent the hook package future users receive.
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
  // Installed policy modules represent the hook files active in a user's project.
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
    join(root, ".goat-flow", "hooks", "post-turn-safety.sh"),
    HOOK_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "hooks", "run-with-bash.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "hooks", "hook-provider-adapters.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  writeFileSync(
    join(root, ".goat-flow", "hooks", "hook-launch-runtime.mjs"),
    HOOK_LAUNCHER_STUB,
  );
  // Drift fixtures compare bytes without executing hooks; every native dependency needs a paired source and installed file.
  for (const directory of ["workflow/hooks", ".goat-flow/hooks"]) {
    // Include every runtime dependency so a complete installation does not produce an unrelated missing-file finding.
    for (const file of new Set(
      listHookSpecs().flatMap((spec) => spec.scriptFiles),
    )) {
      const destination = join(root, directory, file);
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(
        destination,
        file.endsWith(".json") ? "{}\n" : HOOK_LAUNCHER_STUB,
      );
    }
  }

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
 * Copy maintained source and built CLI files into a disposable Git project for install-to-audit checks.
 *
 * Use when a test needs real checkout boundaries; dependencies are linked and local session state is excluded.
 * The fixture spawns Git; copy or initialization failures abort the test instead of producing a misleading audit result.
 *
 * @param sourceRoot - Git checkout whose maintained working-tree files and current dist outputs become fixture inputs
 * @returns the cloned repo root inside the temp fixture; the caller cleans up its parent dir
 */
export function setupInstallRoundTripFixture(
  sourceRoot = PROJECT_ROOT,
): string {
  const parent = mkdtempSync(join(tmpdir(), "goat-flow-install-roundtrip-"));
  const root = join(parent, "repo");
  const tracked = spawnSync("git", ["ls-files", "--cached", "-z"], {
    cwd: sourceRoot,
    encoding: "utf8",
  });
  assert.equal(
    tracked.status,
    0,
    `fixture inputs require a Git checkout: ${tracked.stderr}`,
  );
  const retained = new Set(tracked.stdout.split("\0").filter(Boolean));
  const maintainedAdditions = spawnSync(
    "git",
    [
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
      "--",
      "src",
      "test",
      "workflow",
      "scripts",
      "docs",
    ],
    { cwd: sourceRoot, encoding: "utf8" },
  );
  assert.equal(maintainedAdditions.status, 0, maintainedAdditions.stderr);
  // Include newly written source files so a developer can verify an installation before staging their changes.
  for (const path of maintainedAdditions.stdout.split("\0").filter(Boolean))
    retained.add(path);
  const directories = new Set<string>();
  // Retain each required parent directory while excluding unrelated local work from the copied project.
  for (const path of retained) {
    // Preserve the folder chain so the fixture copier can reach a selected nested file.
    for (
      let parentPath = dirname(path);
      parentPath !== ".";
      parentPath = dirname(parentPath)
    )
      directories.add(parentPath);
  }
  cpSync(sourceRoot, root, {
    recursive: true,
    filter: (src) => {
      const rel = relative(toNamespacedPath(sourceRoot), toNamespacedPath(src));
      // The root itself must remain so the user's fixture directory is created.
      if (rel === "") return true;
      const path = rel.split(sep).join("/");
      // The fixture needs its own Git history and linked dependencies, rather than copies of the developer's local state.
      if (path === ".git" || path === "node_modules") return false;
      // Generated CLI modules are required even though the build directory is ignored.
      if (path === "dist" || path.startsWith("dist/")) return true;
      return retained.has(path) || directories.has(path);
    },
  });
  symlinkSync(
    join(sourceRoot, "node_modules"),
    join(root, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
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
 * Enroll the reference-bearing skill in a copied project so install/upgrade tests can audit its shipped files.
 * The fixture mutates its catalogues and replaces its test command with canned TAP; parse or copy failures abort the test.
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

  // A missing fixture skill is enrolled once so install output can be compared.
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

  const canonicalSkillTotal = manifest.skills.canonical.length;
  const codeMapPath = join(root, ".goat-flow", "code-map.md");
  const codeMap = readFileSync(codeMapPath, "utf8");
  const fixtureSkillRow = `│   ├── ${INSTALL_FIXTURE_SKILL}/SKILL.md = installer round-trip fixture skill template`;
  // A newly enrolled skill must be discoverable so the later audit can assess installation rather than a stale code map.
  if (!codeMap.includes(fixtureSkillRow)) {
    writeFileSync(
      codeMapPath,
      codeMap.replace(
        "│   ├── reference/               = skill-preamble.md and skill-conventions.md templates",
        `${fixtureSkillRow}\n│   ├── reference/               = skill-preamble.md and skill-conventions.md templates`,
      ),
    );
  }

  const glossaryPath = join(root, ".goat-flow", "glossary.md");
  const glossary = readFileSync(glossaryPath, "utf8");
  writeFileSync(
    glossaryPath,
    glossary.replace(
      /^\| Skill \|.*$/mu,
      `| Skill | A slash-command-invoked capability (${canonicalSkillTotal} total) loaded on demand. | \`docs/skills.md\` | goat-* skills |`,
    ),
  );

  const architecturePath = join(root, ".goat-flow", "architecture.md");
  const architecture = readFileSync(architecturePath, "utf8");
  writeFileSync(
    architecturePath,
    architecture.replace(
      /\b\d+ goat-flow skill templates\b/u,
      `${canonicalSkillTotal} goat-flow skill templates`,
    ),
  );

  const constantsPath = join(root, "src", "cli", "constants.ts");
  const constants = readFileSync(constantsPath, "utf8");
  // The CLI registry must expose the same fixture skill as the manifest.
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

/**
 * Run a fixture command and capture the CLI output a developer would see during install or audit.
 *
 * Use for end-to-end assertions; the child runs in the fixture project with a bounded timeout.
 * A launch failure or killed child adds diagnostics to the output and leaves status null.
 *
 * @param cwd - fixture project the command runs in
 * @param command - executable to run, restricted to the three the fixtures need
 * @param args - argument vector passed without a shell, so fixture paths containing spaces stay one argument
 * @param timeout - milliseconds before the command is killed; the default is generous enough for a full audit
 * @param environmentOverrides - variables applied only to this child on top of the inherited environment
 * @returns the finished process with its captured stdout, stderr, and exit status
 */
export function runCommand(
  cwd: string,
  command: "bash" | "node" | "npx",
  args: string[],
  timeout = 60000,
  environmentOverrides?: NodeJS.ProcessEnv,
): CommandResult {
  const spawnOptions = {
    cwd,
    encoding: "utf-8",
    timeout,
    ...(environmentOverrides === undefined
      ? {}
      : { env: { ...process.env, ...environmentOverrides } }),
  } as const;
  const result =
    command === "bash"
      ? spawnSync("bash", args, spawnOptions)
      : command === "node"
        ? spawnSync("node", args, spawnOptions)
        : spawnSync("npx", args, spawnOptions);
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  // A null status needs launch or termination evidence in the assertion output.
  const diagnostic =
    result.status === null
      ? `\n[spawn-result] ${JSON.stringify({
          errorCode:
            (result.error as NodeJS.ErrnoException | undefined)?.code ?? null,
          signal: result.signal,
          timeoutMs: timeout,
        })}`
      : "";
  return {
    status: result.status,
    stdout,
    stderr,
    output: `${stdout}${stderr}${diagnostic}`,
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
  getSkillNames,
  getInstalledSkillRoots,
  getSkillFiles,
};
