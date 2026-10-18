/** Split executable segments, inspect native launches and blocks, and track Git context without executing shell text. */
import { statSync } from "node:fs";
import { asciiLowerCase } from "./policy-input.mjs";
import {
  isGitConfigSourceVariable,
  isGitConfigSourceAmbientlyExported,
} from "./policy-git.mjs";
import {
  joinPolicyShellWords,
  splitPolicyShellWords,
} from "./policy-words.mjs";
import {
  findPolicyNativeCommandGroup,
  type PolicyNativeCommands,
} from "./policy-syntax.mjs";

interface BlockQuoteState {
  quote: string;
  escaped: boolean;
}

/** Escaped and quoted braces remain argument data rather than executable block boundaries. */
function consumeBlockQuote(state: BlockQuoteState, char: string): boolean {
  if (state.escaped) {
    state.escaped = false;
    return true;
  }
  if (state.quote !== "'" && char === "\x60") {
    state.escaped = true;
    return true;
  }
  if (state.quote !== "") {
    if (char === state.quote) state.quote = "";
    return true;
  }
  if (char === "'" || char === '"') {
    state.quote = char;
    return true;
  }
  return false;
}

const printedBlockCommand =
  /^[ \t\r\n\v\f]*(?:write-output|echo)(?:[ \t\r\n\v\f]|$)/u;

/** A printed block runs only when expression context, invocation or the caller's pipeline mode exposes it. */
function policyBlockWouldRun(
  input: string,
  tail: string,
  parentheses: number,
  keepOutputInert: boolean,
): boolean {
  return (
    !keepOutputInert ||
    !printedBlockCommand.test(asciiLowerCase(input)) ||
    parentheses !== 0 ||
    tail.replace(/^[ \t\r\n\v\f]+/u, "").startsWith(".")
  );
}

/** List top-level PowerShell block bodies in order; unresolved means a block has no complete boundary. */
export function findPolicyNativeScriptBlockBodies(
  input: string,
  keepOutputInert: boolean,
  host = "pwsh",
): PolicyNativeCommands {
  const commands: string[] = [];
  const quote: BlockQuoteState = { quote: "", escaped: false };
  let parentheses = 0;
  for (let index = 0; index < input.length; index++) {
    const char = input.charAt(index);
    if (consumeBlockQuote(quote, char)) continue;
    if (char === "(") parentheses++;
    else if (char === ")") parentheses--;
    if (char !== "{") continue;
    const group = findPolicyNativeCommandGroup(input.slice(index), host);
    if (!group) return { kind: "unresolved" };
    if (policyBlockWouldRun(input, group.tail, parentheses, keepOutputInert))
      commands.push(group.body);
    index = input.length - group.tail.length - 1;
  }
  return { kind: "commands", commands };
}

const cmdStartValues = new Set(["/d", "/node", "/affinity"]);

/** Read one raw launch switch using the reference's ASCII token boundaries. */
function nativeLaunchWord(input: string): string {
  return input.split(/[ \t\r\n\v\f]/u, 1)[0] ?? "";
}

/** cmd start's first quoted operand is a window title; recognized value switches precede the executable. */
function readPolicyCmdStart(input: string): PolicyNativeCommands {
  if (input.startsWith('"')) {
    const end = input.indexOf('"', 1);
    if (end < 0) return { kind: "unresolved" };
    input = input.slice(end + 1);
  }
  for (;;) {
    input = input.replace(/^[ \t\r\n\v\f]+/u, "");
    if (!input.startsWith("/")) break;
    const option = nativeLaunchWord(input);
    input = input.slice(option.length);
    if (cmdStartValues.has(asciiLowerCase(option))) {
      input = input.replace(/^[ \t\r\n\v\f]+/u, "");
      input = input.slice(nativeLaunchWord(input).length);
    }
  }
  return { kind: "commands", commands: input === "" ? [] : [input] };
}

const cmdForHeader =
  /^for[ \t\r\n\v\f]+(?:(?:\/[dl]|\/f(?:[ \t\r\n\v\f]+"[^"]*")?|\/r(?:[ \t\r\n\v\f]+[^% \t\r\n\v\f]+)?)[ \t\r\n\v\f]+)*%%?[a-z][ \t\r\n\v\f]+in[ \t\r\n\v\f]*\(/u;
const cmdForCommand =
  /^for[ \t\r\n\v\f]+(?:(?:\/[dl]|\/f(?:[ \t\r\n\v\f]+"[^"]*")?|\/r(?:[ \t\r\n\v\f]+[^% \t\r\n\v\f]+)?)[ \t\r\n\v\f]+)*%%?[a-z][ \t\r\n\v\f]+in[ \t\r\n\v\f]*\(([^)]*)\)[ \t\r\n\v\f]*do[ \t\r\n\v\f]+/u;

/** Quoted for /f sets execute their original-cased command as well as the loop's do action. */
function readPolicyCmdFor(input: string): PolicyNativeCommands {
  const lower = asciiLowerCase(input);
  const loop = cmdForCommand.exec(lower);
  if (!loop) return { kind: "unresolved" };
  const commands = [input.slice(loop[0].length)];
  const prefix = loop[0].split("%", 1)[0] ?? "";
  if (prefix.includes("/f")) {
    const header = cmdForHeader.exec(lower);
    if (!header) return { kind: "unresolved" };
    const set = input
      .slice(header[0].length, header[0].length + (loop[1] ?? "").length)
      .replace(/^[ \t\r\n\v\f]+|[ \t\r\n\v\f]+$/gu, "");
    const quote = set.charAt(0);
    if ((quote === "'" || quote === "\x60") && set.endsWith(quote))
      commands.push(set.slice(1, -1));
  }
  return { kind: "commands", commands };
}

/** cmd launch keywords expose their literal child, while unknown loop headers remain unresolved. */
function readPolicyCmdLaunch(input: string): PolicyNativeCommands {
  if (input.startsWith("@"))
    return { kind: "commands", commands: [input.slice(1)] };
  const lower = asciiLowerCase(input);
  const call = /^call(?:[ \t\r\n\v\f]+|$)/u.exec(lower);
  if (call)
    return { kind: "commands", commands: [input.slice(call[0].length)] };
  const start = /^start(?:[ \t\r\n\v\f]+|$)/u.exec(lower);
  if (start) return readPolicyCmdStart(input.slice(start[0].length));
  return /^for[ \t\r\n\v\f]/u.test(lower)
    ? readPolicyCmdFor(input)
    : { kind: "absent" };
}

const powerShellStarts = new Set(["start", "saps", "start-process"]);
const powerShellEvaluation = new Set(["iex", "invoke-expression"]);

/** Literal positional launches expose a child; dynamic evaluation and named argument assembly require refusal. */
function readPolicyPowerShellLaunch(input: string): PolicyNativeCommands {
  const dot = /^\.[ \t\r\n\v\f]+/u.exec(input);
  if (dot) return { kind: "commands", commands: [input.slice(dot[0].length)] };
  const word = asciiLowerCase(nativeLaunchWord(input));
  const verb = word.slice(word.lastIndexOf("/") + 1);
  if (powerShellEvaluation.has(verb)) return { kind: "unresolved" };
  if (!powerShellStarts.has(verb)) return { kind: "absent" };
  const words = splitPolicyShellWords(input);
  if (words.slice(1).some((word) => word.startsWith("-")))
    return { kind: "unresolved" };
  return {
    kind: "commands",
    commands: words.length < 2 ? [] : [joinPolicyShellWords(words, 1)],
  };
}

/** Return native launch actions, absent ordinary commands, or unresolved nonliteral launch syntax. */
export function findPolicyNativeLaunchedCommands(
  input: string,
  host: string,
): PolicyNativeCommands {
  input = input.replace(/^[ \t\r\n\v\f]+/u, "");
  if (host === "cmd" || host === "cmd.exe") return readPolicyCmdLaunch(input);
  if (/^(?:powershell|pwsh)(?:\.exe)?$/u.test(host))
    return readPolicyPowerShellLaunch(input);
  return { kind: "absent" };
}

export type PolicySegmentSplit =
  | { kind: "segments"; segments: string[]; background: boolean }
  | { kind: "unresolved"; reason: "script-block" | "native-conditional" };

interface SegmentScan {
  input: string;
  host: string;
  index: number;
  current: string;
  segments: string[];
  quote: string;
  escaped: boolean;
  escape: string;
  substitutionDepth: number;
  background: boolean;
}

const powerShellHost = /^(?:powershell|pwsh)(?:\.exe)?$/u;
const cmdHost = /^cmd(?:\.exe)?$/u;
const nativeConditionalStart = /^[ \t\r\n\v\f]*if(?:[ \t\r\n\v\f(]|$)/u;

function isSegmentEscape(scan: SegmentScan, char: string): boolean {
  return (
    scan.quote !== "'" &&
    char === scan.escape &&
    !(scan.escape === "^" && scan.quote === '"')
  );
}

function consumeSegmentQuotedCharacter(
  scan: SegmentScan,
  char: string,
): boolean {
  if (scan.escaped) {
    scan.current += char;
    scan.escaped = false;
    return true;
  }
  if (isSegmentEscape(scan, char)) {
    const next = scan.input.charAt(scan.index + 1);
    // cmd removes word escapes, but escaped operators must survive later parser passes.
    if (scan.escape !== "^" || !/[A-Za-z0-9_./:-]/u.test(next))
      scan.current += char;
    scan.escaped = true;
    return true;
  }
  if (scan.quote !== "") {
    if (char === scan.quote) scan.quote = "";
    scan.current += char;
    return true;
  }
  if (char === '"' || (char === "'" && !cmdHost.test(scan.host))) {
    scan.quote = char;
    scan.current += char;
    return true;
  }
  return false;
}

function nativeGroupReason(
  scan: SegmentScan,
  char: string,
): "script-block" | "native-conditional" | null {
  if (powerShellHost.test(scan.host) && char === "{") return "script-block";
  if (!nativeConditionalStart.test(asciiLowerCase(scan.current))) return null;
  if (
    char === "(" &&
    (powerShellHost.test(scan.host) || cmdHost.test(scan.host))
  )
    return "native-conditional";
  return null;
}

function continuesPowerShellConditional(
  scan: SegmentScan,
  char: string,
): boolean {
  if (char !== "\n" || !powerShellHost.test(scan.host)) return false;
  const prefix = scan.current.replace(/[ \t\r\n\v\f]+$/u, "");
  if (!nativeConditionalStart.test(asciiLowerCase(prefix))) return false;
  const tail = asciiLowerCase(
    scan.input.slice(scan.index + 1).replace(/^[ \t\r\n\v\f]+/u, ""),
  );
  return (
    prefix.endsWith(")") ||
    /(?:^|[ \t\r\n\v\f}])(?:if|elseif|else)[ \t\r\n\v\f]*$/u.test(
      asciiLowerCase(prefix),
    ) ||
    /^else(?:if)?(?:[ \t\r\n\v\f{(]|$)/u.test(tail)
  );
}

function consumeSegmentSubstitution(scan: SegmentScan, char: string): boolean {
  const next = scan.input.charAt(scan.index + 1);
  if (next === "(" && (char === "$" || char === "<" || char === ">")) {
    scan.current += char + next;
    scan.substitutionDepth++;
    scan.index++;
    return true;
  }
  if (scan.substitutionDepth === 0) return false;
  if (char === "(") scan.substitutionDepth++;
  else if (char === ")") scan.substitutionDepth--;
  scan.current += char;
  return true;
}

function isBackgroundSeparator(scan: SegmentScan, char: string): boolean {
  const next = scan.input.charAt(scan.index + 1);
  const previous = scan.input.charAt(scan.index - 1);
  return (
    char === "&" &&
    next !== ">" &&
    previous !== ">" &&
    previous !== "<" &&
    previous !== "|"
  );
}

function segmentSeparatorWidth(
  scan: SegmentScan,
  char: string,
  splitPipelines: boolean,
): number {
  const next = scan.input.charAt(scan.index + 1);
  if (/^(?:&&|\|\|)$/u.test(char + next)) return 2;
  if (splitPipelines && char === "|") return next === "&" ? 2 : 1;
  if (isBackgroundSeparator(scan, char)) return 1;
  return /^[;\n]$/u.test(char) ? 1 : 0;
}

function consumeSegmentSeparator(
  scan: SegmentScan,
  char: string,
  splitPipelines: boolean,
): boolean {
  const width = segmentSeparatorWidth(scan, char, splitPipelines);
  if (width === 0) return false;
  scan.background ||= width === 1 && isBackgroundSeparator(scan, char);
  scan.index += width - 1;
  scan.segments.push(scan.current);
  scan.current = "";
  return true;
}

function scanSegmentCharacter(
  scan: SegmentScan,
  splitPipelines: boolean,
): "script-block" | "native-conditional" | null {
  const char = scan.input.charAt(scan.index);
  if (consumeSegmentQuotedCharacter(scan, char)) return null;
  const reason = nativeGroupReason(scan, char);
  if (reason) {
    const group = findPolicyNativeCommandGroup(
      scan.input.slice(scan.index),
      scan.host,
    );
    if (!group) return reason;
    const end = scan.input.length - group.tail.length;
    scan.current += scan.input.slice(scan.index, end);
    scan.index = end - 1;
    return null;
  }
  if (continuesPowerShellConditional(scan, char)) scan.current += char;
  else if (
    !consumeSegmentSubstitution(scan, char) &&
    !consumeSegmentSeparator(scan, char, splitPipelines)
  )
    scan.current += char;
  return null;
}

/** Split executable boundaries using the selected host's quotes and escapes; retained text is never executed. */
export function splitPolicyCommandSegments(
  input: string,
  host = "",
  splitPipelines = false,
): PolicySegmentSplit {
  const scan: SegmentScan = {
    input,
    host,
    index: 0,
    current: "",
    segments: [],
    quote: "",
    escaped: false,
    escape: powerShellHost.test(host)
      ? "\x60"
      : cmdHost.test(host)
        ? "^"
        : "\\",
    substitutionDepth: 0,
    background: false,
  };
  for (; scan.index < input.length; scan.index++) {
    const reason = scanSegmentCharacter(scan, splitPipelines);
    if (reason) return { kind: "unresolved", reason };
  }
  scan.segments.push(scan.current);
  return {
    kind: "segments",
    segments: scan.segments,
    background: scan.background,
  };
}

/** Include top-level pipeline stages while keeping nested and escaped pipes inside their command. */
export function splitPolicyTopLevelPipelineStages(
  input: string,
  host = "",
): PolicySegmentSplit {
  return splitPolicyCommandSegments(input, host, true);
}

function collectPrintedPipelineBlocks(
  stages: readonly string[],
  host: string,
): PolicyNativeCommands {
  const commands: string[] = [];
  // The pipeline walker owns ordinary stages; only output blocks passed onward need this extra inspection.
  for (const stage of stages.slice(0, -1)) {
    if (!printedBlockCommand.test(asciiLowerCase(stage))) continue;
    const bodies = findPolicyNativeScriptBlockBodies(stage, false, host);
    if (bodies.kind === "unresolved") return bodies;
    if (bodies.kind === "commands") commands.push(...bodies.commands);
  }
  return commands.length > 0
    ? { kind: "commands", commands }
    : { kind: "absent" };
}

/** Collect executable PowerShell blocks, including printed blocks passed to a later pipeline stage. */
export function findPolicyNativeScriptBlockCommands(
  input: string,
  host: string,
): PolicyNativeCommands {
  if (!powerShellHost.test(host) || !input.includes("{"))
    return { kind: "absent" };
  const split = splitPolicyTopLevelPipelineStages(input, host);
  if (split.kind === "unresolved") return { kind: "unresolved" };
  if (split.segments.length !== 1)
    return collectPrintedPipelineBlocks(split.segments, host);
  const bodies = findPolicyNativeScriptBlockBodies(input, true, host);
  return bodies.kind === "commands" && bodies.commands.length === 0
    ? { kind: "absent" }
    : bodies;
}

export interface PolicyGitDirectoryContext {
  directory: string;
  unknown: boolean;
  background: boolean;
  cdPath: string;
}

type DirectoryAction =
  | { kind: "unchanged" }
  | { kind: "unknown" }
  | { kind: "cd"; target: string; inlineCdPath: boolean };

function directoryCommandStart(words: readonly string[]): {
  index: number;
  inlineCdPath: boolean;
} {
  let index = 0;
  let inlineCdPath = false;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/u.test(words[index] ?? "")) {
    inlineCdPath ||= /^CDPATH=.+/su.test(words[index] ?? "");
    index++;
  }
  return { index, inlineCdPath };
}

function readDirectoryAction(segment: string): DirectoryAction {
  const words = splitPolicyShellWords(segment);
  const start = directoryCommandStart(words);
  let index = start.index;
  const inlineCdPath = start.inlineCdPath;
  const verb = words[index++];
  if (verb === "pushd" || verb === "popd") return { kind: "unknown" };
  if (verb !== "cd") return { kind: "unchanged" };
  while (["-L", "-P", "--"].includes(words[index] ?? "")) index++;
  const target = words[index] ?? "";
  if (
    words.length !== index + 1 ||
    target === "" ||
    /^(?:~|-?$)|[$\x60]/u.test(target)
  )
    return { kind: "unknown" };
  return { kind: "cd", target, inlineCdPath };
}

function literalDirectoryExists(directory: string): boolean {
  try {
    return statSync(directory).isDirectory();
  } catch {
    // Missing or inaccessible directories leave the later Git command's location uncertain.
    return false;
  }
}

/** Carry a literal cd into later segments; dynamic, backgrounded or unavailable destinations leave location unknown. */
export function trackPolicyGitShellDirectory(
  segment: string,
  context: PolicyGitDirectoryContext,
): PolicyGitDirectoryContext {
  if (!/(?:cd|pushd|popd)/u.test(segment)) return context;
  const action = readDirectoryAction(segment);
  if (action.kind === "unchanged") return context;
  if (action.kind === "unknown" || context.background)
    return { ...context, unknown: true };
  let directory = action.target;
  if (!directory.startsWith("/")) {
    if (context.unknown || action.inlineCdPath || context.cdPath !== "")
      return { ...context, unknown: true };
    directory = context.directory + "/" + directory;
  }
  return literalDirectoryExists(directory)
    ? { ...context, directory, unknown: false }
    : { ...context, unknown: true };
}

function exportedConfigName(word: string, append: boolean): string | null {
  if (/^[-+]/u.test(word)) return null;
  const match = append
    ? /^([A-Za-z_][A-Za-z0-9_]*)(?:\+?=|$)/u.exec(word)
    : /^([A-Za-z_][A-Za-z0-9_]*)(?:=|$)/u.exec(word);
  const name = match?.[1] ?? "";
  return isGitConfigSourceVariable(name) ? name : null;
}

function declarationChangesGitConfig(words: readonly string[]): boolean {
  const exports = words.some(
    (word) => word.startsWith("-") && word.includes("x"),
  );
  return words.some((word) => {
    const name = exportedConfigName(word, true);
    return (
      name !== null && (exports || isGitConfigSourceAmbientlyExported(name))
    );
  });
}

function builtinChangesGitConfig(
  verb: string,
  words: readonly string[],
): boolean {
  switch (verb) {
    case "export":
      return words.some((word) => exportedConfigName(word, false) !== null);
    case "read":
    case "mapfile":
    case "readarray":
      return words.some((word) => isGitConfigSourceVariable(word));
    case "printf":
      return words.some(
        (word, index) =>
          (word.startsWith("-v") && isGitConfigSourceVariable(word.slice(2))) ||
          (words[index - 1] === "-v" && isGitConfigSourceVariable(word)),
      );
    case "for":
      return isGitConfigSourceAmbientlyExported(words[0] ?? "");
    default:
      return (
        ["declare", "typeset", "readonly", "local"].includes(verb) &&
        declarationChangesGitConfig(words)
      );
  }
}

function configCommandStart(words: readonly string[]): {
  index: number;
  sourceAssignment: boolean;
} {
  let index = 0;
  let sourceAssignment = false;
  for (;;) {
    const match = /^([A-Za-z_][A-Za-z0-9_]*)\+?=/u.exec(words[index] ?? "");
    if (!match) break;
    sourceAssignment ||= isGitConfigSourceVariable(match[1] ?? "");
    index++;
  }
  return { index, sourceAssignment };
}

/** Remember persistent Git configuration-source assignments while leaving command-scoped assignments local. */
export function trackPolicyGitConfigEnvironment(
  segment: string,
  unresolved = false,
): boolean {
  if (unresolved) return true;
  while (/^(?:\(|\{(?:[ \t\r\n\v\f]|$))/u.test(segment))
    segment = segment.slice(1).replace(/^[ \t\r\n\v\f]+/u, "");
  if (!/(?:HOME|GIT_DIR|GIT_COMMON_DIR|GIT_CONFIG)/u.test(segment))
    return false;
  const words = splitPolicyShellWords(segment);
  const { index, sourceAssignment } = configCommandStart(words);
  const command = words[index] ?? "";
  if (sourceAssignment && command === "") return true;
  return builtinChangesGitConfig(
    command.slice(command.lastIndexOf("/") + 1),
    words.slice(index + 1),
  );
}
