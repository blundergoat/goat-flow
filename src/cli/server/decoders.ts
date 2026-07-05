/**
 * Validate dashboard requests at the server boundary.
 * Use when the browser sends terminal, project, hook, upload, or skill-evaluation payloads so the
 * user gets a precise field error instead of a failed terminal session or broken dashboard state.
 * These decoders are intentionally dependency-free because each route only accepts a small,
 * user-facing payload shape.
 */
import type { AgentId } from "../types.js";
import type { ClientMessage, Runner } from "./types.js";

type DecodeResult<T> =
  { ok: true; value: T } | { ok: false; error: string; path: string };

/** Terminal-create payload after optional text fields and runner selection are normalised. */
interface TerminalCreateBody {
  prompt: string;
  projectPath: string;
  targetPath: string;
  runner: Runner;
}

/** Dashboard project-list state after omitted optional collections use their state-file fallbacks. */
interface ProjectsListBody {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
}

/** Dashboard project-path payload for single-project write actions. */
interface ProjectPathBody {
  path: string;
}

/** Base64 upload item after structural validation; file safety checks run in the upload handler. */
interface TerminalUploadFile {
  name: string;
  data: string;
}

/** Terminal upload payload grouped by request so count limits can be enforced before decoding files. */
interface TerminalUploadBody {
  files: TerminalUploadFile[];
}

/** Quality-evaluate payload, accepting one pasted document or one bounded file bundle. */
export interface EvaluateBody {
  /** Either a single content string (paste / textarea) OR an array of named
   *  files (multi-file drop). Exactly one must be set. */
  content?: string;
  files?: { name: string; content: string }[];
  /** Optional filename or display name; used as the analyzed artifact name. */
  suggestedName?: string | undefined;
  /** Optional explicit kind override; otherwise inferred from frontmatter. */
  kind?: "skill" | "shared-reference" | undefined;
}

/** Hook-toggle payload accepted by POST /api/hooks/:hookId/toggle. */
type HookToggleBody = Record<"enabled", boolean>;

const MAX_PROJECT_TITLE_LENGTH = 120; // Storage limit: dense dashboard rows cannot absorb long custom aliases.

/**
 * Build the error shape every route decoder returns.
 * Use when rejecting one field so the dashboard can show the exact user-fixable request path.
 *
 * @param path - request field path; empty would leave the UI without a precise failing field
 * @param message - plain validation message; empty would produce an unhelpful toast or response
 * @returns decoder failure; never `null`, because callers branch on `ok: false`
 */
function err(
  path: string,
  message: string,
): { ok: false; error: string; path: string } {
  return { ok: false, error: message, path };
}

/**
 * Parse a JSON request body without throwing through the route handler.
 * Use at every dashboard ingress so malformed user/browser payloads become field errors.
 *
 * @param body - raw request body; empty or invalid text means there is no usable payload to process
 * @param path - field label used in the error; empty makes the dashboard error less actionable
 * @returns parsed JSON, or a decoder error describing the malformed body
 */
function parseJson(body: string, path: string): DecodeResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    // Invalid JSON cannot be routed, so tell the user/route which body failed.
    const message = e instanceof Error ? e.message : String(e);
    return err(path, `invalid JSON: ${message}`);
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
 * @param key - list field to read; empty is not accepted because only known state lists are decoded
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
      ? err(`body.${key}`, "is required")
      : {
          ok: true,
          value: [],
        };
  }
  // Non-array state would make the Projects list unreadable.
  if (!Array.isArray(raw[key])) {
    return err(`body.${key}`, "must be an array");
  }
  const values: string[] = [];
  // Validate each visible path/favorite before it is written back to dashboard state.
  for (const [index, item] of raw[key].entries()) {
    // Non-string entries cannot be shown as project paths or favorites.
    if (typeof item !== "string") {
      return err(`body.${key}[${index}]`, "must be a string");
    }
    values.push(item);
  }
  return { ok: true, value: values };
}

/**
 * Decode one optional terminal-create text field.
 * Use when launching terminals where omitted text means the route should fall back to the selected project.
 *
 * @param raw - terminal-create body; missing field means the user did not choose that optional value
 * @param key - prompt/path field to read; empty is not accepted because only known terminal fields are decoded
 * @returns decoded string, or an empty string when the UI intentionally left the value unset
 */
function decodeOptionalStringField(
  raw: Record<string, unknown>,
  key: "prompt" | "projectPath" | "targetPath",
): DecodeResult<string> {
  // Missing optional terminal fields mean "use the route default" instead of blocking launch.
  if (!Object.hasOwn(raw, key)) {
    return { ok: true, value: "" };
  }
  return typeof raw[key] === "string"
    ? { ok: true, value: raw[key] }
    : err(`body.${key}`, "must be a string");
}

/**
 * Decode a request to open a dashboard terminal.
 * Use when the user clicks a terminal action so invalid runner names fail before any session starts.
 *
 * @param body - raw request body; empty or malformed JSON means no terminal should be opened
 * @param options - allowed runners plus fallback; empty runner set means every explicit runner is rejected
 * @returns terminal-create payload, or an error the route can show without starting a session
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
  if (!isRecord(raw)) return err("body", "must be a JSON object");

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

  // Invalid runner names stay errors; the default only applies when the field is absent.
  let runner: AgentId = options.defaultRunner;
  // Missing runner means use the dashboard's active/default runner.
  if (Object.hasOwn(raw, "runner")) {
    // Runner ids must be strings so they can be matched against configured agents.
    if (typeof raw.runner !== "string") {
      return err("body.runner", "must be a string");
    }
    // Unknown runners would create a terminal the dashboard cannot label or launch.
    if (!options.validRunners.has(raw.runner)) {
      return err(
        "body.runner",
        `unknown runner: ${raw.runner}. Valid: ${Array.from(options.validRunners).join(", ")}`,
      );
    }
    runner = raw.runner as AgentId;
  }

  return {
    ok: true,
    value: {
      prompt: prompt.value,
      projectPath: projectPath.value,
      targetPath: targetPath.value,
      runner,
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
  if (!isRecord(raw)) return err("body", "must be a JSON object");

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
  if (!isRecord(raw)) return err("body", "must be a JSON object");
  // Missing path means the dashboard cannot know which project the user meant.
  if (!Object.hasOwn(raw, "path")) return err("body.path", "is required");
  return typeof raw.path === "string"
    ? { ok: true, value: { path: raw.path } }
    : err("body.path", "must be a string");
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
  if (!isRecord(raw)) return err("body", "must be a JSON object");
  // Non-boolean enabled values could accidentally flip a guardrail from ambiguous UI input.
  if (typeof raw.enabled !== "boolean") {
    return err("body.enabled", "must be a boolean");
  }
  return { ok: true, value: { enabled: raw.enabled } };
}

/**
 * Decode POST /api/terminal/:id/upload-image before content safety checks.
 *
 * The handler enforces MIME and byte limits after this structural pass; this
 * decoder only proves the request has named base64 entries and a valid count.
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
  if (!isRecord(raw)) return err("body", "must be a JSON object");
  // Files must be an array so the UI can preserve upload order.
  if (!Array.isArray(raw.files)) {
    return err("body.files", "must be an array");
  }
  // Empty upload requests mean the user did not attach anything useful.
  if (raw.files.length === 0) {
    return err("body.files", "must contain at least one file");
  }
  // Too many files are rejected before the terminal upload pipeline starts.
  if (raw.files.length > options.maxFiles) {
    return err(
      "body.files",
      `must contain at most ${options.maxFiles} file(s) per request`,
    );
  }

  const files: TerminalUploadFile[] = [];
  // Validate each uploaded image entry before any terminal-facing upload work begins.
  for (const [index, item] of raw.files.entries()) {
    // A file entry must be an object so name and base64 data can be checked separately.
    if (!isRecord(item)) {
      return err(`body.files[${index}]`, "must be an object");
    }
    // Empty names would leave the terminal upload result with an unreadable attachment label.
    if (typeof item.name !== "string" || item.name.length === 0) {
      return err(`body.files[${index}].name`, "must be a non-empty string");
    }
    // Empty data means the user would see an attachment that cannot be sent.
    if (typeof item.data !== "string" || item.data.length === 0) {
      return err(
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
    return err("body.projectTitles", "must be an object");
  }
  const result: Record<string, string> = {};
  // Each saved title is validated before it can replace the path-derived project label.
  for (const [key, entry] of Object.entries(projectTitles)) {
    // Non-string titles cannot be shown as project aliases.
    if (typeof entry !== "string") {
      return err(
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
 * Decode a terminal WebSocket frame with one branch per supported message type.
 *
 * The socket handler sends these errors back to the client, so the explicit
 * input and resize branches intentionally preserve the exact rejected field.
 *
 * @param raw - raw WebSocket frame text; empty or malformed JSON means no terminal action is taken
 * @returns client message, or a path-specific decoder error sent back to the browser
 */
export function decodeClientMessage(raw: string): DecodeResult<ClientMessage> {
  const parsed = parseJson(raw, "message");
  // Malformed frames are rejected without forwarding input to the terminal.
  if (!parsed.ok) return parsed;
  const obj = parsed.value;
  // Terminal frames must be objects so the message type can be checked.
  if (!isRecord(obj)) return err("message", "must be a JSON object");

  // Input messages carry keystrokes or paste data from the visible terminal.
  if (obj.type === "input") {
    // Input without string data cannot be forwarded to the PTY.
    if (typeof obj.data !== "string") {
      return err("message.data", "must be a string on input messages");
    }
    return { ok: true, value: { type: "input", data: obj.data } };
  }
  // Resize messages keep the PTY matched to the browser terminal dimensions.
  if (obj.type === "resize") {
    // Invalid column counts would make terminal rendering drift from the browser.
    if (typeof obj.cols !== "number" || !Number.isFinite(obj.cols)) {
      return err("message.cols", "must be a finite number on resize messages");
    }
    // Invalid row counts would make terminal rendering drift from the browser.
    if (typeof obj.rows !== "number" || !Number.isFinite(obj.rows)) {
      return err("message.rows", "must be a finite number on resize messages");
    }
    return {
      ok: true,
      value: { type: "resize", cols: obj.cols, rows: obj.rows },
    };
  }
  return err(
    "message.type",
    `must be "input" or "resize" (got ${JSON.stringify(obj.type)})`,
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
 * Decode the optional evaluate fields shared by both accepted payload shapes.
 *
 * This stays separate because single-content and multi-file requests must
 * report identical path errors for `suggestedName` and `kind`.
 *
 * @param obj - evaluate request object; missing optionals mean the UI lets the evaluator infer labels
 * @returns optional evaluation labels, or an error before the evaluator runs
 */
function decodeEvaluateOptionals(obj: Record<string, unknown>): DecodeResult<{
  suggestedName?: string | undefined;
  kind?: "skill" | "shared-reference" | undefined;
}> {
  let suggestedName: string | undefined;
  // Suggested name is optional; absent values let the evaluator infer the artifact label.
  if (obj.suggestedName !== undefined) {
    // Non-string names cannot be shown as the evaluated artifact label.
    if (typeof obj.suggestedName !== "string") {
      return err("body.suggestedName", "must be a string");
    }
    // Overlong names are rejected before they overflow compact evaluator surfaces.
    if (utf8ByteLength(obj.suggestedName) > MAX_EVALUATE_NAME_BYTES) {
      return err(
        "body.suggestedName",
        `must be at most ${MAX_EVALUATE_NAME_BYTES} bytes`,
      );
    }
    suggestedName = obj.suggestedName;
  }
  let kind: "skill" | "shared-reference" | undefined;
  // Kind is optional; absent values let the evaluator infer skill versus reference.
  if (obj.kind !== undefined) {
    // Unknown kinds cannot be mapped to evaluator modes.
    if (obj.kind !== "skill" && obj.kind !== "shared-reference") {
      return err("body.kind", 'must be "skill" or "shared-reference"');
    }
    kind = obj.kind;
  }
  return { ok: true, value: { suggestedName, kind } };
}

/**
 * Decode the `files` array on a multi-file evaluate body.
 *
 * The bundle path uses the same aggregate byte cap as pasted content, preventing
 * many small files from bypassing the route-level request budget.
 *
 * @param raw - raw files value; missing, empty, or non-array values mean no file bundle can be scored
 * @returns decoded file bundle, or an error before the skill evaluator runs
 */
// eslint-disable-next-line complexity -- intentional: per-file boundary checks preserve exact error paths for rejected bundle entries.
function decodeEvaluateFiles(
  raw: unknown,
): DecodeResult<{ name: string; content: string }[]> {
  // Multi-file evaluation needs an ordered array from the upload control.
  if (!Array.isArray(raw)) return err("body.files", "must be an array");
  // Empty bundles mean the user dropped no content for the evaluator.
  if (raw.length === 0)
    return err("body.files", "must contain at least one file");
  // Too many files are rejected before the evaluator scores an oversized bundle.
  if (raw.length > MAX_EVALUATE_FILES) {
    return err(
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
      return err(`body.files[${index}]`, "must be an object");
    }
    // Empty filenames make evaluator results impossible to tie back to a file.
    if (typeof item.name !== "string" || item.name.length === 0) {
      return err(`body.files[${index}].name`, "must be a non-empty string");
    }
    // Overlong names would dominate the evaluator's file list and result labels.
    if (utf8ByteLength(item.name) > MAX_EVALUATE_FILENAME_BYTES) {
      return err(
        `body.files[${index}].name`,
        `must be at most ${MAX_EVALUATE_FILENAME_BYTES} bytes`,
      );
    }
    // File names stay bare so the UI does not imply host filesystem paths were uploaded.
    if (
      item.name.includes("/") ||
      item.name.includes("\\") ||
      item.name.includes("\0")
    ) {
      return err(
        `body.files[${index}].name`,
        "must be a bare filename (no path separators or NUL bytes)",
      );
    }
    // Duplicate names would make result evidence ambiguous for the user.
    if (seenNames.has(item.name)) {
      return err(
        `body.files[${index}].name`,
        `duplicate filename: ${JSON.stringify(item.name)}`,
      );
    }
    seenNames.add(item.name);
    // File content must be text because the evaluator scores source/document content.
    if (typeof item.content !== "string") {
      return err(`body.files[${index}].content`, "must be a string");
    }
    totalBytes += utf8ByteLength(item.content);
    // The bundle cap keeps multi-file scoring within the same limits as pasted content.
    if (totalBytes > MAX_EVALUATE_CONTENT_BYTES) {
      return err(
        "body.files",
        `combined content size exceeds ${MAX_EVALUATE_CONTENT_BYTES} bytes`,
      );
    }
    files.push({ name: item.name, content: item.content });
  }
  return { ok: true, value: files };
}

/**
 * Decode and validate a `POST /api/quality/evaluate` request body.
 *
 * This stays explicit because the route accepts the current multi-file uploader
 * and the older single-text form; ambiguous bodies are rejected before quality
 * scoring. The deprecated `/api/quality/analyse` alias reuses the same shape.
 *
 * @param body - raw request body; empty or malformed JSON means no evaluation starts
 * @returns evaluate payload, or a path-specific error shown before scoring
 */
export function decodeEvaluateBody(body: string): DecodeResult<EvaluateBody> {
  const parsed = parseJson(body, "body");
  // Malformed JSON stops evaluation before any score is computed.
  if (!parsed.ok) return parsed;
  // Evaluation requests need named fields for content/files and optional labels.
  if (!isRecord(parsed.value)) {
    return err("body", "must be a JSON object");
  }
  const obj = parsed.value;
  const hasContent = obj.content !== undefined;
  const hasFiles = obj.files !== undefined;
  // The evaluator needs exactly one source: pasted content or an uploaded file bundle.
  if (hasContent === hasFiles) {
    return err("body", 'exactly one of "content" or "files" must be set');
  }
  const optionals = decodeEvaluateOptionals(obj);
  // Invalid labels stop before scoring so result metadata stays trustworthy.
  if (!optionals.ok) return optionals;

  // Pasted-content mode scores the single document currently visible in the evaluator.
  if (hasContent) {
    // Empty pasted content would produce a meaningless quality result.
    if (typeof obj.content !== "string" || obj.content.trim().length === 0) {
      return err("body.content", "must be a non-empty markdown string");
    }
    // Oversized pasted content is rejected before scoring starts.
    if (utf8ByteLength(obj.content) > MAX_EVALUATE_CONTENT_BYTES) {
      return err(
        "body.content",
        `must be at most ${MAX_EVALUATE_CONTENT_BYTES} bytes`,
      );
    }
    return {
      ok: true,
      value: {
        content: obj.content,
        suggestedName: optionals.value.suggestedName,
        kind: optionals.value.kind,
      },
    };
  }

  const filesResult = decodeEvaluateFiles(obj.files);
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
