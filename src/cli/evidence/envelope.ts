/**
 * Shared evidence envelope for local runtime producers.
 *
 * The envelope adapts the existing CheckEvidence provenance contract instead
 * of inventing a parallel event schema. Producers add the small runtime field
 * set needed to answer "what happened locally?" while payloads stay redacted by
 * default and writes remain non-fatal.
 */
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  type Stats,
} from "node:fs";
import { join } from "node:path";
import type { CheckEvidence } from "../audit/provenance-types.js";
import { validateProvenance } from "../audit/provenance-types.js";
import {
  isRedactedEvidenceValue,
  type RedactedEvidenceValue,
} from "./redaction.js";

type EvidenceActor = "dashboard" | "cli" | "server";

/** Stable event names emitted by local runtime producers into the evidence log. */
export type EvidenceEventKind =
  | "terminal.create"
  | "terminal.delete"
  | "terminal.upload"
  | "terminal.send"
  | "prompt.launch"
  | "prompt.send"
  | "audit.exec"
  | "audit.run"
  | "setup.prompt"
  | "quality.prompt"
  | "index.regenerate"
  | "project.save"
  | "project.remove"
  | "project.switch"
  | "hook.verify";

type EvidencePayloadValue =
  | string
  | number
  | boolean
  | null
  | RedactedEvidenceValue
  | EvidencePayloadValue[]
  | { [key: string]: EvidencePayloadValue };

/** JSON-compatible payload object; sensitive values must use redaction markers. */
export type EvidencePayload = Record<string, EvidencePayloadValue>;

/** Runtime event record that reuses CheckEvidence provenance fields. */
export interface EvidenceEnvelope extends CheckEvidence {
  producer: string;
  event_kind: EvidenceEventKind;
  actor: EvidenceActor;
  timestamp: string;
  project_path: string;
  payload?: EvidencePayload;
}

/** Caller-friendly input shape before camelCase fields are adapted to envelope keys. */
export interface CreateEvidenceEnvelopeInput {
  producer?: string;
  eventType: EvidenceEventKind;
  actor: EvidenceActor;
  projectRoot: string;
  timestamp?: string | Date;
  payload?: EvidencePayload | undefined;
  provenance?: Partial<
    Pick<
      CheckEvidence,
      | "source_urls"
      | "evidence_paths"
      | "framework_evidence_paths"
      | "target_evidence_paths"
      | "reason"
    >
  >;
}

/** Non-throwing append result returned to dashboard and CLI producers. */
export interface AppendEvidenceEnvelopeResult extends Record<"ok", boolean> {
  path: string | null;
  error?: string;
}

/** Optional warning sink used by tests and dashboard routes instead of direct stderr writes. */
export interface EvidenceEnvelopeWriteOptions {
  onWarning?: ((message: string) => void) | undefined;
}

type EvidencePathExists = (path: string) => boolean;

const EVENTS_LOG_RELATIVE_DIR = ".goat-flow/logs/events";
const ENVELOPE_FRAMEWORK_EVIDENCE = "src/cli/evidence/envelope.ts";
// Cap tails at 500 entries so dashboard reads stay bounded even when daily JSONL logs grow.
const MAX_TAIL_LIMIT = 500;
const SENSITIVE_PAYLOAD_KEY =
  /^(?:prompt|output|terminal_output|terminal_scrollback|scrollback|upload_content|upload_data|screenshot|raw_json|raw_html|raw_tool_output|tool_output|bucket_body)$/iu;
const VALID_ACTORS = new Set<EvidenceActor>(["dashboard", "cli", "server"]);

/** Resolve the gitignored event-log directory under the selected project root. */
function eventsLogDir(projectRoot: string): string {
  return join(projectRoot, EVENTS_LOG_RELATIVE_DIR);
}

/** Inspect one target-controlled evidence path without following a symlink. */
function evidencePathStats(path: string, displayPath: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(
      `Could not inspect ${displayPath} before writing evidence.`,
    );
  }
}

/** Create the event-log path one real directory at a time, rejecting redirection. */
function ensureSafeEventsLogDirectory(projectRoot: string): string {
  const directories = [
    { path: join(projectRoot, ".goat-flow"), displayPath: ".goat-flow" },
    {
      path: join(projectRoot, ".goat-flow", "logs"),
      displayPath: ".goat-flow/logs",
    },
    {
      path: eventsLogDir(projectRoot),
      displayPath: EVENTS_LOG_RELATIVE_DIR,
    },
  ];
  for (const directory of directories) {
    const stats = evidencePathStats(directory.path, directory.displayPath);
    if (stats !== null && !stats.isDirectory()) {
      throw new Error(
        `${directory.displayPath} must be a project-local directory.`,
      );
    }
    if (stats === null) mkdirSync(directory.path);
  }
  return directories.at(-1)?.path ?? eventsLogDir(projectRoot);
}

/** Normalize optional caller timestamps while defaulting local events to current time. */
function timestampString(timestamp: string | Date | undefined): string {
  if (timestamp instanceof Date) return timestamp.toISOString();
  return timestamp ?? new Date().toISOString();
}

/** Check the timestamp format expected by envelope filenames and provenance dates. */
function isIsoTimestamp(timestamp: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/u.test(timestamp) &&
    !Number.isNaN(Date.parse(timestamp))
  );
}

/** Narrow parsed JSON and payload values to object records before key inspection. */
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return (
    typeof candidate === "object" &&
    candidate !== null &&
    !Array.isArray(candidate)
  );
}

/** Recursively require redaction markers for sensitive payload keys. */
function validatePayloadValue(
  key: string,
  value: EvidencePayloadValue,
  path: string,
): string[] {
  if (isRedactedEvidenceValue(value)) return [];
  if (SENSITIVE_PAYLOAD_KEY.test(key)) {
    return [`${path} must be a redacted evidence value`];
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      validatePayloadValue(key, item, `${path}[${index}]`),
    );
  }
  return Object.entries(value).flatMap(([childKey, childValue]) =>
    validatePayloadValue(childKey, childValue, `${path}.${childKey}`),
  );
}

/** Validate the optional payload without rejecting the envelope when no payload exists. */
function validatePayload(payload: EvidencePayload | undefined): string[] {
  if (payload === undefined) return [];
  if (!isRecord(payload)) return ["payload must be an object"];
  return Object.entries(payload).flatMap(([key, value]) =>
    validatePayloadValue(key, value, `payload.${key}`),
  );
}

function applyEnvelopeOptionalFields(
  envelope: EvidenceEnvelope,
  input: CreateEvidenceEnvelopeInput,
): void {
  if (input.provenance?.evidence_paths) {
    envelope.evidence_paths = input.provenance.evidence_paths;
  }
  if (input.provenance?.target_evidence_paths) {
    envelope.target_evidence_paths = input.provenance.target_evidence_paths;
  }
  if (input.provenance?.reason) {
    envelope.reason = input.provenance.reason;
  }
  if (input.payload) {
    envelope.payload = input.payload;
  }
}

/**
 * Build a validated envelope shape from one local runtime event.
 *
 * @param input - Runtime event details and optional provenance override.
 * @returns Evidence envelope ready for validation or append.
 */
export function createEvidenceEnvelope(
  input: CreateEvidenceEnvelopeInput,
): EvidenceEnvelope {
  const timestamp = timestampString(input.timestamp);
  const envelope: EvidenceEnvelope = {
    source_type: "spec",
    source_urls: input.provenance?.source_urls ?? [],
    verified_on: timestamp.slice(0, 10),
    normative_level: "BEST_PRACTICE",
    framework_evidence_paths: input.provenance?.framework_evidence_paths ?? [
      ENVELOPE_FRAMEWORK_EVIDENCE,
    ],
    producer: input.producer ?? "goat-flow",
    event_kind: input.eventType,
    actor: input.actor,
    timestamp,
    project_path: input.projectRoot,
  };
  applyEnvelopeOptionalFields(envelope, input);
  return envelope;
}

/**
 * Validate runtime envelope fields while delegating provenance rules.
 *
 * @param envelope - Envelope to validate.
 * @param pathExists - Optional path-existence predicate for provenance checks.
 * @returns Human-readable validation errors; an empty array means valid.
 */
export function validateEvidenceEnvelope(
  envelope: EvidenceEnvelope,
  pathExists?: EvidencePathExists,
): string[] {
  const errors = validateProvenance(envelope, pathExists);
  if (!envelope.producer.trim()) errors.push("producer must be non-empty");
  if (!VALID_ACTORS.has(envelope.actor)) {
    errors.push(`actor must be one of: ${Array.from(VALID_ACTORS).join(", ")}`);
  }
  if (!envelope.event_kind.trim()) errors.push("event_kind must be non-empty");
  if (!isIsoTimestamp(envelope.timestamp)) {
    errors.push(
      `timestamp must be an ISO-8601 timestamp, got ${envelope.timestamp}`,
    );
  }
  if (envelope.verified_on !== envelope.timestamp.slice(0, 10)) {
    errors.push("verified_on must match the timestamp date");
  }
  if (!envelope.project_path.trim()) {
    errors.push("project_path must be non-empty");
  }
  errors.push(...validatePayload(envelope.payload));
  return errors;
}

function warn(
  options: EvidenceEnvelopeWriteOptions | undefined,
  message: string,
): void {
  if (options?.onWarning) {
    options.onWarning(message);
    return;
  }
  console.warn(message);
}

/**
 * Append one envelope to the local gitignored JSONL event log. Never throws.
 *
 * @param projectRoot - Project root that owns `.goat-flow/logs/events`.
 * @param envelope - Validated or caller-created envelope to append.
 * @param options - Optional warning callback for non-fatal validation or filesystem failures.
 * @returns Append outcome with a path on success and an error string on failure.
 */
export function appendEvidenceEnvelope(
  projectRoot: string,
  envelope: EvidenceEnvelope,
  options?: EvidenceEnvelopeWriteOptions,
): AppendEvidenceEnvelopeResult {
  try {
    const errors = validateEvidenceEnvelope(envelope);
    if (errors.length > 0) {
      const error = `invalid evidence envelope: ${errors.join("; ")}`;
      warn(options, `[evidence] ${error}`);
      return { ok: false, path: null, error };
    }
    const dir = ensureSafeEventsLogDirectory(projectRoot);
    const path = join(dir, `${envelope.timestamp.slice(0, 10)}.jsonl`);
    const pathStats = evidencePathStats(
      path,
      `${EVENTS_LOG_RELATIVE_DIR}/${envelope.timestamp.slice(0, 10)}.jsonl`,
    );
    if (pathStats !== null && (!pathStats.isFile() || pathStats.nlink !== 1)) {
      throw new Error(
        "Evidence event destination must be a single-link regular file.",
      );
    }
    appendFileSync(path, `${JSON.stringify(envelope)}\n`, "utf-8");
    return { ok: true, path };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(options, `[evidence] failed to append event: ${message}`);
    return { ok: false, path: null, error: message };
  }
}

/**
 * Convenience producer helper for common dashboard/server event emission.
 *
 * @param input - Runtime event details to envelope and append.
 * @param options - Optional warning callback for append failures.
 * @returns Append outcome from the underlying non-throwing writer.
 */
export function recordEvidenceEvent(
  input: CreateEvidenceEnvelopeInput,
  options?: EvidenceEnvelopeWriteOptions,
): AppendEvidenceEnvelopeResult {
  return appendEvidenceEnvelope(
    input.projectRoot,
    createEvidenceEnvelope(input),
    options,
  );
}

/** Return sorted daily JSONL event logs; invariant: filenames must preserve chronology. */
function eventLogFiles(projectRoot: string): string[] {
  const dir = eventsLogDir(projectRoot);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}\.jsonl$/u.test(name))
    .sort()
    .map((name) => join(dir, name));
}

/** Parse one JSONL entry; swallows malformed JSON or invalid envelopes as unreadable history. */
function parseEnvelopeLine(line: string): EvidenceEnvelope | null {
  if (!line.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) return null;
    const candidate = parsed as EvidenceEnvelope & Record<string, unknown>;
    return validateEvidenceEnvelope(candidate).length === 0 ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Read the newest local event envelopes, preserving chronological order.
 *
 * @param projectRoot - Project root whose gitignored event logs should be tailed.
 * @param limit - Requested maximum number of newest envelopes; capped for bounded reads.
 * @returns Valid envelopes from the newest tail window.
 */
export function tailEvidenceEvents(
  projectRoot: string,
  limit = 20,
): EvidenceEnvelope[] {
  const boundedLimit = Math.max(1, Math.min(limit, MAX_TAIL_LIMIT));
  const entries = eventLogFiles(projectRoot).flatMap((path) =>
    readFileSync(path, "utf-8")
      .split(/\r?\n/u)
      .flatMap((line) => {
        const envelope = parseEnvelopeLine(line);
        return envelope ? [envelope] : [];
      }),
  );
  return entries.slice(-boundedLimit);
}
