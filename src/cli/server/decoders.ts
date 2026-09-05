/**
 * Validate dashboard requests before terminal sessions, project writes, hook changes, uploads, or skill evaluations begin.
 *
 * Each decoder returns accepted fields or a precise field error the route can show to the user.
 * These dependency-free checks establish payload shape; route handlers still validate filesystem paths and uploaded content.
 */
import type { AgentId } from "../types.js";
import type { ClientMessage, Runner, TerminalAccessMode } from "./types.js";

type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; error: string; path: string };

/**
 * Carry normalized launch choices before the terminal route validates paths or starts the selected runner.
 *
 * Missing text fields remain empty so the route can choose directory defaults or open an idle shell.
 * Access mode, draft capture, and report ownership remain separate choices for the launch checks.
 */
interface TerminalCreateBody {
  prompt: string;
  projectPath: string;
  targetPath: string;
  runner: Runner;
  accessMode: TerminalAccessMode;
  captureQualityDrafts: boolean;
  qualityReportProjectPath: string;
}

/**
 * Carry the Projects view's accepted paths, favorites, and custom labels to the saved-state writer.
 *
 * The paths list is required; omitted favorites and titles become empty collections for older clients.
 * The route still validates each filesystem path before it persists the user's selections.
 */
interface ProjectsListBody {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
}

/**
 * Identify the project selected for one dashboard write action.
 *
 * Decoding proves only that path is a string; the route applies its filesystem policy before writing.
 * Empty strings remain accepted at this boundary, so the owning route decides whether to use a default or reject them.
 */
interface ProjectPathBody {
  path: string;
}

/**
 * Carry one named attachment from the terminal upload request to the content-safety checks.
 *
 * Name and data must be non-empty strings so each submitted attachment has a label and payload.
 * The upload handler still checks whether the data is valid base64 and an allowed image.
 */
interface TerminalUploadFile {
  name: string;
  data: string;
}

/**
 * Carry an ordered group of terminal attachments after field and count validation.
 *
 * An empty group or one above the caller's file-count limit is rejected before upload processing.
 * Passing this decoder does not replace the handler's image-type and byte-limit checks.
 */
interface TerminalUploadBody {
  files: TerminalUploadFile[];
}

/**
 * Carry pasted Markdown or a named upload bundle into the Skills evaluator.
 *
 * The decoder accepts exactly one content source and checks names and size before scoring.
 * Optional labels and kind overrides let the caller guide the report; absent values leave inference to the evaluator.
 */
export interface EvaluateBody {
  // Pasted Markdown or a named upload bundle; the decoder rejects requests that supply both or neither.
  content?: string;
  files?: { name: string; content: string }[];
  // Optional filename or display name; used as the analyzed artifact name.
  suggestedName?: string | undefined;
  // Optional explicit kind override; otherwise inferred from frontmatter.
  kind?: "skill" | "shared-reference" | undefined;
}

// Hook-toggle payload accepted by POST /api/hooks/:hookId/toggle.
type HookToggleBody = Record<"enabled", boolean>;

const MAX_PROJECT_TITLE_LENGTH = 120; // Storage limit: dense dashboard rows cannot absorb long custom aliases.

/**
 * Build the error shape every route decoder returns.
 * Use when rejecting one field so the dashboard can show the exact user-fixable request path.
 *
 * @param path - field label returned to the route so the dashboard can identify the rejected input
 * @param message - validation explanation the route includes in its error response
 * @returns decoder failure; never `null`, because callers branch on `ok: false`
 */
function buildDecodeError(
  path: string,
  message: string,
): { ok: false; error: string; path: string } {
  return { ok: false, error: message, path };
}

/**
 * Parse a JSON request body. Swallows parse errors into the shared decoder failure shape.
 * Use at every dashboard ingress so malformed user/browser payloads become field errors.
 *
 * @param body - raw request body; empty or invalid text means there is no usable payload to process
 * @param path - body or message label that tells the caller which incoming payload failed
 * @returns parsed JSON, or a decoder error describing the malformed body
 */
function parseJson(body: string, path: string): DecodeResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (parseError) {
    // An empty body or truncated JSON from a browser request cannot be decoded; return a field error before the requested action starts.
    const message =
      parseError instanceof Error ? parseError.message : String(parseError);
    return buildDecodeError(path, `invalid JSON: ${message}`);
  }
}

/**
 * Decide whether a parsed payload has named request fields.
 * Use before reading dashboard payload properties, because arrays and `null` cannot carry route options.
 *
 * @param candidate - parsed JSON value; `null`, arrays, or primitives mean the request has no field map
 * @returns whether named fields can be read; `false` means the route returns a body-level error
 */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/**
 * Decode a dashboard project-path list from saved project state.
 * Use when the Projects view saves or reloads paths and favorites.
 *
 * @param raw - request body object; missing optional keys mean the older UI had no values to save
 * @param key - paths or favorites list to decode; the field name is reused in validation errors
 * @param options - `required` marks fields the UI must send; omitted means old state files default empty
 * @returns decoded strings, or an error when the list would corrupt saved project state
 */
function decodeStringArrayField(
  raw: Record<string, unknown>,
  key: "paths" | "favorites",
  options?: { required?: boolean },
): DecodeResult<string[]> {
  // Older state files may omit optional lists; required lists must be present for the UI to save.
  if (!Object.hasOwn(raw, key)) {
    return options?.required
      ? buildDecodeError(`body.${key}`, "is required")
      : {
          ok: true,
          value: [],
        };
  }
  // Non-array state would make the Projects list unreadable.
  if (!Array.isArray(raw[key])) {
    return buildDecodeError(`body.${key}`, "must be an array");
  }
  const values: string[] = [];
  // Validate each visible path/favorite before it is written back to dashboard state.
  for (const [index, item] of raw[key].entries()) {
    // Non-string entries cannot be shown as project paths or favorites.
    if (typeof item !== "string") {
      return buildDecodeError(`body.${key}[${index}]`, "must be a string");
    }
    values.push(item);
  }
  return { ok: true, value: values };
}

/**
 * Decode one optional terminal-create text field.
 * Missing paths let the terminal route choose its defaults; a missing prompt opens the runner without sending initial text.
 *
 * @param raw - terminal-create body; missing field means the user did not choose that optional value
 * @param key - supported launch text field to decode and identify in any validation error
 * @returns decoded string, or an empty string when the UI intentionally left the value unset
 */
function decodeOptionalStringField(
  raw: Record<string, unknown>,
  key: "prompt" | "projectPath" | "targetPath" | "qualityReportProjectPath",
): DecodeResult<string> {
  // Missing optional terminal fields mean "use the route default" instead of blocking launch.
  if (!Object.hasOwn(raw, key)) {
    return { ok: true, value: "" };
  }
  return typeof raw[key] === "string"
    ? { ok: true, value: raw[key] }
    : buildDecodeError(`body.${key}`, "must be a string");
}

// Accept the launch's filesystem access mode; an omitted choice uses the normal workspace session.
function decodeTerminalAccessMode(
  raw: Record<string, unknown>,
): DecodeResult<TerminalAccessMode> {
  // Older launch requests omit access mode, so they keep the workspace behavior used by ordinary terminal actions.
  if (!Object.hasOwn(raw, "accessMode")) {
    return { ok: true, value: "workspace" };
  }
  // Only modes the terminal flow can enforce are passed through to session creation.
  if (raw.accessMode === "workspace" || raw.accessMode === "reporting") {
    return { ok: true, value: raw.accessMode };
  }
  return buildDecodeError(
    "body.accessMode",
    'must be either "workspace" or "reporting"',
  );
}

/**
 * Resolve the runner for a terminal launch, using the server default only when the request omits that field.
 * An unknown runner stays an error because silently replacing the user's selection could launch a different agent.
 */
function decodeTerminalRunner(
  raw: Record<string, unknown>,
  options: { validRunners: ReadonlySet<string>; defaultRunner: AgentId },
): DecodeResult<AgentId> {
  // Missing runner means use the dashboard's active/default runner.
  if (!Object.hasOwn(raw, "runner")) {
    return { ok: true, value: options.defaultRunner };
  }
  // Runner ids must be strings so they can be matched against configured agents.
  if (typeof raw.runner !== "string") {
    return buildDecodeError("body.runner", "must be a string");
  }
  // An unsupported runner cannot launch on this server; return its field error instead of substituting another agent.
  if (!options.validRunners.has(raw.runner)) {
    return buildDecodeError(
      "body.runner",
      `unknown runner: ${raw.runner}. Valid: ${Array.from(options.validRunners).join(", ")}`,
    );
  }
  return { ok: true, value: raw.runner as AgentId };
}

/**
 * Decode the explicit opt-in that makes a Quality launch capture a staged report draft.
 *
 * Reporting access alone must not enable capture because custom prompts and presets without write permission also use that mode.
 * Only the Quality flow's draft-writing prompt opts in; ordinary launches must not create a staging tree in the selected target.
 */
function decodeTerminalCaptureQualityDrafts(
  raw: Record<string, unknown>,
): DecodeResult<boolean> {
  // Absent means an ordinary launch; capture is opt-in.
  if (!Object.hasOwn(raw, "captureQualityDrafts")) {
    return { ok: true, value: false };
  }
  // A supplied capture choice must be explicit so ambiguous request values cannot start draft collection.
  if (typeof raw.captureQualityDrafts === "boolean") {
    return { ok: true, value: raw.captureQualityDrafts };
  }
  return buildDecodeError("body.captureQualityDrafts", "must be a boolean");
}

/**
 * Decode the launch prompt and directory choices before the terminal route decides where the runner will start.
 * An empty prompt is valid because the user can open an idle shell without sending initial text.
 *
 * @param raw - parsed terminal request; omitted text fields become empty strings for the route's defaults
 * @returns prompt and directory choices, or the field error the user must correct before launch
 */
function decodeTerminalPathFields(
  raw: Record<string, unknown>,
): DecodeResult<{ prompt: string; projectPath: string; targetPath: string }> {
  // Empty prompt is valid: the terminal route opens an idle shell in that case.
  const prompt = decodeOptionalStringField(raw, "prompt");
  // Invalid prompt types cannot be pasted into a terminal safely.
  if (!prompt.ok) return prompt;

  const projectPath = decodeOptionalStringField(raw, "projectPath");
  // Invalid project path types cannot select a working directory.
  if (!projectPath.ok) return projectPath;

  // Target path lets the terminal open inside a different folder than the selected project.
  const targetPath = decodeOptionalStringField(raw, "targetPath");
  // Invalid target path types would open the runner in the wrong place.
  if (!targetPath.ok) return targetPath;

  return {
    ok: true,
    value: {
      prompt: prompt.value,
      projectPath: projectPath.value,
      targetPath: targetPath.value,
    },
  };
}

/**
 * Collect the launch choices that decide whether quality-report capture and ownership can be honored.
 *
 * Capture is an explicit request, while a blank report-project path means no owner was supplied.
 * The decoder checks these choices together before the terminal route creates any reporting session.
 */
interface QualityCaptureSelection {
  wasCaptureRequested: boolean;
  qualityReportProjectPath: string;
  runner: string;
  accessMode: string;
}

/**
 * Validate a Quality launch after the user selects its runner, access mode, and report owner.
 *
 * Capture requires Claude reporting mode and an explicit owner because the agent waits for a draft receipt from that project.
 * Report ownership without capture is allowed only in Claude or Codex reporting sessions.
 *
 * @param selection - launch choices; a blank report-project path means the user supplied no owner
 * @returns the field error to return, or null when the launch combination is supported
 */
function rejectUnsupportedQualityCapture(
  selection: QualityCaptureSelection,
): DecodeResult<never> | null {
  const hasQualityReportOwner =
    selection.qualityReportProjectPath.trim().length > 0;
  const isClaudeReporting =
    selection.runner === "claude" && selection.accessMode === "reporting";

  // A draft-capture launch needs Claude's reporting channel so the agent can receive its publication receipt.
  if (selection.wasCaptureRequested && !isClaudeReporting) {
    return buildDecodeError(
      "body.captureQualityDrafts",
      "is supported only for Claude reporting sessions",
    );
  }
  // Captured reports need an explicitly chosen owner so the receipt cannot land in an inferred project.
  if (selection.wasCaptureRequested && !hasQualityReportOwner) {
    return buildDecodeError(
      "body.qualityReportProjectPath",
      "is required when staged-draft capture is enabled",
    );
  }
  // An ordinary launch with no report owner needs no further reporting-ownership checks.
  if (!hasQualityReportOwner) return null;

  // Report ownership belongs to an isolated reporting session, not a workspace session that can change the project.
  if (selection.accessMode !== "reporting") {
    return buildDecodeError(
      "body.qualityReportProjectPath",
      "is supported only for reporting sessions",
    );
  }
  // Only these runners provide the reporting channel needed to enforce the chosen report owner.
  if (selection.runner !== "claude" && selection.runner !== "codex") {
    return buildDecodeError(
      "body.qualityReportProjectPath",
      "is supported only for Claude or Codex reporting sessions",
    );
  }
  return null;
}

/**
 * Decode the browser's launch request before the terminal route starts a session.
 * Each rejection names the field the user must correct; accepted choices still need the route's path and launch checks.
 *
 * @param body - raw request body; empty or malformed JSON stops the launch before a terminal row appears
 * @param options - allowed runners and default; an empty allowed set rejects every explicit runner selection
 * @returns decoded launch choices, or a field error the route can show without starting a session
 */
export function decodeTerminalCreateBody(
  body: string,
  options: { validRunners: ReadonlySet<string>; defaultRunner: AgentId },
): DecodeResult<TerminalCreateBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON stops the launch before a terminal row appears.
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  // A non-object body cannot carry the selected runner or project path.
  if (!isRecord(raw)) return buildDecodeError("body", "must be a JSON object");

  const paths = decodeTerminalPathFields(raw);
  // Invalid prompt or directory fields stop the launch before a runner can receive the wrong input or working directory.
  if (!paths.ok) return paths;
  const { prompt, projectPath, targetPath } = paths.value;

  const runner = decodeTerminalRunner(raw, options);
  // A rejected runner choice must be corrected before any session is created.
  if (!runner.ok) return runner;

  const accessMode = decodeTerminalAccessMode(raw);
  // An unsupported access mode cannot be passed to the runner's filesystem policy.
  if (!accessMode.ok) return accessMode;

  const captureQualityDrafts = decodeTerminalCaptureQualityDrafts(raw);
  // An ambiguous draft-capture choice cannot authorize report collection.
  if (!captureQualityDrafts.ok) return captureQualityDrafts;

  const qualityReportProjectPath = decodeOptionalStringField(
    raw,
    "qualityReportProjectPath",
  );
  // A non-string owner cannot be matched safely to the projects visible in the launch.
  if (!qualityReportProjectPath.ok) return qualityReportProjectPath;

  const captureRejection = rejectUnsupportedQualityCapture({
    wasCaptureRequested: captureQualityDrafts.value,
    qualityReportProjectPath: qualityReportProjectPath.value,
    runner: runner.value,
    accessMode: accessMode.value,
  });
  // Incompatible reporting choices already identify the field to fix, so the launch must not proceed.
  if (captureRejection) return captureRejection;

  return {
    ok: true,
    value: {
      prompt,
      projectPath,
      targetPath,
      runner: runner.value,
      accessMode: accessMode.value,
      captureQualityDrafts: captureQualityDrafts.value,
      qualityReportProjectPath: qualityReportProjectPath.value,
    },
  };
}

/**
 * Decode the saved project-list payload from the Projects view.
 * Use when the user edits favorites, project paths, or display names.
 *
 * @param body - raw request body; empty or malformed JSON means project state is left unchanged
 * @returns decoded project-list state, or an error that prevents saving corrupted dashboard state
 */
export function decodeProjectsListBody(
  body: string,
): DecodeResult<ProjectsListBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON leaves the existing project list untouched.
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  // The project list must be an object so paths, favorites, and titles can be saved together.
  if (!isRecord(raw)) return buildDecodeError("body", "must be a JSON object");

  const paths = decodeStringArrayField(raw, "paths", { required: true });
  // The visible project list cannot be saved without its path rows.
  if (!paths.ok) return paths;
  const favorites = decodeStringArrayField(raw, "favorites");
  // Invalid favorites are rejected so the UI does not pin a non-displayable project.
  if (!favorites.ok) return favorites;
  const projectTitles = decodeProjectTitles(raw);
  // Invalid titles are rejected before they overwrite the user's saved aliases.
  if (!projectTitles.ok) return projectTitles;

  return {
    ok: true,
    value: {
      paths: paths.value,
      favorites: favorites.value,
      projectTitles: projectTitles.value,
    },
  };
}

/**
 * Decode a body carrying the target project path for a dashboard write action.
 *
 * @param body - raw request body; empty or malformed JSON means no project action can run
 * @returns project-path payload, or an error that keeps the write action from targeting the wrong project
 */
export function decodeProjectPathBody(
  body: string,
): DecodeResult<ProjectPathBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON blocks the write before any project state changes.
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  // A project write needs a named path field.
  if (!isRecord(raw)) return buildDecodeError("body", "must be a JSON object");
  // Missing path means the dashboard cannot know which project the user meant.
  if (!Object.hasOwn(raw, "path"))
    return buildDecodeError("body.path", "is required");
  return typeof raw.path === "string"
    ? { ok: true, value: { path: raw.path } }
    : buildDecodeError("body.path", "must be a string");
}

/**
 * Decode a hook enable/disable request.
 * Use when the user toggles a guardrail row so only an explicit boolean can change hook state.
 *
 * @param body - raw JSON request body; empty or malformed JSON means the hook stays unchanged
 * @returns decoded hook toggle payload, or a field-specific validation error
 */
export function decodeHookToggleBody(
  body: string,
): DecodeResult<HookToggleBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON keeps the guardrail state unchanged.
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  // A hook toggle must be an object so the enabled value is explicit.
  if (!isRecord(raw)) return buildDecodeError("body", "must be a JSON object");
  // Non-boolean enabled values could accidentally flip a guardrail from ambiguous UI input.
  if (typeof raw.enabled !== "boolean") {
    return buildDecodeError("body.enabled", "must be a boolean");
  }
  return { ok: true, value: { enabled: raw.enabled } };
}

/**
 * Check the names, data fields, and file count of a terminal image-upload request before content-safety validation.
 * The upload handler then enforces image type and byte limits because non-empty text alone does not prove a safe attachment.
 *
 * @param body - raw request body; empty or malformed JSON means no images are attached
 * @param options - upload count limits; zero max means every image upload is rejected
 * @returns upload payload, or a path-specific error before the terminal receives files
 */
// eslint-disable-next-line complexity -- intentional: flat boundary checks preserve one precise error path per rejected upload field.
export function decodeTerminalUploadBody(
  body: string,
  options: { maxFiles: number },
): DecodeResult<TerminalUploadBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON means the terminal should not receive any uploaded files.
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  // Upload requests need named fields so file arrays can be validated before use.
  if (!isRecord(raw)) return buildDecodeError("body", "must be a JSON object");
  // Files must be an array so the UI can preserve upload order.
  if (!Array.isArray(raw.files)) {
    return buildDecodeError("body.files", "must be an array");
  }
  // Empty upload requests mean the user did not attach anything useful.
  if (raw.files.length === 0) {
    return buildDecodeError("body.files", "must contain at least one file");
  }
  // Too many files are rejected before the terminal upload pipeline starts.
  if (raw.files.length > options.maxFiles) {
    return buildDecodeError(
      "body.files",
      `must contain at most ${options.maxFiles} file(s) per request`,
    );
  }

  const files: TerminalUploadFile[] = [];
  // Validate each uploaded image entry before any terminal-facing upload work begins.
  for (const [index, item] of raw.files.entries()) {
    // A file entry must be an object so name and base64 data can be checked separately.
    if (!isRecord(item)) {
      return buildDecodeError(`body.files[${index}]`, "must be an object");
    }
    // Empty names would leave the terminal upload result with an unreadable attachment label.
    if (typeof item.name !== "string" || item.name.length === 0) {
      return buildDecodeError(
        `body.files[${index}].name`,
        "must be a non-empty string",
      );
    }
    // Empty data means the user would see an attachment that cannot be sent.
    if (typeof item.data !== "string" || item.data.length === 0) {
      return buildDecodeError(
        `body.files[${index}].data`,
        "must be a non-empty base64 string",
      );
    }
    files.push({ name: item.name, data: item.data });
  }

  return { ok: true, value: { files } };
}

/**
 * Decode optional custom titles for saved projects.
 * Use when the user renames projects; blank titles clear back to path-derived labels.
 *
 * @param raw - project-list request body; missing `projectTitles` means no custom titles were saved
 * @returns title map for visible project labels, or an error before state is written
 */
function decodeProjectTitles(
  raw: Record<string, unknown>,
): DecodeResult<Record<string, string>> {
  // Missing titles mean the UI should keep using path-derived names.
  if (!Object.hasOwn(raw, "projectTitles")) {
    return { ok: true, value: {} };
  }
  const projectTitles = raw.projectTitles;
  // Titles must be a map from project path to display label.
  if (!isRecord(projectTitles)) {
    return buildDecodeError("body.projectTitles", "must be an object");
  }
  const result: Record<string, string> = {};
  // Each saved title is validated before it can replace the path-derived project label.
  for (const [key, entry] of Object.entries(projectTitles)) {
    // Non-string titles cannot be shown as project aliases.
    if (typeof entry !== "string") {
      return buildDecodeError(
        `body.projectTitles[${JSON.stringify(key)}]`,
        "must be a string",
      );
    }
    const trimmed = entry.trim().slice(0, MAX_PROJECT_TITLE_LENGTH);
    // Blank titles mean the user cleared the alias and wants the fallback label.
    if (trimmed.length === 0) continue;
    result[key] = trimmed;
  }
  return { ok: true, value: result };
}

/**
 * Decode terminal keystrokes, pasted text, and resize requests before they reach the running session.
 * Separate message branches preserve the precise field error the socket handler sends back to the browser.
 *
 * @param raw - raw WebSocket frame text; empty or malformed JSON means no terminal action is taken
 * @returns client message, or a field error sent back to the browser
 */
export function decodeClientMessage(raw: string): DecodeResult<ClientMessage> {
  const parsed = parseJson(raw, "message");
  // Malformed frames are rejected without forwarding input to the terminal.
  if (!parsed.ok) return parsed;
  const messagePayload = parsed.value;
  // Terminal frames must be objects so the message type can be checked.
  if (!isRecord(messagePayload))
    return buildDecodeError("message", "must be a JSON object");

  // Input messages carry keystrokes or paste data from the visible terminal.
  if (messagePayload.type === "input") {
    // Input without string data cannot be forwarded to the PTY.
    if (typeof messagePayload.data !== "string") {
      return buildDecodeError(
        "message.data",
        "must be a string on input messages",
      );
    }
    return { ok: true, value: { type: "input", data: messagePayload.data } };
  }
  // Resize messages keep the PTY matched to the browser terminal dimensions.
  if (messagePayload.type === "resize") {
    // Invalid column counts would make terminal rendering drift from the browser.
    if (
      typeof messagePayload.cols !== "number" ||
      !Number.isFinite(messagePayload.cols)
    ) {
      return buildDecodeError(
        "message.cols",
        "must be a finite number on resize messages",
      );
    }
    // Invalid row counts would make terminal rendering drift from the browser.
    if (
      typeof messagePayload.rows !== "number" ||
      !Number.isFinite(messagePayload.rows)
    ) {
      return buildDecodeError(
        "message.rows",
        "must be a finite number on resize messages",
      );
    }
    return {
      ok: true,
      value: {
        type: "resize",
        cols: messagePayload.cols,
        rows: messagePayload.rows,
      },
    };
  }
  return buildDecodeError(
    "message.type",
    `must be "input" or "resize" (got ${JSON.stringify(messagePayload.type)})`,
  );
}

export const MAX_EVALUATE_CONTENT_BYTES = 256 * 1024;
const MAX_EVALUATE_NAME_BYTES = 200;
const MAX_EVALUATE_FILES = 32;
const MAX_EVALUATE_FILENAME_BYTES = 256;

/**
 * Measure user-submitted text in UTF-8 bytes.
 * Use for request caps so pasted skill content and filenames match HTTP payload limits.
 *
 * @param text - user-submitted text; empty text counts as zero bytes and may fail a caller's empty check
 * @returns UTF-8 byte count; zero means there is no payload content to send
 */
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Validate optional labels and kind overrides consistently for pasted Markdown and uploaded bundles.
 *
 * @param evaluationPayload - evaluation request; missing optional fields leave artifact naming and kind inference to the evaluator
 * @returns accepted optional labels, or a field error before scoring begins
 */
function decodeEvaluateOptionals(
  evaluationPayload: Record<string, unknown>,
): DecodeResult<{
  suggestedName?: string | undefined;
  kind?: "skill" | "shared-reference" | undefined;
}> {
  let suggestedName: string | undefined;
  // Suggested name is optional; absent values let the evaluator infer the artifact label.
  if (evaluationPayload.suggestedName !== undefined) {
    // Non-string names cannot be shown as the evaluated artifact label.
    if (typeof evaluationPayload.suggestedName !== "string") {
      return buildDecodeError("body.suggestedName", "must be a string");
    }
    // Overlong names are rejected before they overflow compact evaluator surfaces.
    if (
      utf8ByteLength(evaluationPayload.suggestedName) > MAX_EVALUATE_NAME_BYTES
    ) {
      return buildDecodeError(
        "body.suggestedName",
        `must be at most ${MAX_EVALUATE_NAME_BYTES} bytes`,
      );
    }
    suggestedName = evaluationPayload.suggestedName;
  }
  let kind: "skill" | "shared-reference" | undefined;
  // Kind is optional; absent values let the evaluator infer skill versus reference.
  if (evaluationPayload.kind !== undefined) {
    // Unknown kinds cannot be mapped to evaluator modes.
    if (
      evaluationPayload.kind !== "skill" &&
      evaluationPayload.kind !== "shared-reference"
    ) {
      return buildDecodeError(
        "body.kind",
        'must be "skill" or "shared-reference"',
      );
    }
    kind = evaluationPayload.kind;
  }
  return { ok: true, value: { suggestedName, kind } };
}

/**
 * Validate an uploaded filename so the report can identify its evidence without implying that a host filesystem path was uploaded.
 *
 * @param name - submitted filename; empty or non-string values are rejected before scoring
 * @param index - position in the bundle used to identify the rejected input field
 * @param seenNames - previously accepted names; an empty set means this is the first file being checked
 * @returns accepted bare filename, or the field error the user must correct
 */
function decodeEvaluateFilename(
  name: unknown,
  index: number,
  seenNames: ReadonlySet<string>,
): DecodeResult<string> {
  // Empty filenames make evaluator results impossible to tie back to a file.
  if (typeof name !== "string" || name.length === 0) {
    return buildDecodeError(
      `body.files[${index}].name`,
      "must be a non-empty string",
    );
  }
  // Overlong names would dominate the evaluator's file list and result labels.
  if (utf8ByteLength(name) > MAX_EVALUATE_FILENAME_BYTES) {
    return buildDecodeError(
      `body.files[${index}].name`,
      `must be at most ${MAX_EVALUATE_FILENAME_BYTES} bytes`,
    );
  }
  // File names stay bare so the UI does not imply host filesystem paths were uploaded.
  if (name.includes("/") || name.includes("\\") || name.includes("\0")) {
    return buildDecodeError(
      `body.files[${index}].name`,
      "must be a bare filename (no path separators or NUL bytes)",
    );
  }
  // Duplicate names would make result evidence ambiguous for the user.
  if (seenNames.has(name)) {
    return buildDecodeError(
      `body.files[${index}].name`,
      `duplicate filename: ${JSON.stringify(name)}`,
    );
  }
  return { ok: true, value: name };
}

/**
 * Validate the uploaded bundle before the Skills evaluator scores or labels any of its files.
 * The aggregate byte cap matches pasted content so many small uploads cannot bypass the same request budget.
 *
 * @param raw - raw files value; missing, empty, or non-array values mean no bundle can be scored
 * @returns decoded bundle, or a field error returned before the evaluator runs
 */
function decodeEvaluateFiles(
  raw: unknown,
): DecodeResult<{ name: string; content: string }[]> {
  // Multi-file evaluation needs an ordered array from the upload control.
  if (!Array.isArray(raw))
    return buildDecodeError("body.files", "must be an array");
  // Empty bundles mean the user dropped no content for the evaluator.
  if (raw.length === 0)
    return buildDecodeError("body.files", "must contain at least one file");
  // Too many files are rejected before the evaluator scores an oversized bundle.
  if (raw.length > MAX_EVALUATE_FILES) {
    return buildDecodeError(
      "body.files",
      `must contain at most ${MAX_EVALUATE_FILES} files`,
    );
  }
  const files: { name: string; content: string }[] = [];
  let totalBytes = 0;
  const seenNames = new Set<string>();
  // Validate every uploaded file before the evaluator sees the bundle.
  for (const [index, item] of raw.entries()) {
    // A file entry must be an object so the UI can name and score it.
    if (!isRecord(item)) {
      return buildDecodeError(`body.files[${index}]`, "must be an object");
    }
    const decodedName = decodeEvaluateFilename(item.name, index, seenNames);
    // A rejected filename must be corrected before any partial bundle can appear in the evaluation report.
    if (!decodedName.ok) return decodedName;
    seenNames.add(decodedName.value);
    // File content must be text because the evaluator scores source/document content.
    if (typeof item.content !== "string") {
      return buildDecodeError(
        `body.files[${index}].content`,
        "must be a string",
      );
    }
    totalBytes += utf8ByteLength(item.content);
    // The bundle cap keeps multi-file scoring within the same limits as pasted content.
    if (totalBytes > MAX_EVALUATE_CONTENT_BYTES) {
      return buildDecodeError(
        "body.files",
        `combined content size exceeds ${MAX_EVALUATE_CONTENT_BYTES} bytes`,
      );
    }
    files.push({ name: decodedName.value, content: item.content });
  }
  return { ok: true, value: files };
}

/**
 * Accept one source of Markdown for the Skills evaluator before scoring begins.
 *
 * This stays explicit because pasted content and uploaded bundles need the same field errors for ambiguous requests.
 * The deprecated /api/quality/analyse alias preserves this request contract.
 *
 * @param body - raw request body; empty or malformed JSON means no evaluation starts
 * @returns evaluation payload, or a field error shown before scoring
 */
export function decodeEvaluateBody(body: string): DecodeResult<EvaluateBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON stops evaluation before any score is computed.
  if (!parsed.ok) return parsed;
  // Evaluation requests need named fields for content/files and optional labels.
  if (!isRecord(parsed.value)) {
    return buildDecodeError("body", "must be a JSON object");
  }
  const evaluationPayload = parsed.value;
  const hasContent = evaluationPayload.content !== undefined;
  const hasFiles = evaluationPayload.files !== undefined;
  // The evaluator needs exactly one source: pasted content or an uploaded file bundle.
  if (hasContent === hasFiles) {
    return buildDecodeError(
      "body",
      'exactly one of "content" or "files" must be set',
    );
  }
  const optionals = decodeEvaluateOptionals(evaluationPayload);
  // Invalid labels stop before scoring so result metadata stays trustworthy.
  if (!optionals.ok) return optionals;

  // Pasted-content mode scores the single document currently visible in the evaluator.
  if (hasContent) {
    // Empty pasted content would produce a meaningless quality result.
    if (
      typeof evaluationPayload.content !== "string" ||
      evaluationPayload.content.trim().length === 0
    ) {
      return buildDecodeError(
        "body.content",
        "must be a non-empty markdown string",
      );
    }
    // Oversized pasted content is rejected before scoring starts.
    if (
      utf8ByteLength(evaluationPayload.content) > MAX_EVALUATE_CONTENT_BYTES
    ) {
      return buildDecodeError(
        "body.content",
        `must be at most ${MAX_EVALUATE_CONTENT_BYTES} bytes`,
      );
    }
    return {
      ok: true,
      value: {
        content: evaluationPayload.content,
        suggestedName: optionals.value.suggestedName,
        kind: optionals.value.kind,
      },
    };
  }

  const filesResult = decodeEvaluateFiles(evaluationPayload.files);
  // Invalid file bundles stop before the evaluator shows partial results.
  if (!filesResult.ok) return filesResult;
  return {
    ok: true,
    value: {
      files: filesResult.value,
      suggestedName: optionals.value.suggestedName,
      kind: optionals.value.kind,
    },
  };
}
