/** Preserve analyzer findings, coverage failures and direct-call diagnostics as separate outcomes. */
import { relative, resolve } from "node:path";
import {
  analyzerTarget,
  object,
  ownerRoot,
  ownerSettings,
  variant,
  type EditRequest,
  type JsonObject,
} from "./scope.mjs";
import { changedRanges, wholeFile } from "./ranges.mjs";
import {
  capabilities,
  discoverAnalyzer,
  invokeAnalyzer,
  parseReply,
  timeoutSeconds,
  type AnalyzerCommand,
  type AnalyzerReply,
  type Capabilities,
} from "./analyzer.mjs";

export interface Finding {
  code: string;
  message: string;
  target: string;
}
export interface FileResult {
  priority: number;
  outcome: "pass" | "advisory" | "incomplete" | "unavailable";
  reason: string;
  findings: Finding[];
  completed: number;
  verified: boolean;
  binary: string;
}
interface FileContext {
  root: string;
  path: string;
  absolute: string;
  binary: string;
  target: string;
  operand: string;
  command: AnalyzerCommand;
  ranges: string;
  managed: boolean;
}
interface DisplayFinding {
  severity: string;
  rank: number;
  file: string;
  line: number | null;
  code: string;
  message: string;
  structural: boolean;
}
interface Report {
  rows: DisplayFinding[];
  visible: DisplayFinding[];
  suppressed: number;
  contract: boolean;
}

export const footer =
  "For triage: consult .goat-flow/skill-docs/playbooks/gruff-code-quality.md";

export function result(
  priority: number,
  outcome: FileResult["outcome"],
  reason: string,
  finding?: Finding,
  completed = 0,
  verified = false,
): FileResult {
  return {
    priority,
    outcome,
    reason,
    findings: finding ? [finding] : [],
    completed,
    verified,
    binary: "",
  };
}

function failure(
  ctx: Pick<FileContext, "path">,
  code: string,
  message: string,
  reason = "hook-unavailable",
  priority = 80,
): FileResult {
  return result(
    priority,
    priority === 80 ? "unavailable" : "incomplete",
    reason,
    { code: code, message: message, target: ctx.path },
  );
}

function rows(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.map(object) : [];
}
function isRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function rank(value: string): number {
  return value === "error" ? 3 : value === "warning" ? 2 : 1;
}
function normalize(value: string): string {
  return value.replaceAll("\\", "/").replace(/^\.\//u, "");
}
function sameFile(
  path: string,
  relativePath: string,
  absolute: string,
): boolean {
  const value = normalize(path);
  const rel = normalize(relativePath);
  return (
    value === rel || value === normalize(absolute) || value.endsWith("/" + rel)
  );
}
function inRanges(start: number, end: number, ranges: string): boolean {
  return ranges
    .split(",")
    .filter(Boolean)
    .some((range) => {
      const [first, last] = range.split("-").map(Number);
      return start <= (last ?? first ?? 0) && end >= (first ?? 0);
    });
}

function first(...values: unknown[]): unknown {
  return values.find((value) => value !== undefined && value !== null);
}
function lineNumber(value: unknown): number | null {
  return value === undefined ||
    value === null ||
    !Number.isFinite(Number(value))
    ? null
    : Number(value);
}
function displayFinding(row: JsonObject, contract: boolean): DisplayFinding {
  const location = object(row.location);
  const rawLine = contract
    ? row.line
    : first(row.line, location.line, location.startLine);
  const structural = contract && ["file", "project"].includes(text(row.scope));
  const severity =
    text(row.severity).toLowerCase() || (contract ? "advisory" : "unknown");
  const file = contract
    ? first(row.file, row.filePath, row.path)
    : first(row.filePath, row.file, row.path);
  return {
    severity,
    rank: rank(severity),
    file: text(file),
    line: structural ? null : lineNumber(rawLine),
    code: text(row.ruleId) || "unknown-rule",
    message: text(row.message),
    structural,
  };
}
function attributable(
  row: JsonObject,
  finding: DisplayFinding,
  ctx: FileContext,
  native: boolean,
): boolean {
  if (finding.structural) return true;
  if (finding.line === null) return false;
  const end = Math.max(finding.line, Number(row.endLine) || finding.line);
  return native || inRanges(finding.line, end, ctx.ranges);
}

function compareFindings(left: DisplayFinding, right: DisplayFinding): number {
  return (
    right.rank - left.rank ||
    (left.file < right.file ? -1 : left.file > right.file ? 1 : 0) ||
    (left.line ?? 0) - (right.line ?? 0) ||
    left.code.localeCompare(right.code)
  );
}
function selectFindings(
  output: JsonObject,
  ctx: FileContext,
  contract: boolean,
  native: boolean,
) {
  let suppressed = 0;
  const eligible: DisplayFinding[] = [];
  for (const row of rows(output.findings)) {
    const finding = displayFinding(row, contract);
    const matching =
      contract || sameFile(finding.file, ctx.operand, ctx.absolute);
    const included = attributable(row, finding, ctx, native);
    if (matching && !included) suppressed += 1;
    if (matching && included) eligible.push(finding);
  }
  eligible.sort(compareFindings);
  return { eligible, suppressed };
}
function displaySettings(): { floor: number; max: number } {
  const floor = rank(
    (process.env.GRUFF_CODE_QUALITY_MIN_SEVERITY ?? "advisory").toLowerCase(),
  );
  const configured = process.env.GRUFF_CODE_QUALITY_MAX_FINDINGS ?? "20";
  const max =
    /^[0-9]+$/u.test(configured) && Number(configured) >= 1
      ? Number(configured)
      : 20;
  return { floor, max };
}
function reportFor(
  output: JsonObject,
  ctx: FileContext,
  contract: boolean,
  native: boolean,
): Report {
  const { eligible, suppressed: hidden } = selectFindings(
    output,
    ctx,
    contract,
    native,
  );
  const { floor, max } = displaySettings();
  let suppressed = hidden;
  if (contract) suppressed = Number(object(output.suppressed).count) || 0;
  else if (native)
    suppressed =
      Number(output.suppressedCount ?? object(output.diff).suppressedCount) ||
      0;
  return {
    rows: eligible,
    visible: eligible.filter((finding) => finding.rank >= floor).slice(0, max),
    suppressed,
    contract,
  };
}

function reviewGuidance(findings: DisplayFinding[]): string[] {
  const messages: string[] = [];
  if (findings.some((finding) => finding.code.startsWith("docs.")))
    messages.push(
      "gruff-code-quality: docs findings want a real contract, not a marker word - say what it does, when a reader reaches it, and what null/empty means for them (code-comments.md tiers 1 and 4).",
    );
  if (findings.some((finding) => finding.code.startsWith("naming.")))
    messages.push(
      "gruff-code-quality: naming findings require responsibility-first placement and verified identifier claims before edits (naming-and-placement.md).",
    );
  if (
    findings.some(
      (finding) =>
        finding.code.startsWith("size.") ||
        finding.code === "design.circular-import",
    )
  )
    messages.push(
      "gruff-code-quality: structural findings are review cost - split along the concern a reader follows, then re-run `goat-flow stats --check`, because moving a symbol breaks learning-loop anchors that no compiler can see.",
    );
  return messages;
}

function reportTail(report: Report, more: number, floored: number): string[] {
  const lines: string[] = [];
  if (more > 0)
    lines.push(
      report.contract
        ? `gruff-code-quality: ${more} more attributable finding(s) were capped`
        : `gruff-code-quality: (${more} more on changed lines; raise GRUFF_CODE_QUALITY_MAX_FINDINGS to list them)`,
    );
  if (floored > 0)
    lines.push(
      report.contract
        ? `gruff-code-quality: ${floored} attributable finding(s) below the configured floor`
        : `gruff-code-quality: ${floored} finding(s) below GRUFF_CODE_QUALITY_MIN_SEVERITY=${process.env.GRUFF_CODE_QUALITY_MIN_SEVERITY ?? "advisory"} not listed`,
    );
  if (report.suppressed > 0)
    lines.push(
      report.contract
        ? `gruff-code-quality: suppressed ${report.suppressed} finding(s) outside the changed scope`
        : `gruff-code-quality: suppressed ${report.suppressed} pre-existing finding(s) outside changed lines`,
    );
  if (report.visible.length > 0)
    lines.push(...reviewGuidance(report.visible), footer);
  return lines;
}

function renderReport(report: Report, ctx: FileContext): void {
  if (ctx.managed && !report.contract) return;
  const all = report.rows;
  const floor = rank(
    (process.env.GRUFF_CODE_QUALITY_MIN_SEVERITY ?? "advisory").toLowerCase(),
  );
  const surfaced = all.filter((finding) => finding.rank >= floor).length;
  const floored = all.length - surfaced;
  const more = surfaced - report.visible.length;
  const lines: string[] = [];
  if (all.length > 0 || report.suppressed > 0) {
    const structural = all.filter((finding) => finding.structural).length;
    lines.push(
      `gruff-code-quality: ${ctx.binary} ${ctx.path} edit-ranges=${ctx.ranges}; ${all.length} attributable finding(s) (edit=${all.length - structural}, file/project=${structural}): ${all.filter((finding) => finding.rank === 3).length} error, ${all.filter((finding) => finding.rank === 2).length} warning, ${all.filter((finding) => finding.rank === 1).length} advisory`,
    );
  }
  lines.push(
    ...report.visible.map(
      (finding) =>
        `- [${finding.severity}] ${finding.file}${finding.line === null ? "" : `:${finding.line}`} ${finding.code} - ${finding.message}`,
    ),
  );
  lines.push(...reportTail(report, more, floored));
  const stream = ctx.managed ? process.stderr : process.stdout;
  if (lines.length) stream.write(lines.join("\n") + "\n");
}

function reportResult(
  output: JsonObject,
  ctx: FileContext,
  contract: boolean,
  native = false,
): FileResult {
  const report = reportFor(output, ctx, contract, native);
  renderReport(report, ctx);
  const value = result(
    report.rows.length > 0 ? 20 : 0,
    report.rows.length > 0 ? "advisory" : "pass",
    report.rows.length > 0 ? "findings-reported" : "completed-clean",
    undefined,
    1,
    true,
  );
  value.binary = ctx.binary;
  value.findings = report.visible.slice(0, 20).map((finding) => ({
    code: finding.code,
    message: `[${finding.severity}] ${finding.message}`,
    target: ctx.path,
  }));
  return value;
}

function diagnosticMessage(row: JsonObject): string {
  return text(row.message ?? row.detail ?? row.reason ?? row.error);
}
function configError(output: JsonObject): string {
  const config = object(output.config);
  if (config.schemaOk === false)
    return (
      text(config.error) ||
      text(object(config.error).message) ||
      "project gruff config rejected"
    );
  const diagnostics = rows(output.diagnostics);
  const configDiagnostic = diagnostics.find((row) =>
    /config[-_ ]?error|config/u.test(
      text(row.type ?? row.code ?? row.kind ?? row.category).toLowerCase(),
    ),
  );
  if (configDiagnostic) return diagnosticMessage(configDiagnostic);
  const paths = object(output.paths);
  const ignored = [
    ...rows(object(output.ignored).paths),
    ...rows(paths.ignoredPaths),
    ...rows(output.ignoredPaths),
    ...rows(paths.skipped),
  ];
  return (output.filesDiscovered ?? paths.analysedFiles) === 0 &&
    ignored.length === 0
    ? diagnosticMessage(diagnostics[0] ?? {})
    : "";
}

function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function ignoreDetail(value: unknown): string {
  const row = object(value);
  return text(first(row.pattern, row.source, row.reason));
}
function ignoredBy(
  output: JsonObject,
  ctx: FileContext,
  contract: boolean,
): string {
  const paths = object(output.paths);
  const values = contract
    ? array(object(output.ignored).paths)
    : [
        ...array(paths.ignoredPaths),
        ...array(output.ignoredPaths),
        ...array(paths.skipped),
      ];
  const matches = values.filter((value) =>
    sameFile(
      typeof value === "string"
        ? value
        : text(first(object(value).path, object(value).file)),
      ctx.operand,
      ctx.absolute,
    ),
  );
  const match =
    matches.find((value) => ignoreDetail(value) !== "") ?? matches[0];
  if (match === undefined) return "";
  const row = object(match);
  if (contract)
    return `${text(row.source) || "config"}${row.pattern ? " " + text(row.pattern) : ""}`;
  const detail = ignoreDetail(match);
  return `gruff config${detail ? " (matched " + detail + ")" : ""}`;
}

function ignoredResult(
  ctx: FileContext,
  reason: string,
  contract: boolean,
): FileResult {
  const value = result(
    20,
    "advisory",
    "findings-reported",
    {
      code: "analysis-not-applicable",
      message: `This file is ignored by ${reason}${contract ? ", so Gruff did not request changes" : ""}`,
      target: ctx.path,
    },
    1,
    true,
  );
  value.binary = ctx.binary;
  if (!ctx.managed || contract)
    (ctx.managed ? process.stderr : process.stdout).write(
      `gruff-code-quality: skipped ${ctx.binary} ${ctx.path} - ignored by ${reason}; out of scope${contract ? "" : ", do not modify to satisfy gruff."}\n`,
    );
  return value;
}

function validateContract(
  output: JsonObject | null,
  version: string,
  status: number | null,
): boolean {
  if (!output || output.contractVersion !== version) return false;
  if (version === "gruff.hook.v1")
    return (
      Array.isArray(output.findings) ||
      isRecord(output.config) ||
      isRecord(output.ignored)
    );
  if (status === 2)
    return Array.isArray(output.findings) || isRecord(output.config);
  return validV2Result(output);
}

function validV2Result(output: JsonObject): boolean {
  const count = object(output.run).analysedFiles;
  return (
    Array.isArray(output.findings) &&
    Array.isArray(output.diagnostics) &&
    typeof object(output.config).schemaOk === "boolean" &&
    typeof count === "number" &&
    Number.isInteger(count) &&
    count >= 0
  );
}

function contractFailure(
  reply: AnalyzerReply,
  output: JsonObject | null,
  ctx: FileContext,
  version: string,
): FileResult | null {
  if (reply.timedOut)
    return failure(
      ctx,
      "analyzer-timeout",
      `${ctx.binary} exceeded ${timeoutSeconds(ctx.binary)}s while checking this edit`,
      "execution-timeout",
      70,
    );
  const statuses = version === "gruff.hook.v1" ? [0] : [0, 1, 2];
  if (!statuses.includes(reply.status ?? -1))
    return failure(
      ctx,
      "analyzer-failed",
      reply.stderr ||
        `${ctx.binary} exited ${reply.status} without a complete result`,
    );
  if (reply.invalid || !validateContract(output, version, reply.status))
    return invalidContractReply(reply, ctx);
  return null;
}
function invalidContractReply(
  reply: AnalyzerReply,
  ctx: FileContext,
): FileResult {
  if (reply.status === 2)
    return failure(
      ctx,
      "analyzer-failed",
      reply.stderr || `${ctx.binary} exited 2 without a readable result`,
    );
  return failure(
    ctx,
    "analyzer-response-invalid",
    `${ctx.binary} returned malformed or unsupported result JSON`,
    "output-invalid",
    60,
  );
}

function contractConfigError(output: JsonObject, version: string): string {
  if (version !== "gruff.hook.v2" || object(output.config).schemaOk === false)
    return configError(output);
  return diagnosticMessage(
    rows(output.diagnostics).find(
      (row) => row.severity === "fatal" && text(row.type).includes("config"),
    ) ?? {},
  );
}
function contractContentFailure(
  output: JsonObject,
  reply: AnalyzerReply,
  ctx: FileContext,
  version: string,
): FileResult | null {
  const config = contractConfigError(output, version);
  if (config) return failure(ctx, "analyzer-config-invalid", config);
  if (version !== "gruff.hook.v2") return null;
  const fatal = diagnosticMessage(
    rows(output.diagnostics).find((row) => row.severity === "fatal") ?? {},
  );
  if (reply.status === 2 || fatal)
    return failure(
      ctx,
      "analyzer-failed",
      fatal || reply.stderr || `${ctx.binary} could not run for this edit`,
    );
  return null;
}
function addDiagnostics(
  value: FileResult,
  output: JsonObject,
  ctx: FileContext,
): void {
  for (const row of rows(output.diagnostics)) {
    if (!["warning", "info"].includes(text(row.severity))) continue;
    (ctx.managed ? process.stderr : process.stdout).write(
      `gruff-code-quality: ${ctx.binary} diagnostic [${row.severity}] ${text(row.type) || "diagnostic"}: ${text(row.message)}\n`,
    );
    if (row.severity !== "warning") continue;
    value.findings.push({
      code: "analyzer-diagnostic",
      message: `[warning] ${text(row.type) || "diagnostic"}: ${text(row.message)}`,
      target: ctx.path,
    });
    value.priority = 20;
    value.outcome = "advisory";
    value.reason = "findings-reported";
  }
  value.findings = value.findings.slice(0, 20);
}
async function contractResult(
  ctx: FileContext,
  version: string,
): Promise<FileResult> {
  const reply = await invokeAnalyzer(
    ctx.command,
    ["hook", "--format", "json", ctx.operand],
    ctx.target,
    ctx.binary,
  );
  const output = parseReply(reply.stdout);
  const failed = contractFailure(reply, output, ctx, version);
  if (failed) return failed;
  if (!output)
    return failure(
      ctx,
      "analyzer-response-invalid",
      "No analyzer result",
      "output-invalid",
      60,
    );
  const contentFailure = contractContentFailure(output, reply, ctx, version);
  if (contentFailure) return contentFailure;
  const ignored = ignoredBy(output, ctx, true);
  if (ignored) return ignoredResult(ctx, ignored, true);
  if (version === "gruff.hook.v2" && object(output.run).analysedFiles === 0)
    return failure(
      ctx,
      "analyzer-analysed-nothing",
      `${ctx.binary} analysed no file for this edit`,
      "coverage-incomplete",
      60,
    );
  const value = reportResult(output, ctx, true);
  if (version === "gruff.hook.v2") addDiagnostics(value, output, ctx);
  return value;
}

function legacyArguments(
  help: string,
  ctx: FileContext,
): { args: string[]; native: boolean } {
  const native = ["--changed-ranges", "--changed-scope", "--no-baseline"].every(
    (flag) => help.includes(flag),
  );
  const args = [
    "analyse",
    help.includes("--format") ? "--format" : "-format",
    "json",
  ];
  if (help.includes("--format") && help.includes("--fail-on"))
    args.push("--fail-on", "none");
  if (native && help.includes("--format")) {
    const scopeHelp =
      help
        .slice(help.indexOf("--changed-scope"))
        .split(/\r?\n/u)
        .slice(0, 3)
        .join("\n")
        .slice("--changed-scope".length)
        .split(/--[a-z]/u)[0] ?? "";
    const scope =
      ctx.ranges === wholeFile(ctx.absolute) &&
      /(^|[^A-Za-z-])file([^A-Za-z-]|$)/u.test(scopeHelp)
        ? "file"
        : "symbol";
    args.push(
      "--no-baseline",
      "--changed-ranges",
      ctx.ranges,
      "--changed-scope",
      scope,
    );
  }
  args.push(ctx.operand);
  return { args, native };
}

function renderSchemaRejection(ctx: FileContext, reply: AnalyzerReply): void {
  if (!ctx.managed && (reply.stderr + reply.stdout).includes("schemaVersion")) {
    process.stdout.write(
      `gruff-code-quality: ${ctx.binary} could not analyse - its project config (.${ctx.binary}.yaml) was rejected. gruff reported:\n${(
        reply.stderr + reply.stdout
      )
        .split("\n")
        .filter(Boolean)
        .slice(0, 12)
        .map((line) => "  " + line)
        .join(
          "\n",
        )}\nSafety: Do not run ${ctx.binary} init --force in this project. Generate defaults in a fresh temporary directory, compare them with .${ctx.binary}.yaml, and merge deliberately.\n`,
    );
  }
}

function invalidLegacyReply(
  ctx: FileContext,
  reply: AnalyzerReply,
): FileResult {
  renderSchemaRejection(ctx, reply);
  return failure(
    ctx,
    "analyzer-response-invalid",
    reply.stdout
      ? `${ctx.binary} returned non-JSON analysis output after exit ${reply.status}`
      : reply.stderr
        ? `${ctx.binary} exited ${reply.status} without analysis output: ${reply.stderr.split("\n")[0]}`
        : `${ctx.binary} returned no analysis result`,
    "output-invalid",
    60,
  );
}

async function legacyResult(ctx: FileContext): Promise<FileResult> {
  const help = await invokeAnalyzer(
    ctx.command,
    ["analyse", "--help"],
    ctx.target,
    ctx.binary,
  );
  const helpText = help.stdout + help.stderr;
  if (!helpText.includes("--format") && !helpText.includes("-format"))
    return failure(
      ctx,
      "analyzer-capability-unsupported",
      `${ctx.binary} does not expose JSON analysis output`,
    );
  const request = legacyArguments(helpText, ctx);
  const reply = await invokeAnalyzer(
    ctx.command,
    request.args,
    ctx.target,
    ctx.binary,
  );
  if (reply.timedOut)
    return failure(
      ctx,
      "analyzer-timeout",
      `${ctx.binary} exceeded the configured feedback deadline`,
      "execution-timeout",
      70,
    );
  const output = parseReply(reply.stdout);
  if (reply.invalid || !output || !Array.isArray(output.findings)) {
    return invalidLegacyReply(ctx, reply);
  }
  const config = configError(output);
  if (config) return failure(ctx, "analyzer-config-invalid", config);
  const ignored = ignoredBy(output, ctx, false);
  if (ignored) return ignoredResult(ctx, ignored, false);
  return reportResult(output, ctx, false, request.native);
}

function prepareFile(
  root: string,
  path: string,
):
  | FileResult
  | {
      binary: string;
      target: { root: string; path: string; config: string };
      command: AnalyzerCommand;
    } {
  const binary = variant(path);
  const owner = ownerRoot(root, path);
  if (ownerSettings(owner).choice === "invalid")
    return failure(
      { path },
      "owner-config-invalid",
      `hooks.gruff-code-quality.enabled in ${relative(root, resolve(owner, ".goat-flow/config.yaml")).replaceAll("\\", "/")} is unreadable or not true/false`,
    );
  const target = analyzerTarget(root, path, binary, owner);
  if (target === "ambiguous")
    return failure(
      { path },
      "analyzer-config-ambiguous",
      `Both .${binary}.yaml and .${binary}.yml exist for this file`,
    );
  if (!target)
    return failure(
      { path },
      "analyzer-config-missing",
      `No .${binary}.yaml or .${binary}.yml config owns this edited file`,
    );
  const found = discoverAnalyzer(root, owner, target.root, binary);
  if (!found.command) {
    if (found.reason === "unsupported-wrapper")
      return failure(
        { path },
        "analyzer-wrapper-unsupported",
        `${binary} uses an unsupported custom wrapper; install a standard npm shim or directly launchable analyzer`,
      );
    return failure(
      { path },
      found.outside
        ? "analyzer-binary-outside-project"
        : "analyzer-binary-missing",
      found.outside
        ? `hooks.gruff-code-quality.binaries.${binary.slice(6)} resolves outside the repository`
        : `${binary} could not be resolved for ${relative(root, target.config)}`,
    );
  }
  return { binary, target, command: found.command };
}

/** An edited file resolves its owner and analyzer before any analysis may run. */
export async function inspectFile(
  request: EditRequest,
  root: string,
  path: string,
  count: number,
  allowCached: boolean,
  managed: boolean,
  cache: Map<string, Capabilities>,
): Promise<FileResult> {
  const selected = prepareFile(root, path);
  if ("outcome" in selected) return selected;
  const { binary, target, command } = selected;
  const ranges = changedRanges(request, root, path, count, allowCached);
  if (ranges.status === "none")
    return result(20, "advisory", "findings-reported", {
      code: "analysis-not-applicable",
      message: "This edit has no remaining source lines for Gruff to analyze",
      target: path,
    });
  if (ranges.status === "failed")
    return failure(
      { path },
      "git-scope-failed",
      "Git could not derive trustworthy changed ranges for this edit",
      "coverage-incomplete",
      60,
    );
  if (!ranges.text)
    return failure(
      { path },
      "git-scope-unavailable",
      "No trustworthy changed ranges were available for this edited file",
      "coverage-incomplete",
      60,
    );
  if (ranges.status === "whole-file")
    process.stderr.write(
      `gruff-code-quality: ${path} is in no Git repository; analysing the whole file\n`,
    );
  const ctx: FileContext = {
    root,
    path,
    absolute: resolve(root, path),
    binary,
    target: target.root,
    operand: target.path,
    command,
    ranges: ranges.text,
    managed,
  };
  const caps = await capabilities(command, target.root, binary, cache);
  if (caps.unsupported)
    return failure(
      ctx,
      "analyzer-capability-unsupported",
      `${binary} advertises ${caps.unsupported}, which this hook cannot read; update goat-flow`,
    );
  return caps.version ? contractResult(ctx, caps.version) : legacyResult(ctx);
}

/** Direct callers receive legacy prose without turning missing analysis into a clean result. */
export function renderDirectFailure(value: FileResult, path: string): void {
  if (value.completed || !value.findings[0]) return;
  const finding = value.findings[0];
  if (finding.code === "analyzer-config-missing") return;
  if (finding.code === "analyzer-config-invalid") {
    process.stdout.write(
      `gruff-code-quality: ${variant(path)} could not analyse ${path} - ${finding.message}\n`,
    );
    return;
  }
  let message = finding.message;
  if (finding.code === "analyzer-binary-missing") {
    const binary = message.split(" ")[0] ?? "gruff";
    message = `.${binary}.yaml present but ${binary} not found on search paths (vendor/bin, node_modules/.bin, bin, .venv/bin, ~/.local/bin, PATH); set hooks.gruff-code-quality.binaries.${binary.slice(6)} in .goat-flow/config.yaml or GRUFF_${binary.slice(6).toUpperCase()}_BIN to an executable path for non-standard monorepo layouts; skipped`;
  } else if (
    finding.code.startsWith("git-scope") ||
    finding.code === "analysis-not-applicable"
  )
    message = `no changed lines detected for ${path}; skipping gruff output`;
  process.stderr.write(`gruff-code-quality: ${message}\n`);
}
