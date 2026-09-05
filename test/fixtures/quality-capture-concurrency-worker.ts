/**
 * Run independent processes to test how servers share quality drafts and evidence files.
 *
 * The parent releases workers through one IPC barrier so they compete for the same project paths.
 * Use these workers when process-local state would hide ownership or directory-creation races.
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

// Reject an incomplete test launch before it can read or write an unintended project.
if (!mode || !projectRoot || !process.send) {
  throw new Error(
    "quality capture worker requires mode, project root, id, and IPC",
  );
}

// Directory and evidence modes need no draft watcher; null also marks a watcher already disposed by this worker.
let capture: ReturnType<typeof startQualityDraftCapture> | null = null;
// Draft persistence and shutdown races need a watcher running before the parent releases the barrier.
if (mode === "persist-draft" || mode === "dispose-observer") {
  capture = startQualityDraftCapture({
    projectRoot,
    intervalMs: 60_000,
    stableMs: 0,
  });
}

process.send({ type: "ready", workerId });
// Start the selected race only when the parent releases this worker alongside its peers.
process.once("message", (message: unknown) => {
  // Ignore unrelated IPC payloads so they cannot trigger project writes before the shared barrier.
  if (message !== "go") return;
  void (async () => {
    try {
      // Competing servers must agree on a real staging directory before accepting report drafts.
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
      } else if (
        // Force a draft scan so the parent can verify that competing servers save one report.
        mode === "persist-draft"
      ) {
        await capture?.processNow();
        process.send?.({ type: "done", workerId, result: { processed: true } });
      } else if (
        // End this watcher so the parent can check that another server retains its claimed draft.
        mode === "dispose-observer"
      ) {
        capture?.dispose();
        capture = null;
        process.send?.({ type: "done", workerId, result: { disposed: true } });
      } else {
        // Append one event per worker to check shared evidence-directory creation and independent records.
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
      // A staging path replaced by a file is rejected; report that failure so the parent can assert the outcome.
      process.send?.({
        type: "error",
        workerId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      // Release any watcher still owned here and close IPC so the parent can observe worker exit.
      capture?.dispose();
      process.disconnect();
    }
  })();
});
