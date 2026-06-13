/**
 * checkDrift hook-template parity: drift-clean when installed deny-dangerous scripts and the
 * Copilot hooks.json match their workflow templates, and the content/missing findings raised when
 * a .codex script or the Copilot config diverges, including the enabled-optional-hook allowance.
 */
import {
  assert,
  checkDrift,
  COPILOT_GRUFF_HOOK_ENTRY,
  createFS,
  describe,
  HOOK_STUB,
  it,
  join,
  rmSync,
  setupFixture,
  writeFileSync,
  writeHookFixtures,
} from "./audit-drift.helpers.ts";

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

  it("reports plan checkbox guard hook content drift", () => {
    const root = setupFixture();
    try {
      writeHookFixtures(root);
      writeFileSync(
        join(root, ".goat-flow", "hooks", "plan-checkbox-guard.sh"),
        `${HOOK_STUB}\n# local plan guard drift\n`,
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
            finding.path === ".goat-flow/hooks/plan-checkbox-guard.sh",
        ),
        `expected plan checkbox guard drift, findings=${JSON.stringify(report.findings)}`,
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
