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
  dirname,
  mkdirSync,
  mkdtempSync,
  patchInstallRoundTripFixture,
  PROJECT_ROOT,
  readFileSync,
  rmSync,
  runCommand,
  setupInstallRoundTripFixture,
  tmpdir,
  writeFileSync,
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

// Writes and copies a small temporary checkout, then removes both trees after checking the exclusions.
it("copies maintained inputs without local plan or scratchpad contents", () => {
  const source = mkdtempSync(join(tmpdir(), "goat-flow-roundtrip-source-"));
  let fixture: string | undefined;
  const retained = {
    ".goat-flow/plans/README.md": "plan anchor",
    ".goat-flow/plans/.gitignore": "*",
    ".goat-flow/scratchpad/README.md": "scratchpad anchor",
    ".goat-flow/scratchpad/.gitkeep": "",
    ".goat-flow/config.yaml": "version: 1",
    ".goat-flow/learning-loop/lessons/fixture.md": "retained evidence",
    "docs/guide.md": "maintained documentation",
  };
  const local = [
    ".goat-flow/plans/active/work.md",
    ".goat-flow/scratchpad/archive/work.md",
  ];
  try {
    for (const [path, content] of Object.entries(retained)) {
      mkdirSync(dirname(join(source, path)), { recursive: true });
      writeFileSync(join(source, path), content);
    }
    for (const path of local) {
      mkdirSync(dirname(join(source, path)), { recursive: true });
      writeFileSync(join(source, path), "local working content");
    }
    mkdirSync(join(source, "node_modules"));
    const copiedRoot = setupInstallRoundTripFixture(source);
    fixture = copiedRoot;
    assert.deepEqual(
      Object.fromEntries(
        Object.keys(retained).map((path) => [
          path,
          readFileSync(join(copiedRoot, path), "utf8"),
        ]),
      ),
      retained,
    );
    assert.deepEqual(
      local.filter((path) => existsSync(join(copiedRoot, path))),
      [],
    );
  } finally {
    if (fixture !== undefined)
      rmSync(dirname(fixture), { recursive: true, force: true });
    rmSync(source, { recursive: true, force: true });
  }
});

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
