/** Verify native shell primitives against retained cleanup, pipeline and script-input controls. */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  rmHasRecursive,
  rmIsSafelyScoped,
  isShellName,
  isShellCommand,
  isInterpreterCommand,
  isLocalDataPipeSource,
  scriptFileWordIsSafe,
  isScriptFileShellCommand,
  isDownloaderPipeSource,
  isInertDownloadPipeConsumer,
  isInlineInterpreterCommand,
  interpreterOptionAction,
  isScriptFileInterpreterCommand,
  inlineInterpreterProgram,
  inlineProgramVisibleCode,
  inlineProgramExecutesCommands,
  interpreterTreatsStdinAsData,
  stripSqlLiteralsInsideDoubleQuotes,
  checkCommandChainPolicy,
  checkPipelineShellConsumers,
  pipelineContainsShellEvalStage,
  checkXargsDestructivePayload,
  checkPipelineXargsDestructivePayloads,
} from "../../workflow/hooks/deny-dangerous/patterns-shell.mjs";
import { stripPolicyShellQuotesForPathScan } from "../../workflow/hooks/policy-words.mjs";

const rmHasRecursiveCases: ReadonlyArray<readonly [string, boolean]> = [
  ["rm -rf node_modules", true],
  ["/bin/rm -fR src/old", true],
  ["rm --recursive build", true],
  ["rm -r", true],
  ["rm -rF build", true],
  ["rm -f file", false],
  ["rmdir -r build", false],
  ["echo rm -rf /", false],
  ["rm '--recursive' build", false],
  ["rm -- --recursive", true],
];

const rmIsSafelyScopedCases: ReadonlyArray<readonly [string, boolean]> = [
  ["rm", false],
  ["rm -rf", true],
  ["rm -rf node_modules", true],
  ["rm -rf ./node_modules/", true],
  ['rm -rf "node_modules"', true],
  ["rm -rf src/old", true],
  ['rm -rf "src/old dir"', false],
  ["rm -rf /etc", false],
  ['rm -rf "/etc"', false],
  ["rm -rf ~/", false],
  ["rm -rf C:/Users/project", false],
  ["rm -rf /tmp/build-clean/a_1", true],
  ["rm -rf /tmp/build-clean/../home", false],
  ["rm -rf /tmp/build-clean/.cache", true],
  ["rm -rf cache/$TARGET", false],
  ["rm -rf `pwd`/build", false],
  ["rm -rf {build,dist}", false],
  ["rm -rf build/{1..9}", false],
  ["rm -rf src/./old", false],
  ["rm -rf src/../old", false],
  ["rm -rf ./", false],
  ["rm -rf important", false],
  ["rm -rf .cache dist vendor", true],
  ["rm -rf node_modules /etc", false],
  ["rm -rf *", false],
  ["rm -rf d*", false],
  ["rm -rf build/*", false],
  ["rm -rf build/?", false],
  ["rm -rf build/[ab]", false],
];

const isShellNameCases: ReadonlyArray<readonly [string, boolean]> = [
  ["bash", true],
  ["dash", true],
  ["ash", true],
  ["ksh93", true],
  ["yash", true],
  ["/bin/bash", false],
  ["BASH", false],
  ["fish", false],
];

const isShellCommandCases: ReadonlyArray<readonly [string, boolean]> = [
  ["bash", true],
  ["/usr/bin/dash -s", true],
  ["sudo -n sh script", true],
  ["env -i zsh", true],
  ["busybox sh", true],
  ["/bin/busybox ash -s", true],
  ["busybox cat", false],
  ['busybox "sh"', false],
  ["fish", false],
  ["echo bash", false],
];

const isInterpreterCommandCases: ReadonlyArray<readonly [string, boolean]> = [
  ["python -c code", true],
  ["python3 script.py", true],
  ["/usr/bin/node app.js", true],
  ["env -i ruby -e code", true],
  ["perl script.pl", true],
  ["python2", false],
  ["nodejs", false],
  ["deno eval code", false],
  ["echo python", false],
];

const isLocalDataPipeSourceCases: ReadonlyArray<readonly [string, boolean]> = [
  ["cat local.json", true],
  ["tail app.log", true],
  ["env -i jq . data.json", true],
  ['printf "curl and bash"', true],
  ["/usr/bin/sort file", true],
  ["curl url", false],
  ["ssh host cat file", false],
  ["sed -n p file", false],
  ["unknown", false],
];

const scriptFileWordIsSafeCases: ReadonlyArray<readonly [string, boolean]> = [
  ["./script.sh", true],
  ["script.sh", false],
  ["script.py", true],
  ['"script.mjs"', true],
  ["'script.rb'", true],
  ["script.cjs", true],
  ["script.ts", true],
  ["-", false],
  ["/dev/stdin", false],
  ["/proc/self/fd/0", false],
  ["$ROOT/script.py", false],
  ["`pwd`/script.py", false],
  ["--script.py", true],
  ["prefix$VALUE.js", true],
  ["script", false],
  ["", false],
];

const stripPolicyShellQuotesForPathScanCases: ReadonlyArray<
  readonly [string, string]
> = [
  ["'hello world'", "hello world"],
  ['"hello \\"world\\""', 'hello "world"'],
  ["cat<file", "cat< file"],
  ["cat<<EOF", "cat<<EOF"],
  ["cat<&0", "cat<&0"],
  ["cat<(printf x)", "cat<(printf x)"],
  ["printf '<'", "printf <"],
  ["trailing\\\\", "trailing\\"],
  ["dangling\\", "dangling\\"],
  ["'unfinished", "unfinished"],
];

const isScriptFileShellCommandCases: ReadonlyArray<readonly [string, boolean]> =
  [
    ["bash ./script.sh", true],
    ["dash ./script.sh", true],
    ["bash script.sh", false],
    ["bash -x ./script.sh", true],
    ["bash -c ./script.sh", false],
    ["bash -xc ./script.sh", false],
    ["bash -s ./script.sh", false],
    ["bash -o pipefail ./script.sh", true],
    ["bash -o pipefail", false],
    ["bash --rcfile /dev/stdin ./script.sh", false],
    ["bash --rcfile ./rc ./script.sh", true],
    ["bash --init-file=./rc ./script.sh", true],
    ["bash --init-file=/proc/self/fd/0 ./script.sh", false],
    ["bash -- ./script.sh", true],
    ["bash --unknown ./script.sh", true],
    ["busybox sh ./script.sh", false],
    ["fish ./script.sh", false],
  ];

const networkConsumersCases: ReadonlyArray<
  readonly [string, boolean, boolean]
> = [
  ["curl url", true, false],
  ["env -i wget url", true, false],
  ["/bin/fetch url", true, false],
  ["http url", true, false],
  ["cat local.txt", false, true],
  ["printf data", false, true],
  ["jq .", false, true],
  ["python script.py", false, false],
  ["ssh host cat file", false, false],
];

const isInlineInterpreterCommandCases: ReadonlyArray<
  readonly [string, boolean]
> = [
  ["python -c code", true],
  ["python3 -c code", true],
  ["node --eval code", true],
  ["node -e code", true],
  ["perl -e code", true],
  ["ruby -e code", true],
  ["env -i node -e code", true],
  ["node -p code", false],
  ["node --eval=code", false],
  ["python -cprint", false],
  ["perl -E code", false],
  ["python script.py -c argument", true],
  ["sh -c code", false],
];

const interpreterOptionActionCases: ReadonlyArray<
  readonly [string, string, string]
> = [
  ["python", "-c", "reject"],
  ["python3", "-mjson.tool", "reject"],
  ["python", "-W", "skip_next"],
  ["python", "-Wignore", "skip"],
  ["python", "-I", "skip"],
  ["python", "--unknown", "reject"],
  ["python", "--unknown=x", "skip"],
  ["python", "--", "stop"],
  ["python", "-", "positional"],
  ["node", "--import", "skip_next"],
  ["node", "--import=./x.mjs", "skip"],
  ["node", "-p1", "reject"],
  ["node", "--watch", "skip"],
  ["node", "--unknown", "reject"],
  ["perl", "-M", "skip_next"],
  ["perl", "-Mfeature", "skip"],
  ["perl", "-E", "reject"],
  ["ruby", "--encoding", "skip_next"],
  ["ruby", "--encoding=utf8", "skip"],
  ["ruby", "-Ilib", "skip"],
  ["ruby", "-eputs", "reject"],
  ["ruby", "--unknown", "reject"],
  ["unknown", "--", "stop"],
  ["unknown", "-x", "reject"],
];

const isScriptFileInterpreterCommandCases: ReadonlyArray<
  readonly [string, boolean]
> = [
  ["python script.py", true],
  ["python -I script.py", true],
  ["python -W ignore script.py", true],
  ["python -W", false],
  ["python -c code script.py", false],
  ["python -m module script.py", false],
  ["python -- script.py", true],
  ["python -", false],
  ["python /dev/stdin", false],
  ['python "$ROOT/script.py"', false],
  ["node --import ./preload.mjs script.js", true],
  ["node --import ./preload.mjs", false],
  ["node --unknown script.js", false],
  ["node -e code script.js", false],
  ["perl -M feature script.pl", true],
  ["perl -E code script.pl", false],
  ["ruby -I lib script.rb", true],
  ["ruby --encoding=utf8 script.rb", true],
  ["env -i node script.mjs", true],
  ["sh script.py", false],
];

const inlineInterpreterProgramCases: ReadonlyArray<
  readonly [string, string, string]
> = [
  ["python -c 'print(1)' data", "-c", "print(1)"],
  ["node -e '' ignored", "-e", ""],
  ["node --eval 'pre'\"fix\" later", "--eval", "prefix"],
  ["python -c 'unterminated", "-c", "unterminated"],
  ["node --eval=code", "--eval", "=code"],
  ["python -c 'two words' data", "-c", "two words"],
];

const inlineProgramVisibleCodeCases: ReadonlyArray<
  readonly [string, string, string]
> = [
  ['print("hello")', "python", "print( )"],
  ["print('\\\"'); os.system('id')", "python", "print( ); os.system( )"],
  ["'unfinished", "python", "'unfinished"],
  ["qx'echo hi'", "perl", "qx'echo hi'"],
  ["prefixqx'echo hi'", "perl", "prefixqx "],
  ['print "${system(1)}"', "perl", 'print "${system(1)}"'],
  ['print "#{system(1)}"', "ruby", 'print "#{system(1)}"'],
  ["print '#{system(1)}'", "ruby", "print  "],
  ['%x"echo hi"', "ruby", '%x"echo hi"'],
  ['prefix%x"echo hi"', "ruby", "prefix%x "],
  ["console.log(`hello`)", "node", "console.log(`hello`)"],
  ['print("a\\"b")', "python", "print( )"],
];

describe("native shell policy primitives", () => {
  it("rmHasRecursive retains its shell reference decisions", () => {
    for (const [input, expected] of rmHasRecursiveCases)
      assert.equal(rmHasRecursive(input), expected, input);
  });
  it("rmIsSafelyScoped requires explicit targets without wildcard spellings", () => {
    for (const [input, expected] of rmIsSafelyScopedCases)
      assert.equal(rmIsSafelyScoped(input), expected, input);
  });
  it("isShellName retains its shell reference decisions", () => {
    for (const [input, expected] of isShellNameCases)
      assert.equal(isShellName(input), expected, input);
  });
  it("isShellCommand retains its shell reference decisions", () => {
    for (const [input, expected] of isShellCommandCases)
      assert.equal(isShellCommand(input), expected, input);
  });
  it("isInterpreterCommand retains its shell reference decisions", () => {
    for (const [input, expected] of isInterpreterCommandCases)
      assert.equal(isInterpreterCommand(input), expected, input);
  });
  it("isLocalDataPipeSource retains its shell reference decisions", () => {
    for (const [input, expected] of isLocalDataPipeSourceCases)
      assert.equal(isLocalDataPipeSource(input), expected, input);
  });
  it("scriptFileWordIsSafe retains its shell reference decisions", () => {
    for (const [input, expected] of scriptFileWordIsSafeCases)
      assert.equal(scriptFileWordIsSafe(input), expected, input);
  });
  it("stripPolicyShellQuotesForPathScan retains its shell reference decisions", () => {
    for (const [input, expected] of stripPolicyShellQuotesForPathScanCases)
      assert.equal(stripPolicyShellQuotesForPathScan(input), expected, input);
  });
});

describe("native script and inline-program policy", () => {
  it("requires explicit shell scripts and safe startup files", () => {
    for (const [input, expected] of isScriptFileShellCommandCases)
      assert.equal(isScriptFileShellCommand(input), expected, input);
  });
  it("keeps download producers separate from inert data consumers", () => {
    for (const [input, download, inert] of networkConsumersCases) {
      assert.equal(isDownloaderPipeSource(input), download, input);
      assert.equal(isInertDownloadPipeConsumer(input), inert, input);
    }
  });
  it("recognizes only the retained standalone interpreter flags", () => {
    for (const [input, expected] of isInlineInterpreterCommandCases)
      assert.equal(isInlineInterpreterCommand(input), expected, input);
  });
  it("distinguishes interpreter options, values, terminators and inline programs", () => {
    for (const [base, word, expected] of interpreterOptionActionCases)
      assert.equal(
        interpreterOptionAction(base, word),
        expected,
        base + ":" + word,
      );
  });
  it("finds script operands after interpreter options without accepting stdin programs", () => {
    for (const [input, expected] of isScriptFileInterpreterCommandCases)
      assert.equal(isScriptFileInterpreterCommand(input), expected, input);
  });
  it("extracts one inline program while retaining empty and adjacent quoted fragments", () => {
    for (const [input, flag, expected] of inlineInterpreterProgramCases)
      assert.equal(inlineInterpreterProgram(input, flag), expected, input);
  });
  it("hides ordinary strings while exposing executable quoting and unfinished text", () => {
    for (const [input, language, expected] of inlineProgramVisibleCodeCases)
      assert.equal(inlineProgramVisibleCode(input, language), expected, input);
  });
});

const inlineProgramExecutesCommandsCases: ReadonlyArray<
  readonly [string, string, string, boolean]
> = [
  ["python", "python -c 'os.system(\"id\")'", 'os.system("id")', true],
  ["python", "python -c 'subprocess.run(argv)'", "subprocess.run(argv)", true],
  ["python", "python -c 'print(1)'", "print(1)", false],
  ["node", "node -e '/x/.exec(\"x\")'", '/x/.exec("x")', false],
  [
    "node",
    "node -e 'child_process.spawn(\"x\")'",
    'child_process.spawn("x")',
    true,
  ],
  [
    "deno",
    "deno eval 'new Deno.Command(\"x\")'",
    'new Deno.Command("x")',
    true,
  ],
  ["ruby", "ruby -e 'system \"id\"'", 'system "id"', true],
  ["ruby", "ruby -e 'puts \"system id\"'", 'puts "system id"', false],
  ["ruby", "ruby -e '%x(id)'", "%x(id)", true],
  ["perl", "perl -e 'readpipe \"id\"'", 'readpipe "id"', true],
  ["perl", "perl -e 'print \"system id\"'", 'print "system id"', false],
  ["perl", "perl -e 'qx(id)'", "qx(id)", true],
  ["perl", "perl -e 'open(FH,\"id|\")'", 'open(FH,"id|")', true],
  ["php", "php -r 'passthru(\"id\");'", 'passthru("id");', true],
  ["php", "php -r 'echo `id`;'", "echo `id`;", true],
  ["node", "node -e 'console.log(`x`)'", "console.log(`x`)", false],
];

const interpreterTreatsStdinAsDataCases: ReadonlyArray<
  readonly [string, boolean]
> = [
  ["python -c code", true],
  ["python script.py", true],
  ["node --import preload.mjs app.js", true],
  ["ruby -e code", true],
  ["python", false],
  ["node -", false],
  ["python /dev/stdin", false],
];

const stripSqlLiteralsInsideDoubleQuotesCases: ReadonlyArray<
  readonly [string, string]
> = [
  ["psql -c \"select 'drop table t'\"", "psql -c \"select ''\""],
  ['psql -c "drop table t"', 'psql -c "drop table t"'],
  ["psql -c 'select 1'", "psql -c 'select 1'"],
  ["x \"a'unfinished", "x \"a''"],
  ["x \"'one' + 'two'\"", "x \"'' + ''\""],
  ['x \\"quoted\\"', 'x \\"quoted\\"'],
];

const checkCommandChainPolicyCases: ReadonlyArray<
  readonly [string, number, string | null]
> = [
  [
    "curl url && bash file",
    0,
    "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it.",
  ],
  [
    "wget url; /usr/bin/dash file",
    0,
    "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it.",
  ],
  [
    "http url || ksh93 file",
    0,
    "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it.",
  ],
  ["curl url && bash file", 1, null],
  ["cat file && bash file", 0, null],
  ["curl url && cat file", 0, null],
  ["/usr/bin/curl url && bash file", 0, null],
];

const checkPipelineShellConsumersCases: ReadonlyArray<
  readonly [string, number, string | null]
> = [
  [
    "curl url | sh",
    0,
    "Downloaded content reaches an executable or unknown pipeline consumer. Save and inspect it before running it.",
  ],
  [
    "curl url | head | python app.py",
    0,
    "Downloaded content reaches an executable or unknown pipeline consumer. Save and inspect it before running it.",
  ],
  ["curl url | jq .", 0, null],
  [
    "cat data | sh",
    0,
    "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping.",
  ],
  ["cat data | sh ./script.sh", 0, null],
  [
    "cat data | sh ./script.sh",
    1,
    "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping.",
  ],
  [
    "cat data | python",
    0,
    "Pipe to interpreter. Download or inspect first, then run; to feed local data to inline interpreter code, redirect from a file (cmd < file) instead of piping.",
  ],
  ["cat data | python -c code", 0, null],
  [
    "cat data | python app.py",
    1,
    "Pipe to interpreter. Download or inspect first, then run; to feed local data to inline interpreter code, redirect from a file (cmd < file) instead of piping.",
  ],
  [
    "unknown | python app.py",
    0,
    "Pipe to interpreter. Download or inspect first, then run; to feed local data to inline interpreter code, redirect from a file (cmd < file) instead of piping.",
  ],
  ["cat data || sh", 0, null],
  ["cat data\n| sh", 0, null],
  [
    "cat data | sh\nnext",
    0,
    "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping.",
  ],
];

const xargsRulesCases: ReadonlyArray<
  readonly [string, string | null, string | null]
> = [
  [
    "xargs rm -rf",
    "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually.",
    "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually.",
  ],
  [
    "xargs -I{} rm -rf {}",
    "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually.",
    "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually.",
  ],
  ["xargs rm file", null, null],
  ["xargs --help", null, null],
  [
    "cat list | xargs rm -rf",
    null,
    "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually.",
  ],
  ["printf data || xargs rm -rf", null, null],
  ["cat list\n| xargs rm -rf", null, null],
];

const pipelineContainsShellEvalStageCases: ReadonlyArray<
  readonly [string, boolean]
> = [
  ["eval cmd", true],
  ["cat file | eval cmd", true],
  [">out eval cmd", true],
  ["command eval cmd", true],
  ["echo eval", false],
  ["printf '%s' '| eval cmd'", false],
  ["cat file | sh ./script.sh", false],
];

describe("native shell pipeline and execution rules", () => {
  it("detects language execution APIs without treating JavaScript regex calls as process launches", () => {
    for (const [
      language,
      segment,
      program,
      expected,
    ] of inlineProgramExecutesCommandsCases)
      assert.equal(
        inlineProgramExecutesCommands(language, segment, program),
        expected,
        segment,
      );
  });
  it("requires an explicit program before treating interpreter stdin as data", () => {
    for (const [input, expected] of interpreterTreatsStdinAsDataCases)
      assert.equal(interpreterTreatsStdinAsData(input), expected, input);
  });
  it("hides only SQL literals inside double-quoted shell arguments", () => {
    for (const [input, expected] of stripSqlLiteralsInsideDoubleQuotesCases)
      assert.equal(stripSqlLiteralsInsideDoubleQuotes(input), expected, input);
  });
  it("returns the exact download-and-execute refusal only at top level", () => {
    for (const [input, depth, expected] of checkCommandChainPolicyCases)
      assert.equal(checkCommandChainPolicy(input, depth), expected, input);
  });
  it("retains pipeline provenance, local-script exemptions and legacy newline boundaries", () => {
    for (const [input, depth, expected] of checkPipelineShellConsumersCases)
      assert.equal(checkPipelineShellConsumers(input, depth), expected, input);
  });
  it("checks direct and pipeline xargs payloads at their respective boundaries", () => {
    for (const [input, direct, pipeline] of xargsRulesCases) {
      assert.equal(checkXargsDestructivePayload(input), direct, input);
      assert.equal(
        checkPipelineXargsDestructivePayloads(input),
        pipeline,
        input,
      );
    }
  });
  it("detects eval after real stage splitting, wrapper normalization and leading redirections", () => {
    for (const [input, expected] of pipelineContainsShellEvalStageCases)
      assert.equal(pipelineContainsShellEvalStage(input), expected, input);
    assert.equal(pipelineContainsShellEvalStage("${IFS}eval cmd"), null);
  });
});
