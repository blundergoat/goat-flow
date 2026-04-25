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

/** Decode POST /api/terminal/create body.
 *  Applies the `runner` fallback to the given default when absent or unknown -
 *  preserves existing server behaviour where a missing/bad runner was tolerated. */
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

  // runner: optional string; fall back to default when absent or unknown.
  let runner: AgentId = options.defaultRunner;
  if (Object.hasOwn(raw, "runner") && typeof raw.runner === "string") {
    if (options.validRunners.has(raw.runner)) {
      runner = raw.runner as AgentId;
    }
    // Unknown runner silently falls back to default; the server surfaces no
    // error to avoid breaking frontends that send legacy/stale values.
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
