/** Native segment and context parsing preserves the frozen command boundaries. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  findPolicyNativeScriptBlockBodies,
  findPolicyNativeLaunchedCommands,
  inspectPolicyPowerShellSyntax,
  splitPolicyCommandSegments,
  splitPolicyTopLevelPipelineStages,
  findPolicyNativeScriptBlockCommands,
  trackPolicyGitShellDirectory,
  trackPolicyGitConfigEnvironment,
} from "../../workflow/hooks/policy-segments.mjs";

describe("policy native block and launch inspection", () => {
  for (const command of [
    "(Get-Location).Path",
    "Get-Content control.txt",
    "Get-Content 'report\u00a0notes.txt'",
    'Write-Output "typographic \u2018single\u2019 quotes"',
    "git -c color.ui=false status",
    "& 'gh.exe' pr create --fill",
    "Get-ChildItem | Select-Object Name",
    "if (Test-Path .git) { git status } else { Write-Output missing }",
    "if ($true) { Write-Output Ready }",
    "if ($true) { Write-Output Ready }; Write-Output Done",
    "if ($false) { Write-Output Ready } else { Write-Output Ready }",
    ". Write-Output Ready",
    "echo {git.exe status --short} | % {& $_}",
    "pwsh --version",
    "Write-Output '$env:COMMAND [type] + Set-Alias g gh'",
  ]) {
    it(`admits inspectable PowerShell syntax: ${command}`, () => {
      assert.equal(inspectPolicyPowerShellSyntax(command), null);
    });
  }
  for (const command of [
    "& $env:COMMAND --fill",
    "& (Get-Command gh) pr create --fill",
    "Write-Output (gh pr create --fill)",
    "\u00a0Remove-Item target",
    "gh\u00a0pr\u00a0create\u00a0--fill",
    "& \u2018Remove-Item\u2019 target",
    "Write-Output 'x\u2019; gh pr create --fill; \u2019y'",
    "Start-Process gh \u2013ArgumentList 'pr create'",
    "if ($true) { Write-Output Ready }; Write-Output (gh pr create --fill)",
    "if ($true) { Write-Output Ready }; Write-Output (Remove-Item -Recurse -Force build)",
    "return (gh pr create --fill)",
    '"text".GetType()',
    "Get-Process | ForEach-Object Kill",
    "pwsh -File unchecked.ps1",
    ". (Get-Command gh) pr create --fill",
    "Get-Content commands.txt | % {& $_}",
    "echo (Get-Content commands.txt) | % {& $_}",
    "Set-Alias g gh; g pr create --fill",
    "[System.Diagnostics.Process]::Start('gh','pr create --fill')",
    'Write-Output "$env:COMMAND"',
    "& ('g' + 'h') pr create --fill",
    "@('gh', 'pr', 'create')",
    "Set-Location ..; git status",
    ". local.ps1",
    "./local.ps1",
    "Write-Output 'unterminated",
    "if (Test-Path .git) { git status",
  ]) {
    it(`refuses unresolved PowerShell syntax: ${command}`, () => {
      assert.match(
        inspectPolicyPowerShellSyntax(command) ?? "",
        /Cannot inspect/u,
      );
    });
  }
  it("distinguishes printed PowerShell blocks from expression, invocation and pipeline-consumed bodies", () => {
    for (const row of [
      ["", true, "pwsh", { kind: "commands", commands: [] }],
      [
        "echo {Remove-Item build}",
        true,
        "pwsh",
        { kind: "commands", commands: [] },
      ],
      [
        "echo {Remove-Item build}",
        false,
        "pwsh",
        { kind: "commands", commands: ["Remove-Item build"] },
      ],
      [
        "Write-Output (& {git status})",
        true,
        "pwsh",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        "Write-Output {git status}.Invoke()",
        true,
        "pwsh",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        "ForEach-Object {git status}",
        true,
        "pwsh",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        "% {echo {nested}} {git status}",
        true,
        "pwsh",
        { kind: "commands", commands: ["echo {nested}", "git status"] },
      ],
      ["echo '{literal}'", false, "pwsh", { kind: "commands", commands: [] }],
      ['echo "{literal}"', false, "pwsh", { kind: "commands", commands: [] }],
      ["echo `{literal`}", true, "pwsh", { kind: "commands", commands: [] }],
      ["% {echo safe", true, "pwsh", { kind: "unresolved" }],
      ["% {}", true, "pwsh", { kind: "commands", commands: [""] }],
      [
        "Write-Output {echo λ}  {git status}",
        true,
        "powershell",
        { kind: "commands", commands: [] },
      ],
      [
        "Write-Output {echo λ}  {git status}",
        false,
        "powershell",
        { kind: "commands", commands: ["echo λ", "git status"] },
      ],
      [
        "echo ({echo λ})",
        true,
        "pwsh",
        { kind: "commands", commands: ["echo λ"] },
      ],
      [
        "echo {echo 🦌} .Invoke()",
        true,
        "pwsh",
        { kind: "commands", commands: ["echo 🦌"] },
      ],
      [
        "% {echo ')'}",
        true,
        "pwsh",
        { kind: "commands", commands: ["echo ')'"] },
      ],
      [
        "echo ( {one} ) {two}",
        true,
        "pwsh",
        { kind: "commands", commands: ["one"] },
      ],
      [
        "echo {literal} ; % {git status}",
        true,
        "pwsh",
        { kind: "commands", commands: [] },
      ],
      [
        "% {echo `} safe}",
        true,
        "pwsh",
        { kind: "commands", commands: ["echo `} safe"] },
      ],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeScriptBlockBodies(row[0], row[1], row[2]),
        row[3],
        JSON.stringify(row),
      );
    }
  });
  it("retains cmd launch commands, window titles and for-loop actions with original letter case", () => {
    for (const row of [
      ["echo safe", "cmd", { kind: "absent" }],
      ["@git status", "cmd", { kind: "commands", commands: ["git status"] }],
      ["@@echo safe", "cmd", { kind: "commands", commands: ["@echo safe"] }],
      [
        "call git status",
        "cmd",
        { kind: "commands", commands: ["git status"] },
      ],
      ["CALL git -D", "cmd.exe", { kind: "commands", commands: ["git -D"] }],
      ["call", "cmd", { kind: "commands", commands: [""] }],
      [
        'start "" /b git status',
        "cmd",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        'start "window" /d repo /node 1 /affinity 2 git status',
        "cmd",
        { kind: "commands", commands: ["git status"] },
      ],
      ['start "unterminated', "cmd", { kind: "unresolved" }],
      ["start /b", "cmd", { kind: "commands", commands: [] }],
      ["start", "cmd", { kind: "commands", commands: [] }],
      [
        "for %i in (build dist) do git status",
        "cmd",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        "for %%I in (build) do echo %%I",
        "cmd",
        { kind: "commands", commands: ["echo %%I"] },
      ],
      [
        "for /f %i in ('git branch -D Main') do echo %i",
        "cmd",
        { kind: "commands", commands: ["echo %i", "git branch -D Main"] },
      ],
      [
        "for /f %i in (`git branch -D Main`) do echo %i",
        "cmd",
        { kind: "commands", commands: ["echo %i", "git branch -D Main"] },
      ],
      [
        'for /f "tokens=*" %i in ("plain data") do echo %i',
        "cmd",
        { kind: "commands", commands: ["echo %i"] },
      ],
      [
        "for /r root /f %i in ('git status') do echo %i",
        "cmd",
        { kind: "commands", commands: ["echo %i", "git status"] },
      ],
      [
        "for /d %i in (build) do echo %i",
        "cmd",
        { kind: "commands", commands: ["echo %i"] },
      ],
      [
        "for /l %i in (1,1,2) do echo %i",
        "cmd",
        { kind: "commands", commands: ["echo %i"] },
      ],
      ["for unsupported header", "cmd", { kind: "unresolved" }],
      ["for %i in () do ", "cmd", { kind: "commands", commands: [""] }],
      ["\tcall echo λ", "cmd", { kind: "commands", commands: ["echo λ"] }],
      ["start /d", "cmd", { kind: "commands", commands: [] }],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeLaunchedCommands(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
  it("reveals positional PowerShell launches while refusing dynamic evaluation and named argument assembly", () => {
    for (const row of [
      [". git status", "pwsh", { kind: "commands", commands: ["git status"] }],
      [". ", "pwsh", { kind: "commands", commands: [""] }],
      ["iex 'git status'", "pwsh", { kind: "unresolved" }],
      [
        "Microsoft.PowerShell.Utility/Invoke-Expression text",
        "powershell.exe",
        { kind: "unresolved" },
      ],
      [
        "Start-Process git.exe status",
        "pwsh.exe",
        { kind: "commands", commands: ["git.exe status"] },
      ],
      [
        "saps git.exe 'a b'",
        "pwsh",
        { kind: "commands", commands: ["git.exe a b"] },
      ],
      [
        "start git.exe status",
        "powershell",
        { kind: "commands", commands: ["git.exe status"] },
      ],
      ["Start-Process", "pwsh", { kind: "commands", commands: [] }],
      [
        "Start-Process -FilePath git.exe -ArgumentList status",
        "pwsh",
        { kind: "unresolved" },
      ],
      ["Start-Process git.exe --help", "pwsh", { kind: "unresolved" }],
      ["echo safe", "pwsh", { kind: "absent" }],
      [". git status", "bash", { kind: "absent" }],
      ["call git status", "pwsh", { kind: "absent" }],
      ["start git status", "bash", { kind: "absent" }],
      [
        "Start-Process git.exe 'λ'",
        "pwsh",
        { kind: "commands", commands: ["git.exe λ"] },
      ],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeLaunchedCommands(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
});

describe("policy composed segment inspection", () => {
  it("splits command lists without mistaking quoted, escaped or redirected operators for background actions", () => {
    for (const row of [
      [
        "",
        "",
        {
          kind: "segments",
          segments: [""],
          background: false,
        },
      ],
      [
        "git status && echo ok || echo retry; pwd\nls",
        "",
        {
          kind: "segments",
          segments: ["git status ", " echo ok ", " echo retry", " pwd", "ls"],
          background: false,
        },
      ],
      [
        "echo a | cat",
        "",
        {
          kind: "segments",
          segments: ["echo a | cat"],
          background: false,
        },
      ],
      [
        "echo a |& cat",
        "",
        {
          kind: "segments",
          segments: ["echo a |& cat"],
          background: false,
        },
      ],
      [
        "echo a & git status",
        "",
        {
          kind: "segments",
          segments: ["echo a ", " git status"],
          background: true,
        },
      ],
      [
        "echo a 2>&1; cat <&0 &>out",
        "",
        {
          kind: "segments",
          segments: ["echo a 2>&1", " cat <&0 &>out"],
          background: false,
        },
      ],
      [
        "printf 'a;b|c&d' \"x&&y\" \\; \\&; pwd",
        "",
        {
          kind: "segments",
          segments: ["printf 'a;b|c&d' \"x&&y\" \\; \\&", " pwd"],
          background: false,
        },
      ],
      [
        'echo "unfinished;still quoted',
        "",
        {
          kind: "segments",
          segments: ['echo "unfinished;still quoted'],
          background: false,
        },
      ],
      [
        "echo x;;",
        "",
        {
          kind: "segments",
          segments: ["echo x", "", ""],
          background: false,
        },
      ],
    ] as const) {
      assert.deepEqual(
        splitPolicyCommandSegments(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
  it("splits top-level pipelines while preserving command and process substitutions", () => {
    for (const row of [
      [
        "echo a |& cat",
        "",
        {
          kind: "segments",
          segments: ["echo a ", " cat"],
          background: false,
        },
      ],
      [
        "echo $(printf a | cat) | wc",
        "",
        {
          kind: "segments",
          segments: ["echo $(printf a | cat) ", " wc"],
          background: false,
        },
      ],
      [
        "cat <(printf a | cat) >(tee out) | wc",
        "",
        {
          kind: "segments",
          segments: ["cat <(printf a | cat) >(tee out) ", " wc"],
          background: false,
        },
      ],
      [
        "echo $(echo $(pwd); ls) && pwd",
        "",
        {
          kind: "segments",
          segments: ["echo $(echo $(pwd); ls) ", " pwd"],
          background: false,
        },
      ],
      [
        'echo "a|b" | cat',
        "",
        {
          kind: "segments",
          segments: ['echo "a|b" ', " cat"],
          background: false,
        },
      ],
      [
        "echo \\| literal | cat",
        "",
        {
          kind: "segments",
          segments: ["echo \\| literal ", " cat"],
          background: false,
        },
      ],
      [
        "echo λ | cat",
        "",
        {
          kind: "segments",
          segments: ["echo λ ", " cat"],
          background: false,
        },
      ],
    ] as const) {
      assert.deepEqual(
        splitPolicyTopLevelPipelineStages(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
  it("uses native quoting and keeps complete conditional branches and script blocks together", () => {
    for (const row of [
      [
        "echo ' & git status & echo '",
        "cmd",
        {
          kind: "segments",
          segments: ["echo ' ", " git status ", " echo '"],
          background: true,
        },
      ],
      [
        'echo "a^&b" & git status',
        "cmd.exe",
        {
          kind: "segments",
          segments: ['echo "a^&b" ', " git status"],
          background: true,
        },
      ],
      [
        "git pu^sh & echo ^&",
        "cmd",
        {
          kind: "segments",
          segments: ["git push ", " echo ^&"],
          background: true,
        },
      ],
      [
        "if exist x (echo a & echo b) else (echo c) & pwd",
        "cmd",
        {
          kind: "segments",
          segments: ["if exist x (echo a & echo b) else (echo c) ", " pwd"],
          background: true,
        },
      ],
      [
        "if exist x (echo a",
        "cmd",
        {
          kind: "unresolved",
          reason: "native-conditional",
        },
      ],
      [
        "echo `| literal | cat",
        "pwsh",
        {
          kind: "segments",
          segments: ["echo `| literal ", " cat"],
          background: false,
        },
      ],
      [
        "Write-Output {echo a; echo b} | % {echo c}",
        "pwsh",
        {
          kind: "segments",
          segments: ["Write-Output {echo a; echo b} ", " % {echo c}"],
          background: false,
        },
      ],
      [
        "if ($x)\n{echo a; echo b}\nelse\n{echo c}\npwd",
        "pwsh",
        {
          kind: "segments",
          segments: ["if ($x)\n{echo a; echo b}\nelse\n{echo c}", "pwd"],
          background: false,
        },
      ],
      [
        "if ($x) {echo a} elseif ($y) {echo b} else {echo c}; pwd",
        "powershell.exe",
        {
          kind: "segments",
          segments: [
            "if ($x) {echo a} elseif ($y) {echo b} else {echo c}",
            " pwd",
          ],
          background: false,
        },
      ],
      [
        "% {echo a",
        "pwsh",
        {
          kind: "unresolved",
          reason: "script-block",
        },
      ],
      [
        "if ($x",
        "pwsh",
        {
          kind: "unresolved",
          reason: "native-conditional",
        },
      ],
    ] as const) {
      assert.deepEqual(
        splitPolicyTopLevelPipelineStages(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
  it("collects executable blocks and output blocks consumed downstream without scanning inert output", () => {
    for (const row of [
      [
        "echo plain",
        "pwsh",
        {
          kind: "absent",
        },
      ],
      [
        "% {echo a; echo b}",
        "pwsh",
        {
          kind: "commands",
          commands: ["echo a; echo b"],
        },
      ],
      [
        "Write-Output {git status}",
        "pwsh",
        {
          kind: "absent",
        },
      ],
      [
        "Write-Output {git status} | % {& $_}",
        "pwsh",
        {
          kind: "commands",
          commands: ["git status"],
        },
      ],
      [
        "Write-Output {git status} | cat | Write-Output {echo last}",
        "pwsh",
        {
          kind: "commands",
          commands: ["git status"],
        },
      ],
      [
        "Get-Item . | % {git status}",
        "pwsh",
        {
          kind: "absent",
        },
      ],
      [
        "Write-Output {echo a} ; echo done",
        "pwsh",
        {
          kind: "commands",
          commands: ["echo a"],
        },
      ],
      [
        "Write-Output (& {git status})",
        "pwsh",
        {
          kind: "absent",
        },
      ],
      [
        'echo "{literal}"',
        "pwsh",
        {
          kind: "absent",
        },
      ],
      [
        "% {echo a",
        "pwsh",
        {
          kind: "unresolved",
        },
      ],
      [
        "% {echo a}",
        "cmd",
        {
          kind: "absent",
        },
      ],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeScriptBlockCommands(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
});

const directoryContextCases = [
  [
    "cd child",
    false,
    false,
    "",
    {
      directory: "@ROOT@/child",
      unknown: false,
    },
  ],
  [
    "cd -L -P -- child",
    false,
    false,
    "",
    {
      directory: "@ROOT@/child",
      unknown: false,
    },
  ],
  [
    "cd",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd -",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd ~",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    'cd "$HOME"',
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd `pwd`",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd missing",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd plain-file",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd child/..",
    false,
    false,
    "",
    {
      directory: "@ROOT@/child/..",
      unknown: false,
    },
  ],
  [
    "cd child extra",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "pushd child",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "popd",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "echo cd",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: false,
    },
  ],
  [
    "FOO=x cd child",
    false,
    false,
    "",
    {
      directory: "@ROOT@/child",
      unknown: false,
    },
  ],
  [
    "CDPATH=x cd child",
    false,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "CDPATH= cd child",
    false,
    false,
    "",
    {
      directory: "@ROOT@/child",
      unknown: false,
    },
  ],
  [
    "cd child",
    false,
    false,
    "other",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd child",
    true,
    false,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
  [
    "cd /",
    true,
    false,
    "other",
    {
      directory: "/",
      unknown: false,
    },
  ],
  [
    "cd /",
    false,
    true,
    "",
    {
      directory: "@ROOT@",
      unknown: true,
    },
  ],
] as const;

describe("tracked Git segment context", () => {
  it("tracks literal directories and preserves uncertainty for dynamic, backgrounded or missing destinations", (t) => {
    const root = mkdtempSync(join(tmpdir(), "goat-git-segment with spaces-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, "child"));
    writeFileSync(join(root, "plain-file"), "data");
    for (const row of directoryContextCases) {
      const context = {
        directory: root,
        unknown: row[1],
        background: row[2],
        cdPath: row[3],
      };
      const command = row[0].replaceAll("@ROOT@", root);
      const expected = {
        ...context,
        ...row[4],
        directory: row[4].directory.replaceAll("@ROOT@", root),
      };
      assert.deepEqual(
        trackPolicyGitShellDirectory(command, context),
        expected,
        JSON.stringify(row),
      );
    }
  });
  it("distinguishes persistent configuration sources from command-scoped and unexported assignments", () => {
    for (const row of [
      ["echo safe", false, false],
      ["HOME=x", false, true],
      ["GIT_CONFIG_GLOBAL=x", false, true],
      ["FOO=x HOME=x", false, true],
      ["HOME=x git status", false, false],
      ["export HOME", false, true],
      ["export GIT_CONFIG_GLOBAL=x", false, true],
      ["export +HOME -HOME", false, false],
      ["export HOME+=x", false, false],
      ["read HOME", false, true],
      ["mapfile GIT_CONFIG_KEY_0", false, true],
      ["readarray GIT_CONFIG_VALUE_0", false, true],
      ["printf -v HOME x", false, true],
      ["printf -vHOME x", false, true],
      ["printf HOME x", false, false],
      ["for HOME in a", false, true],
      ["for GIT_CONFIG_GLOBAL in a", false, false],
      ["declare HOME=x", false, true],
      ["declare GIT_CONFIG_GLOBAL=x", false, false],
      ["declare -x GIT_CONFIG_GLOBAL=x", false, true],
      ["local -rx GIT_CONFIG_GLOBAL", false, true],
      ["typeset GIT_CONFIG_GLOBAL+=x", false, false],
      ["readonly XDG_CONFIG_HOME=x", false, true],
      ["( { HOME=x", false, true],
      ["{HOME=x", false, false],
      ["git config --global x y", false, false],
      ["echo HOME", true, true],
    ] as const) {
      assert.equal(
        trackPolicyGitConfigEnvironment(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
});
