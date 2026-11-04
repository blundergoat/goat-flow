/** Large report transport stays bounded while executable openers and continuations remain inspected. */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";
import { copyHookTree } from "../helpers/hook-entrypoint.js";
import { checkInstalledPolicy } from "../helpers/check-installed-policy.js";

const policyFixture = mkdtempSync(
  resolve(tmpdir(), "goat-large-report-policy-"),
);
const fixtureHooks = resolve(policyFixture, ".goat-flow/hooks");
mkdirSync(fixtureHooks, { recursive: true });
copyHookTree(fixtureHooks);
const initialized = spawnSync("git", ["init", "-q", policyFixture]);
assert.equal(initialized.status, 0, initialized.stderr?.toString());
after(() => rmSync(policyFixture, { recursive: true, force: true }));

describe("bounded large-report heredoc transport", () => {
  const report = JSON.stringify({
    detail:
      "x".repeat(17000) + " Literal rm -rf / and git push are report evidence.",
  });
  const cases: {
    name: string;
    command: string;
    expected: readonly [0 | 2, 0 | 2];
  }[] = [
    {
      name: "installed quality saver",
      command: "goat-flow quality save .",
      expected: [0, 0],
    },
    {
      name: "source quality saver",
      command: "node --import tsx src/cli/cli.ts quality save .",
      expected: [0, 0],
    },
    {
      name: "assignment prefix",
      command: "CI=1 goat-flow quality save .",
      expected: [0, 0],
    },
    {
      name: "directory prefix",
      command: "cd . && goat-flow quality save .",
      expected: [2, 2],
    },
    {
      name: "built CLI",
      command: "node dist/cli/cli.js quality save .",
      expected: [2, 2],
    },
    {
      name: "installed redactor",
      command: "goat-flow redact",
      expected: [2, 2],
    },
    {
      name: "source redactor",
      command: "node --import tsx src/cli/cli.ts redact",
      expected: [2, 2],
    },
    {
      name: "installed review validator",
      command: "goat-flow review validate",
      expected: [2, 2],
    },
    {
      name: "source review validator",
      command: "node --import tsx src/cli/cli.ts review validate",
      expected: [2, 2],
    },
    {
      name: "unquoted delimiter",
      command: "goat-flow quality save . <<REPORT\n" + report + "\nREPORT",
      expected: [2, 2],
    },
    {
      name: "shell-fed body",
      command:
        "goat-flow quality save . <<'REPORT' | bash\n" + report + "\nREPORT",
      expected: [2, 2],
    },
    {
      name: "destructive opener",
      command: "goat-flow quality save . $(rm -rf /)",
      expected: [2, 0],
    },
    {
      name: "Git opener",
      command: "goat-flow quality save . $(git push origin main)",
      expected: [0, 2],
    },
    {
      name: "destructive continuation",
      command:
        "goat-flow quality save . <<'REPORT'\n" + report + "\nREPORT\nrm -rf /",
      expected: [2, 0],
    },
    {
      name: "Git continuation",
      command:
        "goat-flow quality save . <<'REPORT'\n" +
        report +
        "\nREPORT\ngit push origin main",
      expected: [0, 2],
    },
  ];
  for (const fixture of cases) {
    const command = fixture.command.includes("<<")
      ? fixture.command
      : fixture.command + " <<'REPORT'\n" + report + "\nREPORT";
    for (const [index, hook] of (
      ["deny-dangerous", "deny-git-mutations"] as const
    ).entries()) {
      it(`${hook}: ${fixture.name}`, () => {
        assert.ok(Buffer.byteLength(command) > 16384);
        const result = checkInstalledPolicy(
          resolve(fixtureHooks, `${hook}.sh`),
          policyFixture,
          command,
        );
        assert.equal(result.error, undefined);
        assert.equal(result.status, fixture.expected[index], result.stderr);
        assert.equal(result.stdout, "");
        assert.doesNotMatch(result.stderr, /hook unavailable/iu);
        if (fixture.expected[index] === 2)
          assert.match(result.stderr, /BLOCKED: Policy /u);
        else assert.equal(result.stderr, "");
      });
    }
  }
});
