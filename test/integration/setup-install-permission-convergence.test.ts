/**
 * Permission upgrades must settle after one install without activating saved
 * allow/ask rules. Exercise real release settings and both Claude scopes through
 * the installer and preview, including exact changes shown to the developer.
 */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  makeTempProject,
  runCliInstaller,
  runInstaller,
} from "./setup-install.helpers.js";

// Exact permissions from v1.13.1:workflow/hooks/agent-config/claude.json.
// Pin the release data so shallow checkouts still run the convergence regressions.
const historicalPermissions = {
  allow: ["Read(.env.example)", "Read(**/.env.example)"],
  deny: [
    "Bash(*git commit*)",
    "Bash(*git push*)",
    "Bash(*sudo *)",
    "Bash(*mkfs*)",
    "Bash(*dd if=*)",
    "Bash(*git reset --hard*)",
    "Read(**/.env*)",
    "Edit(**/.env*)",
    "Write(**/.env*)",
    "Read(**/secrets/**)",
    "Read(**/*.pem)",
    "Read(**/*.key)",
    "Read(**/.ssh/**)",
    "Read(**/.aws/**)",
    "Read(**/.docker/config.json)",
    "Read(**/.gnupg/**)",
    "Read(**/.npmrc)",
    "Read(**/.pypirc)",
    "Read(**/*.pfx)",
    "Read(**/credentials*)",
    "Read(**/.kube/config)",
    "Write(**/secrets/**)",
    "Write(**/*.pem)",
    "Write(**/*.key)",
    "Write(**/.ssh/**)",
    "Write(**/.aws/**)",
    "Write(**/.docker/config.json)",
    "Write(**/.gnupg/**)",
    "Write(**/.npmrc)",
    "Write(**/.pypirc)",
    "Write(**/*.pfx)",
    "Write(**/credentials*)",
    "Write(**/.kube/config)",
    "Edit(**/secrets/**)",
    "Edit(**/*.pem)",
    "Edit(**/*.key)",
    "Edit(**/.ssh/**)",
    "Edit(**/.aws/**)",
    "Edit(**/.docker/config.json)",
    "Edit(**/.gnupg/**)",
    "Edit(**/.npmrc)",
    "Edit(**/.pypirc)",
    "Edit(**/*.pfx)",
    "Edit(**/credentials*)",
    "Edit(**/.kube/config)",
  ],
};
const settingsPaths = [
  ".claude/settings.json",
  ".claude/settings.local.json",
] as const;

/** Create and install a disposable project so later differences isolate permission changes. */
function installedProject(): string {
  const root = makeTempProject();
  const result = runInstaller(root, "--agent", "claude");
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return root;
}

/** Read the public preview rows without changing target files. */
function previewRows(root: string): Array<{ path: string; reason: string }> {
  const result = runCliInstaller(
    root,
    "--agent",
    "claude",
    "--dry-run",
    "--format",
    "json",
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout).files;
}

describe("Claude permission convergence", () => {
  for (const settingsPath of settingsPaths) {
    it(`converges historical permissions once in ${settingsPath}`, () => {
      const root = installedProject();
      const path = join(root, settingsPath);
      const settings = JSON.parse(
        readFileSync(join(root, settingsPaths[0]), "utf8"),
      );
      settings.permissions = structuredClone(historicalPermissions);
      // These synthetic unmatched-tool variants extend the actual release fixture.
      settings.permissions.deny.push(
        "NotebookEdit(**/.env*)",
        "Glob(**/.env*)",
      );
      const allow = [
        "Write(docs/**)",
        "MultiEdit(notes/**)",
        "Read(**/.env.example)",
      ];
      const ask = ["Glob(assets/**)", "NotebookEdit(notes/**)"];
      settings.permissions.allow = allow;
      settings.permissions.ask = ask;
      writeFileSync(path, JSON.stringify(settings, null, 2) + "\n");

      assert.match(
        previewRows(root).find((row) => row.path === settingsPath)?.reason ??
          "",
        /repair stale, unmatched, or retired Claude permission rules/u,
      );
      const first = runInstaller(root, "--agent", "claude");
      assert.equal(first.status, 0, first.stderr || first.stdout);
      const convergedBytes = readFileSync(path, "utf8");
      const permissions = JSON.parse(convergedBytes).permissions;
      assert.deepEqual(permissions.allow, allow);
      assert.deepEqual(permissions.ask, ask);
      assert.equal(
        permissions.deny.some(
          (rule: string) =>
            /^(Write|NotebookEdit|Glob|MultiEdit)\(/u.test(rule) ||
            rule.includes("/.env*)") ||
            rule.includes("/credentials*)") ||
            rule.includes("/secrets/**)"),
        ),
        false,
      );
      for (const tool of ["Read", "Edit"]) {
        assert.ok(permissions.deny.includes(`${tool}(**/.env)`));
        assert.ok(permissions.deny.includes(`${tool}(~/.ssh/**)`));
        assert.ok(permissions.deny.includes(`${tool}(**/.ssh/**)`));
        assert.ok(!permissions.deny.includes(`${tool}(**/credentials.json)`));
      }
      assert.doesNotMatch(
        previewRows(root).find((row) => row.path === settingsPath)?.reason ??
          "",
        /repair stale, unmatched, or retired Claude permission rules/u,
      );
      // The second install proves convergence; the third guards continuing byte stability.
      for (let repeat = 0; repeat < 2; repeat += 1) {
        const result = runInstaller(root, "--agent", "claude");
        assert.equal(result.status, 0, result.stderr || result.stdout);
        assert.equal(readFileSync(path, "utf8"), convergedBytes);
        assert.doesNotMatch(
          result.stdout,
          /stale or superseded permission rules/u,
        );
        assert.doesNotMatch(result.stderr, /Claude .*rule (?:added|removed):/u);
      }
    });
  }

  // A current deny list isolates saved user choices from legitimate deny migrations.
  it("preserves legacy allow/ask spellings without predicting a migration", () => {
    const root = installedProject();
    const saved = new Map<string, string>();
    for (const settingsPath of settingsPaths) {
      const settings = JSON.parse(
        readFileSync(join(root, settingsPaths[0]), "utf8"),
      );
      settings.permissions.allow = ["MultiEdit(notes/**)", "Write(docs/**)"];
      settings.permissions.ask = ["Glob(assets/**)", "NotebookEdit(notes/**)"];
      const bytes = JSON.stringify(settings, null, 2) + "\n";
      writeFileSync(join(root, settingsPath), bytes);
      saved.set(settingsPath, bytes);
    }
    const rows = previewRows(root);
    for (const settingsPath of settingsPaths) {
      assert.doesNotMatch(
        rows.find((row) => row.path === settingsPath)?.reason ?? "",
        /repair stale, unmatched, or retired Claude permission rules/u,
      );
    }
    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    for (const [path, bytes] of saved) {
      assert.equal(readFileSync(join(root, path), "utf8"), bytes);
    }
    assert.doesNotMatch(result.stdout, /stale or superseded permission rules/u);
  });

  // Synthetic inputs isolate each reported delta and the already-present replacement control.
  it("prints only actual deny deltas, including normalized retirements and expansions", () => {
    const root = installedProject();
    const path = join(root, settingsPaths[1]);
    const deny = [
      "Write(**/custom-cert.pem)",
      "Edit(**/*.key)",
      "Write(**/*.key)",
      "Write(**/credentials*)",
      "MultiEdit(**/old/**)",
      "Read(~/.ssh/**)",
      "Read(**/.env*)",
      "Read(**/.env)",
    ];
    writeFileSync(
      path,
      JSON.stringify({
        permissions: { deny },
        note: "synthetic-value-not-for-output",
      }),
    );
    const result = runInstaller(root, "--agent", "claude");
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const lines = result.stderr
      .split(/\r?\n/u)
      .filter((line) => /Claude .*rule (?:removed|added):/u.test(line));
    assert.deepEqual(lines, [
      '  - Claude deny rule removed: "Write(**/custom-cert.pem)"',
      '  - Claude deny rule removed: "Write(**/*.key)"',
      '  - retired Claude deny rule removed: "Write(**/credentials*)"',
      '  - Claude deny rule removed: "MultiEdit(**/old/**)"',
      '  - Claude deny rule removed: "Read(**/.env*)"',
      '  + Claude deny rule added: "Edit(**/custom-cert.pem)"',
      '  + paired Claude credential deny rule added: "Read(**/.ssh/**)"',
      ...["local", "development", "production", "staging", "test"].map(
        (variant) => `  + Claude deny rule added: "Read(**/.env.${variant})"`,
      ),
      '  + Claude deny rule added: "Read(**/.envrc)"',
      '  + Claude deny rule added: "Read(**/.env.*.local)"',
    ]);
    assert.doesNotMatch(
      result.stdout + result.stderr,
      /synthetic-value-not-for-output/u,
    );
  });
});
