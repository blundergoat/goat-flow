/** Parent-side IPC barrier for the quality capture concurrency fixture. */
import { fork, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";

type WorkerMode =
  "ensure-staging" | "persist-draft" | "dispose-observer" | "append-evidence";

/** Observable completion payload returned by one synchronized child fixture. */
export interface ConcurrentWorkerOutcome {
  workerId: string;
  result: Record<string, unknown>;
}

/** Live child plus the two barrier phases the parent waits for. */
interface PendingWorker {
  child: ChildProcess;
  ready: Promise<void>;
  done: Promise<ConcurrentWorkerOutcome>;
}

const WORKER_PATH = fileURLToPath(
  new URL("../fixtures/quality-capture-concurrency-worker.ts", import.meta.url),
);
const WORKER_TIMEOUT_MS = 15_000;

/** Start one child and expose separate barrier-ready and completed promises. */
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
  const rejectWorker = (error: Error): void => {
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
    if (typeof message !== "object" || message === null) return;
    const payload = message as {
      type?: string;
      workerId?: string;
      result?: Record<string, unknown>;
      error?: string;
    };
    if (payload.type === "ready") {
      resolveReady?.();
      return;
    }
    if (payload.type === "done") {
      if (hasSettled) return;
      hasSettled = true;
      clearTimeout(timeout);
      resolveDone?.({
        workerId: payload.workerId ?? workerId,
        result: payload.result ?? {},
      });
      return;
    }
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
    if (hasSettled && code === 0) return;
    rejectWorker(
      new Error(
        `concurrency worker ${workerId} exited ${String(code)}${stderr ? `: ${stderr}` : ""}`,
      ),
    );
  });
  return { child, ready, done };
}

/** Release multiple child processes together and return every observable outcome. */
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
    for (const worker of workers) worker.child.send("go");
    return await Promise.all(workers.map((worker) => worker.done));
  } catch (error) {
    for (const worker of workers) {
      if (worker.child.exitCode === null) worker.child.kill();
    }
    throw error;
  }
}
