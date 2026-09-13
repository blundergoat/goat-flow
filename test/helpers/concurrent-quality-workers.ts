/**
 * Start synchronized fixture processes to test competing quality-report operations in one project.
 *
 * Use the ready/go barrier to make staging, draft, disposal, or evidence writes overlap deliberately.
 * The parent collects each result or fails the test and stops remaining workers.
 */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type WorkerMode =
  "ensure-staging" | "persist-draft" | "dispose-observer" | "append-evidence";

/**
 * Identify one child operation's result for concurrency assertions.
 *
 * The worker id ties the outcome to the contender started by the test.
 * Result fields are supplied by the chosen worker mode and checked by that mode's assertions.
 */
export interface ConcurrentWorkerOutcome {
  workerId: string;
  result: Record<string, unknown>;
}

/**
 * Keep a fixture process with the two promises needed by the test's synchronization barrier.
 *
 * The ready promise means the child is waiting for permission to start its operation.
 * The done promise supplies that child's result after the shared release.
 */
interface PendingWorker {
  child: ChildProcess;
  ready: Promise<void>;
  done: Promise<ConcurrentWorkerOutcome>;
}

const WORKER_PATH = fileURLToPath(
  new URL("../fixtures/quality-capture-concurrency-worker.ts", import.meta.url),
);
const WORKER_TIMEOUT_MS = 15_000;

/**
 * Starts one fixture process and exposes ready/completed promises so that tests can overlap quality operations deliberately.
 * The first completion or failure settles the worker; later notifications cannot replace its outcome.
 */
function startWorker(
  mode: WorkerMode,
  projectRoot: string,
  workerId: string,
): PendingWorker {
  // The fixture path and mode are fixed by this test helper; no command string or shell is user-controlled.
  const child = fork(WORKER_PATH, [mode, projectRoot, workerId], {
    execArgv: ["--import", "tsx"],
    silent: true,
  });
  let stderr = "";
  // Startup or fixture failures may explain themselves on stderr; retain that text for the test's failure message.
  child.stderr?.on("data", (chunk: Buffer | string) => {
    stderr += chunk.toString();
  });

  let resolveReady: (() => void) | undefined;
  let resolveDone: ((outcome: ConcurrentWorkerOutcome) => void) | undefined;
  let rejectReady: ((error: Error) => void) | undefined;
  let rejectDone: ((error: Error) => void) | undefined;
  const ready = new Promise<void>((resolvePromise, rejectPromise) => {
    resolveReady = resolvePromise;
    rejectReady = rejectPromise;
  });
  const done = new Promise<ConcurrentWorkerOutcome>(
    (resolvePromise, rejectPromise) => {
      resolveDone = resolvePromise;
      rejectDone = rejectPromise;
    },
  );

  let hasSettled = false;
  // Reject both barrier phases on the first failure so the test cannot hang while waiting for a failed child.
  const rejectWorker = (error: Error): void => {
    // Exit, timeout, and IPC errors can describe the same failure; keep the first outcome for the assertion.
    if (hasSettled) return;
    hasSettled = true;
    clearTimeout(timeout);
    rejectReady?.(error);
    rejectDone?.(error);
  };
  const timeout = setTimeout(() => {
    rejectWorker(
      new Error(
        `concurrency worker ${workerId} exceeded ${WORKER_TIMEOUT_MS}ms`,
      ),
    );
    child.kill();
  }, WORKER_TIMEOUT_MS);
  timeout.unref();

  child.on("message", (message: unknown) => {
    // Messages outside the fixture protocol cannot release the barrier or complete the operation.
    if (typeof message !== "object" || message === null) return;
    const payload = message as {
      type?: string;
      workerId?: string;
      result?: Record<string, unknown>;
      error?: string;
    };
    // The child reached its barrier, so the parent can include it in the simultaneous start.
    if (payload.type === "ready") {
      resolveReady?.();
      return;
    }
    // Completion carries the result the test will compare with the other contenders.
    if (payload.type === "done") {
      // Duplicate completion must not overwrite a failure or an earlier result.
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeout);
      // Missing payload fields retain this child's identity and expose an empty result for the caller's assertions.
      resolveDone?.({
        workerId: payload.workerId ?? workerId,
        result: payload.result ?? {},
      });
      return;
    }
    // A fixture operation failure rejects the shared run with the child's own diagnostic.
    if (payload.type === "error") {
      rejectWorker(
        new Error(
          `concurrency worker ${workerId} failed: ${payload.error ?? "unknown error"}`,
        ),
      );
    }
  });
  child.on("error", (error) => {
    rejectWorker(error);
  });
  child.on("exit", (code) => {
    // A normal exit after a result needs no extra failure message.
    if (hasSettled && code === 0) return;
    rejectWorker(
      new Error(
        `concurrency worker ${workerId} exited ${String(code)}${stderr ? `: ${stderr}` : ""}`,
      ),
    );
  });
  return { child, ready, done };
}

/**
 * Release ready fixture processes together and collect the outcomes of competing quality operations.
 * Throws worker failures after stopping any remaining children so a failed test leaves no fixture writers running.
 *
 * @param mode - worker behaviour under test
 * @param projectRoot - shared project the workers contend over
 * @param count - worker count; zero returns no outcomes, while the default two create real contention
 * @returns outcomes in start order; an empty array means the test requested no workers
 */
export async function runConcurrentQualityWorkers(
  mode: WorkerMode,
  projectRoot: string,
  count = 2,
): Promise<ConcurrentWorkerOutcome[]> {
  const workers = Array.from({ length: count }, (_, index) =>
    startWorker(mode, projectRoot, `worker-${index + 1}`),
  );
  try {
    await Promise.all(workers.map((worker) => worker.ready));
    // All children are waiting now; release each contender before awaiting any single result.
    for (const worker of workers) worker.child.send("go");
    return await Promise.all(workers.map((worker) => worker.done));
  } catch (error) {
    // A child startup error, failed fixture operation, or timeout must not leave other writers running after the test fails.
    for (const worker of workers) {
      // Only children without an exit status still need a stop request.
      if (worker.child.exitCode === null) worker.child.kill();
    }
    throw error;
  }
}
