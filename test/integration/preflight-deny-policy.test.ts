/**
 * Keep retired Bash policy checks out of preflight's direct stages.
 * The separately published verification command retains its fixture-based contract.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { afterEach, describe, it, test } from "node:test";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const fixtureDirectories: string[] = [];
const policies = ["deny-dangerous", "deny-git-mutations"];
const installedDirectory = ".goat-flow/hooks";

afterEach(() => {
  for (const directory of fixtureDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

// Writes fixture files and their parent directories inside the temporary project.
function writeFixture(directory: string, path: string, content: string) {
  const destination = join(directory, path);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, content);
}

// Harmless hooks expose scheduling without rerunning the real policy corpus for each drift case.
function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), "goat-preflight-policy-"));
  fixtureDirectories.push(directory);
  writeFixture(
    directory,
    "workflow/manifest.json",
    JSON.stringify({
      agents: {
        codex: { hooks_dir: installedDirectory },
        claude: { hooks_dir: installedDirectory },
      },
    }),
  );
  for (const root of ["workflow/hooks", installedDirectory]) {
    for (const policy of policies) {
      writeFixture(
        directory,
        `${root}/${policy}.sh`,
        '#!/usr/bin/env bash\n[[ "$1" == --self-test=full ]] || exit 64\nprintf "%s\\n" "$0 $1" >> full-suite-runs\nprintf "%s\\n" "PASS: fixture full policy corpus"\n',
      );
    }
    for (const path of [
      "deny-dangerous/guard-runtime.sh",
      "deny-dangerous/deny-dangerous-self-test.sh",
      "gh-graphql-read.cjs",
      "vendor/graphql.cjs",
    ]) {
      writeFixture(directory, `${root}/${path}`, "fixture runtime bytes\n");
    }
  }
  return directory;
}

describe("preflight policy retirement", () => {
  it("does not schedule or invoke the retired Bash policy checks", () => {
    const source = readFileSync(
      join(repositoryRoot, "scripts/preflight-checks.sh"),
      "utf8",
    );
    assert.doesNotMatch(source, /deny-dangerous\.sh|deny-git-mutations\.sh/u);
    assert.doesNotMatch(source, /--self-test=full|run_configured_hook_smokes/u);
    assert.doesNotMatch(source, /section "Deny Policy"/u);
  });

  // Spawns the published command against complete, incomplete and consumer-only fixture trees; each must get its documented verdict.
  it("requires complete canonical runtime in the documented verification command", () => {
    const playbook = readFileSync(
      join(repositoryRoot, "workflow/skills/playbooks/hook-policy-testing.md"),
      "utf8",
    );
    const command = playbook.match(
      /### 4\. Verify installed policy and available canonical source[\s\S]*?```bash\n([\s\S]*?)\n```/u,
    )?.[1];
    assert.ok(
      command,
      "the playbook must supply its runnable verification command",
    );

    for (const state of ["complete", "missing-entrypoint", "consumer"]) {
      const directory = createFixture();
      if (state === "missing-entrypoint") {
        rmSync(join(directory, "workflow/hooks/deny-dangerous.sh"));
      } else if (state === "consumer") {
        rmSync(join(directory, "workflow/hooks"), { recursive: true });
      }
      const result = spawnSync("bash", ["-c", command], {
        cwd: directory,
        encoding: "utf8",
        timeout: 10_000,
      });
      assert.equal(
        result.status,
        state === "missing-entrypoint" ? 2 : 0,
        `${state}: ${result.stdout}${result.stderr}`,
      );
      const runs = join(directory, "full-suite-runs");
      if (state === "missing-entrypoint") {
        assert.match(
          result.stderr,
          /workflow\/hooks\/deny-dangerous\.sh/u,
          `fixture ${state}`,
        );
        assert.equal(existsSync(runs), false, `fixture ${state}`);
      } else {
        assert.deepEqual(
          readFileSync(runs, "utf8").trim().split("\n").sort(),
          policies
            .map(
              (policy) => `${installedDirectory}/${policy}.sh --self-test=full`,
            )
            .sort(),
          `fixture ${state}`,
        );
      }
    }
  });
});

import { verifyDirectHookRuntime } from "../../src/cli/audit/check-agent-deny-runtime.js";
import {
  checkHookFileSyntax,
  checkHookSelfTest,
} from "../../src/cli/audit/check-agent-deny-mechanism.js";
import {
  makeCtx,
  PROFILES,
  stubAgentFacts,
  stubFS,
} from "../unit/audit-command/helpers.js";

// Writes and runs an installed Bash control so extracting native invocation cannot silently change the default audit route.
test("installed direct audit keeps the default Bash transport", () => {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-audit-default-")),
  );
  const project = join(parent, "goat's installed & (default) [fixture]");
  try {
    const script = ".goat-flow/hooks/deny-dangerous.sh";
    mkdirSync(join(project, ".goat-flow/hooks"), { recursive: true });
    writeFileSync(
      join(project, script),
      "#!/usr/bin/env bash\nprintf 'BLOCKED: Policy destructive: installed fixture\\n' >&2\nexit 2\n",
    );
    const facts = stubAgentFacts({ agent: PROFILES.claude });
    const result = verifyDirectHookRuntime(
      makeCtx({ projectPath: project }),
      facts,
      script,
    );
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});

// Writes failing installed controls so audit reports Bash parse and self-test failures when native selection is omitted.
test("mechanism checks retain installed Bash parsing and self-test defaults", () => {
  const parent = realpathSync(
    mkdtempSync(join(tmpdir(), "goat-audit-installed-mechanism-")),
  );
  try {
    const hooks = join(parent, ".goat-flow/hooks");
    mkdirSync(join(hooks, "deny-dangerous"), { recursive: true });
    writeFileSync(join(hooks, "invalid.sh"), "if then\n");
    writeFileSync(join(hooks, "deny-dangerous.sh"), "exit 0\n");
    writeFileSync(
      join(hooks, "deny-dangerous/deny-dangerous-self-test.sh"),
      "exit 7\n",
    );
    const ctx = makeCtx({
      projectPath: parent,
      agents: [stubAgentFacts({ agent: PROFILES.claude })],
      fs: stubFS({
        readFile: (path) => {
          try {
            return readFileSync(join(parent, path), "utf8");
          } catch {
            return null;
          }
        },
      }),
    });
    assert.equal(
      checkHookFileSyntax(ctx, ".goat-flow/hooks", "invalid.sh").status,
      "syntax-error",
    );
    const result = checkHookSelfTest(ctx);
    assert.ok(result);
    assert.match(result.message, /self-test.*failed for claude/u);
    assert.match(result.howToFix ?? "", /Run bash .*\.sh/u);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
