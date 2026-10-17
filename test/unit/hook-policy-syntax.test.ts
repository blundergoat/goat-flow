/**
 * Direct checks for the shell syntax primitives in policy-syntax.mts, run against the generated workflow/hooks copy that ships.
 * The tables cover redirections, cmd/PowerShell/WSL launches and conditionals, comments, subshells and the composed wrapper
 * normalizer, pairing each agent-typed input with the exact text or decision the hook must produce.
 *
 * A few rows start with U+00A0, a non-breaking space that looks like a space, to prove that only ASCII whitespace is a word break.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  stripLeadingPolicyShellRedirections,
  stripPolicyShellRedirections,
  findPolicyNativeCommandGroup,
  countPolicySubstitutionOpeners,
} from "../../workflow/hooks/policy-syntax.mjs";

describe("policy syntax primitives", () => {
  it("reveals leading redirect payloads while retaining no-match and incomplete forms", () => {
    for (const row of [
      ["", { kind: "absent" }],
      ["git status", { kind: "absent" }],
      [">", { kind: "absent" }],
      ["> file", { kind: "absent" }],
      ["> file git status", { kind: "command", command: "git status" }],
      [">file git 'a b'", { kind: "command", command: "git a b" }],
      [
        "2>>log <'two files' git status",
        { kind: "command", command: "git status" },
      ],
      ["{fd}>file git status", { kind: "command", command: "git status" }],
      ["<<< value git status", { kind: "command", command: "git status" }],
      ["<<- END git status", { kind: "command", command: "git status" }],
      ["&>>log git status", { kind: "command", command: "git status" }],
      ["3>&1 git status", { kind: "command", command: "git status" }],
      ["'>\n' git status", { kind: "command", command: "git status" }],
      ["'2>log' git ''", { kind: "command", command: "git " }],
      // The next row starts with U+00A0, which is not ASCII whitespace, so the first word is not a redirection.
      [" git status", { kind: "absent" }],
    ] as const) {
      assert.deepEqual(
        stripLeadingPolicyShellRedirections(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("strips request redirections without erasing quoted data or trusting unsupported syntax", () => {
    for (const row of [
      ["", ""],
      ["git status", "git status"],
      ["gh api repos >out", "gh api repos  "],
      ["2>err gh api repos", " gh api repos"],
      ["gh api repos > 'two files' --jq '.name'", "gh api repos  --jq '.name'"],
      ["gh api repos 2>&1", "gh api repos  "],
      ["gh api repos &>>log", "gh api repos  "],
      ["printf '>' >out", "printf '>'  "],
      ['printf "a>b"', 'printf "a>b"'],
      ["echo \\> literal", "echo \\> literal"],
      ["cat <input >output", "cat   "],
      ["gh api repos <<END", null],
      ["gh api repos <(cat)", null],
      ["gh api repos >(tee)", null],
      ["gh api repos >", null],
      ["echo 'unterminated", null],
      ["echo word\\", null],
      ["echo 'λ' >out", "echo 'λ'  "],
      ['"2">out gh api repos', '"2" gh api repos'],
    ] as const) {
      assert.deepEqual(
        stripPolicyShellRedirections(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("preserves native group bodies and tails under each host's quote and escape grammar", () => {
    for (const row of [
      ["()tail", "", { body: "", tail: "tail" }],
      ["{echo (safe)} tail", "pwsh", { body: "echo (safe)", tail: " tail" }],
      ["(λ '🦌') tail", "powershell", { body: "λ '🦌'", tail: " tail" }],
      ["(echo ^) safe) tail", "cmd", { body: "echo ^) safe", tail: " tail" }],
      ["(echo `) safe) tail", "pwsh", { body: "echo `) safe", tail: " tail" }],
      ["(echo C:\\) tail", "cmd.exe", { body: "echo C:\\", tail: " tail" }],
      ["('a)b') tail", "cmd", { body: "'a", tail: "b') tail" }],
      ["('a)b') tail", "pwsh", { body: "'a)b'", tail: " tail" }],
      ["command", "cmd", null],
      ["(echo safe", "pwsh", null],
      ["(echo ') tail", "pwsh", null],
      ["(echo ^)", "cmd", null],
      ["(echo `)", "pwsh", null],
      ['(echo "a)b") rest', "cmd", { body: 'echo "a)b"', tail: " rest" }],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeCommandGroup(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
  it("counts executable substitution openers while retaining quote and arithmetic boundaries", () => {
    for (const row of [
      ["", 0],
      ["$(echo safe)", 1],
      ["'$(echo data)' $(echo safe)", 1],
      ['"$(echo safe)"', 1],
      ["\\$(echo data)", 0],
      ["$((1 + 2))", 0],
      ["$(echo $(echo nested)) <(cat) >(tee)", 4],
      ["$(( $(echo nested) ))", 1],
      ["'<(data)'", 0],
      ['"<(data)"', 1],
      ["λ$(echo '🦌')", 1],
      ["$((", 0],
    ] as const) {
      assert.deepEqual(
        countPolicySubstitutionOpeners(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
});

import {
  stripUnquotedPolicyShellComments,
  findUnmatchedPolicyClosingParen,
  stripPolicySubshellParentheses,
  isUnredirectedUnpipedPolicyReadOnly,
} from "../../workflow/hooks/policy-syntax.mjs";

describe("policy comment and subshell context", () => {
  it("retains quoted and embedded hashes while removing only word-boundary comments", () => {
    for (const row of [
      ["", ""],
      ["# all comment", ""],
      ["echo safe # comment", "echo safe"],
      ["echo safe#word", "echo safe#word"],
      ["echo '# literal' # comment", "echo '# literal'"],
      ['echo "# literal" # comment', 'echo "# literal"'],
      ["echo \\# literal", "echo \\# literal"],
      ["echo word\\ # comment", "echo word\\"],
      ["echo safe\n# later", "echo safe"],
      ["echo 'unterminated # literal", "echo 'unterminated # literal"],
      ["echo safe\t\r\n", "echo safe"],
      ["λ#word", "λ#word"],
      ["λ # comment", "λ"],
      // The next row has U+00A0 before `#`, so the hash does not sit at an ASCII word boundary and is kept as text.
      ["echo #word", "echo #word"],
      ["echo safe\\", "echo safe\\"],
    ] as const) {
      assert.equal(
        stripUnquotedPolicyShellComments(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("reports unmatched unquoted closing parentheses with C-locale byte offsets", () => {
    for (const row of [
      ["", -1],
      ["()", -1],
      [")tail", 0],
      ["(safe))", 6],
      ["'(quoted)'", -1],
      ["echo ')'", -1],
      ["echo \\)", -1],
      ["λ)", 2],
      ["🦌)", 4],
      ['echo "unclosed )', -1],
      ["(λ)) tail", 4],
      ["echo \\\\)", 7],
    ] as const) {
      assert.equal(
        findUnmatchedPolicyClosingParen(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("exposes subshell segment commands without erasing quoted or substituted parentheses", () => {
    for (const row of [
      ["", ""],
      [" (( git status )) ", "git status"],
      ["(λ) >out", "λ  >out"],
      ["(echo '🦌')", "echo '🦌'"],
      ["$(echo safe)", "$(echo safe)"],
      ["echo ')'", "echo ')'"],
      ["echo \\)", "echo \\)"],
      ["left)right)", "left right"],
      [" (echo safe && (git status))", "echo safe && (git status)"],
      // The next row starts with U+00A0, which is not trimmed, so the `(` is not leading and nothing is unwrapped.
      [" (echo safe)", " (echo safe)"],
      ["(echo '(')", "echo '('"],
      ["(echo (nested))", "echo (nested)"],
    ] as const) {
      assert.equal(
        stripPolicySubshellParentheses(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("requires redirect and pipe context before bypassing write-policy checks for inspection", () => {
    for (const row of [
      ["cat file", { verb: "cat", hasRedirect: false, hasPipe: false }, true],
      [
        "cat file >out",
        { verb: "cat", hasRedirect: true, hasPipe: false },
        false,
      ],
      [
        "cat file | sh",
        { verb: "cat", hasRedirect: false, hasPipe: true },
        false,
      ],
      ["rg needle", { verb: "rg", hasRedirect: false, hasPipe: false }, true],
      [
        "sed -n p file",
        { verb: "sed", hasRedirect: false, hasPipe: false },
        true,
      ],
      [
        "sed -i file",
        { verb: "sed", hasRedirect: false, hasPipe: false },
        false,
      ],
      [
        "sed -ni file",
        { verb: "sed", hasRedirect: false, hasPipe: false },
        false,
      ],
      [
        "sed --in-place=.bak file",
        { verb: "sed", hasRedirect: false, hasPipe: false },
        false,
      ],
      [
        "printf safe",
        { verb: "printf", hasRedirect: false, hasPipe: false },
        true,
      ],
      ["rm file", { verb: "rm", hasRedirect: false, hasPipe: false }, false],
      ["cat file", { verb: "CAT", hasRedirect: false, hasPipe: false }, false],
      [
        "sed\t-i file",
        { verb: "sed", hasRedirect: false, hasPipe: false },
        false,
      ],
      [
        "sed -i file",
        // The command above separates `sed` and `-i` with U+00A0, so the ASCII-whitespace check does not see an in-place edit.
        { verb: "sed", hasRedirect: false, hasPipe: false },
        true,
      ],
      ["ls", { verb: "ls", hasRedirect: false, hasPipe: false }, true],
      [
        "test -e file",
        { verb: "test", hasRedirect: false, hasPipe: false },
        true,
      ],
    ] as const) {
      assert.equal(
        isUnredirectedUnpipedPolicyReadOnly(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
});

import {
  findPolicyNativeShellCommand,
  findPolicyNativeConditionalCommands,
} from "../../workflow/hooks/policy-syntax.mjs";

describe("policy native host and conditional parsing", () => {
  it("retains an empty ungrouped cmd else branch as a parsed action", () => {
    assert.deepEqual(
      findPolicyNativeConditionalCommands(
        "if exist file (echo safe) else",
        "cmd",
      ),
      { kind: "commands", commands: ["echo safe", ""] },
    );
  });
  it("reveals cmd inline commands while preserving attached switches and uncertain options", () => {
    for (const row of [
      ["cmd", { kind: "absent" }],
      ["cmd /c git status", { kind: "command", command: "git status" }],
      [
        'cmd //d //s //c "git status"',
        { kind: "command", command: "git status" },
      ],
      [
        "cmd /Cgit.exe push origin main",
        { kind: "command", command: "git.exe push origin main" },
      ],
      ["cmd //kdir a", { kind: "command", command: "dir a" }],
      [
        "cmd /q /v:on /t:1 /c echo safe",
        { kind: "command", command: "echo safe" },
      ],
      ["cmd /?", { kind: "absent" }],
      ["cmd /unknown git status", { kind: "unresolved" }],
      ["cmd plain words", { kind: "absent" }],
      ["CMD.EXE /C echo λ", { kind: "command", command: "echo λ" }],
      [
        "C:\\Windows\\System32\\cmd.exe /c git status",
        { kind: "command", command: "git status" },
      ],
      [" cmd /c git status", { kind: "absent" }],
      ["cmd /c", { kind: "absent" }],
      ["cmd /c ''", { kind: "absent" }],
      ["cmd /ccafé", { kind: "command", command: "café" }],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeShellCommand(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("distinguishes PowerShell command text, script paths, abbreviated options and hidden stdin", () => {
    for (const row of [
      [
        "powershell -NoP -NonI -NoL -ep Bypass -C 'git status'",
        { kind: "command", command: "git status" },
      ],
      [
        "pwsh --command 'git status'",
        { kind: "command", command: "git status" },
      ],
      [
        "powershell /co 'git status'",
        { kind: "command", command: "git status" },
      ],
      [
        "pwsh //command 'git status'",
        { kind: "command", command: "git status" },
      ],
      [
        "powershell -v 5 -c git status",
        { kind: "command", command: "git status" },
      ],
      ["pwsh -v git status", { kind: "absent" }],
      [
        "pwsh -workingdirectory repo -c git status",
        { kind: "command", command: "git status" },
      ],
      [
        "powershell -workingdirectory repo -c git status",
        { kind: "unresolved" },
      ],
      ["powershell git status", { kind: "command", command: "git status" }],
      ["pwsh script.ps1", { kind: "absent" }],
      ["pwsh -file -", { kind: "unresolved" }],
      ["powershell -file script.ps1", { kind: "absent" }],
      ["pwsh -command -", { kind: "unresolved" }],
      ["powershell -", { kind: "unresolved" }],
      ["pwsh -EncodedCommand hidden", { kind: "unresolved" }],
      ["powershell -executionpolicy", { kind: "absent" }],
      ["pwsh -help", { kind: "absent" }],
      [
        "pwsh -NoProfile -STA -NoExit -c 'echo safe'",
        { kind: "command", command: "echo safe" },
      ],
      ["pwsh -c ''", { kind: "absent" }],
      [
        "pwsh -inputformat text -outputformat text -windowstyle hidden -c 'git status'",
        { kind: "command", command: "git status" },
      ],
      ["pwsh -e hidden", { kind: "unresolved" }],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeShellCommand(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("retains WSL shell reparsing versus direct argv and refuses unknown administrative modes", () => {
    for (const row of [
      ["wsl git status", { kind: "command", command: "git status" }],
      [
        "wsl -d Ubuntu -u user --cd repo -- 'git status'",
        { kind: "command", command: '"git status"' },
      ],
      ["wsl -e git 'a b' '|'", { kind: "command", command: "git a\\ b \\|" }],
      [
        "wsl --exec git 'a b' '|'",
        { kind: "command", command: "git a\\ b \\|" },
      ],
      [
        "wsl --shell-type none git 'a b'",
        { kind: "command", command: "git a\\ b" },
      ],
      [
        "wsl --shell-type standard git 'a b'",
        { kind: "command", command: 'git "a b"' },
      ],
      [
        "wsl --shell-type login git 'a b'",
        { kind: "command", command: 'git "a b"' },
      ],
      [
        "wsl --shell-type none --shell-type standard git 'a b'",
        { kind: "command", command: "git a\\ b" },
      ],
      ["wsl --shell-type strange git status", { kind: "unresolved" }],
      ["wsl --shell-type", { kind: "unresolved" }],
      ["wsl --unregister target", { kind: "unresolved" }],
      ["wsl --status", { kind: "absent" }],
      ["wsl --system ~ git status", { kind: "command", command: "git status" }],
      [
        "wsl --distribution-id value --user value git status",
        { kind: "command", command: "git status" },
      ],
      ["wsl --cd", { kind: "absent" }],
      ["wsl --exec", { kind: "absent" }],
      ["wsl --exec ''", { kind: "command", command: "''" }],
      ["wsl -- 'echo a|b'", { kind: "command", command: '"echo a|b"' }],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeShellCommand(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("retains native conditional conditions, all branches and executable tails without guessing malformed groups", () => {
    for (const row of [
      ["echo safe", "pwsh", { kind: "absent" }],
      [
        "if ($ok) {git status} else {git diff} tail",
        "pwsh",
        {
          kind: "commands",
          commands: ["$ok", "git status", "git diff", " tail"],
        },
      ],
      [
        "IF($ok){echo safe}elseif($other){git status}",
        "powershell",
        {
          kind: "commands",
          commands: ["$ok", "echo safe", "if($other){git status}"],
        },
      ],
      ["if ($ok) {git status} else broken", "pwsh", { kind: "unresolved" }],
      ["if ($ok) {git status", "pwsh", { kind: "unresolved" }],
      ["if $ok {git status}", "pwsh", { kind: "unresolved" }],
      [
        "if (Test-Path 'a)b') {echo safe}",
        "powershell.exe",
        { kind: "commands", commands: ["Test-Path 'a)b'", "echo safe"] },
      ],
      [
        "if($ok){}else{} tail",
        "pwsh.exe",
        { kind: "commands", commands: ["$ok", "", "", " tail"] },
      ],
      [
        "if exist file git status",
        "cmd",
        { kind: "commands", commands: ["git status"] },
      ],
      [
        'if /i not exist "A B" (git status) else (git diff) tail',
        "cmd.exe",
        { kind: "commands", commands: ["git status", "git diff", " tail"] },
      ],
      [
        "if defined VALUE (echo λ)",
        "cmd",
        { kind: "commands", commands: ["echo λ"] },
      ],
      [
        "if errorlevel 1 (echo safe) else git status",
        "cmd",
        { kind: "commands", commands: ["echo safe", "git status"] },
      ],
      [
        "if cmdextversion 2 echo safe",
        "cmd",
        { kind: "commands", commands: ["echo safe"] },
      ],
      [
        "if a==b (echo safe)",
        "cmd",
        { kind: "commands", commands: ["echo safe"] },
      ],
      [
        "if a equ b (echo safe)",
        "cmd",
        { kind: "commands", commands: ["echo safe"] },
      ],
      [
        "if a neq b (echo ^) safe)",
        "cmd",
        { kind: "commands", commands: ["echo ^) safe"] },
      ],
      [
        "if a lss b echo safe",
        "cmd",
        { kind: "commands", commands: ["echo safe"] },
      ],
      ["if a==b (echo safe) else (broken", "cmd", { kind: "unresolved" }],
      ["if unsupported (echo safe)", "cmd", { kind: "unresolved" }],
      ["if ($ok) {echo safe}", "bash", { kind: "absent" }],
      ["iffoo", "pwsh", { kind: "absent" }],
      ["if", "pwsh", { kind: "unresolved" }],
      [
        "\tif ($ok) {echo '🦌'} trailing",
        "pwsh",
        { kind: "commands", commands: ["$ok", "echo '🦌'", "trailing"] },
      ],
      [
        "if exist 'a' if exist b git status",
        "cmd",
        { kind: "commands", commands: ["if exist b git status"] },
      ],
    ] as const) {
      assert.deepEqual(
        findPolicyNativeConditionalCommands(row[0], row[1]),
        row[2],
        JSON.stringify(row),
      );
    }
  });
});

import { normalizePolicyCommandCandidate } from "../../workflow/hooks/policy-syntax.mjs";

describe("policy composed command normalization", () => {
  it("retains the approved env quote correction through composed normalization", () => {
    for (const [input, expected] of [
      ["env -S '\"git\" push'", "git push"],
      ["env --split-string=\"'git' push\"", "git push"],
      ["env -s '\"git\" status'", "git status"],
    ] as const)
      assert.equal(normalizePolicyCommandCandidate(input), expected, input);
  });
  it("reveals shell control and lookup prefixes without discarding ordinary executable text", () => {
    for (const row of [
      ["", ""],
      ["  git status", "git status"],
      ["! git status", "git status"],
      ["(( git status", "git status"],
      ["{ git status", "git status"],
      ["case x in value) git status", "git status"],
      ["coproc worker { git status", "git status"],
      ["coproc git status", "git status"],
      ["then git status", "git status"],
      ["do git status", "git status"],
      ["else git status", "git status"],
      ["if git status", "git status"],
      ["elif git status", "git status"],
      ["while git status", "git status"],
      ["until git status", "git status"],
      ["in git status", "git status"],
      ["fn() { git status", "git status"],
      ["function fn () { git status", "git status"],
      ["command -p -- git status", "git status"],
      ["command --help", "--help"],
      ["builtin -- echo safe", "echo safe"],
      ["builtin --", ""],
      ["not-a-wrapper git status", "not-a-wrapper git status"],
      ["2>file git status", "git status"],
      ["'git' status", "git status"],
      ["C:\\Git\\git.exe status", "C:Gitgit.exe status"],
    ] as const) {
      assert.equal(
        normalizePolicyCommandCandidate(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("normalizes nested timing, priority, privilege and process wrappers through their real parsers", () => {
    for (const row of [
      ["time -p sudo -n git status", "git status"],
      ["nohup nice -n 5 git 'a b'", "git a\\ b"],
      ["nice --adjustment=4 git status", "git status"],
      ["nice -10 git status", "git status"],
      ["nice --help", "nice --help"],
      ["nice -n 2 --version", "nice -n 2 --version"],
      ["nice -n", null],
      ["nice --unknown git status", null],
      ["exec -a name timeout -s TERM 5 setsid -f git status", "git status"],
      [
        "stdbuf -oL ionice -c 2 taskset -c 0 chrt -f 1 git status",
        "git status",
      ],
      ["flock lock nice -n 5 git status", "git status"],
      ["flock -c 'git status && echo safe' lock", "git status && echo safe"],
      ["sudo --unknown git status", "--unknown git status"],
      ["time --unknown git status", "--unknown git status"],
      ["timeout --unknown 5 git status", null],
      ["exec -a", null],
      ["ionice -p 1 git status", "ionice -p 1 git status"],
      ["taskset -p 1 git status", "taskset -p 1 git status"],
      ["chrt -p 1 git status", "chrt -p 1 git status"],
      ["flock --unknown lock git status", null],
      ["watch -n 2 sudo git status", "git status"],
      ["parallel --jobs 2 sudo git status", "git status"],
      ["setsid --help", "setsid --help"],
      ["nice git 'λ'", "git $'\\316\\273'"],
    ] as const) {
      assert.equal(
        normalizePolicyCommandCandidate(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("reveals assignment and env commands while preserving recognized env paths and unresolved syntax", () => {
    for (const row of [
      ["KEY=value git status", "git status"],
      ["KEY+='a b' sudo git status", "git status"],
      ["KEY=value OTHER=value git status", "git status"],
      ["env -i KEY=value git status", "git status"],
      ["/usr/bin/env -u HOME git status", "git status"],
      ["/bin/env --chdir repo git status", "git status"],
      ["/opt/env git status", "/opt/env git status"],
      ["env --split-string='git status'", "git status"],
      ["env -S 'git status'", "git status"],
      ["env --unknown git status", null],
      ["env --help", "--help"],
      ["env", ""],
      ["'git'$IFS status", null],
      ["git$IFS status", null],
      ["git${IFS}status", null],
      ["env -- git status", "git status"],
      ["env -u HOME -- sudo git status", "git status"],
    ] as const) {
      assert.equal(
        normalizePolicyCommandCandidate(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
  it("retains xargs outer semantics while revealing nested child wrappers and quoted argv", () => {
    for (const row of [
      ["xargs git status", "xargs git status"],
      ["xargs -0 sudo git status", "xargs -0 git status"],
      ["xargs -n 1 timeout 5 git status", "xargs -n 1 git status"],
      ["xargs -- nice -n 2 git status", "xargs -- git status"],
      ["xargs --unknown git status", null],
      ["xargs", "xargs"],
      ["xargs echo 'a b'", "xargs echo 'a b'"],
      ["xargs echo λ", "xargs echo λ"],
      ["xargs echo 'λ λ'", "xargs echo 'λ λ'"],
      ["xargs xargs sudo git status", "xargs git status"],
      ["watch -x git 'a b'", "git a\\ b"],
      ["parallel -- git status", "git status"],
      ["watch --unknown git status", null],
      ["parallel --unknown git status", null],
    ] as const) {
      assert.equal(
        normalizePolicyCommandCandidate(row[0]),
        row[1],
        JSON.stringify(row),
      );
    }
  });
});
