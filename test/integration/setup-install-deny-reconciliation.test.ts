/**
 * Exercise reviewed permission repair through real install, audit and setup paths.
 * Installer migrations must leave absent stores and saved user choices alone.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { runAudit } from "../../src/cli/audit/audit.js";
import { classifyProjectState } from "../../src/cli/classify-state.js";
import { loadConfig } from "../../src/cli/config/reader.js";
import { getStaleSkillNames } from "../../src/cli/constants.js";
import { PROFILES } from "../../src/cli/detect/agents.js";
import { createFS } from "../../src/cli/facts/fs.js";
import { extractProjectFacts } from "../../src/cli/facts/orchestrator.js";
import { composeSetup } from "../../src/cli/prompt/compose-setup.js";
import {
  makeTempProject,
  PROJECT_ROOT,
  runInstaller,
} from "./setup-install.helpers.js";

const stores = [
  ".netrc",
  ".git-credentials",
  ".config/gh/hosts.yml",
  ".pgpass",
];
const requiredReads = stores.map((store) => `Read(~/${store})`);
const exactPair = ["Read(**/credentials.json)", "Edit(**/credentials.json)"];

/** Writes a disposable project's instruction file and spawns its installer; shared teardown removes the project. */
function installedClaude(): string {
  const root = makeTempProject();
  writeFileSync(
    join(root, "CLAUDE.md"),
    readFileSync(join(PROJECT_ROOT, "CLAUDE.md")),
  );
  const result = runInstaller(root, "--agent", "claude");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return root;
}

/**
 * Spawns the CLI setup prompt for a disposable target without applying changes.
 *
 * @param root - disposable installed project
 * @param agent - Claude by default; null requests prompts for all agents
 * @returns the CLI's setup prompt output
 */
function cliSetup(root: string, agent: "claude" | null = "claude"): string {
  const result = spawnSync(
    "node",
    [
      "--import",
      "tsx",
      join(PROJECT_ROOT, "src/cli/cli.ts"),
      "setup",
      root,
      ...(agent === null ? [] : ["--agent", agent]),
    ],
    {
      cwd: PROJECT_ROOT,
      encoding: "utf8",
      timeout: 30_000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

describe("reviewed deny reconciliation", () => {
  it("shows version blockers and their next action without recommending installation", () => {
    const root = installedClaude();
    const configPath = join(root, ".goat-flow/config.yaml");
    for (const [config, guidance] of [
      ['version: "999.0.0"\n', /Upgrade the CLI before installing/u],
      ['version: "unrankable"\n', /use a numeric X.Y.Z release/u],
      [
        "version: >-\n  1.17.0\n",
        /put the version on a single top-level line/u,
      ],
    ] as const) {
      writeFileSync(configPath, config);
      const fs = createFS(root);
      const report = runAudit(fs, root, {
        agentFilter: "claude",
        harness: true,
      });
      const facts = extractProjectFacts(fs, {
        agentFilter: "claude",
        projectPath: root,
        configState: loadConfig(root, fs),
      });
      const output = composeSetup(report, facts, "claude")!;
      assert.match(output, guidance);
      assert.doesNotMatch(output, /Step 1 - Install files|setup install/u);
    }
  });
  // Writes missing-store settings and spawns install/setup to verify reviewed repair remains reachable.
  it("names missing required stores after install and reaches current-project reconciliation", () => {
    const root = installedClaude();
    const path = join(root, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8"));
    const absentRules = new Set(
      stores.flatMap((store) =>
        ["Read", "Edit"].flatMap((tool) => [
          `${tool}(~/${store})`,
          `${tool}(**/${store})`,
        ]),
      ),
    );
    settings.permissions.deny = settings.permissions.deny.filter(
      (rule: string) => !absentRules.has(rule),
    );
    // Synthetic user choices are preservation controls, not historical settings.
    settings.permissions.allow = ["Write(notes/**)", "Read(.env.example)"];
    settings.permissions.ask = ["Glob(assets/**)"];
    settings.userMarker = "retain this value";
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
    const install = runInstaller(root, "--agent", "claude");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), settings);

    const fs = createFS(root);
    assert.equal(classifyProjectState(fs, "claude").state, "current");
    const report = runAudit(fs, root, { agentFilter: "claude", harness: true });
    const secret = report.scopes.harness?.checks.find(
      (check) => check.id === "deny-covers-secrets",
    );
    assert.ok(secret);
    const output = cliSetup(root);
    console.info(
      JSON.stringify({
        state: classifyProjectState(fs, "claude").state,
        secretStatus: secret.status,
        missingPatterns: secret.details?.denyMatrix?.[0]?.missingPatterns,
        reconciliation: output.includes("Reconcile agent settings"),
      }),
    );
    assert.equal(secret.status, "fail");
    assert.equal(secret.type, "integrity");
    assert.match(output, /## Step 1 - Reconcile agent settings/u);
    assert.deepEqual(
      secret.details?.denyMatrix?.[0]?.missingPatterns,
      requiredReads,
    );
    for (const rule of requiredReads) {
      assert.ok(secret.failure?.howToFix?.includes(rule), rule);
      assert.ok(output.includes(rule), rule);
    }
    assert.match(output, /show the diff and obtain approval before adding/iu);
    assert.match(output, /Preserve allow and ask arrays verbatim/u);
    const facts = extractProjectFacts(fs, {
      agentFilter: "claude",
      projectPath: root,
      configState: loadConfig(root, fs),
    });
    const baseReport = runAudit(fs, root, {
      agentFilter: "claude",
      harness: false,
    });
    const beforeCompose = structuredClone(baseReport);
    assert.match(
      composeSetup(baseReport, facts, "claude")!,
      /## Step 1 - Reconcile agent settings/u,
    );
    assert.deepEqual(baseReport, beforeCompose);
    for (const promptScope of ["full", "harness-card"] as const) {
      assert.match(
        composeSetup(report, facts, "claude", { promptScope })!,
        /## Step 1 - Reconcile agent settings/u,
        promptScope,
      );
    }
    assert.doesNotMatch(
      output,
      /Instruction file line count|Feedback loop active/u,
    );
    assert.doesNotMatch(output, /add each template deny or allow rule/iu);
    assert.equal(
      readFileSync(path, "utf8"),
      JSON.stringify(settings, null, 2) + "\n",
    );

    // Simulate the explicitly reviewed fixture repair; the installer did not add these rules.
    settings.permissions.deny.push(...requiredReads);
    writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");
    // Each audit needs a fresh adapter after a write; adapters cache their file snapshot.
    const repaired = runAudit(createFS(root), root, {
      agentFilter: "claude",
      harness: true,
    });
    assert.equal(
      repaired.scopes.harness?.checks.find(
        (check) => check.id === "deny-covers-secrets",
      )?.status,
      "pass",
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")).permissions.allow,
      settings.permissions.allow,
    );
    assert.deepEqual(
      JSON.parse(readFileSync(path, "utf8")).permissions.ask,
      settings.permissions.ask,
    );
  });

  it("keeps multi-agent deny failures in the matching agent prompt", () => {
    const root = installedClaude();
    writeFileSync(
      join(root, "AGENTS.md"),
      readFileSync(join(PROJECT_ROOT, "AGENTS.md")),
    );
    const install = runInstaller(root, "--agent", "codex");
    assert.equal(install.status, 0, install.stderr || install.stdout);
    const path = join(root, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8"));
    settings.permissions.deny = settings.permissions.deny.filter(
      (rule: string) => !requiredReads.includes(rule),
    );
    writeFileSync(path, JSON.stringify(settings));
    const fs = createFS(root);
    assert.equal(classifyProjectState(fs, "claude").state, "current");
    assert.equal(classifyProjectState(fs, "codex").state, "current");
    const facts = extractProjectFacts(fs, {
      agentFilter: null,
      projectPath: root,
      configState: loadConfig(root, fs),
    });
    const codex = facts.agents.find((fact) => fact.agent.id === "codex")!;
    assert.equal(codex.hooks.readDenyCoversSecrets, true);
    assert.equal(codex.hooks.bashDenyCoversSecrets, true);
    const report = runAudit(fs, root, { agentFilter: null, harness: false });
    const beforeCompose = structuredClone(report);
    assert.match(
      composeSetup(report, facts, "claude")!,
      /claude: Read\(~\/\.netrc\)/u,
    );
    const codexPrompt = composeSetup(report, facts, "codex")!;
    assert.doesNotMatch(codexPrompt, /claude: Read\(~\/\.netrc\)/u);
    assert.doesNotMatch(codexPrompt, /Reconcile agent settings/u);
    assert.deepEqual(report, beforeCompose);
    const sections = cliSetup(root, null).split(/^# GOAT Flow Setup - /gmu);
    const codexSection = sections.find((section) =>
      section.startsWith(PROFILES.codex.name + "\n"),
    );
    assert.ok(codexSection);
    assert.doesNotMatch(codexSection, /claude: Read\(~\/\.netrc\)/u);
    assert.doesNotMatch(codexSection, /Reconcile agent settings/u);
  });

  for (const agent of ["claude", "codex", "copilot"] as const) {
    for (const state of ["outdated", "v0.9"] as const) {
      it(`keeps ${state} ${agent} steps sequential`, () => {
        const root = makeTempProject();
        const profile = PROFILES[agent];
        mkdirSync(join(root, profile.instructionFile, ".."), {
          recursive: true,
        });
        writeFileSync(
          join(root, profile.instructionFile),
          "# Synthetic upgrade fixture\n",
        );
        if (state === "outdated") {
          mkdirSync(join(root, ".goat-flow"), { recursive: true });
          writeFileSync(
            join(root, ".goat-flow/config.yaml"),
            'version: "1.16.0"\n',
          );
        } else {
          const legacySkill = getStaleSkillNames()[0];
          assert.ok(legacySkill);
          const skillDirectory = join(root, profile.skillsDir, legacySkill);
          mkdirSync(skillDirectory, { recursive: true });
          writeFileSync(
            join(skillDirectory, "SKILL.md"),
            "# Synthetic legacy skill\n",
          );
        }
        const fs = createFS(root);
        assert.equal(classifyProjectState(fs, agent).state, state);
        const facts = extractProjectFacts(fs, {
          agentFilter: agent,
          projectPath: root,
          configState: loadConfig(root, fs),
        });
        const report = runAudit(fs, root, {
          agentFilter: agent,
          harness: false,
        });
        const output = composeSetup(report, facts, agent)!;
        const steps = [...output.matchAll(/^## Step (\d+) - /gmu)].map(
          (match) => Number(match[1]),
        );
        const count =
          (state === "outdated" ? 3 : 4) +
          (profile.settingsFile === null ? 0 : 1);
        assert.deepEqual(
          steps,
          Array.from({ length: count }, (_, index) => index + 1),
        );
        assert.equal(
          output.includes("Reconcile agent settings"),
          profile.settingsFile !== null,
        );
      });
    }
  }

  it("prints reviewed exact replacements for retired broad credentials without adding them", () => {
    const root = installedClaude();
    const path = join(root, ".claude/settings.json");
    const settings = JSON.parse(readFileSync(path, "utf8"));
    settings.permissions.deny = settings.permissions.deny.filter(
      (rule: string) => !exactPair.includes(rule),
    );
    settings.permissions.deny.push(
      "Read(**/credentials*)",
      "Write(**/credentials*)",
    );
    writeFileSync(path, JSON.stringify(settings));
    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stderr, /Review replacement denies/u);
    for (const rule of exactPair) {
      assert.ok(result.stderr.includes(rule), rule);
      assert.ok(
        !JSON.parse(readFileSync(path, "utf8")).permissions.deny.includes(rule),
      );
    }
    const saved = JSON.parse(readFileSync(path, "utf8"));
    saved.permissions.deny.push(...exactPair, "Read(**/credentials*)");
    writeFileSync(path, JSON.stringify(saved));
    const covered = runInstaller(root, "--agent", "claude");
    assert.equal(covered.status, 0, covered.stderr || covered.stdout);
    assert.doesNotMatch(covered.stderr, /Review replacement denies/u);
  });
});
