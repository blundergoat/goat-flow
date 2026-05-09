/**
 * Runtime decoders for server-boundary payloads.
 *
 * Every ingress boundary (HTTP body, WebSocket message) must validate the
 * payload shape before dispatching. The previous code hand-rolled casts
 * like `JSON.parse(body) as { prompt?: string }`, which silently allows
 * arbitrary shapes through to downstream logic. M17-9 centralises the
 * per-boundary decoders here so failures return a typed `{ ok: false, error, path }`
 * instead of a stack trace at a later inner layer.
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

interface TerminalCreateBody {
  prompt: string;
  projectPath: string;
  targetPath: string;
  runner: Runner;
}

interface ProjectsListBody {
  paths: string[];
  favorites: string[];
  projectTitles: Record<string, string>;
}

interface TerminalUploadFile {
  name: string;
  data: string;
}

interface TerminalUploadBody {
  files: TerminalUploadFile[];
}

interface AnalyseBody {
  /** Either a single content string (paste / textarea) OR an array of named
   *  files (multi-file drop). Exactly one must be set. */
  content?: string;
  files?: { name: string; content: string }[];
  /** Optional filename or display name; used as the analyzed artifact name. */
  suggestedName?: string;
  /** Optional explicit kind override; otherwise inferred from frontmatter. */
  kind?: "skill" | "shared-reference";
}

const MAX_PROJECT_TITLE_LENGTH = 120;

/** Build a decoder error result. */
function err(
  path: string,
  message: string,
): { ok: false; error: string; path: string } {
  return { ok: false, error: message, path };
}

/** Parse the JSON. */
function parseJson(body: string, path: string): DecodeResult<unknown> {
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err(path, `invalid JSON: ${message}`);
  }
}

/** Check whether a value is a record. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode one string-array field from a JSON object. */
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

/** Decode one optional string field from a JSON object. */
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

/** Decode POST /api/terminal/create body. */
export function decodeTerminalCreateBody(
  body: string,
  options: { validRunners: ReadonlySet<string>; defaultRunner: AgentId },
): DecodeResult<TerminalCreateBody> {
  const parsed = parseJson(body, "body");
  if (!parsed.ok) return parsed;
  const raw = parsed.value;
  if (!isRecord(raw)) return err("body", "must be a JSON object");

  // prompt: optional string; empty string allowed (opens an idle shell).
  const prompt = decodeOptionalStringField(raw, "prompt");
  if (!prompt.ok) return prompt;

  // projectPath: optional string.
  const projectPath = decodeOptionalStringField(raw, "projectPath");
  if (!projectPath.ok) return projectPath;

  // targetPath: optional string. When present, the runner cwd can differ from
  // the selected project being analysed.
  const targetPath = decodeOptionalStringField(raw, "targetPath");
  if (!targetPath.ok) return targetPath;

  // runner: optional string; fall back only when absent.
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

/** Decode POST /api/projects/list body. */
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

/** Decode POST /api/terminal/:id/upload-image body.
 *  Shape: `{ files: [{ name: string, data: <base64 string> }] }`. The handler
 *  enforces size, MIME, and count limits after structural validation. */
// eslint-disable-next-line complexity -- explicit ingress validation: each branch maps to one rejection class for the upload payload
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
  const value = raw.projectTitles;
  if (!isRecord(value)) {
    return err("body.projectTitles", "must be an object");
  }
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
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

/** Decode a WebSocket frame into a typed ClientMessage or a typed error. */
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

const MAX_ANALYSE_CONTENT_BYTES = 256 * 1024;
const MAX_ANALYSE_NAME_BYTES = 200;
const MAX_ANALYSE_FILES = 32;
const MAX_ANALYSE_FILENAME_BYTES = 256;

/** Decode the optional `suggestedName` and `kind` fields shared between the
 *  single-content and multi-file analyse payloads. */
function decodeAnalyseOptionals(obj: Record<string, unknown>): DecodeResult<{
  suggestedName?: string;
  kind?: "skill" | "shared-reference";
}> {
  let suggestedName: string | undefined;
  if (obj.suggestedName !== undefined) {
    if (typeof obj.suggestedName !== "string") {
      return err("body.suggestedName", "must be a string");
    }
    if (obj.suggestedName.length > MAX_ANALYSE_NAME_BYTES) {
      return err(
        "body.suggestedName",
        `must be at most ${MAX_ANALYSE_NAME_BYTES} bytes`,
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

/** Decode the `files` array on a multi-file analyse body. Validates count,
 *  per-file name + content shape, and enforces the same total-byte cap as the
 *  single-content path so the server can't be used as a CPU sink. */
// eslint-disable-next-line complexity -- per-file boundary validation; each branch maps to one rejection class for the bundle payload
function decodeAnalyseFiles(
  raw: unknown,
): DecodeResult<{ name: string; content: string }[]> {
  if (!Array.isArray(raw)) return err("body.files", "must be an array");
  if (raw.length === 0)
    return err("body.files", "must contain at least one file");
  if (raw.length > MAX_ANALYSE_FILES) {
    return err("body.files", `must contain at most ${MAX_ANALYSE_FILES} files`);
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
    if (item.name.length > MAX_ANALYSE_FILENAME_BYTES) {
      return err(
        `body.files[${index}].name`,
        `must be at most ${MAX_ANALYSE_FILENAME_BYTES} bytes`,
      );
    }
    if (item.name.includes("/") || item.name.includes("\0")) {
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
    totalBytes += item.content.length;
    if (totalBytes > MAX_ANALYSE_CONTENT_BYTES) {
      return err(
        "body.files",
        `combined content size exceeds ${MAX_ANALYSE_CONTENT_BYTES} bytes`,
      );
    }
    files.push({ name: item.name, content: item.content });
  }
  return { ok: true, value: files };
}

/** Decode and validate a `POST /api/quality/analyse` request body.
 *  Accepts either a single `content` string (paste / textarea) or a `files`
 *  array (multi-file drag-drop) — exactly one must be set. */
export function decodeAnalyseBody(body: string): DecodeResult<AnalyseBody> {
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
  const optionals = decodeAnalyseOptionals(obj);
  if (!optionals.ok) return optionals;

  if (hasContent) {
    if (typeof obj.content !== "string" || obj.content.trim().length === 0) {
      return err("body.content", "must be a non-empty markdown string");
    }
    if (obj.content.length > MAX_ANALYSE_CONTENT_BYTES) {
      return err(
        "body.content",
        `must be at most ${MAX_ANALYSE_CONTENT_BYTES} bytes`,
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

  const filesResult = decodeAnalyseFiles(obj.files);
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
