/** Verify complete native policy decisions: provider rendering, request routing, guard dispatch and shell-state scoping. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import {
  renderPolicyResponse,
  runPolicyHook,
  type PolicyGuard,
} from "../../workflow/hooks/policy-evaluation.mjs";

let home = "";
let repository = "";

before(() => {
  home = mkdtempSync(join(tmpdir(), "goat-evaluation-home-"));
  repository = mkdtempSync(join(tmpdir(), "goat-evaluation-repo-"));
  execFileSync("git", ["init", "--quiet", repository]);
});

after(() => {
  rmSync(home, { recursive: true, force: true });
  rmSync(repository, { recursive: true, force: true });
});

/** Run one request through the hook with isolated Git configuration; `stdin` is the provider payload. */
async function hook(
  guard: PolicyGuard,
  argv: string[],
  stdin = "",
  stdinIsTerminal = false,
) {
  const bytes = Buffer.from(stdin, "latin1");
  return runPolicyHook(
    {
      guard,
      directory: repository,
      deadlineAt: Date.now() + 10_000,
      homeDirectory: home,
      environment: {
        ...process.env,
        HOME: home,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_NOSYSTEM: "1",
      },
    },
    { argv, readStdin: () => bytes, stdinIsTerminal },
  );
}

describe("native policy provider responses", () => {
  it("renders denials and allows through each provider channel with real JSON", () => {
    const denial = { scope: "secret", reason: 'cat "x"\nnext' };
    assert.deepEqual(renderPolicyResponse("stderr-exit", denial), {
      stdout: "",
      stderr: 'BLOCKED: Policy secret: cat "x"\nnext\n',
      exitCode: 2,
    });
    const copilot = renderPolicyResponse("copilot-json", denial);
    assert.equal(copilot.exitCode, 0);
    assert.deepEqual(JSON.parse(copilot.stdout), {
      permissionDecision: "deny",
      permissionDecisionReason: 'Policy secret: cat "x"\nnext',
    });
    assert.deepEqual(
      JSON.parse(renderPolicyResponse("antigravity-json", denial).stdout),
      { decision: "deny", reason: 'Policy secret: cat "x"\nnext' },
    );
    assert.deepEqual(renderPolicyResponse("antigravity-json", null), {
      stdout: '{"decision":"allow"}\n',
      stderr: "",
      exitCode: 0,
    });
    assert.deepEqual(renderPolicyResponse("stderr-exit", null), {
      stdout: "",
      stderr: "",
      exitCode: 0,
    });
  });
});

describe("native policy request routing", () => {
  it("routes provider tools by ownership and refuses requests it cannot inspect", async () => {
    const notExposed =
      "BLOCKED: Policy deny-dangerous: Hook payload did not expose a bash command to evaluate\n";
    for (const [guard, argv, stdin, stderr] of [
      [
        "deny-git-mutations",
        [],
        '{"tool_name":"Read","tool_input":{"file_path":".env"}}',
        "",
      ],
      [
        "deny-dangerous",
        [],
        '{"tool_name":"Read","tool_input":{"file_path":".env"}}',
        "BLOCKED: Policy secret: Secret-file access (.env). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk. Use a checked-in example or ask the user for sanitized fields.\n",
      ],
      [
        "deny-dangerous",
        [],
        '{"tool_name":"PowerShell","tool_input":{"command":"echo safe"}}',
        "BLOCKED: Policy deny-dangerous: Native PowerShell tool commands are not supported by this policy. Use a supported shell tool instead.\n",
      ],
      [
        "deny-dangerous",
        [],
        '{"tool_name":"Bash","tool_input":{}}',
        notExposed,
      ],
      ["deny-dangerous", [], '{"tool_name":"Bash"', notExposed],
      ["deny-dangerous", [], '{"command":"echo \xff"}', notExposed],
      [
        "deny-dangerous",
        ["echo hi"],
        '{"tool_name":"Bash","tool_input":{"command":"rm -rf /"}}',
        "BLOCKED: Policy deny-dangerous: Hook received both positional command and stdin payload. Submit exactly one command source.\n",
      ],
      ["deny-dangerous", ["--check={not json"], "", ""],
    ] as const) {
      const outcome = await hook(guard, [...argv], stdin);
      assert.equal(outcome.kind, "response", stdin);
      if (outcome.kind !== "response") throw new Error(stdin);
      assert.equal(outcome.stderr, stderr, `${guard} ${stdin}`);
      assert.equal(outcome.exitCode, stderr === "" ? 0 : 2, stdin);
    }
    assert.deepEqual(await hook("deny-dangerous", ["--self-test=smoke"]), {
      kind: "self-test",
      mode: "smoke",
    });
  });

  it("answers JSON providers on stdout and keeps their allow envelope", async () => {
    const outcome = await hook(
      "deny-git-mutations",
      [],
      '{"toolCall":{"name":"run_command","args":{"CommandLine":"git push"}}}',
    );
    assert.equal(outcome.kind, "response");
    if (outcome.kind !== "response") throw new Error("missing response");
    assert.equal(outcome.exitCode, 0);
    assert.equal(JSON.parse(outcome.stdout).decision, "deny");
    assert.deepEqual(
      await hook(
        "deny-git-mutations",
        [],
        '{"toolCall":{"name":"run_command","args":{"CommandLine":"git status"}}}',
      ),
      {
        kind: "response",
        stdout: '{"decision":"allow"}\n',
        stderr: "",
        exitCode: 0,
      },
    );
  });
});

describe("native policy dispatch and shell state", () => {
  it("applies each guard's rules, including nested and inline-shell commands", async () => {
    for (const [guard, command, prefix] of [
      [
        "deny-dangerous",
        "rm -rf /",
        "BLOCKED: Policy destructive: rm -r without safe scoping",
      ],
      [
        "deny-dangerous",
        "cat .env",
        "BLOCKED: Policy secret: Secret-file access (cat)",
      ],
      [
        "deny-dangerous",
        "echo $(echo $(rm -rf /))",
        "BLOCKED: Policy destructive: rm -r",
      ],
      [
        "deny-dangerous",
        "bash -c 'rm -rf /'",
        "BLOCKED: Policy destructive: rm -r",
      ],
      [
        "deny-dangerous",
        'powershell -Command "Remove-Item build"',
        "BLOCKED: Policy destructive: PowerShell destructive verb",
      ],
      [
        "deny-git-mutations",
        "git push origin main",
        "BLOCKED: Policy repository: Git publication is not allowed",
      ],
      [
        "deny-git-mutations",
        "find . -exec git push \\;",
        "BLOCKED: Policy repository: Git publication is not allowed",
      ],
      [
        "deny-git-mutations",
        "git -c core.pager='git push' log",
        "BLOCKED: Policy repository: Git publication is not allowed",
      ],
      ["deny-dangerous", "git status && ls", ""],
      ["deny-git-mutations", "git status && ls", ""],
    ] as const) {
      const outcome = await hook(guard, [`--check=${command}`]);
      assert.equal(outcome.kind, "response", command);
      if (outcome.kind !== "response") throw new Error(command);
      if (prefix === "") assert.equal(outcome.stderr, "", command);
      else
        assert.ok(
          outcome.stderr.startsWith(prefix),
          `${command}: ${outcome.stderr}`,
        );
    }
  });

  it("keeps directory and config-source changes inside the subshell that made them", async () => {
    for (const [command, denied] of [
      ['cd "$x"; git saved', true],
      ['(cd "$x"); git saved', false],
      ["HOME=/tmp/other; git status", true],
      ["(HOME=/tmp/other); git status", false],
    ] as const) {
      const outcome = await hook("deny-dangerous", [`--check=${command}`]);
      assert.equal(outcome.kind, "response", command);
      if (outcome.kind !== "response") throw new Error(command);
      assert.equal(
        outcome.exitCode,
        denied ? 2 : 0,
        `${command}: ${outcome.stderr}`,
      );
    }
  });
});
