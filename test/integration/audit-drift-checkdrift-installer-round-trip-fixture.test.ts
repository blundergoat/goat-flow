/**
 * checkDrift installer round-trip: clones the repo, installs a fixture-backed reference skill for
 * every agent, then asserts the skill files land, each required hook proof passes, and a real
 * `audit --check-drift` run reports zero drift - the end-to-end guard that install output matches what
 * drift expects. The repository preflight runs once in CI's `checks` job, not inside this copy.
 */
import {
  after,
  assert,
  before,
  describe,
  existsSync,
  INSTALL_FIXTURE_FILES,
  INSTALL_FIXTURE_SKILL,
  it,
  join,
  patchInstallRoundTripFixture,
  PROJECT_ROOT,
  rmSync,
  runCommand,
  setupInstallRoundTripFixture,
} from "./audit-drift.helpers.ts";

/** Required offline proofs that let the fixture's audit show real effective coverage. */
const REQUIRED_EFFECTIVE_HOOK_PROOFS = [
  { agentId: "claude", scenario: "deny-hook" },
  { agentId: "codex", scenario: "deny-hook" },
  { agentId: "antigravity", scenario: "deny-hook" },
  { agentId: "copilot", scenario: "deny-hook" },
  { agentId: "claude", scenario: "git-mutations-hook" },
  { agentId: "codex", scenario: "git-mutations-hook" },
  { agentId: "antigravity", scenario: "git-mutations-hook" },
  { agentId: "copilot", scenario: "git-mutations-hook" },
  { agentId: "claude", scenario: "gruff-hook" },
  { agentId: "copilot", scenario: "gruff-hook" },
  { agentId: "claude", scenario: "post-turn-hook" },
] as const;

describe("checkDrift: installer round-trip fixture", () => {
  let root: string;
  before(() => {
    assert.ok(
      existsSync(join(PROJECT_ROOT, "node_modules")),
      "node_modules must exist for the temp-repo CLI runs",
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
    "installs fixture-backed references, proves the hooks, and reports zero drift",
    { timeout: 400000 },
    () => {
      const { agentIds, skillRoots } = patchInstallRoundTripFixture(root);
      // A user can install several agents before asking one audit to assess shared coverage.
      for (const agentId of agentIds) {
        const install = runCommand(
          root,
          "node",
          [
            "--import",
            "tsx",
            "src/cli/cli.ts",
            "install",
            root,
            "--agent",
            agentId,
          ],
          60000,
        );
        assert.equal(
          install.status,
          0,
          `install for ${agentId} should pass:\n${install.output}`,
        );
      }

      // Every selected agent should receive the same fixture-backed reference skill.
      for (const skillRoot of skillRoots) {
        // Each required file must exist before the user sees that skill as installed.
        for (const relativeFile of INSTALL_FIXTURE_FILES) {
          assert.ok(
            existsSync(
              join(root, skillRoot, INSTALL_FIXTURE_SKILL, relativeFile),
            ),
            `expected ${skillRoot}/${INSTALL_FIXTURE_SKILL}/${relativeFile} to exist after install`,
          );
        }
      }

      // Explicit offline scenarios provide the runtime evidence a normal audit never executes.
      for (const requiredHookProof of REQUIRED_EFFECTIVE_HOOK_PROOFS) {
        const hookProof = runCommand(
          root,
          "node",
          [
            "dist/cli/cli.js",
            "hooks",
            "verify",
            ".",
            "--agent",
            requiredHookProof.agentId,
            "--scenario",
            requiredHookProof.scenario,
            "--trusted-target",
          ],
          60000,
        );
        assert.equal(
          hookProof.status,
          0,
          `${requiredHookProof.agentId}/${requiredHookProof.scenario} proof should pass:\n${hookProof.output}`,
        );
      }

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
