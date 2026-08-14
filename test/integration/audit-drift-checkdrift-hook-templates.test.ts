/**
 * Covers the hook drift report users receive after setup or an upgrade.
 * Use when hook scripts, launchers, timeouts, or optional-hook settings change.
 * Fixtures prove current installs pass and stale managed values name a repair.
 * User-owned and explicitly disabled hooks remain outside the drift result.
 */
import {
  assert,
  checkDrift,
  COPILOT_GRUFF_HOOK_ENTRY,
  createFS,
  describe,
  existsSync,
  HOOK_LAUNCHER_STUB,
  HOOK_STUB,
  it,
  join,
  mkdirSync,
  rmSync,
  setupFixture,
  writeFileSync,
  writeHookFixtures,
} from "./audit-drift.helpers.ts";
import { buildAgentHookDescriptor } from "../../src/cli/server/agent-hook-command.js";
import { getHookSpec } from "../../src/cli/server/hooks-registry.js";

describe("checkDrift: hook templates", () => {
  // Fixture writes stale settings because the stable drift contract must fail at 60s and pass at 90s.
  it("reports stale managed hook timeouts and accepts the registry value", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      const claudeSettingsDirectory = join(root, ".claude");
      const claudeSettingsPath = join(claudeSettingsDirectory, "settings.json");
      mkdirSync(claudeSettingsDirectory, { recursive: true });
      const postTurnSafetySpec = getHookSpec("post-turn-safety");
      assert.ok(postTurnSafetySpec);
      // Claude registers the structured argv handler, so the fixture carries the same shape.
      const postTurnDescriptor = buildAgentHookDescriptor(
        "claude",
        ".goat-flow/hooks",
        postTurnSafetySpec,
      );
      if (postTurnDescriptor.form !== "argv") {
        assert.fail("Claude must register the approved argv handler");
      }
      const claudeSettings = {
        hooks: {
          Stop: [
            {
              hooks: [
                {
                  type: "command",
                  command: postTurnDescriptor.command,
                  args: postTurnDescriptor.args,
                  timeout: 60,
                },
              ],
            },
          ],
        },
      };
      writeFileSync(
        claudeSettingsPath,
        `${JSON.stringify(claudeSettings, null, 2)}\n`,
      );

      const staleTimeoutReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(staleTimeoutReport.status, "fail");
      assert.ok(
        staleTimeoutReport.findings.some(
          (finding) =>
            finding.kind === "content" &&
            finding.path === ".claude/settings.json" &&
            finding.message.includes("60s") &&
            finding.message.includes("90s"),
        ),
        `expected timeout drift, findings=${JSON.stringify(staleTimeoutReport.findings)}`,
      );

      claudeSettings.hooks.Stop[0]!.hooks[0]!.timeout = 90;
      writeFileSync(
        claudeSettingsPath,
        `${JSON.stringify(claudeSettings, null, 2)}\n`,
      );
      const currentTimeoutReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(
        currentTimeoutReport.status,
        "pass",
        `registry timeout should be drift-clean: ${JSON.stringify(currentTimeoutReport.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Covers missing and stale managed launch assets because a silent gap would
  // leave the registered handler failing at runtime with no named local repair.
  it("names absent or stale managed launch assets with the hooks sync repair", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);

      // A registered hook script that disappeared must surface as repairable drift.
      rmSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh"));
      const missingScriptReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(missingScriptReport.status, "fail");
      const missingFinding = missingScriptReport.findings.find(
        (finding) =>
          finding.kind === "missing" &&
          finding.path === ".goat-flow/hooks/deny-dangerous.sh",
      );
      assert.ok(
        missingFinding,
        `expected missing hook script finding, findings=${JSON.stringify(missingScriptReport.findings)}`,
      );
      assert.match(missingFinding.message, /run goat-flow hooks sync/u);
      writeFileSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh"), HOOK_STUB);

      // A version-drifted shared launcher must surface the same local repair,
      // without claiming anything about provider-side delivery.
      writeFileSync(
        join(root, ".goat-flow", "hooks", "run-with-bash.mjs"),
        "// stale launcher bytes from an earlier release\n",
      );
      const staleLauncherReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(staleLauncherReport.status, "fail");
      const staleFinding = staleLauncherReport.findings.find(
        (finding) =>
          finding.kind === "content" &&
          finding.path === ".goat-flow/hooks/run-with-bash.mjs",
      );
      assert.ok(
        staleFinding,
        `expected stale launcher finding, findings=${JSON.stringify(staleLauncherReport.findings)}`,
      );
      assert.match(staleFinding.message, /run goat-flow hooks sync/u);
      assert.doesNotMatch(staleFinding.message, /deliver/iu);
      writeFileSync(
        join(root, ".goat-flow", "hooks", "run-with-bash.mjs"),
        HOOK_LAUNCHER_STUB,
      );

      // Restored files leave the user with a clean drift report again.
      const repairedReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(
        repairedReport.status,
        "pass",
        `repaired assets should be drift-clean: ${JSON.stringify(repairedReport.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Covers filesystem writes because exact launcher identity is the user's drift contract.
  it("reports a managed hook launcher whose command identity is stale", () => {
    const targetProjectPath = setupFixture();
    try {
      writeHookFixtures(targetProjectPath);
      const codexHooksDirectory = join(targetProjectPath, ".codex");
      mkdirSync(codexHooksDirectory, { recursive: true });
      // This models a user whose Codex config still names a pre-upgrade launcher.
      writeFileSync(
        join(codexHooksDirectory, "hooks.json"),
        `${JSON.stringify(
          {
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  hooks: [
                    {
                      type: "command",
                      command:
                        'node -e "process.exit(2)" ".goat-flow/hooks/deny-dangerous.sh"',
                    },
                  ],
                },
              ],
            },
          },
          null,
          2,
        )}\n`,
      );

      const driftReport = checkDrift({
        fs: createFS(targetProjectPath),
        projectPath: targetProjectPath,
        templateRoot: targetProjectPath,
        agentFilter: "codex",
      });

      assert.equal(driftReport.status, "fail");
      assert.ok(
        driftReport.findings.some(
          (finding) =>
            finding.path === ".codex/hooks.json" &&
            finding.message.includes("registered launcher command"),
        ),
        `expected launcher-command drift, findings=${JSON.stringify(driftReport.findings)}`,
      );
    } finally {
      rmSync(targetProjectPath, { recursive: true, force: true });
    }
  });

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
        join(root, ".goat-flow", "hooks", "deny-dangerous.sh"),
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
            finding.path === ".goat-flow/hooks/deny-dangerous.sh",
        ),
        `expected central hook drift, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports missing installed hook scripts", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      rmSync(join(root, ".goat-flow", "hooks", "deny-dangerous.sh"), {
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
            finding.path === ".goat-flow/hooks/deny-dangerous.sh",
        ),
        `expected missing central hook finding, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // This fixture writes one retired hook; the audit contract reports it without mutation.
  it("reports deprecated central hook files without deleting them", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      const deprecatedHookPath = join(
        root,
        ".goat-flow",
        "hooks",
        "plan-checkbox-guard.sh",
      );
      writeFileSync(deprecatedHookPath, HOOK_STUB);

      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });

      assert.equal(report.status, "fail");
      assert.ok(
        report.findings.some(
          (finding) =>
            finding.kind === "deprecated" &&
            finding.path === ".goat-flow/hooks/plan-checkbox-guard.sh" &&
            finding.message.includes("goat-flow hooks sync"),
        ),
        `expected actionable deprecated-hook finding, findings=${JSON.stringify(report.findings)}`,
      );
      assert.equal(existsSync(deprecatedHookPath), true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // This fixture writes hook copies, removes Copilot's config, and proves Codex stays drift-clean.
  it("limits hook drift to the selected agent", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      rmSync(join(root, ".github", "hooks", "hooks.json"), { force: true });

      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
        agentFilter: "codex",
      });
      assert.equal(
        report.status,
        "pass",
        `Codex drift included another agent: ${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  // Covers a stale optional script for an unsupported lifecycle: writes it; an agent audit must ignore it.
  it("ignores registry hook scripts unsupported by the selected agent", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".goat-flow", "hooks", "gruff-code-quality.sh"),
        `${HOOK_STUB}\n# stale unsupported copy\n`,
      );

      const antigravityReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
        agentFilter: "antigravity",
      });
      assert.equal(
        antigravityReport.status,
        "pass",
        `Antigravity drift included an unsupported hook: ${JSON.stringify(antigravityReport.findings)}`,
      );

      const aggregateReport = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(aggregateReport.status, "fail");
      assert.ok(
        aggregateReport.findings.some(
          (finding) =>
            finding.path === ".goat-flow/hooks/gruff-code-quality.sh" &&
            finding.kind === "content",
        ),
        `aggregate drift lost the stale hook: ${JSON.stringify(aggregateReport.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports post-turn safety hook content drift", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".goat-flow", "hooks", "post-turn-safety.sh"),
        `${HOOK_STUB}\n# local safety drift\n`,
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
            finding.path === ".goat-flow/hooks/post-turn-safety.sh",
        ),
        `expected post-turn safety drift, findings=${JSON.stringify(report.findings)}`,
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

  // Fixture purpose: writes enabled optional Copilot hooks because configured hooks are allowlisted.
  it("allows Copilot hook config entries for enabled optional hooks", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".goat-flow", "config.yaml"),
        "hooks:\n  gruff-code-quality:\n    enabled: true\n",
      );
      writeFileSync(
        join(root, ".github", "hooks", "hooks.json"),
        `${JSON.stringify(
          {
            version: 1,
            hooks: {
              preToolUse: [],
              postToolUse: [COPILOT_GRUFF_HOOK_ENTRY],
            },
          },
          null,
          2,
        )}\n`,
      );
      const report = checkDrift({
        fs: createFS(root),
        projectPath: root,
        templateRoot: root,
      });
      assert.equal(
        report.status,
        "pass",
        `expected enabled optional Copilot hook to be drift-clean, findings=${JSON.stringify(report.findings)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
