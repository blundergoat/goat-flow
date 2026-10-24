/** Native input primitives preserve provider command bytes before complete policy integration. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  readPolicyPayload,
  parsePolicyPayload,
  detectPolicyOutputMode,
  extractPolicyToolName,
  extractPolicyCommandText,
  isPolicyShellTool,
  isPolicySecretFileTool,
  policyCommandSizeRefusal,
  policySegmentCountRefusal,
} from "../../workflow/hooks/policy-input.mjs";
import {
  isInertHeredocConsumer,
  goatFlowCliConsumesHeredocData,
  heredocCommandListIsInert,
  maskSafeQuotedHeredocBodies,
  largeQualitySaveHeredocIsBoundedData,
} from "../../workflow/hooks/policy-heredoc.mjs";
import {
  firstPolicyWordBase,
  normalizePolicyGitExecutableWord,
  findMatchingPolicyShellParen,
  dropFirstPolicyShellWord,
  splitPolicyShellWords,
  normalizeLeadingPolicyWord,
  stripPolicyXargsPayload,
  joinPolicyShellWords,
  stripPolicyWatchPayload,
  stripPolicyParallelPayload,
  stripPolicyAssignmentPrefix,
  splitIfs,
  normalizePolicyEnvPrefix,
} from "../../workflow/hooks/policy-words.mjs";
import {
  gitConfigKeyRunsCommand,
  gitConfigKeyMayHostCommand,
  gitConfigCommandPayload,
  isGitConfigSourceVariable,
  isGitConfigSourceAmbientlyExported,
  isGitCommandEnvironmentVariable,
  isGitConfigEnvironmentUnresolved,
} from "../../workflow/hooks/policy-git.mjs";

describe("policy assignment and separator primitives", () => {
  it("reveals env children after known flags, directories and assignments while retaining uncertainty", () => {
    for (const [input, expected] of [
      ["-i NAME='a b' git status", "git status"],
      ["--unset NAME -uOTHER --chdir 'a b' -- git status", "git status"],
      ["--chdir=repo -C 'other repo' -0v git status", "git status"],
      ["--ignore-environment --null --debug NAME+=x git status", "git status"],
      ["--help", "--help"],
      ["", ""],
    ])
      assert.deepEqual(
        normalizePolicyEnvPrefix(input ?? ""),
        { kind: "command", command: expected },
        input,
      );
    for (const input of ["--unknown argument git push", "-u", "--chdir", "-S"])
      assert.deepEqual(
        normalizePolicyEnvPrefix(input),
        { kind: "unresolved" },
        input,
      );
  });

  it("removes one env split-string quote layer without hiding a quoted Git executable", () => {
    for (const [input, expected] of [
      ["-S 'git push'", "git push"],
      ["-S '\"git\" push'", '\"git\" push'],
      ["--split-string=\"'git' push\"", "'git' push"],
      ["-s '\"git\" status'", '\"git\" status'],
    ]) {
      const result = normalizePolicyEnvPrefix(input ?? "");
      assert.deepEqual(result, { kind: "command", command: expected }, input);
      if (result.kind === "command")
        assert.equal(
          firstPolicyWordBase(normalizeLeadingPolicyWord(result.command)),
          "git",
          input,
        );
    }
  });
  it("removes one complete assignment while retaining raw command quoting", () => {
    for (const [input, expected] of [
      ["NAME=value git status", "git status"],
      ["NAME+='a b'  \"git\" push", '\"git\" push'],
      ["NAME=\\ value\tgit status", "git status"],
      ["NAME=", ""],
      ["NAME='unterminated git push", ""],
    ])
      assert.equal(stripPolicyAssignmentPrefix(input ?? ""), expected, input);
    for (const input of [
      "",
      " NAME=x git push",
      "1NAME=x git push",
      "git status",
    ])
      assert.equal(stripPolicyAssignmentPrefix(input), null, input);
  });

  it("preserves literal fields and Bash read trailing-delimiter and first-line semantics", () => {
    for (const [input, separators, expected] of [
      ["", ";&|", []],
      [";", ";&|", [""]],
      [";;", ";&|", ["", ""]],
      ["a;;", ";&|", ["a", ""]],
      ["a;&b|c", ";&|", ["a", "", "b", "c"]],
      ["a;b\nc;d", ";&|", ["a", "b"]],
      ["\\path//λ/", "/", ["\\path", "", "λ"]],
      ['a,"b,c",', ",", ["a", '\"b', 'c\"']],
      ["  a | b  ", "|", ["  a ", " b  "]],
    ] as const)
      assert.deepEqual(splitIfs(input, separators), expected, input);
  });
});

describe("policy input primitives", () => {
  it("rejects damaged request bytes while preserving explicit checks and terminal LF semantics", () => {
    assert.equal(
      readPolicyPayload("", Buffer.from("echo safe\n\n")),
      "echo safe",
    );
    assert.equal(
      readPolicyPayload("echo explicit", Buffer.from([0xff])),
      "echo explicit",
    );
    assert.equal(
      readPolicyPayload("", Buffer.from("\uFEFFecho safe\r\n")),
      "\uFEFFecho safe\r",
    );
    assert.throws(
      () => readPolicyPayload("", Buffer.from([0xff])),
      /encoded data/u,
    );
    assert.throws(
      () => readPolicyPayload("", Buffer.from([0xf0, 0x9f])),
      /encoded data/u,
    );
  });

  for (const [name, payload] of [
    [
      "Claude",
      {
        tool_name: "Bash",
        tool_input: { command: "echo safe", file_path: ".env" },
      },
    ],
    [
      "Copilot object",
      {
        toolName: "bash",
        toolArgs: { command: "echo safe", file_path: ".env" },
      },
    ],
    [
      "Copilot encoded",
      {
        toolName: "bash",
        toolArgs: JSON.stringify({ command: "echo safe", file_path: ".env" }),
      },
    ],
    [
      "snake-case encoded",
      {
        tool_name: "Bash",
        tool_args: JSON.stringify({
          commandLine: "echo safe",
          SearchPath: ".env",
        }),
      },
    ],
    [
      "Antigravity",
      {
        toolCall: {
          name: "run_command",
          args: { CommandLine: "echo safe", AbsolutePath: ".env" },
        },
      },
    ],
  ] as const) {
    it(`extracts ${name} command and file targets without coercing fields`, () => {
      const parsed = parsePolicyPayload(JSON.stringify(payload));
      assert.match(extractPolicyToolName(parsed), /^(Bash|bash|run_command)$/u);
      assert.equal(extractPolicyCommandText(parsed), "echo safe .env");
      assert.equal(
        extractPolicyCommandText(parsed, "literal override"),
        "literal override",
      );
    });
  }

  it("decodes Unicode escapes in field names, values and encoded tool arguments", () => {
    const parsed = parsePolicyPayload(
      String.raw`{"tool_\u006eame":"B\u0061sh","toolArgs":"{\"command\":\"echo \\u03bb\"}"}`,
    );
    assert.equal(extractPolicyToolName(parsed), "Bash");
    assert.equal(extractPolicyCommandText(parsed), "echo λ");
  });

  it("refuses malformed outer JSON without trusting malformed encoded arguments", () => {
    for (const payload of ["{", "null", "[]", '"text"', "{} trailing"]) {
      assert.throws(() => parsePolicyPayload(payload));
    }
    assert.equal(extractPolicyCommandText({ toolArgs: "{broken" }), "");
    assert.equal(extractPolicyCommandText({ tool_args: "[]" }), "");
    assert.equal(
      extractPolicyCommandText({
        tool_input: { command: "echo safe" },
        toolArgs: "{broken",
      }),
      "echo safe",
    );
  });

  it("preserves field precedence, path de-duplication and empty-input meaning", () => {
    assert.equal(extractPolicyToolName({}), "");
    assert.equal(
      extractPolicyToolName({ toolName: 12, tool_name: "Bash" }),
      "Bash",
    );
    assert.equal(
      extractPolicyCommandText({ command: false, input: ["git push"] }),
      "",
    );
    assert.equal(
      extractPolicyCommandText({
        tool_input: { command: "cat .env", path: ".env" },
        command: "echo other",
        toolArgs: { command: "echo nested" },
      }),
      "cat .env",
    );
    assert.equal(
      extractPolicyCommandText({ tool_input: { file_path: ".env" } }),
      ".env",
    );
  });

  it("retains response-channel precedence for malformed provider requests", () => {
    assert.equal(detectPolicyOutputMode('{"toolName":'), "copilot-json");
    assert.equal(detectPolicyOutputMode('{"toolCall":'), "antigravity-json");
    assert.equal(
      detectPolicyOutputMode('{"toolName":"","tool_name":"Bash"}'),
      "stderr-exit",
    );
    assert.equal(detectPolicyOutputMode("echo safe"), "stderr-exit");
  });
});

describe("policy word and parenthesis primitives", () => {
  it("recognizes C-locale whitespace without widening raw basename normalization", () => {
    for (const [command, expected] of [
      [" \t/usr/bin/git status", "git"],
      ["\r\ncat file", "cat"],
      ["", ""],
      ["   ", ""],
      ["λcat arg", "λcat"],
      ["cat\u00a0file", "cat\u00a0file"],
      ['"git" status', '"git"'],
    ])
      assert.equal(firstPolicyWordBase(command), expected);
  });

  it("normalizes Windows Git names while preserving assignment values and other programs", () => {
    for (const [word, expected] of [
      ["GIT.EXE", "git"],
      ["C:\\Tools\\GIT-PUSH.EXE", "C:/Tools/git-push"],
      ["/usr/bin/GIT.exe", "/usr/bin/git"],
      ["git-.exe", "git-"],
      ["git-K.EXE", "git-K"],
      ["git-\n.EXE", "git-\n"],
      ["PATH=C:\\GIT.EXE", "PATH=C:\\GIT.EXE"],
      ["C:\\Tools\\NODE.EXE", "C:\\Tools\\NODE.EXE"],
      ["gİt.exe", "gİt.exe"],
      ["git", "git"],
      ["", ""],
    ])
      assert.equal(normalizePolicyGitExecutableWord(word), expected);
  });

  for (const fixture of [
    { name: "empty body", input: "$()", prefix: "$(" },
    {
      name: "simple command",
      input: "$(echo safe) tail",
      prefix: "$(echo safe",
    },
    {
      name: "nested parentheses",
      input: "$(echo (safe)) tail",
      prefix: "$(echo (safe)",
    },
    {
      name: "quoted close",
      input: "$(printf ')') tail",
      prefix: "$(printf ')'",
    },
    {
      name: "double-quoted close",
      input: '$(printf ")") tail',
      prefix: '$(printf ")"',
    },
    { name: "escaped close", input: "$(echo \\)) tail", prefix: "$(echo \\)" },
    {
      name: "Unicode byte offsets",
      input: "λ$(printf '🦌') tail",
      prefix: "λ$(printf '🦌'",
    },
    { name: "unmatched opener", input: "$(echo safe", prefix: null },
    { name: "unclosed quote", input: "$(printf 'unterminated)", prefix: null },
  ]) {
    it(`finds the matching shell close: ${fixture.name}`, () => {
      const bytes = Buffer.from(fixture.input);
      assert.equal(
        findMatchingPolicyShellParen(bytes, bytes.indexOf(0x28)),
        fixture.prefix === null ? null : Buffer.byteLength(fixture.prefix),
      );
    });
  }
});

describe("policy quoted word reading", () => {
  it("decodes the UTF-8 byte escapes emitted by argv quoting", () => {
    const words = ["é", "🦌", "a\tb", "it's literal"];
    assert.deepEqual(
      splitPolicyShellWords(joinPolicyShellWords(words, 0, "argv")),
      words,
    );
  });

  it("normalizes executable quotes without resolving unquoted IFS or changing raw arguments", () => {
    for (const [input, expected] of [
      ["  'g'i't'  status", "git status"],
      ['"g it" status', "g__goat_word_space__it status"],
      ["g\\ it status", "g__goat_word_space__it status"],
      ['"C:\\Tools\\Git.exe" status', "C:\\Tools\\Git.exe status"],
      ["r${IFS}m -rf /", null],
      ["$IFS cat", null],
      ["$IFSX arg", "$IFSX arg"],
      ["X=$IFS cmd", "X=$IFS cmd"],
      ["'$IFS' arg", "$IFS arg"],
      ['"$IFS" arg', "$IFS arg"],
      ["'' arg", " arg"],
      ["one   ", "one"],
      ["word\\", "word\\"],
      ["", ""],
      ["a\\\nb", "a__goat_word_space__b"],
      ["\u00a0git status", "\u00a0git status"],
    ] as const)
      assert.equal(normalizeLeadingPolicyWord(input), expected);
  });

  it("skips a complete quoted option value while retaining the next raw command", () => {
    for (const [input, expected] of [
      ['  "two words"  git status', "git status"],
      ["''\tcat file", "cat file"],
      ["a\\ b node script", "node script"],
      ["'unclosed value", ""],
      ["one", ""],
      ["", ""],
      ["one\u00a0word next", "next"],
    ])
      assert.equal(dropFirstPolicyShellWord(input), expected);
  });

  it("retains empty operands, quote concatenation, literal expansion text and Windows paths", () => {
    for (const [input, expected] of [
      ["git \"\" '' status", ["git", "", "", "status"]],
      ["a\"b c\"'d' tail", ["ab cd", "tail"]],
      ['node "C:\\new\\folder"', ["node", "C:\\new\\folder"]],
      ["echo \"a\\$b\" '$IFS' $(id)", ["echo", "a$b", "$IFS", "$(id)"]],
      ["echo\tλ\u00a0data\nlast", ["echo", "λ\u00a0data", "last"]],
      ["echo \\", ["echo"]],
      ["word\\", ["word\\"]],
      ["\\", []],
      ["   ", []],
    ] as const)
      assert.deepEqual(splitPolicyShellWords(input), expected);
  });
});

describe("policy wrapper word reconstruction", () => {
  it("preserves text and WSL shell payloads without promoting them to argv quoting", () => {
    const words = [
      "wrapper",
      "git",
      "",
      "a b",
      'a"b c',
      "$HOME",
      "λ\u00a0data",
    ];
    assert.equal(
      joinPolicyShellWords(words, 1),
      'git  a b a"b c $HOME λ\u00a0data',
    );
    assert.equal(
      joinPolicyShellWords(words, 1, "wsl-shell"),
      'git  "a b" "a\\"b c" $HOME λ\u00a0data',
    );
    assert.equal(joinPolicyShellWords(words, words.length, "argv"), "");
  });

  it("preserves empty and shell-active argv operands using C-locale byte escapes", () => {
    for (const [word, expected] of [
      ["", "''"],
      ["a b", "a\\ b"],
      ["a;b", "a\\;b"],
      ["a'b", "a\\'b"],
      ["a\\b", "a\\\\b"],
      ["#name", "\\#name"],
      ["a#b", "a#b"],
      ["~", "\\~"],
      ["a=~b", "a=\\~b"],
      ["a\nb", "$'a\\nb'"],
      ["λ", "$'\\316\\273'"],
      ["\t\r\u0001\u0007\v\f\u007f", "$'\\t\\r\\001\\a\\v\\f\\177'"],
    ])
      assert.equal(
        joinPolicyShellWords(["wrapper", word], 1, "argv"),
        expected,
        word,
      );
  });
});

describe("policy xargs payloads", () => {
  it("retains raw payload quoting after separated, attached and optional xargs options", () => {
    for (const prefix of [
      "xargs -a 'two files'",
      "xargs --process-slot-var VAR",
      "xargs --process-slot-var=VAR",
      "xargs -aFILE",
      "xargs -0 -r",
      "xargs -e",
      "xargs -i",
      "xargs -l",
      "xargs --eof",
      "xargs --replace",
      "xargs --max-lines",
      "'/usr/bin/xargs' --",
      "'/path with spaces/xargs' --",
      "xargs '-Iline\nnext'",
    ])
      assert.deepEqual(
        stripPolicyXargsPayload(prefix + " git 'push' origin"),
        { kind: "command", command: "git 'push' origin" },
        prefix,
      );
  });

  it("distinguishes uncertain xargs options from commands that have no payload", () => {
    for (const command of [
      "xargs -a",
      "xargs --process-slot-var",
      "xargs --unknown git push",
      "xargs -z git push",
    ])
      assert.deepEqual(
        stripPolicyXargsPayload(command),
        { kind: "unresolved" },
        command,
      );
    for (const command of [
      "",
      "xargs",
      "xargs -0",
      "xargs --",
      "xargs --help git push",
      "xargs --version",
      "other -a git push",
    ])
      assert.deepEqual(
        stripPolicyXargsPayload(command),
        { kind: "absent" },
        command,
      );
  });
});

describe("policy repeated command payloads", () => {
  it("distinguishes watch shell text, exec operands, missing payloads and uncertain flags", () => {
    for (const [input, expected] of [
      ['watch -n 1 "git push"', { kind: "command", command: "git push" }],
      ["watch -x git 'a b'", { kind: "command", command: "git a\\ b" }],
      ["watch -s --exec git 'a b'", { kind: "command", command: "git a b" }],
      [
        "'/path with spaces/watch' --exec -- git ''",
        { kind: "command", command: "git ''" },
      ],
      ["watch -n", { kind: "unresolved" }],
      ["watch --unknown git push", { kind: "unresolved" }],
      ["watch -n 1", { kind: "absent" }],
      ["watch --", { kind: "absent" }],
      ["watch -v git push", { kind: "absent" }],
      ["other -x git push", { kind: "absent" }],
    ] as const)
      assert.deepEqual(stripPolicyWatchPayload(input), expected, input);
  });

  it("extracts parallel shell text after real option values and retains uncertainty", () => {
    for (const [input, expected] of [
      [
        'parallel -j 2 --joblog "two files" "git push" ::: main',
        { kind: "command", command: "git push ::: main" },
      ],
      [
        "parallel --jobs=2 --bar -- git ''",
        { kind: "command", command: "git " },
      ],
      [
        "'/path with spaces/parallel' -Sserver git status",
        { kind: "command", command: "git status" },
      ],
      ["parallel --jobs", { kind: "unresolved" }],
      ["parallel --unknown git push", { kind: "unresolved" }],
      ["parallel -j 2", { kind: "absent" }],
      ["parallel --", { kind: "absent" }],
      ["parallel --help git push", { kind: "absent" }],
      ["other git push", { kind: "absent" }],
    ] as const)
      assert.deepEqual(stripPolicyParallelPayload(input), expected, input);
  });
});

describe("policy Git configuration payloads", () => {
  it("recognizes actual command-bearing key families without widening ordinary Git data", () => {
    for (const key of [
      "CORE.SSHCOMMAND",
      "diff.driver.textconv",
      "filter.lfs.process",
      "pager.log",
      "sendemail.team.tocmd",
      "sendemail.tocmd",
      "remote.origin.uploadpack",
      "gpg.ssh.defaultKeyCommand",
      "browser..cmd",
    ])
      assert.equal(gitConfigKeyRunsCommand(key), true, key);
    for (const key of [
      "",
      "core.autocrlf",
      "remote.origin.url",
      "credential.helper",
      "submodule.app.update",
      "remote.origin.url.extra",
      "core.sshcommand\u00a0",
      "core.as\u212Apass",
    ])
      assert.equal(gitConfigKeyRunsCommand(key), false, key);
  });

  it("retains environment-backed helper, transport and submodule uncertainty", () => {
    for (const key of [
      "credential.helper",
      "credential.https://example.com.helper",
      "remote.origin.url",
      "remote.origin.pushurl",
      "submodule.app.url",
      "submodule.app.update",
      "CORE.EDITOR",
    ])
      assert.equal(gitConfigKeyMayHostCommand(key), true, key);
    for (const key of [
      "core.autocrlf",
      "remote.origin.fetch",
      "submodule.app.path",
      "credential.username",
      "",
    ])
      assert.equal(gitConfigKeyMayHostCommand(key), false, key);
  });

  it("preserves Git command transformations and distinguishes empty payloads from inert values", () => {
    for (const [key, value, expected] of [
      ["remote.origin.url", "ext::ssh host", "ext::ssh host"],
      ["remote.origin.url", "https://example.com", null],
      ["submodule.app.update", "!echo safe", "echo safe"],
      ["submodule.app.update", "!", ""],
      ["submodule.app.update", "checkout", null],
      ["credential.helper", "", null],
      ["credential.helper", "!echo safe", "echo safe"],
      ["credential.helper", "/usr/bin/helper", "/usr/bin/helper"],
      [
        "credential.helper",
        "cache --timeout=60",
        "git credential-cache --timeout=60",
      ],
      ["CORE.EDITOR", "", ""],
      ["core.editor", "editor --wait", "editor --wait"],
      ["core.autocrlf", "!echo data", null],
    ] as const)
      assert.equal(
        gitConfigCommandPayload(key, value),
        expected,
        key + "=" + value,
      );
  });
});

describe("policy Git environment ownership", () => {
  it("recognizes configuration source names without broadening prefixes or case", () => {
    for (const name of [
      "HOME",
      "XDG_CONFIG_HOME",
      "GIT_DIR",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_COUNT",
      "GIT_CONFIG_KEY_",
      "GIT_CONFIG_KEY_NAME",
      "GIT_CONFIG_VALUE_3",
    ])
      assert.equal(isGitConfigSourceVariable(name), true, name);
    for (const name of [
      "",
      "home",
      "GIT_CONFIG_KEY",
      "GIT_CONFIG_VALUES_3",
      "GIT_AUTHOR_NAME",
    ])
      assert.equal(isGitConfigSourceVariable(name), false, name);
  });

  it("limits ambient export ownership to the two existing config source names", () => {
    for (const name of ["HOME", "XDG_CONFIG_HOME"])
      assert.equal(isGitConfigSourceAmbientlyExported(name), true, name);
    for (const name of [
      "GIT_DIR",
      "GIT_CONFIG_GLOBAL",
      "GIT_CONFIG_COUNT",
      "home",
      "",
    ])
      assert.equal(isGitConfigSourceAmbientlyExported(name), false, name);
  });

  it("recognizes command-valued Git environment variables while retaining ordinary data", () => {
    for (const name of [
      "GIT_EXTERNAL_DIFF",
      "GIT_SSH",
      "GIT_SSH_COMMAND",
      "GIT_PAGER",
      "PAGER",
      "GIT_EDITOR",
      "GIT_SEQUENCE_EDITOR",
      "EDITOR",
      "VISUAL",
      "GIT_PROXY_COMMAND",
      "GIT_ASKPASS",
      "SSH_ASKPASS",
    ])
      assert.equal(isGitCommandEnvironmentVariable(name), true, name);
    for (const name of [
      "",
      "GIT_CONFIG_GLOBAL",
      "GIT_AUTHOR_NAME",
      "GIT_EDITOR_EXTRA",
      "Editor",
    ])
      assert.equal(isGitCommandEnvironmentVariable(name), false, name);
  });
});

describe("policy visible Git configuration sources", () => {
  it("checks only leading or exported source assignments and retains empty override controls", () => {
    for (const [raw, verb, expected] of [
      ["GIT_CONFIG_COUNT=1 git status", "git", true],
      ["GIT_CONFIG_COUNT=0 git status", "git", false],
      ["GIT_CONFIG_GLOBAL='' git status", "git", false],
      ["GIT_CONFIG_KEY_0='' git status", "git", true],
      ["HOME=/other git status", "git", true],
      ["git log 'HOME=/other'", "git", false],
      ["export GIT_CONFIG_GLOBAL=/other", "export", true],
      ["declare GIT_CONFIG_GLOBAL=/other", "declare", false],
      ["declare -x GIT_CONFIG_GLOBAL=/other", "declare", true],
      ["declare -- -x GIT_DIR=/other", "declare", true],
      ["declare NAME=-x GIT_DIR=/other", "declare", false],
      ["'C:\\Git\\git.exe' log 'GIT_DIR=/other'", "git", false],
    ] as const)
      assert.equal(isGitConfigEnvironmentUnresolved(raw, verb), expected, raw);
  });

  it("carries earlier source changes into Git-capable commands without infecting inert commands", () => {
    for (const verb of [
      "git",
      "git-upload-pack",
      "bash",
      "sh",
      "zsh",
      "dash",
      "find",
      "xargs",
      "parallel",
    ])
      assert.equal(
        isGitConfigEnvironmentUnresolved(verb + " status", verb, true),
        true,
        verb,
      );
    for (const verb of ["echo", "printf", "cat", ""])
      assert.equal(
        isGitConfigEnvironmentUnresolved(verb + " safe", verb, true),
        false,
        verb,
      );
  });
});

describe("policy tool ownership and stdin consumers", () => {
  it("routes supported provider command tools to command inspection", () => {
    for (const tool of [
      "Bash",
      "bash",
      "SHELL",
      "sh",
      "run_command",
      "Monitor",
      "MONITOR",
    ])
      assert.equal(isPolicyShellTool(tool), true, tool);
    for (const tool of [
      "",
      "Read",
      "powershell",
      "bash.exe",
      "bash ",
      "run-command",
    ])
      assert.equal(isPolicyShellTool(tool), false, tool);
  });

  it("routes supported provider content tools to secret-path inspection", () => {
    for (const tool of [
      "Read",
      "view",
      "view_file",
      "Write",
      "Edit",
      "MultiEdit",
      "write_to_file",
      "replace_file_content",
      "multi_replace_file_content",
      "Create",
      "grep",
      "RG",
      "str_replace_editor",
      "Grep_Search",
    ])
      assert.equal(isPolicySecretFileTool(tool), true, tool);
    for (const tool of [
      "",
      "Bash",
      "read_file",
      "view_file ",
      "delete_file",
      "glob",
      "apply_patch",
    ])
      assert.equal(isPolicySecretFileTool(tool), false, tool);
  });

  it("keeps shells, dispatchers, handoffs and unknown consumers inspectable", () => {
    for (const consumer of [
      "cat",
      "node",
      "python3",
      "jq",
      "psql",
      "printf",
      ":",
    ])
      assert.equal(isInertHeredocConsumer(consumer), true, consumer);
    for (const consumer of [
      "bash",
      "xargs",
      "parallel",
      "source",
      ".",
      "read",
      "mapfile",
      "ssh",
      "unknown",
      "CAT",
      "/bin/cat",
    ])
      assert.equal(isInertHeredocConsumer(consumer), false, consumer);
  });

  it("accepts exact Goat Flow data subcommands while retaining caller normalization boundaries", () => {
    for (const command of [
      "goat-flow quality save .",
      "/usr/local/bin/goat-flow review validate",
      "goat-flow\tredact",
      "goat-flow quality\nsave .",
      "goat-flow redact --help",
    ])
      assert.equal(goatFlowCliConsumesHeredocData(command), true, command);
    for (const command of [
      "",
      "goat-flow",
      "goat-flow quality save-more",
      "goat-flow review validate-all",
      "goat-flow redact-file",
      "goat-flow hooks enable",
      "other quality save .",
      "GOAT-FLOW redact",
      " goat-flow redact",
      "CI=1 goat-flow quality save .",
      "goat-flow redact; bash",
    ])
      assert.equal(goatFlowCliConsumesHeredocData(command), false, command);
  });
});

describe("policy heredoc body masking", () => {
  it("treats an opener as data only when every stage and substitution consumer is inert", () => {
    const stages = (count: number) =>
      Array.from({ length: count }, () => "cat").join(" | ");
    for (const opener of [
      "cat > out.json <<'EOF'",
      "python3 - <<'PY'",
      "goat-flow quality save . <<'JSON'",
      "timeout 5 sudo cat <<'X' && echo done",
      "cat > >(tee out.log) <<'X'",
      `${stages(64)} <<'X'`,
    ])
      assert.equal(heredocCommandListIsInert(opener), true, opener);
    for (const opener of [
      "cat <<'EOF' | bash",
      "xargs -I{} bash -c '{}' <<'X'",
      "source /dev/stdin <<'X'",
      "cat > >(bash) <<'X'",
      "read x <<'X'",
      "timeout --bogus cat <<'X'",
      `${stages(65)} <<'X'`,
      `cat ${"<(cat) ".repeat(33)}<<'X'`,
      "",
    ])
      assert.equal(heredocCommandListIsInert(opener), false, opener);
  });

  it("collapses inert quoted bodies and keeps shell-fed bodies and later commands visible", () => {
    const python = `python3 - <<'PY'\n${"print(1)\n".repeat(60)}PY`;
    for (const [input, expected] of [
      [
        "cat <<'EOF'\nrm -rf /\nEOF",
        "cat <<'EOF'\n__goat_quoted_heredoc_body__\nEOF",
      ],
      [
        "cat <<-'EOF'\n\trm -rf /\n\tEOF\nrm -rf ~",
        "cat <<-'EOF'\n__goat_quoted_heredoc_body__\n\tEOF\nrm -rf ~",
      ],
      [python, "python3 - <<'PY'\n__goat_quoted_heredoc_body__\nPY"],
      ["bash <<'EOF'\nrm -rf /\nEOF", "bash <<'EOF'\nrm -rf /\nEOF"],
      [
        "cat <<'EOF' \\\n| bash\nrm -rf /\nEOF",
        "cat <<'EOF' | bash\nrm -rf /\nEOF",
      ],
      ["cat <<EOF\nrm -rf /\nEOF", "cat <<EOF\nrm -rf /\nEOF"],
    ])
      assert.equal(maskSafeQuotedHeredocBodies(input), expected, input);
  });

  it("keeps later lines visible when opener-like text is not a real quoted heredoc", () => {
    // Each row was allowed by the shipped Bash hook: its masker hid the `rm` line Bash would run.
    for (const input of [
      "cat <<<'x'\nrm -rf /\nx",
      "echo \"<<'x'\"\nrm -rf /\nx",
      "echo '<<\"x\"'\nrm -rf /\nx",
      "true # <<'x'\nrm -rf /\nx",
      "cat <<'EO'\"F\"\ndata\nEOF\nrm -rf /\nEO",
      "cat <<EOF\ncat <<'y'\n$(rm -rf /)\ny\nEOF",
      'echo $(( 1 <<"2" ))\nrm -rf /\n2',
      'echo "$(echo "<<\'x\'")"\nrm -rf /\nx',
      "cat <<'EOF'\r\nbody\r\nEOF\r\nrm -rf /\r",
      "echo \"\ncat <<'x'\n\"; rm -rf /\nx",
      'echo "$(x)"#"\ncat <<\'y\'\n"; rm -rf /\ny',
    ])
      assert.equal(maskSafeQuotedHeredocBodies(input), input, input);
  });

  it("admits the larger report allowance only for a masked quality save from the installed or source CLI", () => {
    const report = (opener: string) =>
      maskSafeQuotedHeredocBodies(`${opener}\n{"findings":[]}\nJSON`);
    for (const opener of [
      "goat-flow quality save . <<'JSON'",
      "/usr/local/bin/goat-flow quality save --json <<'JSON'",
      "sudo goat-flow quality save . <<'JSON'",
      "node --import tsx src/cli/cli.ts quality save . <<'JSON'",
      "nodejs --import=tsx src/cli/cli.ts quality save . <<'JSON'",
    ])
      assert.equal(
        largeQualitySaveHeredocIsBoundedData(report(opener)),
        true,
        opener,
      );
    for (const opener of [
      "goat-flow quality save . <<'JSON' | bash",
      "goat-flow quality save . <<JSON",
      "goat-flow quality save-more <<'JSON'",
      "goat-flow review validate <<'JSON'",
      "cat > report.json <<'JSON'",
      "node src/cli/cli.ts quality save . <<'JSON'",
      "node --import tsx ./src/cli/cli.ts quality save . <<'JSON'",
      "timeout --bogus goat-flow quality save . <<'JSON'",
    ])
      assert.equal(
        largeQualitySaveHeredocIsBoundedData(report(opener)),
        false,
        opener,
      );
  });
});

describe("policy command inspection limits", () => {
  it("measures command ceilings in UTF-8 bytes and admits only classified bounded report data", () => {
    for (const [command, masked, boundedData] of [
      ["a".repeat(16384), "", false],
      ["λ".repeat(8192), "", false],
      ["a".repeat(262144), "short", true],
      ["a".repeat(20000), "a".repeat(16384), true],
    ] as const) {
      assert.equal(
        policyCommandSizeRefusal(command, masked, boundedData),
        null,
      );
    }
    for (const [command, masked, boundedData, expectedLimit] of [
      ["a".repeat(16385), "", false, 16384],
      ["λ".repeat(8193), "", false, 16384],
      ["a".repeat(262145), "short", true, 262144],
      ["a".repeat(20000), "a".repeat(16385), true, 16384],
    ] as const) {
      const refusal = policyCommandSizeRefusal(command, masked, boundedData);
      assert.ok(refusal?.includes(String(expectedLimit) + "-byte"));
      assert.match(
        refusal,
        /smaller independent calls|supported script route/u,
      );
    }
  });
  it("retains the 50-segment ceiling and names a safe recovery action", () => {
    assert.equal(policySegmentCountRefusal(50), null);
    assert.equal(policySegmentCountRefusal(0), null);
    assert.match(
      policySegmentCountRefusal(51) ?? "",
      /50-segment.*smaller independent calls/u,
    );
  });
});
