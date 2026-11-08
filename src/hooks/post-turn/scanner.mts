/** Scan the turn's committable changes for high-confidence secrets, literal credential assignments and conflict markers. */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  fstatSync,
  lstatSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  type Stats,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { credentialAssignmentFamilies } from "./assignments.mjs";
import {
  recordPostTurnResultFinding,
  type PostTurnContext,
} from "./context.mjs";
import {
  clearStopReentryState,
  finishCoverageGap,
  finishInfrastructureFailure,
} from "./recovery.mjs";

// Bounds each Git path list below the Windows command-line limit.
const CHUNK_SIZE = 64;
// Cap: a larger Git stream ends the scan incomplete instead of exhausting hook memory.
const GIT_OUTPUT_LIMIT_BYTES = 268_435_456;
// Cap: enough leading bytes to tell oversized text from binary without reading the whole file.
const BINARY_PROBE_BYTES = 32_768;
// Read size for binary digests; the scan time budget, not a byte cap, bounds large assets.
const DIGEST_CHUNK_BYTES = 1_048_576;
// Longest unbroken binary run held in memory; a longer run is scanned, then trimmed to its tail.
const BINARY_LINE_WINDOW_CHARS = 1_048_576;
// Tail kept after a trim; longer than any detector needs, so a token cut by the trim still matches.
const BINARY_LINE_OVERLAP_CHARS = 4_096;
// Key data after a private-key header: a base64 line (PEM or OpenSSH) or the legacy encrypted-PEM marker; a CRLF ending is allowed.
// A base64 line must contain a lowercase letter, so uppercase hex constants that libraries print near header text are not key data.
const PRIVATE_KEY_BODY =
  /^(?:(?=[A-Za-z0-9+/]*[a-z])[A-Za-z0-9+/]{40,}={0,2}|Proc-Type: 4,ENCRYPTED)\r?$/u;
// Runs after a header that may still hold its key data, enough to pass PGP "Version:" and "Comment:" lines.
const KEY_BODY_SEARCH_RUNS = 3;
// Temp-folder prefix for private staged copies, also used to find copies a killed Stop left behind.
const STAGED_COPY_PREFIX = "goat-flow-staged-blob-";
// A staged copy older than this was left by a killed Stop; live scans finish within their budget.
const STALE_STAGED_COPY_MS = 3_600_000;
// One line of binary text worth checking: a run of at least 20 bytes between newlines or NUL bytes.
// Shorter runs cannot hold a finding, because the shortest detectable secret (an AWS access key) is 20 characters.
const BINARY_TEXT_RUN = /[^\n\0]{20,}/gu;
// The numstat inventory and whole-file admission name the only gaps an unchanged replay may end.
const BINARY_GAP_MESSAGE =
  /^binary (changed|untracked|unborn worktree) path not scanned$/u;

// Global patterns: every match on a line is checked, so a placeholder earlier on the line cannot hide a real token.
const AWS_TOKEN = /(AKIA|ASIA)[A-Z0-9]{16}/gu;
const GITHUB_TOKEN =
  /gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,}/gu;
const NPM_TOKEN = /npm_[A-Za-z0-9]{36,}/gu;
const SLACK_TOKEN = /xox[baprs]-[A-Za-z0-9-]{20,}/gu;
const API_TOKEN = /sk-[A-Za-z0-9][A-Za-z0-9_-]{31,}/gu;
// A provider label anywhere before an `sk-` token marks it as an API key, even when the token is glued to other text.
const API_TOKEN_LABEL = /OPENAI|ANTHROPIC|API_KEY|TOKEN/u;
// A character that makes an unlabelled `sk-` match part of a longer word rather than a standalone token.
const WORD_CHARACTER = /[A-Za-z0-9_]/u;
// Encrypted PKCS#8 and PGP key blocks expose key material too, so they block like the other private-key headers.
const PRIVATE_KEY =
  /-----BEGIN[ \t\n\v\f\r](RSA[ \t\n\v\f\r]|DSA[ \t\n\v\f\r]|EC[ \t\n\v\f\r]|OPENSSH[ \t\n\v\f\r]|ENCRYPTED[ \t\n\v\f\r])?PRIVATE[ \t\n\v\f\r]KEY-----|-----BEGIN[ \t\n\v\f\r]PGP[ \t\n\v\f\r]PRIVATE[ \t\n\v\f\r]KEY[ \t\n\v\f\r]BLOCK-----/u;
const PLACEHOLDER_ALL_X = /^(gh[pousr]_|github_pat_|npm_|sk-)?x+$/u;
const PLACEHOLDER_MARKER =
  /(^|[_-])(example|placeholder|changeme|change-me|change_me|dummy|fake|sample|test|redacted|xxxx|your-token|your_token|your-key|your_key|your-api-key|your_api_key|not-a-secret)([_-]|$)/u;

// Candidate filters keep every detector input while skipping ordinary text, as the Bash grep prefilters did.
const DIFF_GLOBAL_CANDIDATE =
  /^diff --git |^\+\+\+ |^\+<<<<<<< |^\+={7}[\x00-\x1f\x7f]?$|^\+.*(-----BEGIN|(AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9][A-Za-z0-9_-]{31,})|^\+>>>>>>> /su;
const DIFF_STEM_CANDIDATE =
  /^\+.*(token|secret|password|api[-_]?key|private[-_]?key)/isu;
const CONTENT_GLOBAL_CANDIDATE =
  /^<<<<<<< |^={7}[\x00-\x1f\x7f]?$|^>>>>>>> |-----BEGIN|(AKIA|ASIA)[A-Z0-9]{16}|gh[pousr]_[A-Za-z0-9_]{30,}|github_pat_[A-Za-z0-9_]{20,}|npm_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{20,}|sk-[A-Za-z0-9][A-Za-z0-9_-]{31,}/u;
const CONTENT_STEM_CANDIDATE =
  /token|secret|password|api[-_]?key|private[-_]?key/iu;
const ENV_ASSIGNMENT_FILE =
  /^(\.env.*|.*\.env|.*\.env\..*|dockerfile|dockerfile\..*|.*\.dockerfile|.*\.sh|.*\.bash|.*\.zsh|.*\.ksh|.*\.yaml|.*\.yml|.*\.ini|.*\.toml|.*\.properties|.*\.conf|.*\.cfg)$/su;

// Final whole-file classes: scannable, oversized text, binary, unavailable, excluded symlink.
type FileClass =
  "scannable" | "oversized" | "binary" | "unavailable" | "symlink";

interface ScanState {
  context: PostTurnContext;
  maxFileBytes: number;
  maxFindings: number;
  maxSeconds: number;
  findings: number;
  reported: Set<string>;
  conflictPath: string;
  conflictState: number;
  isBailed: boolean;
  pendingFiles: number;
  incompleteKind: string;
  incompleteReason: string;
  coverageGapMessages: string[];
  coverageGapReported: Set<string>;
  coverageGaps: Array<{ path: string; message: string }>;
  diffFilesDone: number;
  fileClasses: Map<string, FileClass>;
  fileSizes: Map<string, number>;
}

function numericSetting(value: string | undefined, fallback: number) {
  return value !== undefined && /^(0|[1-9][0-9]*)$/u.test(value)
    ? Number(value)
    : fallback;
}

// Read the stop flag through a call: helpers change it, so a narrowed earlier check is stale.
function hasBailed(state: ScanState): boolean {
  return state.isBailed;
}

// Preserve the first failure that explains why the user's scan stopped.
function markScanIncomplete(state: ScanState, kind: string, reason: string) {
  // Later failures must not replace the first actionable explanation shown to the user.
  if (state.incompleteReason === "") {
    state.incompleteKind = kind;
    state.incompleteReason = reason;
  }
  state.isBailed = true;
}

// Record one declared changed path that cannot receive a complete text scan for the user.
function markCoverageGap(state: ScanState, path: string, message: string) {
  const key = `${path}|${message}`;
  // Staged and worktree views of one path should give the user one gap message.
  if (state.coverageGapReported.has(key)) return;
  state.coverageGapReported.add(key);
  state.coverageGaps.push({ path, message });
  const detail = message.startsWith("oversized")
    ? `${message} in ${path} (${state.fileSizes.get(path)} bytes; limit ${state.maxFileBytes}; review the file and raise GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES if appropriate)`
    : `${message} in ${path}`;
  state.coverageGapMessages.push(detail);
  recordPostTurnResultFinding(
    state.context,
    "coverage-gap",
    message.startsWith("oversized") ? detail : message,
    path,
  );
}

// Report whether the user's configured scan time has run out, without changing the scan result.
function isBudgetSpent(state: ScanState): boolean {
  const elapsedSeconds = Math.floor(
    (performance.now() - state.context.startedAt) / 1000,
  );
  return elapsedSeconds >= state.maxSeconds;
}

// Stop scanning when the user's time limit or a prior failure makes the result incomplete.
function budgetCheck(state: ScanState): boolean {
  // Reaching the configured limit leaves some user changes unverified.
  if (!state.isBailed && isBudgetSpent(state))
    markScanIncomplete(state, "budget", `budget ${state.maxSeconds}s exceeded`);
  return !state.isBailed;
}

// Run Git with fixed output settings; a failed or oversized result becomes the named incomplete reason.
function runGit(state: ScanState, args: string[], failureReason: string) {
  const result = spawnSync("git", args, {
    maxBuffer: GIT_OUTPUT_LIMIT_BYTES,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    markScanIncomplete(state, "command", failureReason);
    return null;
  }
  return result.stdout;
}

// Split NUL-delimited Git paths; a changed name Node cannot pass back to Git byte-for-byte stays a coverage gap.
function decodePathList(
  state: ScanState,
  output: Buffer,
  isChangeInventory: boolean,
): string[] {
  const paths: string[] = [];
  let start = 0;
  for (
    let index = output.indexOf(0);
    index >= 0;
    index = output.indexOf(0, start)
  ) {
    const bytes = output.subarray(start, index);
    const path = bytes.toString("utf8");
    if (Buffer.from(path, "utf8").equals(bytes)) paths.push(path);
    // A lookup list only filters paths already collected, so an undecodable name there is not changed content.
    else if (isChangeInventory)
      markCoverageGap(
        state,
        bytes.toString("latin1"),
        "changed path name is not valid UTF-8",
      );
    start = index + 1;
  }
  return paths;
}

// Collect a NUL-delimited Git path inventory without losing unusual user filenames.
function collectPaths(
  state: ScanState,
  args: string[],
  isChangeInventory = true,
): string[] {
  const output = runGit(state, args, "Git path inventory failed");
  return output === null
    ? []
    : decodePathList(state, output, isChangeInventory);
}

function chunksOf(paths: string[]): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < paths.length; index += CHUNK_SIZE)
    chunks.push(paths.slice(index, index + CHUNK_SIZE));
  return chunks;
}

// Read leading bytes for the binary check; an unreadable file is unavailable rather than clean.
function readLeadingBytes(path: string, length: number): Buffer | null {
  try {
    const descriptor = openSync(path, "r");
    try {
      const bytes = Buffer.alloc(length);
      return bytes.subarray(0, readSync(descriptor, bytes, 0, length, 0));
    } finally {
      closeSync(descriptor);
    }
  } catch {
    return null;
  }
}

// Classify one full-content path before the scanner reads user-authored lines.
function classifyFile(state: ScanState, path: string): FileClass {
  let size: number;
  try {
    const entry = lstatSync(path);
    // Untracked symlinks are deliberately not followed outside the user's repository.
    if (entry.isSymbolicLink()) return "symlink";
    // A path that vanished after Git inventory cannot count as scanned.
    if (!entry.isFile()) return "unavailable";
    size = entry.size;
    state.fileSizes.set(path, size);
  } catch {
    return "unavailable";
  }
  // Admissible files are probed whole, so a NUL byte anywhere marks them binary; oversized files only need enough to name the gap.
  const probe = readLeadingBytes(
    path,
    Math.max(1, size <= state.maxFileBytes ? size : BINARY_PROBE_BYTES),
  );
  if (probe === null) return "unavailable";
  // Empty user files contain no text findings but still count as completely inspected.
  if (size === 0) return "scannable";
  // A NUL byte marks content the text detectors cannot read, as grep -I treats it.
  if (probe.includes(0)) return "binary";
  return size <= state.maxFileBytes ? "scannable" : "oversized";
}

// Give every full-content path an explicit admission or exclusion result.
function gateScannableFiles(state: ScanState, paths: string[]) {
  for (const chunk of chunksOf(paths)) {
    if (!budgetCheck(state)) return;
    for (const path of chunk)
      state.fileClasses.set(path, classifyFile(state, path));
  }
}

// Keep documented placeholder values usable in examples and setup screens.
function isPlaceholderToken(token: string): boolean {
  const value = token.toLowerCase();
  if (
    value === "" ||
    value === "akiaiosfodnn7example" ||
    value === "asiaiosfodnn7example"
  )
    return true;
  return PLACEHOLDER_ALL_X.test(value) || PLACEHOLDER_MARKER.test(value);
}

// Admit only config-shaped files to generic credential-assignment checks.
function isEnvAssignmentFile(path: string): boolean {
  const lowerPath = path.toLowerCase();
  return ENV_ASSIGNMENT_FILE.test(
    lowerPath.slice(lowerPath.lastIndexOf("/") + 1),
  );
}

// Emit one finding per family and path without repeating user guidance.
function reportFinding(state: ScanState, path: string, family: string) {
  const fingerprint = `${path}|${family}`;
  if (state.reported.has(fingerprint)) return;
  state.reported.add(fingerprint);
  state.findings += 1;
  recordPostTurnResultFinding(
    state.context,
    "safety-hazard",
    `Blocked ${family} in changed content`,
    path,
  );
  // Direct terminal use shows capped findings; managed mode keeps them in JSON without duplicate diagnostics.
  if (!state.context.managedResultMode && state.findings <= state.maxFindings)
    process.stderr.write(`post-turn-safety: blocked ${family} in ${path}\n`);
}

// Reset ordered conflict-marker state when scanning moves to another file.
function resetMergeConflictScan(state: ScanState, path: string) {
  state.conflictPath = path;
  state.conflictState = 0;
}

// Track a complete conflict triplet so Markdown headings do not block the user.
function scanMergeConflictMarker(state: ScanState, path: string, line: string) {
  // A new file cannot complete a conflict sequence started in the previous file.
  if (state.conflictPath !== path) resetMergeConflictScan(state, path);
  if (line.startsWith("<<<<<<< ")) state.conflictState = 1;
  // The middle marker advances only a conflict already opened in this file.
  else if (line === "=======" && state.conflictState === 1)
    state.conflictState = 2;
  else if (line.startsWith(">>>>>>> ")) {
    // A closing marker reports only the complete triplet the user must resolve.
    if (state.conflictState === 2)
      reportFinding(state, path, "merge conflict marker");
    state.conflictState = 0;
  }
}

// Apply every detector to one changed line the user authored.
function scanLine(state: ScanState, path: string, rawLine: string) {
  // A Windows-edited line carries one trailing CR; remove it before user-facing detectors run.
  const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
  scanMergeConflictMarker(state, path, line);
  scanTokens(state, path, line);
  // Config-shaped files also receive literal credential-assignment checks.
  if (isEnvAssignmentFile(path))
    for (const family of credentialAssignmentFamilies(
      path,
      line,
      isPlaceholderToken,
    ))
      reportFinding(state, path, family);
}

/**
 * Report private-key headers and provider token shapes in one line, skipping obvious placeholders.
 *
 * @param state - scan state that records findings for the user
 * @param path - repository path named in any finding
 * @param line - one line of changed content; empty finds nothing
 * @param options - binary-run context; empty means an ordinary text line, where a key header alone blocks
 */
function scanTokens(
  state: ScanState,
  path: string,
  line: string,
  options: TokenScanOptions = {},
) {
  // In text a private-key header means the file can expose a key block; binary runs also need key data (see scanBinaryRun).
  if (!options.isBinaryRun && PRIVATE_KEY.test(line))
    reportFinding(state, path, "private key block");
  reportFirstRealToken(state, path, "AWS access key", AWS_TOKEN, line);
  // Both legacy and fine-grained GitHub tokens share one user-facing family.
  reportFirstRealToken(state, path, "GitHub token", GITHUB_TOKEN, line);
  reportFirstRealToken(state, path, "npm token", NPM_TOKEN, line);
  reportFirstRealToken(state, path, "Slack token", SLACK_TOKEN, line);
  reportFirstRealApiToken(state, path, line, options.isLabelEarlier ?? false);
}

/**
 * Report an `sk-` API key that is labelled earlier in the line or stands alone, skipping obvious placeholders.
 *
 * @param state - scan state that records findings for the user
 * @param path - repository path named in the finding
 * @param line - one line of changed content; empty finds nothing
 * @param isLabelEarlier - true when a provider label was trimmed out of this line before the scanned text
 */
function reportFirstRealApiToken(
  state: ScanState,
  path: string,
  line: string,
  isLabelEarlier: boolean,
): void {
  const labelAt = API_TOKEN_LABEL.exec(line)?.index ?? -1;
  // Each `sk-` match is an API key when a label came earlier in the line or when it stands alone, not glued to a word.
  for (const match of line.matchAll(API_TOKEN)) {
    const isLabelled =
      isLabelEarlier || (labelAt >= 0 && labelAt < match.index);
    const isStandalone =
      match.index === 0 || !WORD_CHARACTER.test(line.charAt(match.index - 1));
    // The first real labelled or standalone key blocks the Stop; one finding per family is enough.
    if ((isLabelled || isStandalone) && !isPlaceholderToken(match[0])) {
      reportFinding(state, path, "API token");
      return;
    }
  }
}

/**
 * Report a token family when any match on the line is real, so an example value earlier on the line cannot hide a real secret.
 *
 * @param state - scan state that records findings for the user
 * @param path - repository path named in the finding
 * @param family - user-facing token family, such as "GitHub token"
 * @param pattern - global token pattern for this family
 * @param line - one line of changed content; empty finds nothing
 */
function reportFirstRealToken(
  state: ScanState,
  path: string,
  family: string,
  pattern: RegExp,
  line: string,
): void {
  // The first match that is not an obvious placeholder is enough to block the Stop.
  for (const match of line.matchAll(pattern)) {
    if (!isPlaceholderToken(match[0])) {
      reportFinding(state, path, family);
      return;
    }
  }
}

// Decode a Git-quoted path so findings show the actual filename, including non-ASCII names and escapes.
function unquoteGitPath(encoded: string): string {
  const escapes: Record<string, number> = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
  };
  const body = encoded.replace(/^"/u, "").replace(/"$/u, "");
  const bytes: number[] = [];
  for (let index = 0; index < body.length; index += 1) {
    const character = body.charCodeAt(index);
    if (body[index] !== "\\") {
      bytes.push(character);
      continue;
    }
    const octal = /^[0-7]{1,3}/u.exec(body.slice(index + 1))?.[0];
    if (octal !== undefined) {
      bytes.push(Number.parseInt(octal, 8) & 0xff);
      index += octal.length;
      continue;
    }
    const escaped = body[index + 1] ?? "";
    bytes.push(escapes[escaped] ?? escaped.charCodeAt(0));
    index += 1;
  }
  return Buffer.from(bytes).toString("utf8");
}

// Turn a diff destination header into the repository path the user sees, or null for a deletion.
function diffDestination(header: string): string | null {
  const destination = header.slice("+++ ".length);
  if (destination === "/dev/null") return null;
  // The stream is read as Latin-1 so detectors see raw bytes; paths convert back to their UTF-8 names.
  const decoded = destination.startsWith('"')
    ? unquoteGitPath(destination)
    : Buffer.from(destination.replace(/\t$/u, ""), "latin1").toString("utf8");
  return decoded.replace(/^b\//u, "");
}

interface DiffSection {
  path: string;
  isScanningFile: boolean;
  isConfigFile: boolean;
  isExpectingHeader: boolean;
}

// Track Git section and destination headers; true means the line was a header rather than added content.
function consumeDiffHeader(
  state: ScanState,
  section: DiffSection,
  line: string,
): boolean {
  // A real Git section header resets path attribution before added user text.
  if (line.startsWith("diff --git ")) {
    section.isExpectingHeader = true;
    section.isScanningFile = false;
    return true;
  }
  // Only the destination header immediately after a section selects a user path.
  if (!section.isExpectingHeader || !line.startsWith("+++ ")) return false;
  section.isExpectingHeader = false;
  const destination = diffDestination(line);
  // A deleted file has no added content for the safety scanner to inspect.
  section.isScanningFile = destination !== null;
  if (destination === null) return true;
  section.path = destination;
  section.isConfigFile = isEnvAssignmentFile(destination);
  resetMergeConflictScan(state, destination);
  state.diffFilesDone += 1;
  return true;
}

// Global candidates feed every detector and carry headers; config-key stems matter only in config-shaped files.
function diffCandidateKind(line: string): "global" | "stem" | null {
  if (DIFF_GLOBAL_CANDIDATE.test(line)) return "global";
  return DIFF_STEM_CANDIDATE.test(line) ? "stem" : null;
}

// Scan one Git diff stream in the user's file and line order; empty added content produces no finding.
function scanDiffStream(state: ScanState, stream: string) {
  const section: DiffSection = {
    path: "",
    isScanningFile: false,
    isConfigFile: false,
    isExpectingHeader: false,
  };
  for (const line of stream.split("\n")) {
    const candidate = diffCandidateKind(line);
    if (candidate === null) continue;
    if (!budgetCheck(state)) return;
    if (candidate === "global" && consumeDiffHeader(state, section, line))
      continue;
    // After the destination header every '+' line is added content, including text that itself starts with '++'.
    if (!section.isScanningFile || !line.startsWith("+")) continue;
    if (candidate === "global" || section.isConfigFile)
      scanLine(state, section.path, line.slice(1));
  }
}

// Record binary changed paths, which have no added text hunks, as explicit coverage gaps.
function recordBinaryPaths(state: ScanState, inventory: Buffer) {
  for (const record of inventory.toString("utf8").split("\0")) {
    if (record.startsWith("-\t-\t"))
      markCoverageGap(
        state,
        record.slice(4),
        "binary changed path not scanned",
      );
  }
}

// Stream one worktree or staged path batch with pinned prefixes so personal Git settings cannot change attribution.
function runDiffBatch(
  state: ScanState,
  mode: "worktree" | "cached",
  paths: string[],
) {
  const cachedFlag = mode === "cached" ? ["--cached"] : [];
  const headRevision = mode === "cached" ? [] : ["HEAD"];
  const pinnedOutput = [
    "-c",
    "core.quotepath=off",
    "-c",
    "diff.noprefix=false",
    "-c",
    "diff.mnemonicprefix=false",
    "-c",
    "diff.srcprefix=a/",
    "-c",
    "diff.dstprefix=b/",
  ];
  for (const chunk of chunksOf(paths)) {
    if (!budgetCheck(state)) return;
    const inventory = runGit(
      state,
      ["-c", "core.quotepath=off", "diff", ...cachedFlag]
        .concat([
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--numstat",
          "--no-renames",
        ])
        .concat(["--diff-filter=ACMRT", "-z", ...headRevision, "--", ...chunk]),
      "Git binary inventory failed",
    );
    if (inventory === null) return;
    recordBinaryPaths(state, inventory);
    const stream = runGit(
      state,
      [...pinnedOutput, "diff", ...cachedFlag]
        .concat(["--no-ext-diff", "--no-textconv", "--no-color", "--unified=0"])
        .concat([...headRevision, "--", ...chunk]),
      "Git diff command failed",
    );
    if (stream === null) return;
    scanDiffStream(state, stream.toString("latin1"));
  }
}

// Scan gated whole files with the same ordered detectors; an empty list is clean.
function scanContentFiles(state: ScanState, paths: string[]) {
  for (const chunk of chunksOf(paths)) {
    if (!budgetCheck(state)) return;
    for (const path of chunk) {
      let content: string;
      try {
        content = readFileSync(path).toString("latin1");
      } catch {
        // Candidate selection must finish before any file in this batch can pass.
        markScanIncomplete(state, "command", "content candidate grep failed");
        return;
      }
      const isConfigFile = isEnvAssignmentFile(path);
      resetMergeConflictScan(state, path);
      for (const line of content.split("\n")) {
        const isGlobal = CONTENT_GLOBAL_CANDIDATE.test(line);
        if (!isGlobal && !(isConfigFile && CONTENT_STEM_CANDIDATE.test(line)))
          continue;
        if (!budgetCheck(state)) return;
        scanLine(state, path, line);
      }
    }
  }
}

// Admit an unborn or untracked path, or name the coverage gap that keeps it unscanned.
function admitWholeFile(state: ScanState, path: string, scope: string) {
  const fileClass = state.fileClasses.get(path);
  if (fileClass === "scannable") return true;
  if (fileClass === "oversized")
    markCoverageGap(state, path, `oversized ${scope} text not scanned`);
  else if (fileClass === "binary")
    markCoverageGap(state, path, `binary ${scope} path not scanned`);
  else if (fileClass === "unavailable")
    markCoverageGap(state, path, `${scope} path unavailable`);
  return false;
}

function createScanState(context: PostTurnContext): ScanState {
  const environment = context.environment;
  return {
    context,
    maxFileBytes: numericSetting(
      environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES,
      1_048_576,
    ),
    maxFindings: numericSetting(
      environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_FINDINGS?.replace(
        /^0+(?=[0-9])/u,
        "",
      ),
      20,
    ),
    maxSeconds: numericSetting(
      environment.GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS?.replace(
        /^0+(?=[0-9])/u,
        "",
      ),
      60,
    ),
    findings: 0,
    reported: new Set(),
    conflictPath: "",
    conflictState: 0,
    isBailed: false,
    pendingFiles: 0,
    incompleteKind: "",
    incompleteReason: "",
    coverageGapMessages: [],
    coverageGapReported: new Set(),
    coverageGaps: [],
    diffFilesDone: 0,
    fileClasses: new Map(),
    fileSizes: new Map(),
  };
}

// Inspect tracked worktree edits first; before the first commit, admitted whole files stand in for changed hunks.
function scanTrackedChanges(
  state: ScanState,
  worktreePaths: string[],
  hasHead: boolean,
) {
  const scanned = new Set<string>();
  for (const path of worktreePaths)
    if (hasHead || admitWholeFile(state, path, "unborn worktree"))
      scanned.add(path);
  if (!budgetCheck(state)) return scanned;
  if (hasHead) {
    state.diffFilesDone = 0;
    runDiffBatch(state, "worktree", [...scanned]);
    state.pendingFiles -= state.isBailed
      ? state.diffFilesDone
      : worktreePaths.length;
  } else {
    scanContentFiles(state, [...scanned]);
    // Completion accounting advances only after the unborn full-content scan finishes.
    if (!state.isBailed) state.pendingFiles -= worktreePaths.length;
  }
  return scanned;
}

// Skip staged content only when it matches worktree content already scanned, so no finding is lost.
function scanStagedChanges(
  state: ScanState,
  cachedPaths: string[],
  scanned: Set<string>,
  hasHead: boolean,
) {
  if (state.isBailed || cachedPaths.length === 0) return;
  // A committed baseline can skip staged content already identical to pass one; only a complete comparison authorizes it.
  const dirtyVsIndex = new Set(
    hasHead
      ? collectPaths(state, ["diff", "--name-only", "-z", "--"], false)
      : [],
  );
  if (hasBailed(state)) return;
  const candidates = cachedPaths.filter(
    (path) => !hasHead || dirtyVsIndex.has(path) || !scanned.has(path),
  );
  state.diffFilesDone = 0;
  runDiffBatch(state, "cached", candidates);
  state.pendingFiles -= hasBailed(state)
    ? state.diffFilesDone
    : cachedPaths.length;
}

// Print the incomplete-scan explanations the user needs before the final decision.
function reportIncompleteScan(state: ScanState) {
  // Budget failures name unscanned files; command failures name the failed operation.
  if (state.isBailed && state.incompleteKind === "budget")
    process.stderr.write(
      `post-turn-safety: scan incomplete, ${Math.max(state.pendingFiles, 1)} file(s) unscanned (budget ${state.maxSeconds}s exceeded; raise GOAT_FLOW_POST_TURN_SAFETY_MAX_SECONDS to scan more).\n`,
    );
  else if (state.isBailed)
    process.stderr.write(
      `post-turn-safety: scan incomplete (${state.incompleteReason}).\n`,
    );
  // Every skipped declared path gets a concise relative-path explanation for the user.
  for (const message of state.coverageGapMessages)
    process.stderr.write(`post-turn-safety: scan incomplete (${message}).\n`);
}

// Context for one scanned line: `isLabelEarlier` marks a provider label trimmed from a long binary run,
// and `isBinaryRun` defers key-header findings to scanBinaryRun, which also needs key data.
interface TokenScanOptions {
  isLabelEarlier?: boolean;
  isBinaryRun?: boolean;
}

/**
 * One text reading of binary bytes, carried from chunk to chunk.
 *
 * - `pending` holds the line still waiting for its newline or NUL.
 * - `isLabelEarlier` remembers a provider label that a window trim removed from that line.
 * - `keyHeaderRunsLeft` counts how many more runs may still hold key data after a private-key header; 0 means none is open.
 */
interface BinaryTextView {
  pending: string;
  isLabelEarlier: boolean;
  keyHeaderRunsLeft: number;
}

/**
 * Check one run of binary text, reporting a private key only when key data follows its header.
 * Example: a TLS library or the ssh program embeds header text with no key after it, so staging that program does not block every Stop.
 *
 * @param state - scan state that records findings for the user
 * @param path - repository path named in any finding
 * @param view - text view that remembers an open key header between runs
 * @param run - one run of at least 20 characters between newlines or NUL bytes
 * @param isLabelEarlier - true when a provider label was trimmed out of this run's line
 */
function scanBinaryRun(
  state: ScanState,
  path: string,
  view: BinaryTextView,
  run: string,
  isLabelEarlier: boolean,
): void {
  // A run shortly after a key header that looks like key data means a real key block was saved in the file.
  if (view.keyHeaderRunsLeft > 0) {
    if (PRIVATE_KEY_BODY.test(run))
      reportFinding(state, path, "private key block");
    view.keyHeaderRunsLeft -= 1;
  }
  // A header opens a short search for its key data; header text in a program's string table never finds any.
  if (PRIVATE_KEY.test(run)) view.keyHeaderRunsLeft = KEY_BODY_SEARCH_RUNS;
  scanTokens(state, path, run, { isLabelEarlier, isBinaryRun: true });
}

/**
 * Scan one chunk of a binary text view line by line, keeping an unfinished line for the next chunk.
 * Used while a skipped binary file is checked for secrets before an unchanged Stop retry may end the agent's turn.
 *
 * @param state - scan state that records findings and the time budget
 * @param path - repository path named in any finding the user sees
 * @param view - text view whose unfinished line carries across chunks
 * @param text - next chunk of this view as latin1 text; empty adds nothing
 * @returns false when the time budget ran out, which leaves the turn blocked
 */
function scanBinaryView(
  state: ScanState,
  path: string,
  view: BinaryTextView,
  text: string,
): boolean {
  const combined = view.pending + text;
  const lastBreak = Math.max(
    combined.lastIndexOf("\n"),
    combined.lastIndexOf("\0"),
  );
  const carriedLabel = view.isLabelEarlier;
  view.pending = combined.slice(lastBreak + 1);
  // Only runs long enough to hold a secret are visited, so zero-padded assets and short binary fragments scan quickly.
  for (const match of combined
    .slice(0, Math.max(lastBreak, 0))
    .matchAll(BINARY_TEXT_RUN)) {
    // A spent budget stops here, and the user's turn stays blocked.
    if (!budgetCheck(state)) return false;
    // Only the run that finishes the carried line inherits a label trimmed from that line.
    scanBinaryRun(
      state,
      path,
      view,
      match[0],
      carriedLabel && match.index === 0,
    );
  }
  // A line break ended the carried line, so its trimmed label no longer applies.
  if (lastBreak >= 0) view.isLabelEarlier = false;
  // A huge run with no line break is scanned in windows, so a large asset is neither skipped nor held whole in memory.
  if (view.pending.length > BINARY_LINE_WINDOW_CHARS) {
    scanBinaryRun(state, path, view, view.pending, view.isLabelEarlier);
    // Remember a label about to be trimmed; the slice reaches a little into the kept tail, so a label cut in half still counts.
    view.isLabelEarlier ||= API_TOKEN_LABEL.test(
      view.pending.slice(0, -BINARY_LINE_OVERLAP_CHARS + 16),
    );
    view.pending = view.pending.slice(-BINARY_LINE_OVERLAP_CHARS);
  }
  return true;
}

/**
 * Split bytes into even-position and odd-position views that keep only UTF-16 characters, for example a token saved by a Windows tool.
 *
 * A byte counts as a character only when a NUL sits next to it, as in "A\0B\0".
 * Plain binary text, such as a library symbol table, has no NUL beside each character, so it becomes separators and cannot spell a fake token.
 *
 * @param bytes - bytes to split; the byte after the last emitted one serves only as lookahead
 * @param offset - file position of `bytes[0]`; it keeps both views aligned across chunks
 * @param previousByte - the file byte just before `bytes`; -1 at the start of the file
 * @param end - number of leading bytes to emit; 0 emits nothing
 * @returns even-position and odd-position text, with NUL characters as separators
 */
function utf16Views(
  bytes: Buffer,
  offset: number,
  previousByte: number,
  end: number,
): [string, string] {
  const evenBytes = Buffer.allocUnsafe(Math.ceil(end / 2) + 1);
  const oddBytes = Buffer.allocUnsafe(Math.ceil(end / 2) + 1);
  let evenLength = 0;
  let oddLength = 0;
  // Each emitted byte goes to the view that matches its position in the whole file, not just in this chunk.
  for (let index = 0; index < end; index += 1) {
    const byte = bytes[index] as number;
    const before = index > 0 ? (bytes[index - 1] as number) : previousByte;
    const after = index + 1 < bytes.length ? (bytes[index + 1] as number) : -1;
    // Only a non-NUL byte with a NUL neighbour is a UTF-16 character; anything else becomes a separator.
    const value = byte !== 0 && (before === 0 || after === 0) ? byte : 0;
    // Even file positions carry UTF-16LE text that starts on an even byte, or UTF-16BE text that starts one byte later.
    if ((offset + index) % 2 === 0) evenBytes[evenLength++] = value;
    else oddBytes[oddLength++] = value;
  }
  return [
    evenBytes.toString("latin1", 0, evenLength),
    oddBytes.toString("latin1", 0, oddLength),
  ];
}

/**
 * Check one binary byte stream for secrets as raw text and as UTF-16 in either byte order.
 * Feed it each chunk in file order, then finish it; any false result leaves the agent's turn blocked.
 *
 * @param state - scan state that records findings and the time budget
 * @param path - repository path named in any finding the user sees
 * @returns feed and finish steps that report false when the time budget ran out
 */
function createBinaryTextScan(state: ScanState, path: string) {
  const raw: BinaryTextView = {
    pending: "",
    isLabelEarlier: false,
    keyHeaderRunsLeft: 0,
  };
  const even: BinaryTextView = {
    pending: "",
    isLabelEarlier: false,
    keyHeaderRunsLeft: 0,
  };
  const odd: BinaryTextView = {
    pending: "",
    isLabelEarlier: false,
    keyHeaderRunsLeft: 0,
  };
  // The last byte of each chunk waits for the next chunk, because its UTF-16 status depends on the byte after it.
  let heldBytes: Buffer = Buffer.alloc(0);
  let previousByte = -1;
  let offset = 0;
  // Emit the UTF-16 views for `block`, all but its last byte unless this is the end of the file.
  const scanUtf16 = (block: Buffer, isEnd: boolean): boolean => {
    const end = isEnd ? block.length : Math.max(block.length - 1, 0);
    const [evenText, oddText] = utf16Views(block, offset, previousByte, end);
    offset += end;
    // Remember the byte before the held one, so the next chunk can judge it.
    if (end > 0) previousByte = block[end - 1] as number;
    heldBytes = block.subarray(end);
    return (
      scanBinaryView(state, path, even, evenText) &&
      scanBinaryView(state, path, odd, oddText)
    );
  };
  return {
    feed(bytes: Buffer): boolean {
      // The caller reuses its read buffer, so the held byte is copied before the next read overwrites it.
      const block = Buffer.concat([heldBytes, bytes]);
      return (
        scanBinaryView(state, path, raw, bytes.toString("latin1")) &&
        scanUtf16(block, false)
      );
    },
    finish(): boolean {
      // The held last byte of the file has no byte after it, so it is judged here.
      if (!scanUtf16(heldBytes, true)) return false;
      // A spent budget means the last lines were never checked, so the turn stays blocked.
      if (!budgetCheck(state)) return false;
      // The file's last line has no terminator, so each view checks it here.
      for (const view of [raw, even, odd])
        scanBinaryRun(state, path, view, view.pending, view.isLabelEarlier);
      return true;
    },
  };
}

/**
 * Copy one staged blob to a private temp file and scan it there, so an asset the user staged is checked whatever its size.
 * Example: the user staged a 300 MiB scene export; an in-memory Git read would fail and block every Stop.
 *
 * @param state - scan state that records findings, failures and the time budget
 * @param path - repository path named in any finding the user sees
 * @param blob - staged blob id from the index; never empty
 * @returns false when the copy failed or the budget ran out, which leaves the turn blocked
 */
function scanStagedBlob(state: ScanState, path: string, blob: string): boolean {
  let directory: string | null = null;
  try {
    removeStaleStagedCopies(state);
    directory = mkdtempSync(join(tmpdir(), STAGED_COPY_PREFIX));
    const descriptor = openSync(join(directory, "blob"), "w+", 0o600);
    try {
      const copied = spawnSync("git", ["cat-file", "blob", blob], {
        stdio: ["ignore", descriptor, "pipe"],
        timeout: remainingBudgetMs(state),
        windowsHide: true,
      });
      // The copy ran past the scan budget, for example a multi-gigabyte asset on a slow disk; the turn stays blocked.
      if (!budgetCheck(state)) return false;
      // Git could not write the staged copy, for example after the user unstaged or garbage-collected it mid-scan.
      if (copied.error || copied.status !== 0) {
        markScanIncomplete(state, "command", "Git binary blob read failed");
        return false;
      }
      const textScan = createBinaryTextScan(state, path);
      const buffer = Buffer.alloc(DIGEST_CHUNK_BYTES);
      let total = 0;
      // Read the copy chunk by chunk, so memory stays small however large the staged asset is.
      for (
        let count = readSync(descriptor, buffer, 0, buffer.length, 0);
        count > 0;
        count = readSync(descriptor, buffer, 0, buffer.length, total)
      ) {
        // A spent budget leaves part of the staged copy unread, so the turn stays blocked.
        if (!budgetCheck(state) || !textScan.feed(buffer.subarray(0, count)))
          return false;
        total += count;
      }
      return textScan.finish();
    } finally {
      closeSync(descriptor);
    }
  } catch {
    // Example: the temp folder is full or read-only, so the staged copy stays unchecked and the turn stays blocked.
    markScanIncomplete(state, "command", "Git binary blob read failed");
    return false;
  } finally {
    // Only a created temp folder needs removing.
    if (directory !== null) removeStagedCopy(directory);
  }
}

/**
 * Milliseconds left in the scan budget, used to stop a slow staged copy; at least 1 so Node applies the limit.
 *
 * @param state - scan state that holds the budget and the hook start time
 * @returns remaining budget in milliseconds; 1 when the budget is already spent
 */
function remainingBudgetMs(state: ScanState): number {
  const elapsedMs = performance.now() - state.context.startedAt;
  return Math.max(1, Math.floor(state.maxSeconds * 1000 - elapsedMs));
}

/**
 * Delete private staged copies that an earlier Stop left behind when it was killed mid-scan, for example by a provider timeout.
 * A copy counts as stale only when it is far older than any scan budget, so a parallel session's live copy is never touched.
 *
 * @param state - scan state that holds the budget used to judge staleness
 */
function removeStaleStagedCopies(state: ScanState): void {
  const staleAfterMs = Math.max(STALE_STAGED_COPY_MS, state.maxSeconds * 2000);
  // Every leftover copy folder in the temp directory is checked; other files are ignored.
  for (const name of readdirSync(tmpdir())) {
    // Only folders this hook created are candidates.
    if (!name.startsWith(STAGED_COPY_PREFIX)) continue;
    const folder = join(tmpdir(), name);
    const stats = lstatSync(folder, { throwIfNoEntry: false });
    // A folder already removed by another Stop, or still young enough to be a live scan, is left alone.
    if (stats?.isDirectory() && Date.now() - stats.mtimeMs > staleAfterMs)
      removeStagedCopy(folder);
  }
}

/**
 * Delete the private staged copy once it has been scanned; if that fails, warn the user on stderr where it was left.
 *
 * @param directory - temp folder made for one staged blob; never empty
 */
function removeStagedCopy(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true });
  } catch {
    // Example: antivirus briefly locks the file on Windows; the scan result stands, but the user is told where the copy remains.
    process.stderr.write(
      `post-turn-safety: could not remove the temporary staged copy in ${directory}; delete it manually.\n`,
    );
  }
}

// A changed path or descriptor cannot inherit an earlier replay's identity, even when its bytes and size match.
function isSameBinaryFile(before: Stats, after: Stats): boolean {
  return (
    after.isFile() &&
    after.size === before.size &&
    after.dev === before.dev &&
    after.ino === before.ino &&
    after.mtimeMs === before.mtimeMs &&
    after.ctimeMs === before.ctimeMs
  );
}

// Scan and hash one open file without retaining the entire asset; null means its complete bytes could not be checked.
function digestBinaryDescriptor(
  state: ScanState,
  path: string,
  descriptor: number,
) {
  const digest = createHash("sha256");
  const buffer = Buffer.alloc(DIGEST_CHUNK_BYTES);
  const textScan = createBinaryTextScan(state, path);
  let total = 0;
  let hasNulByte = false;
  // Hash and scan the file chunk by chunk, so memory stays small however large the asset is.
  for (
    let count = readSync(descriptor, buffer, 0, buffer.length, 0);
    count > 0;
    count = readSync(descriptor, buffer, 0, buffer.length, total)
  ) {
    // A spent budget means the file was not fully checked, so it gets no identity and the turn stays blocked.
    if (!budgetCheck(state)) return null;
    const bytes = buffer.subarray(0, count);
    hasNulByte ||= bytes.includes(0);
    digest.update(bytes);
    total += count;
    // The text scan also ran out of budget part-way through this chunk.
    if (!textScan.feed(bytes)) return null;
  }
  // The final unfinished lines could not be checked in time.
  if (!textScan.finish()) return null;
  return { hash: digest.digest("hex"), total, hasNulByte };
}

// Scan and digest the same stable gap bytes; null leaves the identity unavailable and the turn blocked.
function digestBinaryFile(state: ScanState, path: string): string | null {
  try {
    const before = lstatSync(path);
    if (!before.isFile()) return null;
    const descriptor = openSync(path, "r");
    let result;
    try {
      if (!isSameBinaryFile(before, fstatSync(descriptor))) return null;
      result = digestBinaryDescriptor(state, path, descriptor);
    } finally {
      closeSync(descriptor);
    }
    if (
      result === null ||
      result.total !== before.size ||
      !isSameBinaryFile(before, lstatSync(path))
    )
      return null;
    // Git also reports `-diff` text as binary; without a NUL byte the file keeps blocking every Stop.
    return result.hasNulByte ? result.hash : null;
  } catch {
    // A vanished or unreadable file has no trustworthy identity, so the turn stays blocked.
    return null;
  }
}

// Map each gap path to its staged blob id, one Git call per batch; null means the index was unreadable or a path is unmerged.
function stagedBlobIds(paths: string[]): Map<string, string> | null {
  const blobs = new Map<string, string>();
  for (const chunk of chunksOf(paths)) {
    const result = spawnSync(
      "git",
      ["--literal-pathspecs", "ls-files", "-s", "-z", "--", ...chunk],
      { maxBuffer: GIT_OUTPUT_LIMIT_BYTES, windowsHide: true },
    );
    if (result.error || result.status !== 0) return null;
    for (const record of result.stdout.toString("utf8").split("\0")) {
      if (record === "") continue;
      // Example record: "100644 <blob> 0\tmodels/a.glb"; a conflict stage leaves the staged bytes ambiguous.
      const fields = record.match(/^[0-7]+ ([0-9a-f]+) ([0-3])\t(.*)$/su);
      if (fields === null || fields[2] !== "0") return null;
      blobs.set(fields[3] as string, fields[1] as string);
    }
  }
  return blobs;
}

// Identify every binary gap by root, path, message, worktree digest and staged blob; null keeps the turn blocked.
function binaryGapIdentity(state: ScanState, root: string): string | null {
  if (state.findings > 0 || !hasOnlyBinaryGaps(state)) return null;
  const blobs = stagedBlobIds([
    ...new Set(state.coverageGaps.map((gap) => gap.path)),
  ]);
  if (blobs === null) return null;
  const entries: string[] = [];
  for (const gap of state.coverageGaps) {
    const digest = digestBinaryFile(state, gap.path);
    if (digest === null) return null;
    // An untracked binary has no index entry, recorded as "-" so staging it later changes the identity.
    const blob = blobs.get(gap.path) ?? "-";
    // The staged copy is what a commit would publish, so it is scanned in full even when the worktree copy is clean.
    if (blob !== "-" && !scanStagedBlob(state, gap.path, blob)) return null;
    entries.push(JSON.stringify([gap.path, gap.message, digest, blob]));
  }
  return ["coverage-gap:v1", root, ...entries.sort()].join("\n");
}

// True when the finished scan skipped only binary files; an unfinished scan or any other gap is never eligible for replay release.
function hasOnlyBinaryGaps(state: ScanState): boolean {
  return (
    !state.isBailed &&
    state.coverageGaps.length > 0 &&
    state.coverageGaps.every((gap) => BINARY_GAP_MESSAGE.test(gap.message))
  );
}

// Turn the scan state into the Stop status; findings always block, and only command failures or unchanged binary gaps may end a repeated Stop.
function finishScan(state: ScanState, root: string, variant: string): number {
  // Binary classification is only a coverage warning; both committable views must be checked before any release.
  const gapIdentity = binaryGapIdentity(state, root);
  const context = state.context;
  context.detectedFindings = state.findings;
  context.incomplete = state.isBailed;
  context.coverageGap = state.coverageGapMessages.length > 0;
  if (state.incompleteReason !== "") context.detail = state.incompleteReason;
  reportIncompleteScan(state);
  if (state.findings > 0) {
    clearStopReentryState(context, root);
    // The cap hides duplicate detail, then reports how many user actions remain.
    if (state.findings > state.maxFindings)
      process.stderr.write(
        `post-turn-safety: ${state.findings - state.maxFindings} additional finding(s) hidden by output cap.\n`,
      );
    process.stderr.write(
      "post-turn-safety: fix or remove the flagged changed content before stopping.\n",
    );
    return 2;
  }
  // Only stable binary gaps with no high-confidence secret may end an unchanged replay; all other gaps remain blocking.
  if (hasOnlyBinaryGaps(state))
    return finishCoverageGap(context, root, () => gapIdentity);
  // Every other incomplete content coverage blocks each Stop replay, even when unchanged.
  if (
    context.coverageGap ||
    (state.isBailed && state.incompleteKind !== "command")
  ) {
    clearStopReentryState(context, root);
    return 2;
  }
  if (state.isBailed)
    return finishInfrastructureFailure(
      context,
      root,
      `${variant}:${state.incompleteReason}`,
    );
  clearStopReentryState(context, root);
  return 0;
}

// Exit 128 means no first commit; other failures leave baseline status unknown.
function inspectHead(state: ScanState): boolean {
  const head = spawnSync("git", ["rev-parse", "--verify", "HEAD"], {
    stdio: "ignore",
    windowsHide: true,
  });
  if (head.status !== 0 && head.status !== 128)
    markScanIncomplete(state, "command", "Git HEAD inspection failed");
  return head.status === 0;
}

// Collect worktree, staged and non-ignored untracked paths; later inventories stop once the path set is untrustworthy.
function collectInventories(state: ScanState, hasHead: boolean) {
  const collect = (args: string[]) =>
    hasBailed(state) ? [] : collectPaths(state, args);
  // Worktree inventory runs first so later staged deduplication knows what was scanned.
  const worktreePaths = collect(
    hasHead
      ? ["diff", "--name-only", "-z", "--diff-filter=ACMRT", "HEAD", "--"]
      : ["ls-files", "-z"],
  );
  const cachedPaths = collect([
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--diff-filter=ACMRT",
    "--",
  ]);
  // Ignored local state never blocks; non-ignored untracked files are content the user could commit.
  const untrackedPaths = collect([
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z",
  ]);
  return { worktreePaths, cachedPaths, untrackedPaths };
}

/** Scan tracked, staged and non-ignored untracked changes from the entered Git root and return the Stop status. */
export function scanChangedContent(
  context: PostTurnContext,
  root: string,
): number {
  const state = createScanState(context);
  const hasHead = inspectHead(state);
  const { worktreePaths, cachedPaths, untrackedPaths } = collectInventories(
    state,
    hasHead,
  );
  const changedCount =
    worktreePaths.length + cachedPaths.length + untrackedPaths.length;
  // With no changes, clear old recovery state and let the user finish without scan batches.
  if (
    !hasBailed(state) &&
    changedCount === 0 &&
    state.coverageGapMessages.length === 0
  ) {
    clearStopReentryState(context, root);
    return 0;
  }
  state.pendingFiles = changedCount;
  // New files and repositories without a first commit need full-content admission; tracked edits stream added hunks.
  if (!hasBailed(state))
    gateScannableFiles(
      state,
      hasHead ? untrackedPaths : [...worktreePaths, ...untrackedPaths],
    );
  const scanned = scanTrackedChanges(state, worktreePaths, hasHead);
  scanStagedChanges(state, cachedPaths, scanned, hasHead);
  // Check non-ignored new files last so added content is covered.
  if (!hasBailed(state)) {
    scanContentFiles(
      state,
      untrackedPaths.filter((path) => admitWholeFile(state, path, "untracked")),
    );
    if (!hasBailed(state)) state.pendingFiles = 0;
  }
  const variant =
    context.environment.GOAT_FLOW_POST_TURN_SAFETY_FORCE_BASH3_FALLBACK === "1"
      ? "fallback"
      : "native";
  return finishScan(state, root, variant);
}
