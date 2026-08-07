/**
 * Child-process worker for cross-server quality capture and evidence-directory races.
 * The parent releases every worker from the same IPC barrier so filesystem ownership,
 * rather than one process's module state, decides the outcome.
 */
import { lstatSync } from "node:fs";

import {
  appendEvidenceEnvelope,
  createEvidenceEnvelope,
} from "../../src/cli/evidence/envelope.js";
import {
  ensureQualityDraftStagingDirectory,
  startQualityDraftCapture,
} from "../../src/cli/server/quality-draft-capture.js";

type WorkerMode =
  "ensure-staging" | "persist-draft" | "dispose-observer" | "append-evidence";

const mode = process.argv[2] as WorkerMode | undefined;
const projectRoot = process.argv[3];
const workerId = process.argv[4] ?? "worker";

if (!mode || !projectRoot || !process.send) {
  throw new Error(
    "quality capture worker requires mode, project root, id, and IPC",
  );
}

let capture: ReturnType<typeof startQualityDraftCapture> | null = null;
if (mode === "persist-draft" || mode === "dispose-observer") {
  capture = startQualityDraftCapture({
    projectRoot,
    intervalMs: 60_000,
    stableMs: 0,
  });
}

process.send({ type: "ready", workerId });
process.once("message", (message: unknown) => {
  if (message !== "go") return;
  void (async () => {
    try {
      if (mode === "ensure-staging") {
        const stagingDir = ensureQualityDraftStagingDirectory(projectRoot);
        const stats = lstatSync(stagingDir);
        process.send?.({
          type: "done",
          workerId,
          result: {
            isDirectory: stats.isDirectory(),
            isSymlink: stats.isSymbolicLink(),
          },
        });
      } else if (mode === "persist-draft") {
        await capture?.processNow();
        process.send?.({ type: "done", workerId, result: { processed: true } });
      } else if (mode === "dispose-observer") {
        capture?.dispose();
        capture = null;
        process.send?.({ type: "done", workerId, result: { disposed: true } });
      } else {
        const envelope = createEvidenceEnvelope({
          eventType: "quality.persisted",
          actor: "server",
          projectRoot,
          timestamp: "2026-08-03T00:00:00.000Z",
          payload: { worker: workerId },
        });
        const result = appendEvidenceEnvelope(projectRoot, envelope, {
          onWarning: () => undefined,
        });
        process.send?.({ type: "done", workerId, result });
      }
    } catch (error) {
      process.send?.({
        type: "error",
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      capture?.dispose();
      process.disconnect();
    }
  })();
});
