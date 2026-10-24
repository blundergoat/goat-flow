/** Recognize protected credential operands without reading files or executing commands. */
import { asciiLowerCase, type PolicyDenial } from "../policy-input.mjs";
import {
  splitPolicyTopLevelPipelineStages,
  type PolicySegmentContext,
} from "../policy-segments.mjs";
import {
  normalizePolicyCommandCandidate,
  stripPolicyShellRedirections,
} from "../policy-syntax.mjs";
import {
  inspectGitCommand,
  normalizeGitPolicyCandidate,
  type GitCommandContext,
  type GitCommandOptions,
} from "./git-command.mjs";
import { ghSkipOptionsIndex } from "./github-command.mjs";
import {
  joinPolicyShellWords,
  splitPolicyShellWords,
  stripPolicyShellQuotesForPathScan,
} from "../policy-words.mjs";

interface WindowsPathWord {
  text: string;
  singleQuoted: boolean;
  doubleQuoted: boolean;
  escaped: boolean;
}

function consumesWindowsQuote(
  state: WindowsPathWord,
  character: string,
): boolean {
  if (!state.doubleQuoted && character === "'") {
    state.singleQuoted = !state.singleQuoted;
    return true;
  }
  if (!state.singleQuoted && character === '"') {
    state.doubleQuoted = !state.doubleQuoted;
    return true;
  }
  return false;
}

function consumesWindowsWordCharacter(
  state: WindowsPathWord,
  character: string,
): boolean {
  if (state.escaped) {
    state.text += character;
    state.escaped = false;
    return true;
  }
  if (!state.singleQuoted && character === "\\") {
    state.text += character;
    state.escaped = !state.doubleQuoted;
    return true;
  }
  if (consumesWindowsQuote(state, character)) return true;
  if (
    !state.singleQuoted &&
    !state.doubleQuoted &&
    /[ \t\r\n\v\f]/u.test(character)
  )
    return false;
  state.text += character;
  return true;
}

/** Add a slash-normalized view only for drive-rooted or UNC Windows operands. */
export function windowsPathScanView(input: string): string {
  const words: string[] = [];
  const state: WindowsPathWord = {
    text: "",
    singleQuoted: false,
    doubleQuoted: false,
    escaped: false,
  };
  for (const character of input) {
    if (consumesWindowsWordCharacter(state, character)) continue;
    if (state.text) words.push(state.text);
    state.text = "";
  }
  if (state.text) words.push(state.text);
  return words
    .filter((value) => {
      const candidate = value
        .slice(value.lastIndexOf("=") + 1)
        .replace(/^@/u, "")
        .replace(/^</u, "");
      return /^[A-Za-z]:\\/u.test(candidate) || candidate.startsWith("\\\\");
    })
    .map((value) => value.replace(/\\/gu, "/"))
    .join(" ");
}

const jqDataOptions = new Map([
  ["--arg", { offsets: [1, 2], width: 3 }],
  ["--argjson", { offsets: [1, 2], width: 3 }],
  ["--slurpfile", { offsets: [1], width: 3 }],
  ["--rawfile", { offsets: [1], width: 3 }],
  ["--argsfile", { offsets: [1], width: 3 }],
  ["--indent", { offsets: [1], width: 2 }],
]);

function jqShortOptionWidth(word: string): number | null {
  const bundle = word.slice(1);
  const optionIndex = bundle.search(/[fL]/u);
  const option = bundle[optionIndex];
  if (option === "f") return null;
  return option === "L" && optionIndex === bundle.length - 1 ? 2 : 1;
}

function isJqFilterFileOption(word: string): boolean {
  return (
    word === "-f" || word === "--from-file" || word.startsWith("--from-file=")
  );
}

function jqQueryData(words: readonly string[], start: number): Set<number> {
  const data = new Set<number>();
  for (let index = start; index < words.length;) {
    const word = words[index] ?? "";
    if (word === "--") {
      data.add(index + 1);
      break;
    }
    if (isJqFilterFileOption(word)) break;
    const dataOption = jqDataOptions.get(word);
    if (dataOption) {
      // File-valued options exempt their variable name, but keep their file protected.
      dataOption.offsets.forEach((offset) => data.add(index + offset));
      index += dataOption.width;
      continue;
    }
    if (word === "-L") {
      index += 2;
      continue;
    }
    if (/^-[^-]/u.test(word)) {
      const width = jqShortOptionWidth(word);
      if (width === null) break;
      index += width;
      continue;
    }
    if (!word.startsWith("-")) {
      data.add(index);
      break;
    }
    index++;
  }
  return data;
}

function queryDataIndices(
  words: readonly string[],
  commandVerb: string,
): Set<number> {
  if (commandVerb !== "jq" && commandVerb !== "yq") return new Set();
  const commandIndex = words.findIndex(
    (word) =>
      asciiLowerCase(word.slice(word.lastIndexOf("/") + 1)) === commandVerb,
  );
  if (commandIndex < 0) return new Set();
  if (commandVerb === "jq") return jqQueryData(words, commandIndex + 1);
  // yq may interpret a positional expression as a filename; only explicit expressions are data.
  for (let index = commandIndex + 1; index < words.length; index++) {
    if (words[index] === "--expression") {
      return new Set(index + 1 < words.length ? [index + 1] : []);
    }
    if (words[index]?.startsWith("--expression=")) return new Set([index]);
  }
  return new Set();
}

/** Recognize key-file extensions while excluding only proven jq/yq query data. */
export function keyMaterialPathTouch(input: string, commandVerb = ""): boolean {
  const words = splitPolicyShellWords(input);
  const data = queryDataIndices(words, commandVerb);
  return words.some((word, index) => {
    if (data.has(index)) return false;
    let candidate = word.slice(word.indexOf("=") + 1);
    candidate = candidate.slice(candidate.indexOf(":") + 1);
    const base = asciiLowerCase(
      candidate.slice(candidate.lastIndexOf("/") + 1),
    );
    // Bash ERE dot spans quoted newlines, which remain part of a single filename.
    return /^[^.].*\.(pem|key|pfx)$/su.test(base);
  });
}

function maskEnvExamples(input: string): string {
  return input
    .replace(
      /(^|[ \t\r\n\v\f=:/"'])\.env\.example([ \t\r\n\v\f]|$|["'])/gmu,
      "$1__goat_env_example__$2",
    )
    .replace(
      /(>>|>\||>)[ \t\r\n\v\f]*(["']?)\.env\.example([ \t\r\n\v\f]|$|["'])/gmu,
      "$1$2__goat_env_example__$3",
    );
}

const secretStorePatterns = [
  /(^|[ \t\r\n\v\f=:/"'])(\.ssh|\.aws|\.config\/gcloud|\.gnupg)(\/|[ \t\r\n\v\f]|$|["'])/u,
  /(^|[ \t\r\n\v\f=:/"'])(\.docker\/config\.json|\.kube\/config|\.netrc|\.git-credentials|\.config\/gh\/hosts\.yml|\.pgpass)([ \t\r\n\v\f]|$|["'])/u,
  /application_default_credentials\.json/u,
  /(^|[ \t\r\n\v\f=:/"'])(credentials\.json|\.npmrc|\.pypirc)([ \t\r\n\v\f]|$|\.|["'])/u,
];

/** Remove only proven query arguments before scanning credential paths; file-valued options remain inspectable. */
function pathInputWithoutQueryData(input: string, commandVerb: string): string {
  const words = splitPolicyShellWords(input);
  const data = queryDataIndices(words, commandVerb);
  return data.size === 0
    ? input
    : joinPolicyShellWords(
        words.filter((_, index) => !data.has(index)),
        0,
        "argv",
      );
}

/** Recognize credential stores and filenames outside proven query data; ordinary secrets routes and providers remain readable. */
export function isSecretPathTouch(input: string, commandVerb = ""): boolean {
  const paths = pathInputWithoutQueryData(input, commandVerb);
  let candidate = /['"\\<]/u.test(paths)
    ? stripPolicyShellQuotesForPathScan(paths).replace(/\n+$/u, "")
    : paths;
  const windows = paths.includes("\\") ? windowsPathScanView(paths) : "";
  if (windows) candidate += " " + windows;
  const envScan = candidate.includes(".env.example")
    ? maskEnvExamples(candidate)
    : candidate;
  return (
    /(^|[ \t\r\n\v\f=:/"'])\.env[A-Za-z0-9_.-]*([ \t\r\n\v\f]|$|["'])/u.test(
      envScan,
    ) ||
    /(>>|>\||>)[ \t\r\n\v\f]*["']?\.env[A-Za-z0-9_.-]*([ \t\r\n\v\f]|$|["'])/u.test(
      envScan,
    ) ||
    secretStorePatterns.some((pattern) => pattern.test(candidate)) ||
    keyMaterialPathTouch(input, commandVerb)
  );
}

/** Split curl form attributes or file lists, preserving delimiters inside double quotes. */
export function splitCurlFormParts(value: string, delimiter: string): string[] {
  const parts: string[] = [];
  let part = "";
  let quoted = false;
  let escaped = false;
  for (const character of value) {
    if (escaped) {
      part += character;
      escaped = false;
    } else if (quoted && character === "\\") {
      part += character;
      escaped = true;
    } else {
      if (character === '"') quoted = !quoted;
      if (!quoted && character === delimiter) {
        parts.push(part);
        part = "";
      } else part += character;
    }
  }
  parts.push(part);
  return parts;
}

/** Check upload files and headers=@file attributes, including headers on literal form fields. */
export function curlFormFilesTouchSecret(value: string): boolean {
  const parts = splitCurlFormParts(value.slice(value.indexOf("=") + 1), ";");
  const files = parts[0] ?? "";
  if (
    (files.startsWith("@") || files.startsWith("<")) &&
    splitCurlFormParts(files.slice(1), ",").some((file) =>
      isSecretPathTouch(file),
    )
  )
    return true;
  return parts.slice(1).some((part) => {
    const attribute = part.replace(/^[ \t\r\n\v\f]*/u, "");
    return (
      attribute.startsWith("headers=@") &&
      isSecretPathTouch(attribute.slice("headers=@".length))
    );
  });
}

/** Interpret one curl option value using that option's file-reference grammar. */
export function curlFileReferenceTouchesSecret(
  kind: string,
  value: string,
): boolean {
  let file: string;
  switch (kind) {
    case "data":
      if (!value.startsWith("@")) return false;
      file = value.slice(1);
      break;
    case "data-urlencode":
      if (!value.includes("@")) return false;
      file = value.slice(value.indexOf("@") + 1);
      break;
    case "form":
      return curlFormFilesTouchSecret(value);
    case "direct":
      file = value;
      break;
    default:
      return false;
  }
  return file !== "" && isSecretPathTouch(file);
}

const curlFileOptions = new Map([
  ["-d", "data"],
  ["--data", "data"],
  ["--data-ascii", "data"],
  ["--data-binary", "data"],
  ["--json", "data"],
  ["-H", "data"],
  ["--header", "data"],
  ["--proxy-header", "data"],
  ["--data-urlencode", "data-urlencode"],
  ["-F", "form"],
  ["--form", "form"],
  ["-T", "direct"],
  ["--upload-file", "direct"],
  ["-K", "direct"],
  ["--config", "direct"],
]);
const curlShortFileOptions = new Set(["-d", "-H", "-F", "-T", "-K"]);

interface CurlFileOption {
  kind: string;
  value: string;
  consumesNext: boolean;
}

function readCurlFileOption(word: string, next: string): CurlFileOption | null {
  const separateKind = curlFileOptions.get(word);
  if (separateKind)
    return { kind: separateKind, value: next, consumesNext: true };
  if (word.startsWith("--") && word.includes("=")) {
    const separator = word.indexOf("=");
    const kind = curlFileOptions.get(word.slice(0, separator));
    return kind
      ? { kind, value: word.slice(separator + 1), consumesNext: false }
      : null;
  }
  const prefix = word.slice(0, 2);
  const kind = curlFileOptions.get(prefix);
  if (word.length > 2 && curlShortFileOptions.has(prefix) && kind) {
    return { kind, value: word.slice(2), consumesNext: false };
  }
  return null;
}

/** Check curl's file-reading options; null requires caller refusal because normalization is unresolved. */
export function curlFileOperandsTouchSecret(command: string): boolean | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const words = splitPolicyShellWords(normalized);
  const first = words[0] ?? "";
  if (first.slice(first.lastIndexOf("/") + 1) !== "curl") return false;
  return curlWordsTouchSecret(words);
}

function curlWordsTouchSecret(words: readonly string[]): boolean {
  for (let index = 1; index < words.length; index++) {
    const word = words[index] ?? "";
    const option = readCurlFileOption(word, words[index + 1] ?? "");
    if (option) {
      if (curlFileReferenceTouchesSecret(option.kind, option.value))
        return true;
      if (option.consumesNext) index++;
    } else if (word === "--data-raw" || word === "--form-string") {
      index++;
    }
  }
  return false;
}

const searchCommands = new Set(["grep", "egrep", "fgrep", "rg", "ag", "ack"]);

/** Recognize the search commands whose pattern arguments are data rather than file operands. */
export function isSearchCommandVerb(verb: string): boolean {
  return searchCommands.has(verb.slice(verb.lastIndexOf("/") + 1));
}

/** Reuse the matching prepared Git context; null leaves the command under generic path scanning. */
export function secretSearchCommandCandidate(
  command: string,
  git: GitCommandContext | null,
): string | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const first = normalized.split(/[ \t\r\n\v\f]/u, 1)[0] ?? "";
  if (isSearchCommandVerb(first)) return normalized.replace(/\n+$/u, "");
  const base = first.slice(first.lastIndexOf("/") + 1);
  return base === "git" &&
    git !== null &&
    /^grep([ \t\r\n\v\f]|$)/u.test(git.rest)
    ? git.rest
    : null;
}

const gitLogSearchOptions = new Set(["-S", "-G", "--grep"]);

function gitLogSearchWidth(word: string): number {
  if (gitLogSearchOptions.has(word)) return 2;
  return /^(?:-[SG].+|--grep=.*)$/su.test(word) ? 1 : 0;
}

/** Remove only log-search values; retain global options and every path after --. */
export function gitLogCandidateWithoutSearchValues(
  command: string,
  git: GitCommandContext,
): string | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const words = splitPolicyShellWords(normalized);
  const subcommand = words.findIndex(
    (word, index) =>
      index >= 1 && word === "log" && words.slice(index).join(" ") === git.rest,
  );
  if (subcommand < 1) return null;
  const kept = words.slice(0, subcommand + 1);
  let searchValueSeen = false;
  for (let index = subcommand + 1; index < words.length;) {
    const word = words[index] ?? "";
    if (word === "--") {
      kept.push(...words.slice(index));
      break;
    }
    const width = gitLogSearchWidth(word);
    if (width > 0) {
      if (index + width > words.length) return null;
      searchValueSeen = true;
      index += width;
    } else {
      kept.push(word);
      index++;
    }
  }
  return searchValueSeen ? kept.join(" ") : null;
}

const searchValueOptions = new Set(
  "-A -B -C -D -d -g -M -m -t -T --after-context --before-context --binary-files --color --colour --colors --context --context-separator --directories --devices --encoding --engine --exclude --exclude-dir --exclude-from --glob --group-separator --iglob --ignore-file --include --label --max-columns --max-count --max-depth --path-separator --pre --pre-glob --regexp --replace --sort --sortr --threads --type --type-add --type-clear --type-not".split(
    " ",
  ),
);

/** Identify a separate option value so it cannot be mistaken for a searched filename. */
export function searchOptionConsumesValue(option: string): boolean {
  return searchValueOptions.has(option);
}

/** Protect a search pattern read from a file, including attached option values. */
export function searchPatternFileTouchesSecret(
  option: string,
  value: string,
): boolean {
  if (option === "-f" || option === "--file") return isSecretPathTouch(value);
  if (option.startsWith("-f") && option.length > 2)
    return isSecretPathTouch(option.slice(2));
  return option.startsWith("--file=") && isSecretPathTouch(option.slice(7));
}

interface SearchOption {
  width: number;
  patternSeen: boolean;
  touchesSecret: boolean;
}

function searchOption(
  word: string,
  next: string,
  patternSeen: boolean,
): SearchOption | null {
  if (word === "-e" || word === "--regexp")
    return { width: 2, patternSeen: true, touchesSecret: false };
  if (/^(?:-e.+|--regexp=.*)$/su.test(word))
    return { width: 1, patternSeen: true, touchesSecret: false };
  if (word === "-f" || word === "--file")
    return {
      width: 2,
      patternSeen: true,
      touchesSecret: searchPatternFileTouchesSecret(word, next),
    };
  if (/^(?:-f.+|--file=.*)$/su.test(word))
    return {
      width: 1,
      patternSeen: true,
      touchesSecret: searchPatternFileTouchesSecret(word, ""),
    };
  if (/^--[^]*=/u.test(word))
    return { width: 1, patternSeen, touchesSecret: false };
  if (searchOptionConsumesValue(word))
    return { width: 2, patternSeen, touchesSecret: false };
  return word.startsWith("-")
    ? { width: 1, patternSeen, touchesSecret: false }
    : null;
}

function searchOptionAt(
  words: readonly string[],
  index: number,
  patternSeen: boolean,
): SearchOption | null {
  return searchOption(words[index] ?? "", words[index + 1] ?? "", patternSeen);
}

function searchWordsTouchSecret(words: readonly string[]): boolean {
  let patternSeen = false;
  let afterOptions = false;
  for (let index = 1; index < words.length;) {
    const word = words[index] ?? "";
    if (!afterOptions && word === "--") {
      afterOptions = true;
      index++;
      continue;
    }
    const option: SearchOption | null = afterOptions
      ? null
      : searchOptionAt(words, index, patternSeen);
    if (option) {
      if (option.touchesSecret) return true;
      patternSeen = option.patternSeen;
      index += option.width;
      continue;
    }
    if (patternSeen && isSecretPathTouch(word)) return true;
    patternSeen = true;
    index++;
  }
  return false;
}

/** Exclude actual search patterns and option data; null requires refusal for unresolved normalization. */
export function searchFileOperandsTouchSecret(command: string): boolean | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const words = splitPolicyShellWords(normalized);
  return isSearchCommandVerb(words[0] ?? "") && searchWordsTouchSecret(words);
}

function ghStatusShowsToken(
  words: readonly string[],
  topic: number,
  subcommand: number,
): boolean {
  for (let index = topic + 1; index < words.length; index++) {
    if (index === subcommand) continue;
    const word = words[index] ?? "";
    if (["-h", "--hostname", "-u", "--user"].includes(word)) index++;
    else if (/^(?:-t|--show-token)(?:=.*)?$/su.test(word)) return true;
  }
  return false;
}

/** Detect explicit stored-token output; preserve ordinary status/help and unresolved normalization. */
export function isGhTokenDisclosure(command: string): boolean | null {
  const normalized = normalizeGitPolicyCandidate(command);
  if (normalized === null) return null;
  const words = splitPolicyShellWords(normalized);
  const first = words[0] ?? "";
  if (first.slice(first.lastIndexOf("/") + 1) !== "gh") return false;
  const stripped = stripPolicyShellRedirections(normalized);
  if (stripped === null) return true;
  return ghAuthShowsToken(splitPolicyShellWords(stripped));
}

function ghAuthShowsToken(words: readonly string[]): boolean {
  const topic = ghSkipOptionsIndex(words, 1);
  if (asciiLowerCase(words[topic] ?? "") !== "auth") return false;
  const subcommand = ghSkipOptionsIndex(words, topic + 1);
  switch (asciiLowerCase(words[subcommand] ?? "")) {
    case "token":
      return !(
        words.length === subcommand + 2 && words[subcommand + 1] === "--help"
      );
    case "status":
      return ghStatusShowsToken(words, topic, subcommand);
    case "git-credential":
      return words[subcommand + 1] === "get";
    default:
      return false;
  }
}

/** Check the prepared Git invocation for credential output without reading the credential store. */
export function isGitCredentialDisclosure(git: GitCommandContext): boolean {
  const [command, action] = git.commandWords;
  if (command === "credential") return action === "fill";
  return (
    (command ?? "").startsWith("credential-") &&
    git.commandWords.slice(1).includes("get")
  );
}

interface SecretRedirectionState {
  words: string[];
  redirects: string[];
  word: string;
  quote: string;
  escaped: boolean;
  redirect: 0 | 1 | 2;
}

function consumeSecretQuote(
  state: SecretRedirectionState,
  character: string,
): boolean | null {
  if (state.escaped) {
    if (!character) return null;
    state.word += character;
    state.escaped = false;
    return true;
  }
  if (state.quote !== "'" && character === "\\") {
    state.word += character;
    state.escaped = true;
    return true;
  }
  if (state.quote) {
    state.word += character;
    if (character === state.quote) state.quote = "";
    return true;
  }
  if (character === "'" || character === '"') {
    state.word += character;
    state.quote = character;
    return true;
  }
  return false;
}

function flushSecretWord(
  state: SecretRedirectionState,
  character: string,
): void {
  if (!state.word) return;
  if (state.redirect === 1) state.redirects.push(state.word);
  else if (state.redirect === 0) {
    const descriptor = /^([0-9]+|\{[A-Za-z_][A-Za-z0-9_]*\})$/u.test(
      state.word,
    );
    if (!/[<>]/u.test(character) || !descriptor) state.words.push(state.word);
  }
  state.word = "";
  state.redirect = 0;
}

function secretRedirectWidth(
  rest: string,
): { width: number; kind: 1 | 2 } | null {
  if (rest.startsWith("<<<")) return { width: 3, kind: 2 };
  if (/^(<<|<\(|>\()/u.test(rest)) return null;
  if (rest.startsWith("&>>")) return { width: 3, kind: 1 };
  if (/^(>>|>&|<&|<>|>\||&>)/u.test(rest)) return { width: 2, kind: 1 };
  return { width: 1, kind: 1 };
}

function consumeSecretBoundary(
  state: SecretRedirectionState,
  input: string,
  index: number,
): number | null {
  const character = input[index] ?? "";
  flushSecretWord(state, character);
  if (/[<>]/u.test(character) || input.slice(index, index + 2) === "&>") {
    if (state.redirect !== 0) return null;
    const operator = secretRedirectWidth(input.slice(index));
    if (operator === null) return null;
    state.redirect = operator.kind;
    return operator.width;
  }
  return /[|&;]/u.test(character) ? null : 1;
}

/** Split file-opening redirects from arguments; null keeps compound or malformed syntax under full policy evaluation. */
export function splitSecretRedirections(
  input: string,
): { words: string[]; redirects: string[] } | null {
  const state: SecretRedirectionState = {
    words: [],
    redirects: [],
    word: "",
    quote: "",
    escaped: false,
    redirect: 0,
  };
  for (let index = 0; index <= input.length; index++) {
    const character = input[index] ?? "";
    const quoted = consumeSecretQuote(state, character);
    if (quoted === null) return null;
    if (quoted) continue;
    if (character !== "" && !/[ \t\r\n\v\f<>|&;]/u.test(character)) {
      state.word += character;
      continue;
    }
    const width = consumeSecretBoundary(state, input, index);
    if (width === null) return null;
    index += width - 1;
  }
  return state.quote || state.redirect !== 0
    ? null
    : { words: state.words, redirects: state.redirects };
}

function literalPrefixLength(
  original: readonly string[],
  output: readonly string[],
  normalized: string,
): number {
  const prefix = original.length - output.length;
  if (
    prefix >= 0 &&
    output.every((word, index) => word === original[prefix + index])
  )
    return prefix;
  // Shell-text wrappers join argv; recover the exact suffix instead of treating wrapper files as output data.
  return original.findIndex(
    (_, index) => joinPolicyShellWords(original, index) === normalized,
  );
}

/** Exempt proven echo/printf data while retaining wrapper file operands and normalized redirects. */
export function literalOutputPrefixCandidate(command: string): string | null {
  const normalized = normalizePolicyCommandCandidate(command);
  if (normalized === null) return null;
  const output = splitPolicyShellWords(normalized);
  const first = output[0] ?? "";
  if (!["echo", "printf"].includes(first.slice(first.lastIndexOf("/") + 1)))
    return null;
  const split = splitSecretRedirections(normalized);
  if (split === null) return null;
  const original = splitPolicyShellWords(command);
  const prefix = literalPrefixLength(original, output, normalized);
  if (prefix < 0) return null;
  const retained = original
    .slice(0, prefix)
    .filter((word) => !/^[A-Za-z_][A-Za-z0-9_]*=/u.test(word));
  const prefixText = retained
    .map((word) => joinPolicyShellWords([word], 0, "argv") + " ")
    .join("");
  return prefixText + split.redirects.join(" ") + " ";
}

const secretSyntaxRefusal =
  "Cannot inspect command syntax; use a literal executable and supported wrapper options.";

/** Join words as Bash `printf '%s '` does: each word gets a trailing space, and no words still print one space. */
function spaceTerminatedWords(words: readonly string[]): string {
  return words.length === 0 ? " " : words.map((word) => `${word} `).join("");
}

interface SecretTextScan {
  text: string;
  touches: boolean;
  allowed: boolean;
}

/** Separate redirect targets from command words; a proven literal output prefix that names no secret allows the segment. */
function scanSecretRedirections(context: PolicySegmentContext): SecretTextScan {
  const command = context.trimmed;
  const scan = { text: command, touches: false, allowed: false };
  const eligible =
    context.verb === "echo" ||
    context.verb === "printf" ||
    command.includes("<") ||
    command.includes(">");
  const split = eligible ? splitSecretRedirections(command) : null;
  if (split === null) return scan;
  scan.text = spaceTerminatedWords(split.words);
  if (isSecretPathTouch(spaceTerminatedWords(split.redirects), context.verb)) {
    scan.touches = true;
    return scan;
  }
  const prefix = literalOutputPrefixCandidate(scan.text)?.replace(/\n+$/u, "");
  if (prefix === undefined) return scan;
  if (isSecretPathTouch(prefix, context.verb)) scan.touches = true;
  else scan.allowed = true;
  return scan;
}

/** Refuse token and credential output; a Git command Git itself cannot resolve keeps the destructive scope it has in the reference. */
async function credentialDisclosureDenial(
  command: string,
  options: GitCommandOptions,
): Promise<{ denial: PolicyDenial | null; git: GitCommandContext | null }> {
  const secret = (reason: string) => ({
    denial: { scope: "secret", reason },
    git: null,
  });
  const token = isGhTokenDisclosure(command);
  if (token === null) return secret(secretSyntaxRefusal);
  if (token)
    return secret(
      "GitHub authentication token output exposes a stored credential to the agent. Use gh auth status without token display.",
    );
  const candidate = normalizeGitPolicyCandidate(command);
  if (candidate === null) return secret(secretSyntaxRefusal);
  const inspection = await inspectGitCommand(candidate, options);
  if (inspection.kind === "unresolved")
    return {
      denial: { scope: "destructive", reason: inspection.reason },
      git: null,
    };
  if (inspection.kind === "other") return { denial: null, git: null };
  return isGitCredentialDisclosure(inspection.context)
    ? secret(
        "Git credential output exposes stored passwords or tokens to the agent. Use git config --get credential.helper or request sanitized status.",
      )
    : { denial: null, git: inspection.context };
}

/** Scan search operands when this is a search or `git grep` command; undefined means the search rule does not apply. */
function searchCommandTouchesSecret(
  context: PolicySegmentContext,
  git: GitCommandContext | null,
): boolean | null | undefined {
  const { trimmed, verb, normalized } = context;
  // Ordered-letter checks are deliberate supersets: quotes or escapes can split the visible grep/log spelling.
  if (
    !isSearchCommandVerb(verb) &&
    !(verb === "git" && /g.*r.*e.*p/su.test(normalized))
  )
    return undefined;
  const candidate = secretSearchCommandCandidate(trimmed, git);
  return candidate === null
    ? undefined
    : searchFileOperandsTouchSecret(candidate);
}

/** Pick the operand scan for this verb: curl options, search operands, git log paths, or the generic path scan; null cannot be inspected. */
function commandTouchesSecret(
  context: PolicySegmentContext,
  text: string,
  git: GitCommandContext | null,
): boolean | null {
  const { trimmed, verb, normalized } = context;
  if (verb === "curl") {
    const curl = curlFileOperandsTouchSecret(trimmed);
    if (curl !== false) return curl;
  }
  const search = searchCommandTouchesSecret(context, git);
  if (search !== undefined) return search;
  if (verb === "git" && git !== null && /l.*o.*g/su.test(normalized)) {
    const candidate = gitLogCandidateWithoutSearchValues(trimmed, git);
    if (candidate !== null) return isSecretPathTouch(candidate, verb);
  }
  return isSecretPathTouch(text, verb);
}

/**
 * Apply the secret-file rules to one prepared segment: token and credential output, curl uploads, search and git log
 * operands, redirect targets and literal output, then the generic credential-path scan, e.g. `cat .env` or `grep x ~/.ssh/id_rsa`.
 * A segment with several real pipeline stages is skipped because preparation already checked each stage on its own.
 *
 * @param context - the prepared segment
 * @param options - Git's directory, deadline and environment for the one Git inspection the credential and search rules share
 * @returns the first denial, scoped `secret`, or `destructive` when Git's own command cannot be resolved; null when allowed
 */
export async function checkSecretSegment(
  context: PolicySegmentContext,
  options: GitCommandOptions,
): Promise<PolicyDenial | null> {
  if (context.hasPipe) {
    const stages = splitPolicyTopLevelPipelineStages(
      context.trimmed,
      context.inlineCommandHost,
    );
    if (stages.kind === "segments" && stages.segments.length > 1) return null;
  }
  const scan = scanSecretRedirections(context);
  if (scan.allowed) return null;
  const disclosure = await credentialDisclosureDenial(context.trimmed, options);
  if (disclosure.denial !== null) return disclosure.denial;
  const touches =
    scan.touches || commandTouchesSecret(context, scan.text, disclosure.git);
  if (touches === null) return { scope: "secret", reason: secretSyntaxRefusal };
  return touches
    ? {
        scope: "secret",
        reason: `Secret-file access (${context.verb}). Reading or editing .env / SSH/AWS/GCP keys / credentials through the agent is an exfil risk. Use a checked-in example or ask the user for sanitized fields.`,
      }
    : null;
}
