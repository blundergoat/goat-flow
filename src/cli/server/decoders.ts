/**
 * Runtime decoders for server-boundary payloads.
 *
 * Every ingress boundary (HTTP body, WebSocket message) validates payload shape
 * before dispatching. These decoders return typed `{ ok: false, error, path }`
 * failures so routes can report the exact rejected field instead of letting
 * arbitrary shapes fail later in terminal or quality logic.
 *
 * Deliberately pure TS with no new runtime deps (zod, valibot, etc.) per
 * goat-flow's zero-new-dep policy. Narrow shapes are easy enough to validate
 * by hand.
 */
import type { AgentId } from "../types.js";
import type { ClientMessage, Runner } from "./types.js";

type DecodeResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string; path: string };

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
interface EvaluateBody {
  /** Either a single content string (paste / textarea) OR an array of named
   *  files (multi-file drop). Exactly one must be set. */
  content?: string;
  files?: { name: string; content: string }[];
  /** Optional filename or display name; used as the analyzed artifact name. */
  suggestedName?: string;
  /** Optional explicit kind override; otherwise inferred from frontmatter. */
  kind?: "skill" | "shared-reference";
}

/** Hook-toggle payload accepted by POST /api/hooks/:hookId/toggle. */
interface HookToggleBody {
  enabled: boolean;
}

const MAX_PROJECT_TITLE_LENGTH = 120; // Storage limit: dense dashboard rows cannot absorb long custom aliases.

/** Build a decoder error result. */
function err(
  path: string,
  message: string,
): { ok: false; error: string; path: string } {
  return { ok: false, error: message, path };
}

/** Parse JSON; reports malformed bodies as typed path errors instead of throwing. */
function parseJson(body: string, path: string): DecodeResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(path, `invalid JSON: ${message}`);
  }
}

/** Treat arrays as invalid objects because every decoded payload expects named fields. */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/** Decode dashboard string lists; omitted optional lists become empty for older state files. */
function decodeStringArrayField(
  raw: Record<string, unknown>,
  key: "paths" | "favorites",
  options?: { required?: boolean },
): DecodeResult<string[]> {
  if (!Object.hasOwn(raw, key)) {
    return options?.required
      ? err(`body.${key}`, "is required")
      : {
          ok: true,
          value: [],
        };
  }
  if (!Array.isArray(raw[key])) {
    return err(`body.${key}`, "must be an array");
  }
  const values: string[] = [];
  for (const [index, item] of raw[key].entries()) {
    if (typeof item !== "string") {
      return err(`body.${key}[${index}]`, "must be a string");
    }
    values.push(item);
  }
  return { ok: true, value: values };
}

/** Decode terminal-create strings; missing values become empty to launch against defaults. */
function decodeOptionalStringField(
  raw: Record<string, unknown>,
  key: "prompt" | "projectPath" | "targetPath",
): DecodeResult<string> {
  if (!Object.hasOwn(raw, key)) {
    return { ok: true, value: "" };
  }
  return typeof raw[key] === "string"
    ? { ok: true, value: raw[key] }
    : err(`body.${key}`, "must be a string");
}

/**
 * Decode POST /api/terminal/create without defaulting invalid runner names.
 *
 * @param body Raw request body.
 * @param options Runner allow-list plus the fallback used only when `runner` is absent.
 * @returns Typed terminal-create payload or a path-specific decoder error.
 */
export function decodeTerminalCreateBody(
  body: string,
  options: { validRunners: ReadonlySet<string>; defaultRunner: AgentId },
): DecodeResult<TerminalCreateBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (!isRecord(raw)) return err("body", "must be a JSON object");

  // Empty prompt is valid: the terminal route opens an idle shell in that case.
  const prompt = decodeOptionalStringField(raw, "prompt");
  if (!prompt.ok) return prompt;

  const projectPath = decodeOptionalStringField(raw, "projectPath");
  if (!projectPath.ok) return projectPath;

  // targetPath: optional string. When present, the runner cwd can differ from
  // the selected project being analysed.
  const targetPath = decodeOptionalStringField(raw, "targetPath");
  if (!targetPath.ok) return targetPath;

  // Invalid runner names stay errors; the default only applies when the field is absent.
  let runner: AgentId = options.defaultRunner;
  if (Object.hasOwn(raw, "runner")) {
    if (typeof raw.runner !== "string") {
      return err("body.runner", "must be a string");
    }
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
 * Decode POST /api/projects/list while preserving dashboard state-file fallbacks.
 *
 * @param body Raw request body.
 * @returns Typed project-list payload or a path-specific decoder error.
 */
export function decodeProjectsListBody(
  body: string,
): DecodeResult<ProjectsListBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (!isRecord(raw)) return err("body", "must be a JSON object");

  const paths = decodeStringArrayField(raw, "paths", { required: true });
  if (!paths.ok) return paths;
  const favorites = decodeStringArrayField(raw, "favorites");
  if (!favorites.ok) return favorites;
  const projectTitles = decodeProjectTitles(raw);
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

/** Decode POST /api/hooks/:hookId/toggle. */
export function decodeHookToggleBody(
  body: string,
): DecodeResult<HookToggleBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (!isRecord(raw)) return err("body", "must be a JSON object");
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
 * @param body Raw request body.
 * @param options Request-level upload limits from the route.
 * @returns Typed upload payload or a path-specific decoder error.
 */
// eslint-disable-next-line complexity -- intentional: flat boundary checks preserve one precise error path per rejected upload field.
export function decodeTerminalUploadBody(
  body: string,
  options: { maxFiles: number },
): DecodeResult<TerminalUploadBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (!isRecord(raw)) return err("body", "must be a JSON object");
  if (!Array.isArray(raw.files)) {
    return err("body.files", "must be an array");
  }
  if (raw.files.length === 0) {
    return err("body.files", "must contain at least one file");
  }
  if (raw.files.length > options.maxFiles) {
    return err(
      "body.files",
      `must contain at most ${options.maxFiles} file(s) per request`,
    );
  }

  const files: TerminalUploadFile[] = [];
  for (const [index, item] of raw.files.entries()) {
    if (!isRecord(item)) {
      return err(`body.files[${index}]`, "must be an object");
    }
    if (typeof item.name !== "string" || item.name.length === 0) {
      return err(`body.files[${index}].name`, "must be a non-empty string");
    }
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

/** Decode the optional `projectTitles` map: project path → custom display name.
 *  Empty / whitespace-only titles are dropped so clearing a title round-trips
 *  to the path-derived fallback without leaving a zombie entry in the file. */
function decodeProjectTitles(
  raw: Record<string, unknown>,
): DecodeResult<Record<string, string>> {
  if (!Object.hasOwn(raw, "projectTitles")) {
    return { ok: true, value: {} };
  }
  const projectTitles = raw.projectTitles;
  if (!isRecord(projectTitles)) {
    return err("body.projectTitles", "must be an object");
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(projectTitles)) {
    if (typeof entry !== "string") {
      return err(
        `body.projectTitles[${JSON.stringify(key)}]`,
        "must be a string",
      );
    }
    const trimmed = entry.trim().slice(0, MAX_PROJECT_TITLE_LENGTH);
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
 * @param raw Raw WebSocket frame text.
 * @returns Typed client message or a path-specific decoder error.
 */
export function decodeClientMessage(raw: string): DecodeResult<ClientMessage> {
  const parsed = parseJson(raw, "message");
  if (!parsed.ok) return parsed;
  const obj = parsed.value;
  if (!isRecord(obj)) return err("message", "must be a JSON object");

  if (obj.type === "input") {
    if (typeof obj.data !== "string") {
      return err("message.data", "must be a string on input messages");
    }
    return { ok: true, value: { type: "input", data: obj.data } };
  }
  if (obj.type === "resize") {
    if (typeof obj.cols !== "number" || !Number.isFinite(obj.cols)) {
      return err("message.cols", "must be a finite number on resize messages");
    }
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

/** Measure limits in bytes because HTTP caps count UTF-8 bytes, not JS characters. */
function utf8ByteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}

/**
 * Decode the optional evaluate fields shared by both accepted payload shapes.
 *
 * This stays separate because single-content and multi-file requests must
 * report identical path errors for `suggestedName` and `kind`.
 */
function decodeEvaluateOptionals(obj: Record<string, unknown>): DecodeResult<{
  suggestedName?: string;
  kind?: "skill" | "shared-reference";
}> {
  let suggestedName: string | undefined;
  if (obj.suggestedName !== undefined) {
    if (typeof obj.suggestedName !== "string") {
      return err("body.suggestedName", "must be a string");
    }
    if (utf8ByteLength(obj.suggestedName) > MAX_EVALUATE_NAME_BYTES) {
      return err(
        "body.suggestedName",
        `must be at most ${MAX_EVALUATE_NAME_BYTES} bytes`,
      );
    }
    suggestedName = obj.suggestedName;
  }
  let kind: "skill" | "shared-reference" | undefined;
  if (obj.kind !== undefined) {
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
 */
// eslint-disable-next-line complexity -- intentional: per-file boundary checks preserve exact error paths for rejected bundle entries.
function decodeEvaluateFiles(
  raw: unknown,
): DecodeResult<{ name: string; content: string }[]> {
  if (!Array.isArray(raw)) return err("body.files", "must be an array");
  if (raw.length === 0)
    return err("body.files", "must contain at least one file");
  if (raw.length > MAX_EVALUATE_FILES) {
    return err(
      "body.files",
      `must contain at most ${MAX_EVALUATE_FILES} files`,
    );
  }
  const files: { name: string; content: string }[] = [];
  let totalBytes = 0;
  const seenNames = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (!isRecord(item)) {
      return err(`body.files[${index}]`, "must be an object");
    }
    if (typeof item.name !== "string" || item.name.length === 0) {
      return err(`body.files[${index}].name`, "must be a non-empty string");
    }
    if (utf8ByteLength(item.name) > MAX_EVALUATE_FILENAME_BYTES) {
      return err(
        `body.files[${index}].name`,
        `must be at most ${MAX_EVALUATE_FILENAME_BYTES} bytes`,
      );
    }
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
    if (seenNames.has(item.name)) {
      return err(
        `body.files[${index}].name`,
        `duplicate filename: ${JSON.stringify(item.name)}`,
      );
    }
    seenNames.add(item.name);
    if (typeof item.content !== "string") {
      return err(`body.files[${index}].content`, "must be a string");
    }
    totalBytes += utf8ByteLength(item.content);
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
 * @param body Raw request body.
 * @returns Typed evaluate payload or a path-specific decoder error.
 */
export function decodeEvaluateBody(body: string): DecodeResult<EvaluateBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  if (!isRecord(parsed.value)) {
    return err("body", "must be a JSON object");
  }
  const obj = parsed.value;
  const hasContent = obj.content !== undefined;
  const hasFiles = obj.files !== undefined;
  if (hasContent === hasFiles) {
    return err("body", 'exactly one of "content" or "files" must be set');
  }
  const optionals = decodeEvaluateOptionals(obj);
  if (!optionals.ok) return optionals;

  if (hasContent) {
    if (typeof obj.content !== "string" || obj.content.trim().length === 0) {
      return err("body.content", "must be a non-empty markdown string");
    }
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
