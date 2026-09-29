/**
 * Checks the Windows command spellings that escaped policy during the release assessment.
 *
 * Tests submit inert text to a disposable hook installation; none execute the proposed Git writes or deletions.
 * Harmless controls preserve investigation workflows that need to display those same words.
 */
import assert from "node:assert/strict";
import {
  checkInstalledPolicy,
  runHookWithPayload,
} from "../helpers/check-installed-policy.js";
import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { after, describe, it } from "node:test";

const fixture = mkdtempSync(resolve(tmpdir(), "goat-native-shell-policy-"));
const hooks = resolve(fixture, ".goat-flow/hooks");
mkdirSync(hooks, { recursive: true });
cpSync(resolve(import.meta.dirname, "../../workflow/hooks"), hooks, {
  recursive: true,
});
assert.equal(spawnSync("git", ["init", "-q", fixture]).status, 0);
after(() => rmSync(fixture, { recursive: true, force: true }));

/**
 * Spawns the installed classifier to check a proposed action without running that action.
 *
 * @param policy - enabled policy being exercised inside the disposable project
 * @param command - literal regression input; this helper never executes its proposed action
 * @param tool - provider tool name; omitted means exercise the direct --check interface
 * @returns child exit and diagnostics; a null status means execution failed, not an allow decision
 */
function checkProposedCommand(policy: string, command: string, tool?: string) {
  // An omitted tool selects direct classifier input; provider tests retain their JSON delivery shape.
  if (!tool)
    return checkInstalledPolicy(
      resolve(hooks, `${policy}.sh`),
      fixture,
      command,
    );
  return runHookWithPayload(
    resolve(hooks, `${policy}.sh`),
    fixture,
    JSON.stringify({ tool_name: tool, tool_input: { command } }),
  );
}

const hosts = [
  (command: string) => `cmd //c "${command}"`,
  (command: string) => `powershell -c "${command}"`,
  (command: string) => `pwsh -Command "${command}"`,
  (command: string) => `wsl -e ${command}`,
];

describe("Windows command hosts", () => {
  // Each host must preserve both manual-only writes and ordinary inspection.
  for (const host of hosts) {
    // Publication and destructive operations must still require the user's manual action.
    for (const command of [
      "git.exe push --force origin HEAD",
      "git.exe reset --hard",
      "git.exe clean -fd",
      "git.exe lfs push origin main",
      "gh pr merge --admin 1",
      "gh repo delete example/probe --yes",
      "gh release create probe-tag",
    ]) {
      it(`denies ${host(command)}`, () => {
        const result = checkProposedCommand(
          "deny-git-mutations",
          host(command),
        );
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /Policy repository/u);
      });
    }
    // Investigation needs status reads and printed commands to remain available.
    for (const command of ["git.exe status --short", "echo git.exe push"]) {
      it(`allows ${host(command)}`, () => {
        const result = checkProposedCommand(
          "deny-git-mutations",
          host(command),
        );
        assert.equal(result.status, 0, result.stderr);
      });
    }
  }
  // Double-slash cmd and the WSL suffix must not conceal a recursive deletion.
  for (const command of [
    "cmd //c rmdir /s /q C:\\goat-probe-target",
    "cmd //c del /s /q C:\\goat-probe-target",
    'cmd //c "echo Ready & del /s /q C:\\goat-probe-target"',
    "wsl.exe -e rm -rf ~",
  ]) {
    it(`denies destructive host ${command}`, () => {
      const result = checkProposedCommand("deny-dangerous", command);
      assert.equal(result.status, 2, result.stderr);
    });
  }
  // Displaying a deletion command is useful during investigation; only an executed deletion should be stopped.
  for (const command of [
    'cmd /c "echo rmdir /s /q example"',
    'cmd //c "echo del /s /q example"',
    'cmd //c "echo format C:"',
  ]) {
    it(`allows command documentation ${command}`, () => {
      const result = checkProposedCommand("deny-dangerous", command);
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

describe("PowerShell host argument forms", () => {
  // These native PowerShell spellings execute the same literal body, so abbreviated options cannot bypass publication checks.
  for (const prefix of [
    "powershell -NoP -C",
    "powershell -NoProfile -Co",
    "powershell -NoP -NonI -NoL -C",
    "powershell -EP RemoteSigned -Command",
    "powershell",
  ]) {
    it(`checks publication and inspection through ${prefix}`, () => {
      const denied = checkProposedCommand(
        "deny-git-mutations",
        `${prefix} "git.exe push origin main"`,
      );
      assert.equal(denied.status, 2, denied.stderr);
      const allowed = checkProposedCommand(
        "deny-git-mutations",
        `${prefix} "git.exe status --short"`,
      );
      assert.equal(allowed.status, 0, allowed.stderr);
    });
  }
  // Hidden code or unsupported parameter binding must produce a recovery denial from either enabled policy.
  for (const command of [
    "powershell -e VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAnAGgAaQAnAA==",
    'pwsh -CommandWithArgs "git.exe push" origin main',
    "powershell -Command -",
    "powershell -File -",
  ]) {
    it(`requires literal supported input for ${command}`, () => {
      // Independent toggles must not expose opaque code when only one policy remains enabled.
      for (const policy of ["deny-dangerous", "deny-git-mutations"]) {
        const result = checkProposedCommand(policy, command);
        assert.equal(result.status, 2, result.stderr);
        assert.match(result.stderr, /literal.*Bash/u);
      }
    });
  }
  it("keeps help, version and ordinary script invocation available", () => {
    // Informational host options and script paths must not be mistaken for inline command bodies.
    for (const command of [
      "powershell -Help",
      "pwsh --version",
      "powershell -File scripts/check.ps1",
    ]) {
      const result = checkProposedCommand("deny-dangerous", command);
      assert.equal(result.status, 0, result.stderr);
    }
  });
  it("allows printing destructive PowerShell words but denies executed verbs", () => {
    const allowed = checkProposedCommand(
      "deny-dangerous",
      "powershell -Command \"Write-Output 'Remove-Item example'\"",
    );
    assert.equal(allowed.status, 0, allowed.stderr);
    const denied = checkProposedCommand(
      "deny-dangerous",
      "powershell -NoP -Co \"Write-Output 'Ready'; Remove-Item -Recurse -Force C:\\goat-probe-target\"",
    );
    assert.equal(denied.status, 2, denied.stderr);
    assert.match(denied.stderr, /PowerShell destructive verb/u);
  });
  it("checks execution-policy values without blocking a restricted setting", () => {
    const denied = checkProposedCommand(
      "deny-dangerous",
      "powershell -c \"Set-ExecutionPolicy -Scope Process 'Bypass'\"",
    );
    assert.equal(denied.status, 2, denied.stderr);
    const allowed = checkProposedCommand(
      "deny-dangerous",
      'powershell -c "Set-ExecutionPolicy -Scope Process RemoteSigned"',
    );
    assert.equal(allowed.status, 0, allowed.stderr);
  });
});

describe("Native shell conditionals", () => {
  const conditionalCommands = [
    [
      "powershell -Command 'if ($true)\n{\nACTION\n}\nelse\n{\nWrite-Output Ready\n}'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'if ($false) { Write-Output Ready }\nelseif ($true)\n{\nACTION\n}'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'Write-Output Ready; if ($true) { Write-Output Ready; ACTION; Write-Output Ready }'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'if ($true) { Write-Output Ready }; ACTION'",
      "Remove-Item example",
    ],
    [
      'cmd /c "echo Ready & if exist example (echo Ready & ACTION) else (echo Ready)"',
      "del /s /q example",
    ],
    [
      "powershell -Command 'if ($true) { ACTION }'",
      "Remove-Item -Recurse -Force example",
    ],
    [
      "pwsh -Command 'IF($true){ACTION}'",
      "Remove-Item -Recurse -Force example",
    ],
    [
      "powershell -Command 'if ($false) { Write-Output Ready } else { ACTION }'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'if ($false) { Write-Output Ready } elseif ($true) { ACTION }'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'if ($true) { if ($true) { ACTION } }'",
      "Remove-Item example",
    ],
    [
      "powershell -Command 'if (ACTION) { Write-Output Ready }'",
      "Remove-Item example",
    ],
    ['cmd /c "if exist example ACTION"', "del /s /q example"],
    ['cmd //c "IF NOT EXIST example ACTION"', "rmdir /s /q example"],
    [
      "cmd /c 'if exist \"example folder\" (ACTION) else (echo Ready)'",
      "del /s /q example",
    ],
    [
      'cmd /c "if exist example (echo Ready) else (ACTION)"',
      "del /s /q example",
    ],
    ['cmd /c "if defined EXAMPLE ACTION"', "del /s /q example"],
    ['cmd /c "if errorlevel 1 ACTION"', "del /s /q example"],
    ['cmd /c "if /i example==EXAMPLE ACTION"', "del /s /q example"],
    ['cmd /c "if 1 EQU 1 ACTION"', "del /s /q example"],
    ['cmd /c "if exist example if errorlevel 0 ACTION"', "del /s /q example"],
  ];
  // A user's conditional cleanup or publication request must receive the same decision as its direct command.
  for (const [conditional, destructiveAction] of conditionalCommands) {
    it(`checks executable branches and harmless controls in ${conditional}`, () => {
      const isPowerShell = /^(powershell|pwsh)/u.test(conditional);
      const harmlessAction = isPowerShell ? "Write-Output Ready" : "echo Ready";
      // Each policy also checks a read-only branch, so closing the bypass cannot disable ordinary inspection.
      for (const [policy, deniedAction, allowedAction] of [
        ["deny-dangerous", destructiveAction, harmlessAction],
        [
          "deny-git-mutations",
          "git.exe push origin main",
          "git.exe status --short",
        ],
      ]) {
        const denied = checkProposedCommand(
          policy,
          conditional.replace("ACTION", deniedAction),
        );
        assert.equal(denied.status, 2, `${conditional}: ${denied.stderr}`);
        const allowed = checkProposedCommand(
          policy,
          conditional.replace("ACTION", allowedAction),
        );
        assert.equal(allowed.status, 0, `${conditional}: ${allowed.stderr}`);
      }
    });
  }
  it("keeps quoted conditional text and unevaluated PowerShell script blocks available", () => {
    // An investigator may print a script instead of running it; its braces and verbs remain argument data.
    for (const command of [
      `powershell -Command 'Write-Output "if ($true) { Remove-Item example }"'`,
      `powershell -Command 'Write-Output { Remove-Item example }'`,
      `powershell -Command 'if ($true) { Write-Output "brace } and Remove-Item example" }'`,
      `cmd /c 'if exist "example folder" (echo "del /s /q example")'`,
    ]) {
      const result = checkProposedCommand("deny-dangerous", command);
      assert.equal(result.status, 0, result.stderr);
    }
  });
  it("preserves provider denials for conditional deletions", () => {
    // Provider delivery must retain the same stop decision as the direct classifier interface.
    for (const command of [
      `powershell -Command 'if ($true) { Remove-Item -Recurse -Force example }'`,
      'cmd /c "if exist example del /s /q example"',
    ]) {
      const result = checkProposedCommand("deny-dangerous", command, "Bash");
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /Policy destructive/u);
    }
  });
});

describe("PowerShell executable script blocks", () => {
  const blockCommands = [
    'powershell -Command "1 | ForEach-Object { ACTION }"',
    "pwsh -Command '1 | % { ACTION }'",
    "powershell -Command '1 | foreach -Begin { Write-Output Ready } -Process { Write-Output Ready } -End { ACTION }'",
    "powershell -Command '1 | ForEach-Object { if ($true) { ACTION } }'",
    "powershell -Command 'if ($true) { 1 | ForEach-Object { ACTION } }'",
    "powershell -Command '1 | ForEach-Object { 1 | ForEach-Object { ACTION } }'",
    `powershell -Command '1 | ForEach-Object { Write-Output "brace } | text"; ACTION }'`,
    "powershell -Command '1 | ForEach-Object { Write-Output Ready }; ACTION'",
    "powershell -Command 'Write-Output (& { ACTION })'",
    "powershell -Command '({ ACTION }).Invoke()'",
  ];
  // Script-block arguments execute inside the host and must retain each policy's own deny and allow decisions.
  for (const command of blockCommands) {
    it(`inspects executed script blocks in ${command}`, () => {
      for (const [policy, deniedAction, allowedAction] of [
        [
          "deny-dangerous",
          "Remove-Item -Recurse -Force example",
          "Write-Output Ready",
        ],
        [
          "deny-git-mutations",
          "git.exe push origin main",
          "git.exe status --short",
        ],
      ]) {
        const denied = checkProposedCommand(
          policy,
          command.replace("ACTION", deniedAction),
        );
        assert.equal(denied.status, 2, denied.stderr);
        const allowed = checkProposedCommand(
          policy,
          command.replace("ACTION", allowedAction),
        );
        assert.equal(allowed.status, 0, allowed.stderr);
      }
    });
  }
  it("keeps quoted and output-only script blocks inert", () => {
    for (const command of [
      `powershell -Command 'Write-Output "1 | ForEach-Object { Remove-Item example }"'`,
      `powershell -Command 'Write-Output { Write-Output Ready; Remove-Item example }'`,
      `powershell -Command 'Write-Output -InputObject { Remove-Item example }'`,
      `powershell -Command 'Write-Output "label" { Remove-Item example }'`,
      `powershell -Command 'Write-Output { Remove-Item example } { Remove-Item other }'`,
      `powershell -Command '1 | ForEach-Object { Write-Output { Remove-Item example } }'`,
    ]) {
      const result = checkProposedCommand("deny-dangerous", command);
      assert.equal(result.status, 0, result.stderr);
    }
  });
  it("delivers one provider denial for an executed script block", () => {
    const result = checkProposedCommand(
      "deny-dangerous",
      'powershell -Command "1 | ForEach-Object { Remove-Item -Recurse -Force example }"',
      "Bash",
    );
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr.match(/BLOCKED:/gu)?.length, 1, result.stderr);
  });
});

describe("Native host grammar", () => {
  // Each row is a shape the real host runs but Bash grammar misread, paired with a harmless neighbour that must stay usable.
  const hostGrammarPairs: Array<[string, string, string]> = [
    [
      "deny-dangerous",
      'cmd /c "call del /s /q example"',
      'cmd /c "call echo Ready"',
    ],
    [
      "deny-dangerous",
      'cmd /c "for %i in (x) do del /s /q %i"',
      'cmd /c "for %i in (x) do echo %i"',
    ],
    [
      "deny-git-mutations",
      "cmd /c \"for /f %i in ('git.exe push origin main') do echo %i\"",
      "cmd /c \"for /f %i in ('git.exe status --short') do echo %i\"",
    ],
    [
      "deny-dangerous",
      'cmd /c "start /b del /s /q example"',
      'cmd /c "start /b echo Ready"',
    ],
    ["deny-dangerous", 'cmd /c "@del /s /q example"', 'cmd /c "@echo Ready"'],
    [
      "deny-git-mutations",
      'cmd //c "echo a\\& git.exe push origin main"',
      'cmd //c "echo a ^& git.exe push origin main"',
    ],
    [
      "deny-git-mutations",
      'cmd //e:on //c "git.exe push origin main"',
      'cmd //e:on //c "git.exe status --short"',
    ],
    [
      "deny-git-mutations",
      'cmd /t:0a /c "git.exe push origin main"',
      'cmd /q /c "git.exe status --short"',
    ],
    [
      "deny-git-mutations",
      'cmd /c"git.exe push origin main"',
      'cmd /c"git.exe status --short"',
    ],
    [
      "deny-dangerous",
      'powershell -c "Microsoft.PowerShell.Management\\Remove-Item example"',
      'powershell -c "Microsoft.PowerShell.Utility\\Write-Output Ready"',
    ],
    [
      "deny-dangerous",
      'powershell -c ". Remove-Item example"',
      'powershell -c ". Write-Output Ready"',
    ],
    [
      "deny-git-mutations",
      'powershell -c "C:\\tools\\git.exe push origin main"',
      'powershell -c "C:\\tools\\git.exe status --short"',
    ],
    [
      "deny-git-mutations",
      'powershell -c "Start-Process git.exe push origin main"',
      'powershell -c "Start-Process git.exe status"',
    ],
    [
      "deny-git-mutations",
      'powershell -c "echo {git.exe push origin main} | % {& $_}"',
      'powershell -c "echo {git.exe status --short} | % {& $_}"',
    ],
    [
      "deny-dangerous",
      'xargs powershell -c "Remove-Item example"',
      'xargs powershell -c "Write-Output Ready"',
    ],
    [
      "deny-git-mutations",
      "xargs bash -c 'git push origin main'",
      "xargs bash -c 'git status --short'",
    ],
    [
      "deny-git-mutations",
      "wsl echo a '&&' git push origin main",
      "wsl --shell-type none echo a '&&' git push origin main",
    ],
    ["deny-git-mutations", "wsl --unregister Ubuntu", "wsl --list --verbose"],
  ];
  for (const [policy, denied, allowed] of hostGrammarPairs) {
    it(`${policy} denies ${denied} and allows its neighbour`, () => {
      const deniedResult = checkProposedCommand(policy, denied);
      assert.equal(deniedResult.status, 2, deniedResult.stderr);
      const allowedResult = checkProposedCommand(policy, allowed);
      assert.equal(allowedResult.status, 0, allowedResult.stderr);
    });
  }
  // These host forms have no harmless spelling: aliases, misread separators and run-time evaluation must stay manual.
  for (const [policy, denied] of [
    [
      "deny-git-mutations",
      "cmd //c \"echo ' & git.exe push origin main & echo '\"",
    ],
    ["deny-dangerous", 'powershell -c "rd -Recurse example"'],
    ["deny-dangerous", 'powershell -c "Write-Output a\\; Remove-Item example"'],
    [
      "deny-git-mutations",
      "powershell -c \"Invoke-Expression 'git.exe status --short'\"",
    ],
  ]) {
    it(`${policy} denies ${denied}`, () => {
      const result = checkProposedCommand(policy, denied);
      assert.equal(result.status, 2, result.stderr);
    });
  }
});

// Native Windows paths keep their backslashes after the outer shell removes quotes.
for (const host of [
  '"C:\\Windows\\System32\\cmd.exe" //c',
  '"C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe" -NoP -C',
]) {
  it(`inspects commands through the Windows executable path ${host}`, () => {
    const denied = checkProposedCommand(
      "deny-git-mutations",
      `${host} "git.exe push origin main"`,
    );
    assert.equal(denied.status, 2, denied.stderr);
    const allowed = checkProposedCommand(
      "deny-git-mutations",
      `${host} "git.exe status --short"`,
    );
    assert.equal(allowed.status, 0, allowed.stderr);
  });
}

describe("Windows LFS executable lookup", () => {
  // Windows resolves these spellings to the same LFS executable.
  for (const spelling of ["lfs", "LFS", "Lfs"]) {
    // Both publishing objects and locking remote files are writes.
    for (const command of ["push origin main", "lock probe.txt"]) {
      it(`denies git.exe ${spelling} ${command}`, () => {
        const result = checkProposedCommand(
          "deny-git-mutations",
          `git.exe ${spelling} ${command}`,
        );
        assert.equal(result.status, 2, result.stderr);
      });
    }
    it(`allows git.exe ${spelling} version`, () => {
      const result = checkProposedCommand(
        "deny-git-mutations",
        `git.exe ${spelling} version`,
      );
      assert.equal(result.status, 0, result.stderr);
    });
  }
});

describe("Unqualified native PowerShell tool", () => {
  // Unsupported native-tool input needs a visible Bash recovery route from either enabled policy.
  for (const [policy, command] of [
    ["deny-git-mutations", "git push origin HEAD"],
    ["deny-dangerous", "Remove-Item -Recurse -Force C:\\goat-probe-target"],
  ]) {
    it(`rejects ${policy} PowerShell events with a Bash recovery route`, () => {
      const result = checkProposedCommand(policy, command, "PowerShell");
      assert.equal(result.status, 2, result.stderr);
      assert.match(result.stderr, /PowerShell.*Bash/u);
    });
  }
});
