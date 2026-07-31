/**
 * Dashboard-owned quality report persistence for enforced Claude reporting
 * sessions (ADR-044).
 *
 * Claude Code 2.1.220's permission rules cannot authorize the multi-line
 * heredoc `quality save` command (measured in plan M06), so enforced sessions
 * never persist reports themselves. Instead the agent writes ONE draft JSON
 * into a gitignored staging directory with its file tool, and this module -
 * running inside the dashboard server process - redacts, validates, and
 * persists the draft through the same `quality save` core as the CLI, deletes
 * the draft, and writes a receipt file the agent can read to confirm the
 * outcome.
 *
 * Polling (not fs.watch) is deliberate: watch events are unreliable on WSL2
 * and network filesystems, and a poller with an mtime-stability threshold also
 * solves the partial-write race for free. Every capture is tied to one
 * terminal session and MUST be disposed when that session ends (see the
 * cleanup-layering footgun); `dispose()` clears the timer and sweeps leftover
 * drafts so no unredacted draft outlives its session.
 */
import {
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { persistQualityReportText } from "../quality/quality-command.js";
import { recordEvidenceEvent } from "../evidence/envelope.js";
import { scrubDurableText } from "../evidence/redaction.js";

/** Draft filenames the poller will process; anything else in staging is ignored. */
const DRAFT_NAME_PATTERN = /^goat-quality-draft-[A-Za-z0-9_-]{1,64}\.json$/u;
/** Prefixes used to derive the receipt filename from a draft filename. */
const DRAFT_NAME_PREFIX = "goat-quality-draft-";
const RESULT_NAME_PREFIX = "goat-quality-result-";
/** Reject drafts larger than this; a valid report is far smaller. */
const MAX_DRAFT_BYTES = 2 * 1024 * 1024;
/** Default poll cadence and required mtime quiet period before processing. */
const DEFAULT_INTERVAL_MS = 750;
const DEFAULT_STABLE_MS = 500;

/** Error type satisfying the `quality save` core's injected CLIError contract. */
class QualityCaptureError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number,
  ) {
    super(message);
    this.name = "QualityCaptureError";
  }
}

/** Options for one session-scoped staging capture. */
export interface QualityDraftCaptureOptions {
  /** Report owner project root whose staging directory is watched. */
  projectRoot: string;
  /** Poll cadence override; tests use short intervals. */
  intervalMs?: number;
  /** Required mtime quiet period before a draft is read; guards partial writes. */
  stableMs?: number;
}

/** Live capture handle owned by exactly one terminal session. */
export interface QualityDraftCapture {
  /** Absolute staging directory this capture watches. */
  stagingDir: string;
  /** Stop polling and sweep leftover drafts; safe to call more than once. */
  dispose(): void;
  /** Process eligible drafts immediately; exposed for tests and shutdown flushes. */
  processNow(): Promise<void>;
}

/**
 * Create the staging directory for one reporting root, component by component.
 *
 * Mirrors the `quality save` directory walk: each component must be a real
 * local directory (no symlinked or file-shadowed segments), and the staging
 * leaf is created `0700` so the redaction window named in ADR-044 is not
 * widened by group/world reads. Call BEFORE building the Claude permission
 * overlay so the `.goat-flow/logs` write allow exists for fresh targets.
 *
 * @param projectRoot - report owner project root
 * @returns absolute staging directory path
 */
export function ensureQualityDraftStagingDirectory(
  projectRoot: string,
): string {
  const components = [
    join(projectRoot, ".goat-flow"),
    join(projectRoot, ".goat-flow", "logs"),
    join(projectRoot, ".goat-flow", "logs", "quality"),
    join(projectRoot, ".goat-flow", "logs", "quality", "staging"),
  ];
  for (const componentPath of components) {
    let stats;
    try {
      stats = lstatSync(componentPath);
    } catch {
      stats = null;
    }
    if (stats !== null && !stats.isDirectory()) {
      throw new Error(
        `quality capture: ${componentPath} must be a real project-local directory.`,
      );
    }
    if (stats === null) {
      mkdirSync(componentPath, {
        mode: componentPath.endsWith("staging") ? 0o700 : undefined,
      });
    }
  }
  return components[components.length - 1] as string;
}

/** Write one receipt file beside the processed draft; receipt text is scrubbed. */
function writeCaptureReceipt(
  stagingDir: string,
  draftName: string,
  body: { ok: true; reportPath: string } | { ok: false; error: string },
): void {
  const resultName =
    RESULT_NAME_PREFIX + draftName.slice(DRAFT_NAME_PREFIX.length);
  const serialized = scrubDurableText(`${JSON.stringify(body, null, 2)}\n`);
  writeFileSync(join(stagingDir, resultName), serialized, {
    encoding: "utf8",
    mode: 0o600,
  });
}

/** Delete one draft; missing files are fine because dispose and process can race. */
function removeDraft(stagingDir: string, draftName: string): void {
  try {
    unlinkSync(join(stagingDir, draftName));
  } catch {
    /* already gone */
  }
}

/**
 * Start watching one project root's staging directory for report drafts.
 *
 * Each eligible draft is processed exactly once per appearance: redact ->
 * validate -> persist through {@link persistQualityReportText}, delete the
 * draft, write a receipt, and record a `quality.persisted` or
 * `quality.rejected` evidence event. Failures never stop the poller - one
 * malformed draft must not block a later corrected draft.
 *
 * @param options - owner root plus optional timing overrides
 * @returns capture handle; the owning terminal session must dispose it
 */
export function startQualityDraftCapture(
  options: QualityDraftCaptureOptions,
): QualityDraftCapture {
  const stagingDir = ensureQualityDraftStagingDirectory(options.projectRoot);
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const stableMs = options.stableMs ?? DEFAULT_STABLE_MS;
  // Held on an object so the flags stay observable across awaits; plain
  // closure booleans get narrowed to their initial value by control-flow
  // analysis and the mid-loop dispose check reads as dead code.
  const state = { disposed: false, busy: false };

  function recordCaptureEvent(
    eventType: "quality.persisted" | "quality.rejected",
    payload: Record<string, string>,
  ): void {
    try {
      recordEvidenceEvent({
        producer: "quality-draft-capture",
        actor: "server",
        eventType,
        projectRoot: options.projectRoot,
        payload,
      });
    } catch {
      /* evidence recording must never break persistence */
    }
  }

  async function processDraft(draftName: string): Promise<void> {
    const draftPath = join(stagingDir, draftName);
    let stats;
    try {
      stats = lstatSync(draftPath);
    } catch {
      return;
    }
    if (!stats.isFile()) return;
    if (Date.now() - stats.mtimeMs < stableMs) return;
    if (stats.size > MAX_DRAFT_BYTES) {
      removeDraft(stagingDir, draftName);
      const message = `quality capture: draft exceeds the ${MAX_DRAFT_BYTES} byte limit.`;
      writeCaptureReceipt(stagingDir, draftName, { ok: false, error: message });
      recordCaptureEvent("quality.rejected", {
        draft: draftName,
        error: message,
      });
      return;
    }
    let rawText: string;
    try {
      rawText = readFileSync(draftPath, "utf8");
    } catch {
      return;
    }
    try {
      const reportPath = await persistQualityReportText(
        {
          projectPath: options.projectRoot,
          rawText,
          sourceLabel: "draft",
        },
        { CLIError: QualityCaptureError },
      );
      removeDraft(stagingDir, draftName);
      writeCaptureReceipt(stagingDir, draftName, { ok: true, reportPath });
      recordCaptureEvent("quality.persisted", {
        draft: draftName,
        report_path: reportPath,
      });
    } catch (error) {
      removeDraft(stagingDir, draftName);
      const message = error instanceof Error ? error.message : String(error);
      writeCaptureReceipt(stagingDir, draftName, { ok: false, error: message });
      recordCaptureEvent("quality.rejected", {
        draft: draftName,
        error: message,
      });
    }
  }

  // Read through a function so the mid-loop check survives control-flow
  // narrowing: dispose() can flip this while an await is in flight, which
  // static analysis of a plain flag cannot see.
  const isDisposed = (): boolean => state.disposed;

  async function processNow(): Promise<void> {
    if (state.busy || isDisposed()) return;
    state.busy = true;
    try {
      let entries: string[];
      try {
        entries = readdirSync(stagingDir);
      } catch {
        return;
      }
      for (const entry of entries) {
        if (!DRAFT_NAME_PATTERN.test(entry)) continue;
        await processDraft(entry);
        // Stop immediately if the owning session ended mid-sweep.
        if (isDisposed()) return;
      }
    } finally {
      state.busy = false;
    }
  }

  const timer = setInterval(() => {
    void processNow();
  }, intervalMs);
  // A server shutdown must not be held open by an idle poller.
  timer.unref();

  function sweepDrafts(): void {
    let entries: string[];
    try {
      entries = readdirSync(stagingDir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (DRAFT_NAME_PATTERN.test(entry)) removeDraft(stagingDir, entry);
    }
  }

  return {
    stagingDir,
    processNow,
    dispose(): void {
      if (state.disposed) return;
      state.disposed = true;
      clearInterval(timer);
      sweepDrafts();
    },
  };
}
