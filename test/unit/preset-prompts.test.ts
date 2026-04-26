/**
 * Unit tests for the dashboard preset catalog.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

interface PresetPrompt {
  id: string;
  name: string;
  desc: string;
  prompt: string;
  cat: string;
  route: string;
  source: string;
  globalSafe: boolean;
  internalOnly: boolean;
  qualityMode: boolean;
  requiresGh: boolean;
  requiresPrOrIssue: boolean;
  requiresLocalDiff: boolean;
  requiresUiApp: boolean;
  requiresDependencyFiles: boolean;
  requiresGoatFlowInstall: boolean;
  mayCheckoutBranch: boolean;
  requiresCleanWorktree: boolean;
  mayWriteFiles: boolean;
  artifactRequired: boolean;
  bestTargetSurfaces: string[];
  fallbackPrompt: string;
  costTier: "low" | "medium" | "high";
}

const PROJECT_ROOT = resolve(import.meta.dirname, "..", "..");
const PRESET_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "preset-prompts.json",
);
const DASHBOARD_TERMINAL_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-terminal.ts",
);
const DASHBOARD_PROMPTS_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-prompts.ts",
);
const PROMPTS_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "prompts.html",
);
const DASHBOARD_QUALITY_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "dashboard-setup-quality.ts",
);
const WORKSPACE_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "workspace.html",
);
const SETUP_VIEW_PATH = resolve(
  PROJECT_ROOT,
  "src",
  "dashboard",
  "views",
  "setup.html",
);
const KNOWN_ROUTES = new Set([
  "goat-critique",
  "goat-debug",
  "goat-plan",
  "goat-qa",
  "goat-review",
  "goat-security",
]);
const KNOWN_CATEGORIES = new Set([
  "critique",
  "debug",
  "plan",
  "qa",
  "review",
  "security",
]);

function readPresets(): PresetPrompt[] {
  const parsed = JSON.parse(readFileSync(PRESET_PATH, "utf-8")) as unknown;
  assert.ok(Array.isArray(parsed), "preset catalog should be an array");
  return parsed as PresetPrompt[];
}

function byId(id: string): PresetPrompt {
  const preset = readPresets().find((entry) => entry.id === id);
  assert.ok(preset, `missing preset ${id}`);
  return preset;
}

describe("preset prompt catalog", () => {
  it("keeps the required dashboard preset shape", () => {
    for (const preset of readPresets()) {
      assert.equal(typeof preset.id, "string", `${preset.id} id`);
      assert.equal(typeof preset.name, "string", `${preset.id} name`);
      assert.equal(typeof preset.desc, "string", `${preset.id} desc`);
      assert.equal(typeof preset.prompt, "string", `${preset.id} prompt`);
      assert.equal(typeof preset.cat, "string", `${preset.id} cat`);
      assert.ok(preset.id.length > 0, "id should not be empty");
      assert.ok(
        preset.name.length > 0,
        `${preset.id} name should not be empty`,
      );
      assert.ok(
        preset.desc.length > 0,
        `${preset.id} desc should not be empty`,
      );
      assert.ok(
        preset.prompt.length > 0,
        `${preset.id} prompt should not be empty`,
      );
      assert.ok(preset.cat.length > 0, `${preset.id} cat should not be empty`);
    }
  });

  it("keeps additive metadata present and valid on every preset", () => {
    for (const preset of readPresets()) {
      assert.equal(typeof preset.route, "string", `${preset.id} route`);
      assert.equal(typeof preset.source, "string", `${preset.id} source`);
      assert.equal(
        typeof preset.globalSafe,
        "boolean",
        `${preset.id} globalSafe`,
      );
      assert.equal(
        typeof preset.internalOnly,
        "boolean",
        `${preset.id} internalOnly`,
      );
      assert.equal(
        typeof preset.qualityMode,
        "boolean",
        `${preset.id} qualityMode`,
      );
      assert.equal(
        typeof preset.requiresGh,
        "boolean",
        `${preset.id} requiresGh`,
      );
      assert.equal(
        typeof preset.requiresPrOrIssue,
        "boolean",
        `${preset.id} requiresPrOrIssue`,
      );
      assert.equal(
        typeof preset.requiresLocalDiff,
        "boolean",
        `${preset.id} requiresLocalDiff`,
      );
      assert.equal(
        typeof preset.requiresUiApp,
        "boolean",
        `${preset.id} requiresUiApp`,
      );
      assert.equal(
        typeof preset.requiresDependencyFiles,
        "boolean",
        `${preset.id} requiresDependencyFiles`,
      );
      assert.equal(
        typeof preset.requiresGoatFlowInstall,
        "boolean",
        `${preset.id} requiresGoatFlowInstall`,
      );
      assert.equal(
        typeof preset.mayCheckoutBranch,
        "boolean",
        `${preset.id} mayCheckoutBranch`,
      );
      assert.equal(
        typeof preset.requiresCleanWorktree,
        "boolean",
        `${preset.id} requiresCleanWorktree`,
      );
      assert.equal(
        typeof preset.mayWriteFiles,
        "boolean",
        `${preset.id} mayWriteFiles`,
      );
      assert.equal(
        typeof preset.artifactRequired,
        "boolean",
        `${preset.id} artifactRequired`,
      );
      assert.ok(
        Array.isArray(preset.bestTargetSurfaces),
        `${preset.id} bestTargetSurfaces`,
      );
      assert.equal(
        typeof preset.fallbackPrompt,
        "string",
        `${preset.id} fallbackPrompt`,
      );
      assert.match(preset.costTier, /^(low|medium|high)$/);
      assert.ok(KNOWN_ROUTES.has(preset.route), `${preset.id} known route`);
      if (preset.qualityMode) {
        assert.doesNotMatch(
          preset.prompt,
          /^\/goat-/,
          `${preset.id} quality mode should be a direct assessment prompt`,
        );
      } else {
        assert.match(preset.prompt, new RegExp(`^/${preset.route}\\b`));
      }
    }
  });

  it("routes every built-in preset to an installed skill and known category", () => {
    for (const preset of readPresets()) {
      assert.ok(KNOWN_CATEGORIES.has(preset.cat), `${preset.id} known cat`);
      assert.equal(
        existsSync(resolve(PROJECT_ROOT, ".agents", "skills", preset.route)),
        true,
        `${preset.id} route ${preset.route} should be installed`,
      );
      assert.equal(
        existsSync(
          resolve(PROJECT_ROOT, ".agents", "skills", preset.route, "SKILL.md"),
        ),
        true,
        `${preset.id} route ${preset.route} should include SKILL.md`,
      );
    }
  });

  it("routes security presets to known skills with matching constraints", () => {
    const accessControl = byId("access-control");
    assert.equal(accessControl.cat, "security");
    assert.match(accessControl.prompt, /^\/goat-security\b/);
    assert.match(accessControl.prompt, /web\/API\/app entry points/);
    assert.match(accessControl.prompt, /library, CLI, or tooling repo/);

    const compliance = byId("compliance-check");
    assert.equal(compliance.cat, "security");
    assert.match(compliance.prompt, /^\/goat-security\b/);
    assert.match(compliance.prompt, /authoritative clause\/control source/);
    assert.match(compliance.prompt, /not assessed/);

    const critique = byId("security-critique");
    assert.equal(critique.cat, "security");
    assert.match(critique.prompt, /^\/goat-critique\b/);
    assert.match(critique.prompt, /security assessment artifact/);
    assert.match(critique.prompt, /fresh goat-security scan/);

    const depScan = byId("dep-scan");
    assert.equal(depScan.cat, "security");
    assert.match(depScan.prompt, /^\/goat-security\b/);
    assert.match(depScan.prompt, /leads only/);
    assert.match(depScan.prompt, /reachability/);

    const security = byId("security");
    assert.equal(security.cat, "security");
    assert.match(security.prompt, /^\/goat-security\b/);
    assert.match(security.prompt, /quick scan or a full assessment/);
    assert.match(security.prompt, /local HTTP\/WebSocket\/PTY surfaces/);
  });

  it("keeps prerequisite metadata aligned with prompt text", () => {
    const prWorkflowIds = [
      "coverage-check",
      "walkthrough-comment",
      "walkthrough-with-testing",
      "test",
    ];
    for (const id of prWorkflowIds) {
      const preset = byId(id);
      assert.equal(preset.requiresGh, true, `${id} requires gh metadata`);
      assert.equal(
        preset.requiresPrOrIssue,
        true,
        `${id} requires PR metadata`,
      );
      assert.match(preset.prompt, /gh/i, `${id} prompt should mention gh`);
      assert.match(
        preset.prompt,
        /pasted PR\/diff context|local diff|branch comparison/,
        `${id} prompt should include PR fallback`,
      );
    }

    for (const id of [
      "walkthrough-comment",
      "walkthrough-with-testing",
      "test",
    ]) {
      const preset = byId(id);
      assert.equal(preset.mayCheckoutBranch, true, `${id} may checkout`);
      assert.equal(
        preset.requiresCleanWorktree,
        true,
        `${id} requires clean worktree`,
      );
      assert.match(preset.prompt, /clean worktree|explicit user approval/);
      assert.equal(preset.requiresUiApp, true, `${id} UI workflow`);
    }

    assert.equal(byId("quality-check-goatflow").internalOnly, true);
    assert.equal(byId("quality-check-goatflow").qualityMode, true);
    assert.equal(byId("skill-quality-test").internalOnly, true);
    assert.equal(byId("skill-quality-test").qualityMode, true);
    assert.equal(byId("dep-scan").requiresDependencyFiles, true);
    assert.equal(byId("security-critique").artifactRequired, true);
    assert.equal(byId("compliance-check").artifactRequired, true);
  });

  it("does not mark target-goat-flow-only prompts as globally safe", () => {
    for (const preset of readPresets()) {
      if (preset.globalSafe) {
        assert.equal(
          preset.requiresGoatFlowInstall,
          false,
          `${preset.id} globalSafe cannot require target goat-flow install`,
        );
        assert.doesNotMatch(
          preset.prompt,
          /target .goat-flow|target project.*\.goat-flow/i,
          `${preset.id} globalSafe should not require target .goat-flow`,
        );
      }
    }
    for (const id of ["quality-check-goatflow", "skill-quality-test"]) {
      const preset = byId(id);
      assert.equal(preset.globalSafe, false);
      assert.equal(preset.internalOnly, true);
      assert.equal(preset.qualityMode, true);
    }
    const testPlanVsCode = byId("test-vs-code");
    assert.equal(testPlanVsCode.requiresPrOrIssue, true);
    assert.equal(testPlanVsCode.requiresLocalDiff, true);
    assert.equal(testPlanVsCode.requiresGoatFlowInstall, false);
    assert.equal(testPlanVsCode.globalSafe, true);
  });

  it("keeps the skill quality preset suite-wide instead of single-skill", () => {
    const preset = byId("skill-quality-test");
    assert.doesNotMatch(preset.prompt, /^\/goat-/);
    assert.match(preset.prompt, /Do not use \/goat-critique/);
    assert.match(preset.prompt, /do not count as writes/);
    assert.doesNotMatch(preset.prompt, /strict no-write/);
    assert.match(preset.prompt, /all seven goat-flow skills/);
    assert.doesNotMatch(preset.prompt, /Ask me which skill/i);
    assert.match(
      preset.prompt,
      /\.goat-flow\/skill-reference\/skill-quality-testing\//,
    );
    for (const skill of [
      "goat",
      "goat-debug",
      "goat-plan",
      "goat-review",
      "goat-critique",
      "goat-security",
      "goat-qa",
    ]) {
      assert.match(preset.prompt, new RegExp(`/${skill}\\b`));
    }
    assert.match(preset.prompt, /Do not stop after one skill/);
    for (const required of [
      "Method used",
      "Evidence limit",
      "Worked",
      "Failed/confusing",
      "Useless ceremony",
      "RED scenario",
      "GREEN result",
      "minimal REFACTOR",
      "Cross-skill patterns",
      "Top 5 skill/system improvements",
      "What was not tested",
    ]) {
      assert.match(preset.prompt, new RegExp(required.replace("/", "\\/")));
    }
  });

  it("keeps process quality preset as a direct assessment prompt", () => {
    const preset = byId("quality-check-goatflow");
    assert.doesNotMatch(preset.prompt, /^\/goat-/);
    assert.match(preset.prompt, /GOAT Flow Process Quality Assessment/);
    assert.match(preset.prompt, /Do not use \/goat-review/);
    assert.match(preset.prompt, /do not count as writes/);
    assert.doesNotMatch(preset.prompt, /strict no-write/);
    assert.match(preset.prompt, /Pre-check Results/);
    assert.match(preset.prompt, /Top 5 improvements/);
    assert.match(preset.prompt, /verification command/);
  });

  it("keeps goat-qa presets inside the no-test-code contract", () => {
    const qaPresets = readPresets().filter(
      (preset) => preset.route === "goat-qa",
    );
    for (const preset of qaPresets) {
      assert.equal(
        preset.mayWriteFiles,
        false,
        `${preset.id} should not write`,
      );
      assert.doesNotMatch(
        preset.prompt,
        /Write a test that|Place it near existing tests|generate complete test code/i,
        `${preset.id} asks goat-qa to write test code`,
      );
    }
    assert.match(
      byId("test-regression").prompt,
      /Recommend a regression guard/,
    );
    assert.match(byId("test-regression").prompt, /without writing test code/);
  });

  it("keeps goat-review zero-findings and integrity contracts in presets", () => {
    const uncommitted = byId("uncommitted");
    assert.match(uncommitted.prompt, /Review Integrity/);
    assert.match(uncommitted.prompt, /zero-findings discipline/);
  });

  it("adapts launch prompts with the requested runner and preserves target context", () => {
    const source = readFileSync(DASHBOARD_TERMINAL_PATH, "utf-8");
    assert.match(source, /ctx\.adaptPrompt\(prompt, runnerResolved\)/);
    assert.match(source, /cwdPath: options\.cwdPath \?\? null/);
    assert.match(
      source,
      /targetPath: options\.targetPath \?\? ctx\.projectPath/,
    );
    assert.match(
      source,
      /const controllingCwd = cwdPath \|\| selectedTargetPath/,
    );
    assert.match(source, /GOAT Flow target context:/);
    assert.match(
      source,
      /git -C \$\{dashboardShellQuote\(ctx\.projectPath\)\} status/,
    );

    const adapt = (prompt: string, runner: string): string =>
      runner === "codex" ? prompt.replace(/^\/goat\b/, "$goat") : prompt;
    assert.equal(
      adapt("/goat-qa audit coverage", "codex"),
      "$goat-qa audit coverage",
    );
    assert.equal(
      adapt("/goat-qa audit coverage", "claude"),
      "/goat-qa audit coverage",
    );
  });

  it("dry-runs terminal payload shape across all presets and runners", () => {
    const targets = [
      "/tmp/example-app",
      "/tmp/example-library",
      "/tmp/no-goat-flow-target",
    ];
    const runners = ["claude", "codex", "gemini", "copilot"] as const;
    for (const preset of readPresets()) {
      for (const runner of runners) {
        for (const targetPath of targets) {
          const prompt =
            runner === "codex"
              ? preset.prompt.replace(/^\/goat\b/, "$goat")
              : preset.prompt;
          const payload = {
            prompt,
            projectPath: PROJECT_ROOT,
            targetPath,
            runner,
          };
          assert.equal(payload.projectPath, PROJECT_ROOT);
          assert.equal(payload.targetPath, targetPath);
          if (preset.qualityMode) {
            assert.doesNotMatch(payload.prompt, /^\/goat-/);
          } else {
            assert.match(
              payload.prompt,
              runner === "codex" ? /^\$goat/ : /^\/goat/,
            );
          }
        }
      }
    }
  });

  it("keeps quality prompts out of normal prompt browsing even when internal prompts are shown", () => {
    const source = readFileSync(DASHBOARD_PROMPTS_PATH, "utf-8");
    const view = readFileSync(PROMPTS_VIEW_PATH, "utf-8");
    assert.match(source, /showInternalPresets/);
    assert.match(
      source,
      /const nonQuality = list\.filter\(\(p\) => !p\.qualityMode\)/,
    );
    assert.match(
      source,
      /ctx\.showInternalPresets\s+\?\s+nonQuality\s+:\s+nonQuality\.filter\(\(p\) => !p\.internalOnly\)/,
    );
    assert.match(
      view,
      /!p\.qualityMode && \(showInternalPresets \|\| !p\.internalOnly\)/,
    );
    assert.match(source, /dashboardAllPresets/);
    assert.match(source, /dashboardCustomPromptToPreset/);
  });

  it("mounts internal quality presets on explicit quality-page modes", () => {
    const source = readFileSync(DASHBOARD_QUALITY_PATH, "utf-8");
    for (const mode of ["process", "agent-setup", "harness", "skills"]) {
      assert.match(source, new RegExp(`id: "${mode}"`));
    }
    assert.match(source, /quality-check-goatflow/);
    assert.match(source, /skill-quality-test/);
    assert.match(source, /AI Harness Engineering Quality Assessment/);
    assert.doesNotMatch(source, /\/goat-review audit AI harness/);
    assert.match(source, /dashboardQualityReportLogPrompt/);
    assert.match(source, /\.goat-flow\/logs\/quality/);
    assert.match(source, /"quality_mode"/);
    assert.match(source, /__GOAT_FLOW_VERSION__/);
    assert.doesNotMatch(source, /"goat_flow_version": "1\.3\.0"/);
    assert.match(
      source,
      /Workspace Boundary as a qualitative cross-cutting risk/,
    );
    assert.match(source, /mode=\$\{encodeURIComponent\(requestModeId\)\}/);
    assert.match(source, /isCurrentRequest/);
    assert.match(source, /Report owner project_path for this mode/);
    assert.match(source, /REPORT_ROOT=/);
    assert.match(source, /VALIDATOR_ROOT=/);
    assert.match(source, /quality validate "\$FILE"/);
    assert.match(
      source,
      /Wrote quality report to \$\{projectPath\}\/\.goat-flow\/logs\/quality/,
    );
    assert.match(source, /source: "api"/);
    assert.doesNotMatch(source, /mode\.source !== "api"/);
    assert.match(
      source,
      /\/api\/quality\?path=.*mode=\$\{encodeURIComponent\(requestModeId\)\}/s,
    );
    assert.match(source, /Quality mode scope:/);
    assert.match(source, /missing target \.goat-flow files as normal/);
  });

  it("keeps workspace meter helpers scoped to their local Alpine component", () => {
    const source = readFileSync(WORKSPACE_VIEW_PATH, "utf-8");
    assert.match(source, /this\.allSessions\(\)/);
    assert.match(source, /this\.recentSessions\(\)/);
    assert.match(source, /this\.waitingSessions\(\)/);
    assert.doesNotMatch(source, /return\s+allSessions\(\)/);
    assert.doesNotMatch(source, /return\s+recentSessions\(\)/);
    assert.doesNotMatch(source, /return\s+waitingSessions\(\)/);
  });

  it("shows setup instruction surfaces for the selected target agent", () => {
    const view = readFileSync(SETUP_VIEW_PATH, "utf-8");
    const helper = readFileSync(DASHBOARD_QUALITY_PATH, "utf-8");
    assert.match(view, /setupInstructionSurfaces\(\)/);
    assert.match(helper, /CLAUDE\.md, \.claude\/settings\.json/);
    assert.match(
      helper,
      /AGENTS\.md, \.codex\/config\.toml, \.codex\/hooks\.json/,
    );
    assert.match(helper, /GEMINI\.md, \.gemini\/settings\.json/);
    assert.match(helper, /\.github\/copilot-instructions\.md/);
    assert.match(helper, /\.github\/hooks\/hooks\.json/);
  });

  it("renders stored prompt metadata as badges without redefining global safe", () => {
    const source = readFileSync(DASHBOARD_PROMPTS_PATH, "utf-8");
    assert.match(source, /label: "GOAT install"/);
    assert.match(source, /label: "Artifact required"/);
    assert.match(source, /label: "Dependency files"/);
    assert.match(source, /label: "Needs diff"/);
    assert.match(
      source,
      /preset\.globalSafe && dashboardGlobalSafeAllowed\(preset\)/,
    );
  });

  it("keeps PR fixture fallback wording deterministic", () => {
    const noOpenPr = byId("test");
    assert.equal(noOpenPr.requiresGh, true);
    assert.equal(noOpenPr.requiresPrOrIssue, true);
    assert.match(noOpenPr.fallbackPrompt, /no open PR/i);
    assert.match(noOpenPr.fallbackPrompt, /local diff or branch comparison/i);

    const smallUiPr = byId("walkthrough-with-testing");
    assert.equal(smallUiPr.requiresUiApp, true);
    assert.equal(smallUiPr.mayCheckoutBranch, true);
    assert.match(smallUiPr.prompt, /require a clean worktree/i);

    const largePr = byId("walkthrough-comment");
    assert.match(largePr.fallbackPrompt, /diff is too large/i);
    assert.match(largePr.fallbackPrompt, /chunked local diff/i);

    const dependencyOnlyPr = byId("dep-scan");
    assert.equal(dependencyOnlyPr.requiresDependencyFiles, true);
    assert.match(dependencyOnlyPr.prompt, /dependenc/i);

    const localDiffWithoutGh = byId("coverage-check");
    assert.equal(localDiffWithoutGh.requiresLocalDiff, true);
    assert.match(localDiffWithoutGh.fallbackPrompt, /pasted PR\/diff context/i);
  });
});
