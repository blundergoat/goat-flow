/** Classify heredoc consumers and hide only confirmed inert quoted bodies before command inspection. */
import { firstPolicyWordBase, splitIfs } from "./policy-words.mjs";
import {
  countPolicySubstitutionOpeners,
  normalizePolicyCommandCandidate,
} from "./policy-syntax.mjs";

/** Recognize existing non-shell stdin consumers before later opener and substitution inspection. */
const inertConsumers = new Set(
  (
    "cat tac tee head tail sort uniq wc nl rev cut tr fold fmt column paste join comm expand unexpand strings iconv " +
    "base64 base32 xxd hexdump od md5sum sha1sum sha256sum sha512sum cksum " +
    "grep egrep fgrep rg ag sed gsed awk gawk mawk nawk jq yq xq mlr " +
    "python python2 python3 php node nodejs deno ruby perl lua " +
    "psql mysql mariadb sqlite3 mongosh mongo redis-cli cqlsh duckdb " +
    "echo printf true false : mail mailx sendmail less more"
  ).split(" "),
);

/** Classify one normalized basename; interpreter-language behavior remains outside shell policy. */
export function isInertHeredocConsumer(firstWord: string): boolean {
  return inertConsumers.has(firstWord);
}

/** Trust stdin only for the three existing Goat Flow data commands, after caller normalization. */
export function goatFlowCliConsumesHeredocData(command: string): boolean {
  const separator = command.search(/[ \t\r\n\v\f]/u);
  const word = separator < 0 ? command : command.slice(0, separator);
  if (word.slice(word.lastIndexOf("/") + 1) !== "goat-flow") return false;
  const args = command.slice(word.length).replace(/^[ \t\r\n\v\f]+/u, "");
  return /^(quality[ \t\r\n\v\f]+save|review[ \t\r\n\v\f]+validate|redact)([ \t\r\n\v\f]|$)/u.test(
    args,
  );
}

const singleQuotedSpan = /'[^'\n]*'/gu;
const doubleQuotedSpan = /"[^"\n]*"/gu;
const processSubstitution = /[<>]\(([^()]*)\)/u;
const leadingSpace = /^[ \t\n\v\f\r]+/u;

/** Accept one opener stage only when its normalized command reads stdin as data; an unresolved wrapper is never data. */
function openerStageIsInert(segment: string): boolean {
  if (segment === "") return true;
  const normalized = normalizePolicyCommandCandidate(segment) ?? "";
  return (
    isInertHeredocConsumer(firstPolicyWordBase(normalized)) ||
    goatFlowCliConsumesHeredocData(normalized)
  );
}

/**
 * Decide whether every consumer named on a heredoc opener reads data rather than shell commands,
 * e.g. `cat > out.json <<'EOF'` qualifies while `cat <<'EOF' | bash` and `cat <<'EOF' > >(sh)` do not.
 * Quoted spans are removed line by line first, and each process-substitution interior must qualify on its own.
 *
 * @param opener - the logical opener line as the agent typed it
 * @returns true only when every stage is a known non-shell consumer; unresolved normalization, unknown commands and exceeded bounds return false
 */
export function heredocCommandListIsInert(opener: string): boolean {
  let scan = opener
    .replace(singleQuotedSpan, "")
    .replace(doubleQuotedSpan, "")
    .replace(/\n+$/u, "");
  // Bound the recursive interior checks so a long submitted opener cannot stall the hook.
  if (countPolicySubstitutionOpeners(scan) > 32) return false;
  for (let iterations = 1; ; iterations++) {
    const match = processSubstitution.exec(scan);
    if (match === null) break;
    if (iterations > 32 || !heredocCommandListIsInert(match[1] ?? ""))
      return false;
    // A reviewed interior becomes a placeholder so the outer opener splits without rescanning it.
    scan = scan.replace(match[0], " __goat_ps__ ");
  }
  const segments = splitIfs(scan.replaceAll("\n", ";"), ";&|");
  if (segments.length === 0 || segments.length > 64) return false;
  return segments.every((segment) =>
    openerStageIsInert(segment.replace(leadingSpace, "")),
  );
}

/** Contexts that change how Bash reads a heredoc operator; `<(` closes into the same word, unlike a plain subshell. */
type HeredocFrame =
  "'" | "$'" | '"' | "\x60" | "$(" | "<(" | "(" | "((" | "a(" | "${" | "$[";

interface ConfirmedHeredoc {
  delimiter: string;
  stripTabs: boolean;
  operatorLine: number;
  depth: number;
}

interface HeredocScan {
  input: string;
  index: number;
  line: number;
  frames: HeredocFrame[];
  wordStart: boolean;
  pending: ConfirmedHeredoc | null;
}

type HeredocStep = "next" | "newline" | "ambiguous";

const commandFrameOpeners: ReadonlyArray<readonly [string, HeredocFrame]> = [
  ["$((", "(("],
  ["$(", "$("],
  ["${", "${"],
  ["$[", "$["],
  ["$'", "$'"],
  ['$"', '"'],
  ["<(", "<("],
  [">(", "<("],
  ["(", "("],
  ["'", "'"],
  ['"', '"'],
  ["\x60", "\x60"],
];
const doubleQuoteFrameOpeners = commandFrameOpeners.filter(([text]) =>
  ["$((", "$(", "${", "$[", "\x60"].includes(text),
);
const expansionFrameOpeners = commandFrameOpeners.filter(([text]) =>
  ["$((", "$(", "${", "$[", "\x60", "'", '"'].includes(text),
);

/** Move past consumed text, counting physical lines so confirmed bodies line up with the masker's line numbers. */
function advanceHeredocScan(scan: HeredocScan, width: number): void {
  const end = Math.min(scan.index + width, scan.input.length);
  for (let index = scan.index; index < end; index++)
    if (scan.input.charAt(index) === "\n") scan.line++;
  scan.index = end;
}

/** Enter the first matching context; a subshell or substitution starts a fresh command word. */
function openHeredocFrame(
  scan: HeredocScan,
  openers: ReadonlyArray<readonly [string, HeredocFrame]>,
): boolean {
  const opener = openers.find(([text]) =>
    scan.input.startsWith(text, scan.index),
  );
  if (opener === undefined) return false;
  scan.frames.push(opener[1]);
  scan.wordStart = ["$(", "<(", "("].includes(opener[1]);
  advanceHeredocScan(scan, opener[0].length);
  return true;
}

/** Leave a context; the next character joins the surrounding word unless a plain subshell closed. */
function closeHeredocFrame(scan: HeredocScan, width: number): HeredocStep {
  scan.wordStart = scan.frames.pop() === "(";
  advanceHeredocScan(scan, width);
  return "next";
}

/** Bash keeps single-quoted delimiter text literally; double-quoted text qualifies only without escapes or expansions. */
function isLiteralHeredocDelimiter(text: string, quote: string): boolean {
  if (text === "" || text.includes("\n")) return false;
  return quote === "'" || !/[\\$\x60]/u.test(text);
}

/** Read the `'EOF'` or `"EOF"` delimiter word exactly; partial quoting, escapes, expansions and empty words return null. */
function readQuotedHeredocDelimiter(
  input: string,
  start: number,
): { text: string; end: number } | null {
  let index = start;
  while (input.charAt(index) === " " || input.charAt(index) === "\t") index++;
  const quote = input.charAt(index);
  const close =
    quote === "'" || quote === '"' ? input.indexOf(quote, index + 1) : -1;
  if (close < 0) return null;
  const text = input.slice(index + 1, close);
  // A word that continues after its closing quote, such as 'EO'"F", ends where this reader does not look.
  if (
    !isLiteralHeredocDelimiter(text, quote) ||
    !/^[ \t\n;&|()<>]?$/u.test(input.charAt(close + 1))
  )
    return null;
  return { text, end: close + 1 };
}

/** Record one quoted heredoc operator, skip a here-string, and refuse any delimiter whose body boundary is uncertain. */
function scanHeredocOperator(scan: HeredocScan): HeredocStep {
  const { input, index } = scan;
  // A here-string feeds one word on stdin and never starts a heredoc body.
  if (input.charAt(index + 2) === "<") {
    scan.wordStart = true;
    advanceHeredocScan(scan, 3);
    return "next";
  }
  const stripTabs = input.charAt(index + 2) === "-";
  const delimiter = readQuotedHeredocDelimiter(
    input,
    index + (stripTabs ? 3 : 2),
  );
  // A second body on one command line is outside this masker's one-body model.
  if (delimiter === null || scan.pending !== null) return "ambiguous";
  scan.pending = {
    delimiter: delimiter.text,
    stripTabs,
    operatorLine: scan.line,
    depth: scan.frames.length,
  };
  scan.wordStart = false;
  advanceHeredocScan(scan, delimiter.end - index);
  return "next";
}

/** Skip a comment to the end of its physical line; heredoc-like text inside one stops confirmation altogether. */
function skipHeredocComment(scan: HeredocScan): HeredocStep {
  const end = scan.input.indexOf("\n", scan.index);
  const stop = end < 0 ? scan.input.length : end;
  if (scan.input.slice(scan.index, stop).includes("<<")) return "ambiguous";
  advanceHeredocScan(scan, stop - scan.index);
  return "next";
}

/** End one command line; a pending body whose opening context already closed has no reliable start. */
function endHeredocCommandLine(scan: HeredocScan): HeredocStep {
  if (scan.pending !== null && scan.frames.length < scan.pending.depth)
    return "ambiguous";
  scan.wordStart = true;
  advanceHeredocScan(scan, 1);
  return "newline";
}

/** Escapes keep the next character literal; backslash-newline joins the next physical line into the same command. */
function skipHeredocEscape(scan: HeredocScan): HeredocStep {
  if (scan.input.charAt(scan.index + 1) !== "\n") scan.wordStart = false;
  advanceHeredocScan(scan, 2);
  return "next";
}

/** Arithmetic commands and case patterns inside parentheses close unlike the contexts tracked here, so they stop confirmation. */
function startsUntrackedSyntax(
  scan: HeredocScan,
  frame: HeredocFrame | undefined,
): boolean {
  if (scan.input.startsWith("((", scan.index)) return true;
  return (
    frame !== undefined &&
    scan.wordStart &&
    scan.input.startsWith("case", scan.index) &&
    /^[ \t\n]?$/u.test(scan.input.charAt(scan.index + 4))
  );
}

/** Scan one character where Bash reads commands: top level, subshells and command or process substitutions. */
function scanHeredocCommandCharacter(
  scan: HeredocScan,
  frame: HeredocFrame | undefined,
): HeredocStep {
  const char = scan.input.charAt(scan.index);
  if (char === "\\") return skipHeredocEscape(scan);
  if (char === "\n") return endHeredocCommandLine(scan);
  if (char === "#" && scan.wordStart) return skipHeredocComment(scan);
  if (scan.input.startsWith("<<", scan.index)) return scanHeredocOperator(scan);
  if (startsUntrackedSyntax(scan, frame)) return "ambiguous";
  if (openHeredocFrame(scan, commandFrameOpeners)) return "next";
  if (char === ")" && frame !== undefined) return closeHeredocFrame(scan, 1);
  scan.wordStart = /^[ \t;&|()<>]$/u.test(char);
  advanceHeredocScan(scan, 1);
  return "next";
}

/** Scan quoted or backquoted text, where only the closing character and escapes matter. */
function scanHeredocQuotedCharacter(
  scan: HeredocScan,
  frame: "'" | "$'" | '"' | "\x60",
): HeredocStep {
  const char = scan.input.charAt(scan.index);
  const close = frame === "$'" ? "'" : frame;
  if (char === "\\" && frame !== "'") {
    advanceHeredocScan(scan, 2);
    return "next";
  }
  if (char === close) return closeHeredocFrame(scan, 1);
  if (frame === '"' && openHeredocFrame(scan, doubleQuoteFrameOpeners))
    return "next";
  advanceHeredocScan(scan, 1);
  return "next";
}

/** Track parentheses inside arithmetic, which closes only on `))`; a lone parenthesis means the scan no longer matches Bash. */
function scanHeredocArithmeticParen(
  scan: HeredocScan,
  frame: "((" | "a(",
  char: string,
): HeredocStep | null {
  if (char === "(") {
    scan.frames.push("a(");
    advanceHeredocScan(scan, 1);
    return "next";
  }
  if (char !== ")") return null;
  if (frame === "a(") return closeHeredocFrame(scan, 1);
  return scan.input.charAt(scan.index + 1) === ")"
    ? closeHeredocFrame(scan, 2)
    : "ambiguous";
}

const expansionClosers: Readonly<Record<string, string>> = {
  "${": "}",
  "$[": "]",
};

/** Scan arithmetic, parameter and legacy arithmetic expansions, which close on their own delimiters. */
function scanHeredocExpansionCharacter(
  scan: HeredocScan,
  frame: "((" | "a(" | "${" | "$[",
): HeredocStep {
  const char = scan.input.charAt(scan.index);
  if (char === "\\") {
    advanceHeredocScan(scan, 2);
    return "next";
  }
  if (char === expansionClosers[frame]) return closeHeredocFrame(scan, 1);
  if (openHeredocFrame(scan, expansionFrameOpeners)) return "next";
  const arithmetic =
    frame === "((" || frame === "a("
      ? scanHeredocArithmeticParen(scan, frame, char)
      : null;
  if (arithmetic !== null) return arithmetic;
  advanceHeredocScan(scan, 1);
  return "next";
}

/** Dispatch one character by its innermost context; heredoc-like text outside a command context stops confirmation. */
function scanHeredocCharacter(scan: HeredocScan): HeredocStep {
  const frame = scan.frames.at(-1);
  if (frame === undefined || frame === "$(" || frame === "<(" || frame === "(")
    return scanHeredocCommandCharacter(scan, frame);
  if (scan.input.startsWith("<<", scan.index)) return "ambiguous";
  if (frame === "'" || frame === "$'" || frame === '"' || frame === "\x60")
    return scanHeredocQuotedCharacter(scan, frame);
  return scanHeredocExpansionCharacter(scan, frame);
}

/** Skip one quoted body to its delimiter line, as Bash reads it, tab-stripped for `<<-`. */
function skipHeredocBody(scan: HeredocScan, heredoc: ConfirmedHeredoc): void {
  while (scan.index < scan.input.length) {
    const end = scan.input.indexOf("\n", scan.index);
    const line = scan.input.slice(scan.index, end < 0 ? undefined : end);
    advanceHeredocScan(
      scan,
      (end < 0 ? scan.input.length : end + 1) - scan.index,
    );
    const candidate = heredoc.stripTabs ? line.replace(/^\t+/u, "") : line;
    if (candidate === heredoc.delimiter) return;
  }
}

/**
 * Find quoted heredoc bodies Bash would really read, keyed by their first body line.
 * Scanning stops at the first ambiguous construct, so every later opener stays unconfirmed and its body visible.
 */
function findConfirmedQuotedHeredocs(
  input: string,
): Map<number, ConfirmedHeredoc> {
  const scan: HeredocScan = {
    input,
    index: 0,
    line: 0,
    frames: [],
    wordStart: true,
    pending: null,
  };
  const confirmed = new Map<number, ConfirmedHeredoc>();
  while (scan.index < input.length) {
    const step = scanHeredocCharacter(scan);
    if (step === "ambiguous") break;
    if (step === "newline" && scan.pending !== null) {
      confirmed.set(scan.line, scan.pending);
      skipHeredocBody(scan, scan.pending);
      scan.pending = null;
      scan.wordStart = true;
    }
  }
  return confirmed;
}

const singleQuotedOpener = /(<<-?)[ \t\n\v\f\r]*'([^']+)'/u;
const doubleQuotedOpener = /(<<-?)[ \t\n\v\f\r]*"([^"]+)"/u;
const oddTrailingBackslashes = /(?:^|[^\\])(?:\\\\)*\\$/u;

interface HeredocBody {
  delimiter: string;
  stripTabs: boolean;
  mask: boolean;
}

/** Copy one body until its delimiter line, collapsing a masked body to a single placeholder line. */
function appendHeredocBody(
  lines: readonly string[],
  start: number,
  body: HeredocBody,
  output: string[],
): number {
  let masked = false;
  for (let index = start; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const stripped = body.stripTabs ? line.replace(/^\t+/u, "") : line;
    if (line === body.delimiter || stripped === body.delimiter) {
      output.push(`${line}\n`);
      return index + 1;
    }
    if (!body.mask) output.push(`${line}\n`);
    else if (!masked) output.push("__goat_quoted_heredoc_body__\n");
    masked ||= body.mask;
  }
  return lines.length;
}

/**
 * Replace each confirmed inert quoted heredoc body with one placeholder line so long report data is not counted as chained commands,
 * e.g. `cat > report.json <<'JSON'` plus its body becomes the opener, `__goat_quoted_heredoc_body__` and the closing `JSON` line.
 * A body stays visible unless the opener's consumers are inert and an independent Bash-style scan confirms the same opener, delimiter and body start;
 * here-strings, quoted or commented opener text, unquoted or partly quoted delimiters and nested arithmetic or case syntax therefore keep later lines inspectable.
 *
 * @param input - the complete multi-line command as the agent typed it
 * @returns the command with backslash-continued opener lines joined and confirmed inert bodies masked; other lines are unchanged
 */
export function maskSafeQuotedHeredocBodies(input: string): string {
  const lines = input.split("\n");
  const confirmed = findConfirmedQuotedHeredocs(input);
  const output: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const start = index;
    let logical = lines[index++] ?? "";
    // Join continued opener lines so a shell consumer on the next line cannot hide behind the backslash.
    while (oddTrailingBackslashes.test(logical) && index < lines.length)
      logical = logical.slice(0, -1) + (lines[index++] ?? "");
    output.push(`${logical}\n`);
    const body = heredocOpenerBody(logical, confirmed.get(index), start);
    if (body !== null) index = appendHeredocBody(lines, index, body, output);
  }
  return output.join("").slice(0, -1);
}

/** Describe the body after a quoted opener; it is masked only when Bash would read the same body and every consumer is inert. */
function heredocOpenerBody(
  logical: string,
  real: ConfirmedHeredoc | undefined,
  start: number,
): HeredocBody | null {
  const opener =
    singleQuotedOpener.exec(logical) ?? doubleQuotedOpener.exec(logical);
  if (opener === null) return null;
  const delimiter = opener[2] ?? "";
  const stripTabs = opener[1] === "<<-";
  const mask =
    real?.delimiter === delimiter &&
    real.stripTabs === stripTabs &&
    real.operatorLine >= start &&
    heredocCommandListIsInert(logical);
  return { delimiter, stripTabs, mask };
}

const qualitySaveArguments = /^quality[ \t\n\v\f\r]+save(?:[ \t\n\v\f\r]|$)/u;
const sourceQualitySaveArguments =
  /^--import(?:=tsx|[ \t\n\v\f\r]+tsx)[ \t\n\v\f\r]+src\/cli\/cli\.ts[ \t\n\v\f\r]+quality[ \t\n\v\f\r]+save(?:[ \t\n\v\f\r]|$)/u;

/**
 * Admit the larger report-data allowance only for a masked quality-report save, from the installed command or the source CLI,
 * e.g. `goat-flow quality save . <<'JSON'` followed by the masked body; every other large command keeps the ordinary limit.
 *
 * @param commandPolicy - the command after heredoc masking
 * @returns true when a masked body exists and the first line normalizes to a quality save; unresolved normalization returns false
 */
export function largeQualitySaveHeredocIsBoundedData(
  commandPolicy: string,
): boolean {
  if (!commandPolicy.includes("__goat_quoted_heredoc_body__")) return false;
  const opener = commandPolicy.split("\n", 1)[0] ?? "";
  const normalized = normalizePolicyCommandCandidate(opener) ?? "";
  const word = normalized.split(/[ \t\n\v\f\r]/u, 1)[0] ?? "";
  const base = word.slice(word.lastIndexOf("/") + 1);
  const args = normalized.slice(word.length).replace(leadingSpace, "");
  if (base === "goat-flow") return qualitySaveArguments.test(args);
  return (
    (base === "node" || base === "nodejs") &&
    sourceQualitySaveArguments.test(args)
  );
}
