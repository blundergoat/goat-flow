/** Classify recursive cleanup and shell/interpreter inputs without executing proposed commands. */
import {
  normalizePolicyCommandCandidate,
  stripLeadingPolicyShellRedirections,
} from "../policy-syntax.mjs";
import { splitPolicyTopLevelPipelineStages } from "../policy-segments.mjs";
import {
  dropFirstPolicyShellWord,
  firstPolicyWordBase,
  splitPolicyShellWords,
  splitIfs,
  stripPolicyXargsPayload,
  stripPolicyShellQuotesForPathScan,
} from "../policy-words.mjs";

/** Require rm's basename and a recursive option, preserving the reference's short bundles. */
export function rmHasRecursive(command: string): boolean {
  if (firstPolicyWordBase(command) !== "rm") return false;
  return (
    /(^|[ \t\r\n\v\f])--recursive([ \t\r\n\v\f]|$)/u.test(command) ||
    /(^|[ \t\r\n\v\f])-[^- \t\r\n\v\f]*[rR][^ \t\r\n\v\f]*([ \t\r\n\v\f]|$)/u.test(
      command,
    )
  );
}

const disposableDirectories = new Set([
  "node_modules",
  "vendor",
  "target",
  "dist",
  "out",
  "build",
  "coverage",
  "__pycache__",
  ".cache",
  ".next",
  ".nuxt",
  ".turbo",
]);

function cleanupTargetIsScoped(target: string): boolean {
  if (!target || /[$\x60*?\[]/u.test(target)) return false;
  if (/\{[^]*(?:,|\.\.)[^]*\}/u.test(target)) return false;
  if (/\/\.\.?\//u.test("/" + target + "/")) return false;
  if (/^\/tmp\/build-[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/u.test(target))
    return true;
  if (/^(?:\/|~|[A-Za-z]:[/\\])/u.test(target)) return false;
  return disposableDirectories.has(target) || target.includes("/");
}

/** Judge literal cleanup targets; wildcard spellings require manual review rather than filesystem expansion. */
export function rmIsSafelyScoped(command: string): boolean {
  const targets = dropFirstPolicyShellWord(command).replace(
    /^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/gu,
    "",
  );
  if (!targets) return false;
  for (const word of targets.split(/[ \t\n]+/u)) {
    let target = stripPolicyShellQuotesForPathScan(word).replace(/\n+$/u, "");
    if (target.startsWith("-")) continue;
    target = target.replace(/^\.\//u, "").replace(/\/$/u, "");
    if (!cleanupTargetIsScoped(target)) return false;
  }
  return true;
}

const shellNames = new Set([
  "bash",
  "sh",
  "dash",
  "zsh",
  "ksh",
  "ksh93",
  "mksh",
  "ash",
  "yash",
]);
const interpreterNames = new Set(["python", "python3", "node", "perl", "ruby"]);
const localDataSources = new Set([
  "cat",
  "tac",
  "head",
  "tail",
  "grep",
  "egrep",
  "fgrep",
  "rg",
  "sort",
  "uniq",
  "cut",
  "tr",
  "wc",
  "nl",
  "jq",
  "yq",
  "column",
  "paste",
  "comm",
  "join",
  "printf",
  "echo",
]);

/** Share the POSIX shell list between pipeline detection and explicit script-file checks. */
export function isShellName(name: string): boolean {
  return shellNames.has(name);
}

/** Recognize supported shell executables, including BusyBox's sh and ash applets. */
export function isShellCommand(command: string): boolean {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return false;
  const base = firstPolicyWordBase(normalized);
  if (base !== "busybox") return isShellName(base);
  const applet = normalized
    .replace(/^[ \t\r\n\v\f]+/u, "")
    .split(/[ \t\r\n\v\f]+/u)[1];
  return applet === "sh" || applet === "ash";
}

/** Identify the interpreter set whose pipeline input needs a program-versus-data decision. */
export function isInterpreterCommand(command: string): boolean {
  const normalized = normalizePolicyCommandCandidate(command);
  return (
    normalized !== null && interpreterNames.has(firstPolicyWordBase(normalized))
  );
}

/** Identify known local data producers; unknown or network programs do not establish local input. */
export function isLocalDataPipeSource(command: string): boolean {
  const normalized = normalizePolicyCommandCandidate(command);
  return (
    normalized !== null && localDataSources.has(firstPolicyWordBase(normalized))
  );
}

/** Reject stdin/device programs and unresolved leading expansions before allowing a script operand. */
export function scriptFileWordIsSafe(word: string): boolean {
  const path = stripPolicyShellQuotesForPathScan(word).replace(/\n+$/u, "");
  if (path === "-" || /^(?:\/dev\/|\/proc\/|[$\x60])/u.test(path)) return false;
  return path.includes("/") || /\.(?:py|js|mjs|cjs|rb|pl|ts)$/u.test(path);
}

function shellStartupOptionEnd(
  words: readonly string[],
  index: number,
  word: string,
): number | null {
  if (word === "--init-file" || word === "--rcfile")
    return scriptFileWordIsSafe(words[index + 1] ?? "") ? index + 2 : null;
  if (/^--(?:init-file|rcfile)=/u.test(word))
    return scriptFileWordIsSafe(word.slice(word.indexOf("=") + 1))
      ? index + 1
      : null;
  return index;
}

function shellScriptWordIndex(words: readonly string[]): number | null {
  let index = 1;
  while (index < words.length) {
    const word = words[index] ?? "";
    if (/^(?:-[^-]*c|-s)/u.test(word)) return null;
    if (word === "--") return index + 1;
    const afterStartup = shellStartupOptionEnd(words, index, word);
    if (afterStartup === null) return null;
    if (afterStartup !== index) index = afterStartup;
    else if (/^-[Oo]$/u.test(word)) index += 2;
    else if (word.startsWith("-")) index++;
    else break;
  }
  return index;
}

/** Require an explicit script operand after shell options; stdin and inline programs stay untrusted. */
export function isScriptFileShellCommand(command: string): boolean {
  const words = splitPolicyShellWords(command);
  const executable = words[0] ?? "";
  if (
    words.length < 2 ||
    !isShellName(executable.slice(executable.lastIndexOf("/") + 1))
  )
    return false;
  const index = shellScriptWordIndex(words);
  return (
    index !== null &&
    index < words.length &&
    scriptFileWordIsSafe(words[index] ?? "")
  );
}

const downloaderNames = new Set(["curl", "wget", "fetch", "http"]);

/** Mark network producers whose output must not become a downstream program. */
export function isDownloaderPipeSource(command: string): boolean {
  const normalized = normalizePolicyCommandCandidate(command);
  return (
    normalized !== null && downloaderNames.has(firstPolicyWordBase(normalized))
  );
}

/** Keep download display/transform consumers on the same allowlist as local data producers. */
export function isInertDownloadPipeConsumer(command: string): boolean {
  return isLocalDataPipeSource(command);
}

function normalizedProgramWords(command: string): string[] {
  const normalized = normalizePolicyCommandCandidate(command);
  return normalized === null ? [] : splitPolicyShellWords(normalized);
}

/** Preserve the reference's exact standalone inline flags, including flags after other operands. */
export function isInlineInterpreterCommand(command: string): boolean {
  const words = normalizedProgramWords(command);
  const executable = words[0] ?? "";
  const base = executable.slice(executable.lastIndexOf("/") + 1);
  return words
    .slice(1)
    .some((word) =>
      /^(?:python3?:-c|node:(?:-e|--eval)|perl:-e|ruby:-e)$/u.test(
        base + ":" + word,
      ),
    );
}

export type InterpreterOptionAction =
  "reject" | "stop" | "positional" | "skip_next" | "skip";

interface InterpreterOptions {
  inline: RegExp;
  values: ReadonlySet<string>;
  attached: RegExp;
  flags: RegExp;
}

const pythonOptions: InterpreterOptions = {
  inline: /^-[cm]/u,
  values: new Set(["-W", "-X", "--check-hash-based-pycs"]),
  attached: /^-[WX][^]/u,
  flags: /^(?:--help|--version|-h|-V|-[bBdEhiIOqRsSuvVx]+)$/u,
};
const nodeOptions: InterpreterOptions = {
  inline: /^(?:-[ep]|--(?:eval|print)(?:=|$))/u,
  values: new Set([
    "-r",
    "--require",
    "--import",
    "--loader",
    "--experimental-loader",
    "--input-type",
    "--conditions",
    "-C",
    "--env-file",
    "--env-file-if-exists",
    "--inspect-port",
    "--icu-data-dir",
    "--openssl-config",
    "--redirect-warnings",
    "--diagnostic-dir",
    "--cpu-prof-dir",
    "--heap-prof-dir",
    "--snapshot-blob",
    "--test-reporter",
    "--test-name-pattern",
  ]),
  attached: /^-[rC][^]/u,
  flags:
    /^(?:--help|--version|-h|-v|--check|--watch|--test|--inspect|--inspect-brk|--(?:trace|experimental|no)-[^]*|--throw-deprecation|--enable-source-maps|--preserve-symlinks|--preserve-symlinks-main|--prof|--zero-fill-buffers)$/u,
};
const interpreterOptions = new Map<string, InterpreterOptions>([
  ["python", pythonOptions],
  ["python3", pythonOptions],
  ["node", nodeOptions],
  [
    "perl",
    {
      inline: /^-[eE]/u,
      values: new Set(["-I", "-M", "-m"]),
      attached: /^-[IMm][^]/u,
      flags: /^(?:-c|-w|-d|-T|-U|-W|-X|-v|--help|--version)$/u,
    },
  ],
  [
    "ruby",
    {
      inline: /^-e/u,
      values: new Set([
        "-I",
        "-r",
        "-E",
        "-K",
        "--encoding",
        "--external-encoding",
        "--internal-encoding",
      ]),
      attached: /^-[IrEK][^]/u,
      flags: /^(?:-c|-w|-d|-v|--help|--version)$/u,
    },
  ],
]);

function isSingleWordInterpreterOption(
  options: InterpreterOptions,
  word: string,
): boolean {
  return (
    options.attached.test(word) ||
    (word.startsWith("--") && word.includes("=")) ||
    options.flags.test(word)
  );
}

/** Classify option arity before deciding which interpreter operand names the script. */
export function interpreterOptionAction(
  base: string,
  word: string,
): InterpreterOptionAction {
  if (word === "--") return "stop";
  if (!word.startsWith("-") || word.length < 2) return "positional";
  const options = interpreterOptions.get(base);
  if (!options || options.inline.test(word)) return "reject";
  if (options.values.has(word)) return "skip_next";
  if (isSingleWordInterpreterOption(options, word)) return "skip";
  return "reject";
}

/** Locate an explicit interpreter script without mistaking option values or inline code for it. */
export function isScriptFileInterpreterCommand(command: string): boolean {
  const words = normalizedProgramWords(command);
  const executable = words[0] ?? "";
  const base = executable.slice(executable.lastIndexOf("/") + 1);
  if (!interpreterNames.has(base)) return false;
  let optionsDone = false;
  for (let index = 1; index < words.length; index++) {
    const word = words[index] ?? "";
    const action = optionsDone
      ? "positional"
      : interpreterOptionAction(base, word);
    if (action === "stop") optionsDone = true;
    else if (action === "skip_next") index++;
    else if (action === "reject") return false;
    else if (action === "positional") return scriptFileWordIsSafe(word);
  }
  return false;
}

/** Read one inline program argument, retaining adjacent quote fragments and quoted empty programs. */
export function inlineInterpreterProgram(
  segment: string,
  flagMatch: string,
): string {
  const index = segment.indexOf(flagMatch);
  const program = segment
    .slice(index < 0 ? 0 : index + flagMatch.length)
    .replace(/^[ \t\r\n\v\f]+/u, "");
  return (splitPolicyShellWords("_" + program)[0] ?? "_").slice(1);
}

interface InlineQuoteState {
  visible: string;
  quoted: string;
  quote: string;
  escaped: boolean;
  keepQuoted: boolean;
}

function closeInlineQuote(
  state: InlineQuoteState,
  interpolation: RegExp | null,
): void {
  const interpolates = state.quote === '"' && interpolation?.test(state.quoted);
  state.visible += state.keepQuoted || interpolates ? state.quoted : " ";
  state.quote = "";
  state.quoted = "";
}

function appendInlineQuotedCharacter(
  state: InlineQuoteState,
  char: string,
  interpolation: RegExp | null,
): void {
  state.quoted += char;
  if (state.escaped) state.escaped = false;
  else if (char === "\\") state.escaped = true;
  else if (char === state.quote) closeInlineQuote(state, interpolation);
}

const inlineQuoting = new Map([
  [
    "perl",
    {
      operator: /(^|[^A-Za-z0-9_$@%&])qx[ \t\r\n\v\f]*$/u,
      interpolation: /[@$]\{/u,
    },
  ],
  ["ruby", { operator: /(^|[^A-Za-z0-9_])%x$/u, interpolation: /#\{/u }],
]);

/** Hide complete ordinary strings but retain executable quoting, interpolation and unfinished text. */
export function inlineProgramVisibleCode(
  program: string,
  interpreter = "",
): string {
  const quoting = inlineQuoting.get(interpreter);
  const state: InlineQuoteState = {
    visible: "",
    quoted: "",
    quote: "",
    escaped: false,
    keepQuoted: false,
  };
  for (const char of program) {
    if (state.quote)
      appendInlineQuotedCharacter(state, char, quoting?.interpolation ?? null);
    else if (char === '"' || char === "'") {
      state.quote = char;
      state.quoted = char;
      state.keepQuoted = quoting?.operator.test(state.visible) ?? false;
    } else state.visible += char;
  }
  return state.visible + state.quoted;
}

const shellExecutionPrimitive =
  /(os\.system|os\.popen|os\.exec|os\.spawn|pty\.spawn|child_process|system[ \t\r\n\v\f]*\(|(^|[^A-Za-z0-9_.])exec[ \t\r\n\v\f]*\(|popen|shell_exec)/u;
const interpreterExecutionPatterns = new Map<
  string,
  { module?: RegExp; bare?: RegExp; delimiter?: RegExp; pipe?: RegExp }
>([
  ["python", { module: /subprocess/u }],
  ["python2", { module: /subprocess/u }],
  ["python3", { module: /subprocess/u }],
  ["node", { module: /Deno\.(Command|run)/u }],
  ["nodejs", { module: /Deno\.(Command|run)/u }],
  ["deno", { module: /Deno\.(Command|run)/u }],
  [
    "perl",
    {
      bare: /(^|[^A-Za-z0-9_$@%&:>\-])(system|exec|readpipe)([ \t\r\n\v\f]|\(|$)/u,
      delimiter:
        /(^|[^A-Za-z0-9_$@%&])qx[ \t\r\n\v\f]*[^A-Za-z0-9_ \t\r\n\v\f]/u,
      pipe: /open[ \t\r\n\v\f]*\([^)]*[|]/u,
    },
  ],
  [
    "ruby",
    {
      bare: /(^|[^A-Za-z0-9_$@:\-])(system|exec|spawn)([ \t\r\n\v\f]|\(|$)/u,
      module: /Open3/u,
      delimiter: /(^|[^A-Za-z0-9_])%x[^A-Za-z0-9_ \t\r\n\v\f]/u,
    },
  ],
  [
    "php",
    {
      bare: /(^|[^A-Za-z0-9_$>])(passthru|proc_open|pcntl_exec)[ \t\r\n\v\f]*\(/u,
    },
  ],
]);

function matchesOptionalExecutionPattern(
  pattern: RegExp | undefined,
  input: string,
): boolean {
  return pattern === undefined ? false : pattern.test(input);
}

/** Detect command-launching APIs while retaining interpreter-specific quoting and regex controls. */
export function inlineProgramExecutesCommands(
  interpreter: string,
  segment: string,
  program: string,
): boolean {
  if (shellExecutionPrimitive.test(segment)) return true;
  const patterns = interpreterExecutionPatterns.get(interpreter);
  if (!patterns) return false;
  const visible = inlineProgramVisibleCode(program, interpreter);
  return (
    matchesOptionalExecutionPattern(patterns.module, segment) ||
    matchesOptionalExecutionPattern(patterns.bare, visible) ||
    matchesOptionalExecutionPattern(patterns.delimiter, visible) ||
    matchesOptionalExecutionPattern(patterns.pipe, program) ||
    (["perl", "ruby", "php"].includes(interpreter) && segment.includes("`"))
  );
}

/** Only explicit inline programs and checked script operands establish that stdin is data. */
export function interpreterTreatsStdinAsData(command: string): boolean {
  return (
    isInlineInterpreterCommand(command) ||
    isScriptFileInterpreterCommand(command)
  );
}

/** Remove SQL string data inside double-quoted shell arguments without hiding outer command text. */
export function stripSqlLiteralsInsideDoubleQuotes(input: string): string {
  let output = "";
  let inDouble = false;
  let escaped = false;
  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    if (escaped) {
      output += char;
      escaped = false;
    } else if (char === "\\") {
      output += char;
      escaped = true;
    } else if (char === '"') {
      output += char;
      inDouble = !inDouble;
    } else if (inDouble && char === "'") {
      output += "''";
      index++;
      while (index < input.length && input.charAt(index) !== "'") index++;
    } else output += char;
  }
  return output;
}

/** A top-level download followed by a shell script leaves no inspection step. */
export function checkCommandChainPolicy(
  input: string,
  depth = 0,
): string | null {
  const download = /(^|[ \t\r\n\v\f])(curl|wget|fetch|http)([ \t\r\n\v\f]|$)/u;
  const execute =
    /(;|&&|\|\|)[ \t\r\n\v\f]*([^ \t\r\n\v\f;&|]*\/)?(bash|dash|zsh|ksh93|ksh|mksh|ash|yash|sh)[ \t\r\n\v\f]+[^ \t\r\n\v\f&|;]+/u;
  return depth === 0 && download.test(input) && execute.test(input)
    ? "Download-then-execute (curl/wget ... && bash file). Inspect the downloaded file before running it."
    : null;
}

function legacyPipelineParts(unquoted: string): string[] {
  return splitIfs(unquoted.replaceAll("||", "__GOAT_OR__"), "|");
}

function checkPipelineConsumer(
  current: string,
  sawDownload: boolean,
  explicitLocalInput: boolean,
): string | null {
  if (sawDownload && !isInertDownloadPipeConsumer(current))
    return "Downloaded content reaches an executable or unknown pipeline consumer. Save and inspect it before running it.";
  if (isShellCommand(current))
    return explicitLocalInput && isScriptFileShellCommand(current)
      ? null
      : "Pipe to shell. Download or inspect first, then run; to feed a local script, redirect from a file (cmd < file) instead of piping.";
  if (isInterpreterCommand(current))
    return explicitLocalInput && interpreterTreatsStdinAsData(current)
      ? null
      : "Pipe to interpreter. Download or inspect first, then run; to feed local data to inline interpreter code, redirect from a file (cmd < file) instead of piping.";
  return null;
}

/** Track download provenance through every filter before allowing a script or interpreter consumer. */
export function checkPipelineShellConsumers(
  unquoted: string,
  depth = 0,
): string | null {
  const parts = legacyPipelineParts(unquoted);
  let sawDownload = false;
  let allLocal = true;
  for (let index = 1; index < parts.length; index++) {
    const previous = parts[index - 1] ?? "";
    const current = parts[index] ?? "";
    sawDownload ||= isDownloaderPipeSource(previous);
    allLocal &&= isLocalDataPipeSource(previous);
    const explicitLocalInput = depth === 0 && !sawDownload && allLocal;
    const reason = checkPipelineConsumer(
      current,
      sawDownload,
      explicitLocalInput,
    );
    if (reason !== null) return reason;
  }
  return null;
}

/** Recursive rm driven by xargs hides its actual targets from command-text inspection. */
export function checkXargsDestructivePayload(command: string): string | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const payload = stripPolicyXargsPayload(normalized);
  return payload.kind === "command" && rmHasRecursive(payload.command)
    ? "xargs feeding rm -r hides recursive deletion targets. Review the input list and run manually."
    : null;
}

/** Inspect each legacy pipeline stage for xargs-driven recursive deletion. */
export function checkPipelineXargsDestructivePayloads(
  unquoted: string,
): string | null {
  for (const part of legacyPipelineParts(unquoted)) {
    const reason = checkXargsDestructivePayload(part);
    if (reason !== null) return reason;
  }
  return null;
}

function normalizedStageWithoutRedirections(stage: string): string | null {
  let normalized = normalizePolicyCommandCandidate(stage);
  while (normalized !== null) {
    const stripped = stripLeadingPolicyShellRedirections(normalized);
    if (stripped.kind !== "command") break;
    normalized = normalizePolicyCommandCandidate(stripped.command);
  }
  return normalized;
}

/** Detect shell eval in real pipeline stages; null preserves unresolved parsing for the evaluator. */
export function pipelineContainsShellEvalStage(
  command: string,
  host = "",
): boolean | null {
  const split = splitPolicyTopLevelPipelineStages(command, host);
  if (split.kind === "unresolved") return null;
  for (const stage of split.segments) {
    const normalized = normalizedStageWithoutRedirections(stage);
    if (normalized === null) return null;
    if (firstPolicyWordBase(normalized) === "eval") return true;
  }
  return false;
}
