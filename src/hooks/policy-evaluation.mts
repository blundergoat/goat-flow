/** Reach complete native policy decisions for both guards: request routing, segment preparation, rule dispatch and provider responses. */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import {
  checkGitHostedCommands,
  checkGitSegment,
  type GitCommandOptions,
} from "./deny-dangerous/git-command.mjs";
import { checkRepositorySegment } from "./deny-dangerous/github-command.mjs";
import { checkSecretSegment } from "./deny-dangerous/patterns-paths.mjs";
import {
  checkCommandChainPolicy,
  checkDestructiveSegment,
  findHasDestructiveAction,
} from "./deny-dangerous/patterns-shell.mjs";
import {
  checkGitCommandEnvironment,
  isGitConfigEnvironmentUnresolved,
} from "./policy-git.mjs";
import {
  largeQualitySaveHeredocIsBoundedData,
  maskSafeQuotedHeredocBodies,
} from "./policy-heredoc.mjs";
import {
  asciiLowerCase,
  detectPolicyOutputMode,
  extractPolicyCommandText,
  extractPolicyToolName,
  isPolicySecretFileTool,
  isPolicyShellTool,
  parsePolicyPayload,
  policyCommandSizeRefusal,
  policySegmentCountRefusal,
  readPolicyPayload,
  type PolicyDenial,
  type PolicyOutputMode,
} from "./policy-input.mjs";
import {
  findPolicyNativeLaunchedCommands,
  findPolicyNativeScriptBlockCommands,
  policyUnresolvedSplitRefusal,
  splitPolicyCommandSegments,
  splitPolicyTopLevelPipelineStages,
  trackPolicyGitConfigEnvironment,
  trackPolicyGitShellDirectory,
  type PolicySegmentContext,
} from "./policy-segments.mjs";
import {
  checkPolicyCommandSubstitutions,
  type PolicySegmentEvaluator,
} from "./policy-substitutions.mjs";
import {
  countPolicySubstitutionOpeners,
  findPolicyNativeConditionalCommands,
  findPolicyNativeShellCommand,
  findUnmatchedPolicyClosingParen,
  normalizePolicyCommandCandidate,
  stripPolicySubshellParentheses,
  stripUnquotedPolicyShellComments,
} from "./policy-syntax.mjs";
import {
  dropFirstPolicyShellWord,
  joinPolicyShellWords,
  splitPolicyShellWords,
  stripPolicyXargsPayload,
} from "./policy-words.mjs";

export type PolicyGuard = "deny-dangerous" | "deny-git-mutations";

/** Fixed facts for one hook run: the deciding guard, Git's starting directory, the shared deadline and the environment. */
export interface PolicyRun {
  guard: PolicyGuard;
  directory: string;
  deadlineAt: number;
  homeDirectory?: string;
  environment?: NodeJS.ProcessEnv;
}

/** Shell facts the reference keeps in dynamic scope; every nested check receives a copy, so its changes never leak back. */
interface EvaluationState {
  directory: string;
  directoryUnknown: boolean;
  hostedDirectoryUnknown: boolean;
  configEnvUnresolved: boolean;
  inlineCommandHost: string;
  activeScope: string;
}

const leadingSpace = /^[ \t\n\v\f\r]+/u;
const trailingSpace = /[ \t\n\v\f\r]+$/u;
const syntaxRefusal =
  "Cannot inspect command syntax; use a literal executable and supported wrapper options.";
const posixShells = new Set(["sh", "bash", "dash", "ash", "ksh", "zsh"]);
const nativeShells = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
  "wsl",
  "wsl.exe",
]);
const slashPathHosts = new Set([
  "cmd",
  "cmd.exe",
  "powershell",
  "powershell.exe",
  "pwsh",
  "pwsh.exe",
]);
const redirection = /(?:^|[^=])[0-9]*>(?:>|\||[ \t\n\v\f\r]|[^ \t\n\v\f\r|=])/u;

/** Build the options every Git rule shares from the current shell facts. */
function gitOptions(run: PolicyRun, state: EvaluationState): GitCommandOptions {
  return {
    directory: state.directory,
    deadlineAt: run.deadlineAt,
    directoryUnknown: state.directoryUnknown,
    hostedDirectoryUnknown: state.hostedDirectoryUnknown,
    ...(run.homeDirectory === undefined
      ? {}
      : { homeDirectory: run.homeDirectory }),
    ...(run.environment === undefined ? {} : { environment: run.environment }),
  };
}

/** Evaluate nested commands with the complete policy, labelling refusals raised before their own segments with `activeScope`. */
function nestedEvaluator(
  run: PolicyRun,
  state: EvaluationState,
  activeScope: string,
): PolicySegmentEvaluator {
  return (command, depth) =>
    checkPolicyCommandSegments(command, depth, run, { ...state, activeScope });
}

/** Read the stripped segment's derived facts: normalized verb, unquoted operators, lowercase text, redirects and pipes. */
function segmentFacts(
  policy: string,
  normalized: string,
  depth: number,
  host: string,
): PolicySegmentContext {
  const word = normalized.split(/[ \t\n\v\f\r]/u, 1)[0] ?? "";
  const unquoted = /['"]/u.test(policy)
    ? policy
        .replace(/'[^'\n]*'/gu, "")
        .replace(/"[^"\n]*"/gu, "")
        .replace(/\n+$/u, "")
    : policy;
  return {
    trimmed: policy.replace(leadingSpace, ""),
    normalized,
    verb: word.slice(word.lastIndexOf("/") + 1),
    unquoted,
    lower: asciiLowerCase(policy),
    hasRedirect: redirection.test(unquoted),
    hasPipe: unquoted.replaceAll("||", "").includes("|"),
    depth,
    inlineCommandHost: host,
  };
}

/** Each real pipeline stage runs on its own, so each gets the complete policy before the combined segment is judged. */
async function checkPipelineStages(
  policy: string,
  context: PolicySegmentContext,
  evaluate: PolicySegmentEvaluator,
): Promise<PolicyDenial | null> {
  if (!context.hasPipe) return null;
  const split = splitPolicyTopLevelPipelineStages(
    policy,
    context.inlineCommandHost,
  );
  if (split.kind === "unresolved" || split.segments.length < 2) return null;
  for (const stage of split.segments) {
    const denial = await evaluate(stage, context.depth + 1);
    if (denial !== null) return denial;
  }
  return null;
}

type InlineBody =
  { kind: "body"; body: string } | { kind: "refused"; reason: string };

/** Read the `-c` operand; the word parser keeps an ANSI-C quote marker, and escape decoding needs ordinary quoting the hook can read. */
function rawCommandString(
  source: string,
  words: readonly string[],
  index: number,
): InlineBody {
  const body = words[index + 1] ?? "";
  let raw = source;
  for (let dropped = 0; dropped <= index; dropped++)
    raw = dropFirstPolicyShellWord(raw);
  if (!raw.startsWith("$'")) return { kind: "body", body };
  const decoded = body.replace(/^\$/u, "");
  return decoded.includes("\\")
    ? {
        kind: "refused",
        reason:
          "Cannot inspect ANSI-C escapes in shell code; use ordinary shell quoting.",
      }
    : { kind: "body", body: decoded };
}

/** Decode a POSIX shell's `-c` string, forwarding `exec "$@"` argv and refusing bodies whose commands come from positional parameters. */
function commandStringBody(
  source: string,
  words: readonly string[],
  index: number,
): InlineBody {
  const read = rawCommandString(source, words, index);
  if (read.kind === "refused") return read;
  const { body } = read;
  const candidate = (normalizePolicyCommandCandidate(body) ?? "").replace(
    /\n+$/u,
    "",
  );
  const innerWords = splitPolicyShellWords(candidate);
  if (
    innerWords.length === 1 &&
    (innerWords[0] === "$@" || innerWords[0] === "${@}")
  )
    return {
      kind: "body",
      body:
        index + 3 < words.length
          ? joinPolicyShellWords(words.slice(index + 3), 0, "argv") + " "
          : "",
    };
  if (
    /\$\{?[@*0-9]/u.test(body) &&
    (!/^(?:echo|printf)[ \t\n\v\f\r]/u.test(candidate) || /[;|&\n]/u.test(body))
  )
    return {
      kind: "refused",
      reason:
        "Cannot inspect executable shell positional expansion; invoke the command directly.",
    };
  return { kind: "body", body };
}

/** Find a POSIX shell's `-c` body, skipping its options and `-o`/`+o` values; no command string means no body. */
function posixShellBody(source: string): InlineBody {
  const words = splitPolicyShellWords(source);
  for (let index = 1; index < words.length; index++) {
    const word = words[index] ?? "";
    if (word === "-o" || word === "+o") index++;
    else if (word === "-c" || /^-[a-zA-Z].*c/su.test(word))
      return commandStringBody(source, words, index);
    else if (!word.startsWith("-")) break;
  }
  return { kind: "body", body: "" };
}

/** Read the body an inline shell runs; a Windows host's body must be literal and readable. */
function inlineShellBody(verb: string, source: string): InlineBody {
  if (posixShells.has(verb)) return posixShellBody(source);
  if (!nativeShells.has(asciiLowerCase(verb)))
    return { kind: "body", body: "" };
  const payload = findPolicyNativeShellCommand(source);
  if (payload.kind === "unresolved")
    return {
      kind: "refused",
      reason:
        "Cannot inspect this native shell command. Use a literal command with supported host options through Bash.",
    };
  return {
    kind: "body",
    body: payload.kind === "command" ? payload.command : "",
  };
}

/** An inline shell body runs inside the outer action, so it gets the complete policy under that shell's grammar. */
async function checkInlineShellBody(
  context: PolicySegmentContext,
  run: PolicyRun,
  state: EvaluationState,
  scope: string,
): Promise<PolicyDenial | null> {
  let source = context.normalized;
  // xargs keeps its prefix for stdin-target checks, but a shell it launches still runs a body.
  if (context.verb === "xargs") {
    const payload = stripPolicyXargsPayload(context.normalized);
    if (payload.kind === "command")
      source = payload.command.replace(/\n+$/u, "");
  }
  const word = (source.split(/[ \t\n\v\f\r]/u, 1)[0] ?? "").replaceAll(
    "\\",
    "/",
  );
  const verb = word.slice(word.lastIndexOf("/") + 1);
  const inline = inlineShellBody(verb, source);
  if (inline.kind === "refused") return { scope, reason: inline.reason };
  if (inline.body === "") return null;
  const host = asciiLowerCase(verb);
  // cmd and PowerShell read a backslash as a path separator, so their body is checked with forward slashes.
  const body = slashPathHosts.has(host)
    ? inline.body.replaceAll("\\", "/")
    : inline.body;
  return checkPolicyCommandSegments(body, context.depth + 1, run, {
    ...state,
    inlineCommandHost: host,
    activeScope: scope,
  });
}

type PreparedSegment =
  | { kind: "context"; context: PolicySegmentContext }
  | { kind: "denied"; denial: PolicyDenial };

/**
 * Prepare one segment as the reference does: strip comments and subshell parentheses, inspect substitutions, normalize wrappers,
 * derive operator facts, then check every pipeline stage and inline shell body with the complete policy.
 */
async function preparePolicySegment(
  segment: string,
  depth: number,
  run: PolicyRun,
  state: EvaluationState,
  scope: string,
): Promise<PreparedSegment> {
  let policy = segment.includes("#")
    ? stripUnquotedPolicyShellComments(segment)
    : segment.replace(trailingSpace, "");
  if (/[()]/u.test(policy)) policy = stripPolicySubshellParentheses(policy);
  const evaluate = nestedEvaluator(run, state, scope);
  const substitution = await checkPolicyCommandSubstitutions(
    policy,
    depth,
    scope,
    evaluate,
  );
  if (substitution !== null) return { kind: "denied", denial: substitution };
  const normalized = normalizePolicyCommandCandidate(
    policy.replace(leadingSpace, ""),
  )?.replace(/\n+$/u, "");
  if (normalized === undefined)
    return { kind: "denied", denial: { scope, reason: syntaxRefusal } };
  const context = segmentFacts(
    policy,
    normalized,
    depth,
    state.inlineCommandHost,
  );
  const denial =
    (await checkPipelineStages(policy, context, evaluate)) ??
    (await checkInlineShellBody(context, run, state, scope));
  return denial === null
    ? { kind: "context", context }
    : { kind: "denied", denial };
}

/** deny-dangerous applies the destructive-shell rules, then the secret-file rules. */
async function checkDangerousRules(
  context: PolicySegmentContext,
  run: PolicyRun,
  state: EvaluationState,
): Promise<PolicyDenial | null> {
  return (
    (await checkDestructiveSegment(
      context,
      nestedEvaluator(run, state, "destructive"),
    )) ?? (await checkSecretSegment(context, gitOptions(run, state)))
  );
}

/** deny-git-mutations evaluates find payloads under repository policy, then Git and GitHub writes. */
async function checkRepositoryRules(
  context: PolicySegmentContext,
  run: PolicyRun,
  state: EvaluationState,
): Promise<PolicyDenial | null> {
  // The find walker checks executable payloads; its deletion verdict belongs to the sibling shell policy.
  const find = await findHasDestructiveAction(
    context.normalized,
    context.depth,
    nestedEvaluator(run, state, "repository"),
  );
  if (find.kind === "denied") return find.denial;
  const reason =
    (await checkGitSegment(
      context.trimmed,
      gitOptions(run, state),
      context,
      context.inlineCommandHost,
    )) ??
    checkRepositorySegment(context.trimmed, context, context.inlineCommandHost);
  return reason === null ? null : { scope: "repository", reason };
}

/** Commands Git hosts and Git environment values run too, so each gets the complete policy with Git's directory facts. */
async function checkGitHostedRules(
  context: PolicySegmentContext,
  run: PolicyRun,
  state: EvaluationState,
  scope: string,
): Promise<PolicyDenial | null> {
  // Hosted and environment checks run after the secret rules in the reference, so their nested refusals carry that scope.
  const laterScope =
    run.guard === "deny-git-mutations" ? "repository" : "secret";
  if (context.verb === "git" || context.verb.startsWith("git-")) {
    const hosted = await checkGitHostedCommands(
      context.normalized,
      context.depth,
      scope,
      gitOptions(run, state),
      (command, depth, directory) =>
        checkPolicyCommandSegments(command, depth, run, {
          ...state,
          directory: directory.directory,
          directoryUnknown: directory.directoryUnknown,
          hostedDirectoryUnknown: directory.hostedDirectoryUnknown,
          activeScope: laterScope,
        }),
    );
    if (hosted !== null) return hosted;
  }
  return checkGitCommandEnvironment(
    context.trimmed,
    context.verb,
    context.depth,
    nestedEvaluator(run, state, laterScope),
  );
}

/** Judge one segment with the selected guard's rules; the first denial ends inspection. */
async function checkPolicySegment(
  segment: string,
  depth: number,
  run: PolicyRun,
  state: EvaluationState,
): Promise<PolicyDenial | null> {
  const scope =
    run.guard === "deny-git-mutations" ? "repository" : "destructive";
  const prepared = await preparePolicySegment(
    segment,
    depth,
    run,
    state,
    scope,
  );
  if (prepared.kind === "denied") return prepared.denial;
  const { context } = prepared;
  if (
    isGitConfigEnvironmentUnresolved(
      context.trimmed,
      context.verb,
      state.configEnvUnresolved,
    )
  )
    return {
      scope,
      reason:
        "Visible Git configuration environment can change aliases or executable commands without hook inspection; use literal git -c values or ask the user to run it manually.",
    };
  const rules =
    run.guard === "deny-git-mutations"
      ? await checkRepositoryRules(context, run, state)
      : await checkDangerousRules(context, run, state);
  return rules ?? (await checkGitHostedRules(context, run, state, scope));
}

type NativeFormStep =
  | { kind: "denied"; denial: PolicyDenial }
  | { kind: "handled" }
  | { kind: "continue" };

const nativeForms = [
  {
    find: findPolicyNativeLaunchedCommands,
    depthReason:
      "Native command prefixes exceed inspection depth. Use separate literal commands through Bash.",
    unresolvedReason:
      "Cannot inspect this native command form. Use separate literal commands through Bash.",
    replacesSegment: true,
  },
  {
    find: findPolicyNativeConditionalCommands,
    depthReason:
      "Native conditional nesting exceeds inspection depth. Use separate literal commands through Bash.",
    unresolvedReason:
      "Cannot inspect this native conditional. Use separate literal commands through Bash.",
    replacesSegment: true,
  },
  {
    find: findPolicyNativeScriptBlockCommands,
    depthReason:
      "PowerShell script-block nesting exceeds inspection depth. Use separate literal commands through Bash.",
    unresolvedReason:
      "Cannot inspect this PowerShell script block. Use separate literal commands through Bash.",
    replacesSegment: false,
  },
];

/** Windows launch prefixes, conditionals and script blocks run other commands, each of which gets the complete policy. */
async function checkNativeSegmentForms(
  segment: string,
  depth: number,
  run: PolicyRun,
  state: EvaluationState,
): Promise<NativeFormStep> {
  const deny = (reason: string): NativeFormStep => ({
    kind: "denied",
    denial: { scope: state.activeScope, reason },
  });
  for (const form of nativeForms) {
    const found = form.find(segment, state.inlineCommandHost);
    if (found.kind === "unresolved") return deny(form.unresolvedReason);
    if (found.kind !== "commands") continue;
    // Bound nested native forms so a long chain such as `call call call ...` cannot stall the agent session.
    if (depth >= 16) return deny(form.depthReason);
    for (const command of found.commands) {
      const denial = await checkPolicyCommandSegments(
        command,
        depth + 1,
        run,
        state,
      );
      if (denial !== null) return { kind: "denied", denial };
    }
    if (form.replacesSegment) return { kind: "handled" };
  }
  return { kind: "continue" };
}

interface SubshellSnapshot {
  directory: string;
  directoryUnknown: boolean;
  configEnvUnresolved: boolean;
}

/** Replace the byte at `offset` with a space, matching the reference's C-locale string slicing. */
function blankByte(text: string, offset: number): string {
  const bytes = Buffer.from(text, "utf8");
  return (
    bytes.subarray(0, offset).toString("utf8") +
    " " +
    bytes.subarray(offset + 1).toString("utf8")
  );
}

/** Restore the shell facts each closing parenthesis ends; a subshell cannot persist directory or config-source changes. */
function closeSubshells(
  closing: string,
  stack: SubshellSnapshot[],
  state: EvaluationState,
): void {
  let text = closing;
  for (;;) {
    const offset = findUnmatchedPolicyClosingParen(text);
    if (offset < 0) return;
    const saved = stack.pop();
    if (saved !== undefined) Object.assign(state, saved);
    text = blankByte(text, offset);
  }
}

/** Check one chained segment, then carry its literal cd and config-source changes into the later segments of the same shell. */
async function checkChainedSegment(
  segment: string,
  depth: number,
  run: PolicyRun,
  state: EvaluationState,
  chain: { background: boolean; stack: SubshellSnapshot[] },
): Promise<PolicyDenial | null> {
  let directorySegment = segment;
  while (directorySegment.startsWith("(")) {
    chain.stack.push({
      directory: state.directory,
      directoryUnknown: state.directoryUnknown,
      configEnvUnresolved: state.configEnvUnresolved,
    });
    directorySegment = directorySegment.slice(1).replace(leadingSpace, "");
  }
  const closing = directorySegment;
  if (directorySegment.includes(")"))
    directorySegment = stripPolicySubshellParentheses(segment);
  const denial = await checkPolicySegment(segment, depth, run, state);
  if (denial !== null) return denial;
  const tracked = trackPolicyGitShellDirectory(directorySegment, {
    directory: state.directory,
    unknown: state.directoryUnknown,
    background: chain.background,
    cdPath: run.environment?.CDPATH ?? "",
  });
  state.directory = tracked.directory;
  state.directoryUnknown = tracked.unknown;
  state.configEnvUnresolved = trackPolicyGitConfigEnvironment(
    directorySegment,
    state.configEnvUnresolved,
  );
  if (closing.includes(")")) closeSubshells(closing, chain.stack, state);
  return null;
}

/** Split a chain into its segments after the chain-level checks: download-then-execute, unreadable native groups and the nested segment cap. */
function splitInspectedChain(
  input: string,
  depth: number,
  run: PolicyRun,
  state: EvaluationState,
): { segments: string[]; background: boolean } | PolicyDenial {
  const deny = (reason: string): PolicyDenial => ({
    scope: state.activeScope,
    reason,
  });
  // Only the destructive-shell policy owns download-then-execute chains.
  const chain =
    run.guard === "deny-dangerous"
      ? checkCommandChainPolicy(input, depth)
      : null;
  if (chain !== null) return deny(chain);
  const split = splitPolicyCommandSegments(input, state.inlineCommandHost);
  if (split.kind === "unresolved")
    return deny(policyUnresolvedSplitRefusal(split.reason));
  // The request-level cap covers depth zero; nested chains get the same bound here.
  const cap =
    depth > 0 ? policySegmentCountRefusal(split.segments.length) : null;
  return cap === null ? split : deny(cap);
}

/**
 * Give every executable segment of a command its complete verdict, e.g. both sides of `cd docs && git push`, in order and with
 * the shell facts earlier segments leave behind. Nested evaluations receive copies of those facts.
 *
 * @param input - the command text to inspect
 * @param depth - the nesting depth; the provider's own command is depth zero
 * @param run - the guard, starting directory, deadline and environment for this hook run
 * @param inherited - shell facts from the enclosing evaluation
 * @returns the first denial, or null when every segment is allowed
 */
async function checkPolicyCommandSegments(
  input: string,
  depth: number,
  run: PolicyRun,
  inherited: EvaluationState,
): Promise<PolicyDenial | null> {
  const state = { ...inherited };
  const split = splitInspectedChain(input, depth, run, state);
  if ("reason" in split) return split;
  const chainState: { background: boolean; stack: SubshellSnapshot[] } = {
    background: split.background,
    stack: [],
  };
  for (const raw of split.segments) {
    const segment = raw.replace(leadingSpace, "").replace(trailingSpace, "");
    if (segment === "") continue;
    const native = await checkNativeSegmentForms(segment, depth, run, state);
    if (native.kind === "denied") return native.denial;
    if (native.kind === "handled") continue;
    const denial = await checkChainedSegment(
      segment,
      depth,
      run,
      state,
      chainState,
    );
    if (denial !== null) return denial;
  }
  return null;
}

/** A provider response: stdout and stderr bytes plus the process exit status. */
export interface PolicyResponse {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Render a verdict through the provider's channel: Copilot and Antigravity read JSON on stdout with exit 0, everyone else reads
 * `BLOCKED: Policy <scope>: <reason>` on stderr with exit 2. An allowed Antigravity request still needs an explicit allow envelope.
 *
 * @param mode - the provider response channel
 * @param denial - the verdict to deliver, or null to allow
 * @returns the bytes and exit status to emit
 */
export function renderPolicyResponse(
  mode: PolicyOutputMode,
  denial: PolicyDenial | null,
): PolicyResponse {
  if (denial === null)
    return {
      stdout: mode === "antigravity-json" ? '{"decision":"allow"}\n' : "",
      stderr: "",
      exitCode: 0,
    };
  const reason = `Policy ${denial.scope}: ${denial.reason}`;
  if (mode === "copilot-json")
    return {
      stdout: `${JSON.stringify({ permissionDecision: "deny", permissionDecisionReason: reason })}\n`,
      stderr: "",
      exitCode: 0,
    };
  if (mode === "antigravity-json")
    return {
      stdout: `${JSON.stringify({ decision: "deny", reason })}\n`,
      stderr: "",
      exitCode: 0,
    };
  return { stdout: "", stderr: `BLOCKED: ${reason}\n`, exitCode: 2 };
}

interface PolicyArguments {
  selfTest: string;
  check: string;
  source: "" | "check-flag" | "positional";
  root: string;
}

/** Store a `--check` or `--root` value; the launcher's `--root` selects the project, never check text. */
function storePolicyValue(
  parsed: PolicyArguments,
  option: string,
  value: string,
): void {
  if (option === "root") parsed.root = value;
  else {
    parsed.check = value;
    parsed.source = "check-flag";
  }
}

/** Read one known option at `index`; returns how many argv entries it used, or 0 for an operand. */
function readPolicyOption(
  parsed: PolicyArguments,
  argv: readonly string[],
  index: number,
): number {
  const argument = argv[index] ?? "";
  if (argument === "--self-test") {
    parsed.selfTest = "full";
    return 1;
  }
  if (argument.startsWith("--self-test=")) {
    parsed.selfTest = argument.slice("--self-test=".length);
    return 1;
  }
  if (argument === "--check" || argument === "--root") {
    storePolicyValue(parsed, argument.slice(2), argv[index + 1] ?? "");
    return 2;
  }
  const attached = /^--(check|root)=([^]*)$/u.exec(argument);
  if (attached === null) return 0;
  storePolicyValue(parsed, attached[1] ?? "", attached[2] ?? "");
  return 1;
}

/** Read check, root and self-test options; only the first operand supplies check text. */
function readPolicyArguments(argv: readonly string[]): PolicyArguments {
  const parsed: PolicyArguments = {
    selfTest: "",
    check: "",
    source: "",
    root: "",
  };
  for (let index = 0; index < argv.length;) {
    const used = readPolicyOption(parsed, argv, index);
    if (used === 0 && parsed.check === "") {
      parsed.check = argv[index] ?? "";
      parsed.source = "positional";
    }
    index += Math.max(used, 1);
  }
  return parsed;
}

/** What the entrypoint supplies: argv after the script name, stdin bytes on demand, and whether stdin is a terminal. */
export interface PolicyHookInput {
  argv: readonly string[];
  readStdin: () => Uint8Array;
  stdinIsTerminal: boolean;
}

/** A self-test request runs the policy corpus instead of inspecting a provider payload. */
export type PolicyHookOutcome =
  { kind: "self-test"; mode: string } | ({ kind: "response" } & PolicyResponse);

interface RequestState {
  mode: PolicyOutputMode;
  tool: string;
  command: string;
  structured: boolean;
}

/** Decode the request; a refusal names the guard because no segment has been inspected yet. */
function readPolicyRequest(
  args: PolicyArguments,
  input: PolicyHookInput,
): { request: RequestState } | { mode: PolicyOutputMode; reason: string } {
  let stdin: Uint8Array | null = null;
  const readStdin = (): Uint8Array => (stdin ??= input.readStdin());
  if (args.source === "positional" && !input.stdinIsTerminal) {
    const competing = Buffer.from(readStdin()).toString("latin1");
    if (competing.replace(leadingSpace, "") !== "")
      return {
        mode: detectPolicyOutputMode(competing),
        reason:
          "Hook received both positional command and stdin payload. Submit exactly one command source.",
      };
  }
  let payload: string;
  try {
    payload = readPolicyPayload(
      args.check,
      args.check ? new Uint8Array() : readStdin(),
    );
  } catch {
    // Undecodable bytes expose no command the policy could trust.
    const raw = Buffer.from(readStdin()).toString("latin1");
    return {
      mode: detectPolicyOutputMode(raw),
      reason: "Hook payload did not expose a bash command to evaluate",
    };
  }
  const structured =
    args.check === "" && payload.replace(leadingSpace, "").startsWith("{");
  if (!structured)
    return {
      request: { mode: "stderr-exit", tool: "", command: payload, structured },
    };
  const mode = detectPolicyOutputMode(payload);
  try {
    const parsed = parsePolicyPayload(payload);
    return {
      request: {
        mode,
        tool: extractPolicyToolName(parsed),
        command: extractPolicyCommandText(parsed),
        structured,
      },
    };
  } catch {
    return {
      mode,
      reason: "Hook payload did not expose a bash command to evaluate",
    };
  }
}

/** Decide whether this guard owns the request: unknown and shell tools always, file tools only for deny-dangerous. */
function ownsPolicyRequest(run: PolicyRun, request: RequestState): boolean {
  return (
    request.tool === "" ||
    isPolicyShellTool(request.tool) ||
    (run.guard === "deny-dangerous" && isPolicySecretFileTool(request.tool))
  );
}

/** Mask inert heredoc data, then apply the request-level size, segment and substitution bounds before segment inspection. */
async function evaluatePolicyCommand(
  run: PolicyRun,
  command: string,
): Promise<PolicyDenial | null> {
  const guardDenial = (reason: string): PolicyDenial => ({
    scope: run.guard,
    reason,
  });
  const policy =
    command.includes("<<") || command.includes("\n")
      ? maskSafeQuotedHeredocBodies(command).replace(/\n+$/u, "")
      : command;
  const size = policyCommandSizeRefusal(
    command,
    policy,
    largeQualitySaveHeredocIsBoundedData(policy),
  );
  if (size !== null) return guardDenial(size);
  const split = splitPolicyCommandSegments(policy);
  const cap = policySegmentCountRefusal(
    split.kind === "segments" ? split.segments.length : 0,
  );
  if (cap !== null) return guardDenial(cap);
  if (
    /\$\(|<\(|>\(/u.test(policy) &&
    countPolicySubstitutionOpeners(policy) > 32
  )
    return guardDenial(
      "Command has too many command substitutions; review and run manually if intended.",
    );
  try {
    return await checkPolicyCommandSegments(policy, 0, run, {
      directory: run.directory,
      directoryUnknown: false,
      hostedDirectoryUnknown: false,
      configEnvUnresolved: false,
      inlineCommandHost: "",
      activeScope: run.guard,
    });
  } catch {
    // An evaluation fault leaves no trustworthy decision, so the request is refused rather than allowed.
    return guardDenial(
      `Policy hook unavailable: ${run.guard}.mjs could not evaluate the command. Re-run goat-flow setup.`,
    );
  }
}

/**
 * Run one policy hook request end to end, e.g. a Claude `Bash` payload or `--check='git push'`, and return the provider response.
 * Non-shell tools this guard does not own are allowed unchanged; empty or undecodable requests from policy-relevant tools are refused.
 *
 * @param run - the guard, starting directory, deadline and environment
 * @param input - argv, stdin bytes on demand and whether stdin is a terminal
 * @returns the response to emit, or a self-test request for the entrypoint to run
 */
export async function runPolicyHook(
  run: PolicyRun,
  input: PolicyHookInput,
): Promise<PolicyHookOutcome> {
  const args = readPolicyArguments(input.argv);
  if (args.selfTest !== "") return { kind: "self-test", mode: args.selfTest };
  const read = readPolicyRequest(args, input);
  if ("reason" in read)
    return {
      kind: "response",
      ...renderPolicyResponse(read.mode, {
        scope: run.guard,
        reason: read.reason,
      }),
    };
  const { request } = read;
  const respond = (denial: PolicyDenial | null): PolicyHookOutcome => ({
    kind: "response",
    ...renderPolicyResponse(request.mode, denial),
  });
  if (request.structured && request.tool !== "") {
    if (asciiLowerCase(request.tool) === "powershell")
      return respond({
        scope: run.guard,
        reason:
          "Native PowerShell tool commands are not supported by this policy. Use a supported shell tool instead.",
      });
    if (!ownsPolicyRequest(run, request)) return respond(null);
  }
  if (request.command === "")
    return respond(
      request.structured && ownsPolicyRequest(run, request)
        ? {
            scope: run.guard,
            reason: "Hook payload did not expose a bash command to evaluate",
          }
        : null,
    );
  return respond(await evaluatePolicyCommand(run, request.command));
}

/** Finish before the launcher's kill deadline: its configured timeout or the 25-second policy ceiling, less two seconds to reply. */
function policyDeadlineAt(environment: NodeJS.ProcessEnv): number {
  const configured = Number(environment.GOAT_FLOW_HOOK_LAUNCH_TIMEOUT_MS);
  const ceiling =
    Number.isInteger(configured) && configured > 0
      ? Math.min(configured, 25_000)
      : 25_000;
  return Date.now() + Math.max(ceiling - 2_000, 1_000);
}

/**
 * Decide this process's request for one guard: argv after the script, stdin unless it is a terminal, and the launcher's `--root` (else the working directory) as
 * Git's starting point. The launcher has already applied the saved policy choice, so a disabled guard never reaches this code.
 *
 * @param guard - the policy this entrypoint decides
 * @param runSelfTest - runs the policy corpus for `--self-test`; injected so the corpus runner can call back into this module
 * @returns the exit status after the response is written, or the self-test's status
 */
export async function runPolicyEntrypoint(
  guard: PolicyGuard,
  runSelfTest: (guard: PolicyGuard, mode: string) => Promise<number>,
): Promise<number> {
  const argv = process.argv.slice(2);
  const outcome = await runPolicyHook(
    {
      guard,
      directory: readPolicyArguments(argv).root || process.cwd(),
      deadlineAt: policyDeadlineAt(process.env),
      homeDirectory: homedir(),
      environment: process.env,
    },
    {
      argv,
      readStdin: () => readFileSync(0),
      stdinIsTerminal: process.stdin.isTTY === true,
    },
  );
  if (outcome.kind === "self-test") return runSelfTest(guard, outcome.mode);
  process.stdout.write(outcome.stdout);
  process.stderr.write(outcome.stderr);
  return outcome.exitCode;
}
