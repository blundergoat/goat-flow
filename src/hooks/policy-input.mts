/** Decode provider input for both policy evaluators without launching JSON or shell tools. */
type PolicyObject = Record<string, unknown>;
export type PolicyOutputMode =
  "copilot-json" | "antigravity-json" | "stderr-exit";

/** A denial with the protection that owns it; `{ scope: "destructive", reason }` renders as `Policy destructive: <reason>`. */
export interface PolicyDenial {
  scope: string;
  reason: string;
}

/** Decode original request bytes strictly; retain Bash's removal of terminal LF characters. */
export function readPolicyPayload(
  checkCommand: string,
  stdin: Uint8Array,
): string {
  const payload =
    checkCommand ||
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(stdin);
  return payload.replace(/\n+$/u, "");
}

/** Return an object without treating arrays or null as provider argument maps. */
function objectRecord(value: unknown): PolicyObject | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as PolicyObject)
    : null;
}

/** Parse full JSON, including Unicode escapes; malformed or non-object requests throw. */
export function parsePolicyPayload(payload: string): PolicyObject {
  const value: unknown = JSON.parse(payload);
  const record = objectRecord(value);
  if (record === null) throw new Error("Policy payload must be a JSON object");
  return record;
}

/** Choose the existing response channel even when malformed input cannot be decoded. */
export function detectPolicyOutputMode(payload: string): PolicyOutputMode {
  if (payload.includes('"toolName"') && !payload.includes('"tool_name"'))
    return "copilot-json";
  if (payload.includes('"toolCall"')) return "antigravity-json";
  return "stderr-exit";
}

/** Ignore absent and non-string fields rather than coercing them into command text. */
function firstString(...values: unknown[]): string {
  return (
    values.find(
      (value): value is string => typeof value === "string" && value.length > 0,
    ) ?? ""
  );
}

/** Read object or encoded argument maps; invalid encoded maps contribute no trusted fields. */
function decodedArguments(value: unknown): PolicyObject {
  if (typeof value !== "string") return objectRecord(value) ?? {};
  try {
    return parsePolicyPayload(value);
  } catch {
    // An invalid optional map must not discard a command from a higher-priority provider field.
    return {};
  }
}

/** Extract the selected provider's tool name; empty means ownership is still unknown. */
export function extractPolicyToolName(payload: PolicyObject): string {
  return firstString(
    payload.toolName,
    payload.tool_name,
    objectRecord(payload.toolCall)?.name,
    payload.name,
  );
}

/** Extract command/path fields in provider precedence; embedded argument JSON is never executed. */
export function extractPolicyCommandText(
  payload: PolicyObject,
  checkCommand = "",
): string {
  if (checkCommand) return checkCommand;
  const toolInput = objectRecord(payload.tool_input) ?? {};
  const toolCall = objectRecord(objectRecord(payload.toolCall)?.args) ?? {};
  const toolArgs = decodedArguments(payload.toolArgs);
  const toolArgsSnake = decodedArguments(payload.tool_args);
  let command = firstString(
    toolInput.command,
    toolCall.CommandLine,
    toolCall.command,
    toolCall.commandLine,
    toolCall.input,
    payload.command,
    payload.input,
    toolArgs.command,
    toolArgs.CommandLine,
    toolArgs.commandLine,
    toolArgs.input,
    toolArgsSnake.command,
    toolArgsSnake.CommandLine,
    toolArgsSnake.commandLine,
    toolArgsSnake.input,
  );
  const path = firstString(
    toolInput.file_path,
    toolInput.path,
    toolCall.AbsolutePath,
    toolCall.TargetFile,
    toolCall.FilePath,
    toolCall.SearchPath,
    toolCall.path,
    toolCall.file_path,
    payload.path,
    payload.file_path,
    toolArgs.file_path,
    toolArgs.path,
    toolArgs.AbsolutePath,
    toolArgs.TargetFile,
    toolArgs.FilePath,
    toolArgs.SearchPath,
    toolArgsSnake.file_path,
    toolArgsSnake.path,
    toolArgsSnake.AbsolutePath,
    toolArgsSnake.TargetFile,
    toolArgsSnake.FilePath,
    toolArgsSnake.SearchPath,
    toolCall.Path,
  );
  if (path && !command.includes(path)) command += " " + path;
  return command.replace(/^ /u, "");
}

/** Fold ASCII letters only, preserving the policy's C-locale matching contract. */
export function asciiLowerCase(value: string): string {
  return value.replace(/[A-Z]/gu, (letter) =>
    String.fromCharCode(letter.charCodeAt(0) + 32),
  );
}

/** Route supported provider command tools through command-policy inspection. */
export function isPolicyShellTool(tool: string): boolean {
  return ["bash", "shell", "sh", "run_command", "monitor"].includes(
    asciiLowerCase(tool),
  );
}

/** Route supported provider content tools through the selected secret-path policy. */
export function isPolicySecretFileTool(tool: string): boolean {
  return [
    "read",
    "view",
    "view_file",
    "read_file",
    "write",
    "edit",
    "multiedit",
    "write_to_file",
    "replace_file_content",
    "multi_replace_file_content",
    "create",
    "grep",
    "rg",
    "str_replace_editor",
    "grep_search",
  ].includes(asciiLowerCase(tool));
}

/** Enforce UTF-8 byte ceilings after the caller has classified and masked any bounded quality-report data. */
export function policyCommandSizeRefusal(
  command: string,
  maskedCommand: string,
  boundedQualityData = false,
): string | null {
  const commandBytes = Buffer.byteLength(command, "utf8");
  if (commandBytes > 262144)
    return "Command exceeds the 262144-byte policy inspection limit. Split executable commands into smaller independent calls or use a supported script route; send report data through the approved stdin/file transport.";
  if (commandBytes <= 16384) return null;
  if (boundedQualityData && Buffer.byteLength(maskedCommand, "utf8") <= 16384)
    return null;
  return "Command exceeds the 16384-byte policy inspection limit. Split executable commands into smaller independent calls or use a supported script route; send report data through the approved stdin/file transport.";
}

/** Limit executable segments at every inspection depth; callers count their actual split result. */
export function policySegmentCountRefusal(segmentCount: number): string | null {
  return segmentCount > 50
    ? "Command exceeds the 50-segment policy inspection limit. Split it into smaller independent calls or use a supported script route."
    : null;
}
