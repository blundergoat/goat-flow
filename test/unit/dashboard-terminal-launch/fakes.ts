/**
 * Test doubles for the dashboard terminal launch suite: a controllable fake clock (createFakeTimers) plus fake
 * xterm Terminal, fit addon, ResizeObserver, and WebSocket classes, and the browser-global surface those tests
 * inject when loading the classic dashboard script in a VM rather than a real browser.
 */

/**
 * Shape of the fake clock's drop-in replacements for the four browser timer functions, handed to dashboard
 * helpers so the suite can control time deterministically instead of relying on the real event loop.
 */
export type TimerControls = {
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
};

type FakeTimerHandle = ReturnType<typeof setTimeout> &
  ReturnType<typeof setInterval>;

/** Scheduled callback metadata stored by the deterministic fake clock. */
interface FakeTimerEntry {
  at: number;
  callback: () => void;
  intervalMs?: number;
}

/** Mutable fake clock queues shared by the injected timer functions. */
interface FakeTimerState {
  now: number;
  timers: Map<number, FakeTimerEntry>;
  cancelled: Set<number>;
}

/** Create a fake timeout/interval handle that clear functions can coerce back to the scheduler id. */
function createTimerHandle(id: number): FakeTimerHandle {
  const handle = {
    close: () => handle,
    hasRef: () => true,
    ref: () => handle,
    refresh: () => handle,
    unref: () => handle,
    [Symbol.toPrimitive]: () => id,
    [Symbol.dispose]: () => undefined,
  };
  return handle as FakeTimerHandle;
}

/** Read the fake scheduler id from a timeout/interval handle without depending on real timer objects. */
function readTimerId(
  handle:
    | ReturnType<typeof setTimeout>
    | ReturnType<typeof setInterval>
    | undefined,
): number | null {
  if (handle === undefined) return null;
  const id = Number(handle);
  return Number.isFinite(id) ? id : null;
}

/** Find the earliest timer due at or before the target timestamp. */
function findNextDueTimer(
  timers: ReadonlyMap<number, FakeTimerEntry>,
  target: number,
): [number, FakeTimerEntry] | undefined {
  return [...timers.entries()]
    .filter(([, timer]) => timer.at <= target)
    .sort((a, b) => a[1].at - b[1].at)[0];
}

/** Advance fake time by mutating timer queues and firing every callback due before the target. */
function runDueTimers(state: FakeTimerState, target: number): void {
  while (true) {
    const due = findNextDueTimer(state.timers, target);
    if (!due) break;
    const [id, timer] = due;
    state.timers.delete(id);
    state.now = timer.at;
    timer.callback();
    if (timer.intervalMs !== undefined && !state.cancelled.has(id)) {
      // A zero-delay interval would requeue at the same virtual timestamp and
      // spin this loop forever; clamp to the next millisecond like real timers.
      state.timers.set(id, {
        ...timer,
        at: state.now + Math.max(1, timer.intervalMs),
      });
    }
    state.cancelled.delete(id);
  }
  state.now = target;
}

/** Schedule one fake timer and return a handle compatible with the injected browser timer API. */
function scheduleFakeTimer(
  state: FakeTimerState,
  id: number,
  callback: (...args: unknown[]) => void,
  ms: number | undefined,
  args: unknown[],
  intervalMs?: number,
): FakeTimerHandle {
  state.timers.set(id, {
    at: state.now + (ms ?? 0),
    callback: () => callback(...args),
    ...(intervalMs === undefined ? {} : { intervalMs }),
  });
  return createTimerHandle(id);
}

/** Cancel a fake timer by mutating active and just-fired interval bookkeeping. */
function clearFakeTimer(
  state: FakeTimerState,
  handle:
    | ReturnType<typeof setTimeout>
    | ReturnType<typeof setInterval>
    | undefined,
): void {
  const id = readTimerId(handle);
  if (id === null) return;
  if (!state.timers.delete(id)) state.cancelled.add(id);
}

/**
 * Build a deterministic fake clock. Registrations are recorded in a map keyed by virtual fire time rather than
 * handed to the real event loop, because the launch flow's retry/fallback timing must be driven step by step in a
 * test: `tick` advances virtual time and fires due callbacks in timestamp order, so no real waits are needed and
 * the suite stays deterministic. Cancellation is tracked in a separate set so an interval callback can clear its
 * own timer without that clear being lost when the callback returns.
 *
 * @returns the four timer functions plus `tick` (advance virtual time, firing due callbacks) and `pending`
 *   (count of still-scheduled timers, used to catch leaked fallback work after a scenario)
 */
export function createFakeTimers(): TimerControls & {
  /**
   * Advances all due timeout and interval callbacks in timestamp order.
   */
  tick(durationMs: number): void;
  /**
   * Reports outstanding timers so tests can catch leaked fallback work.
   */
  pending(): number;
} {
  const state: FakeTimerState = {
    now: 0,
    timers: new Map(),
    cancelled: new Set(),
  };
  let nextId = 1;
  const fakeSetTimeout = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const id = nextId;
    nextId += 1;
    return scheduleFakeTimer(state, id, callback, ms, args);
  }) as typeof setTimeout;
  // Fired intervals can be cleared by their own callback; cancelled keeps that
  // clear from being lost after the callback returns.
  const fakeClearTimeout = ((handle?: ReturnType<typeof setTimeout>) => {
    clearFakeTimer(state, handle);
  }) as typeof clearTimeout;
  const fakeSetInterval = ((
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ) => {
    const id = nextId;
    nextId += 1;
    return scheduleFakeTimer(state, id, callback, ms, args, ms ?? 0);
  }) as typeof setInterval;
  // Shares cancellation bookkeeping with timeouts because browser helpers use
  // both APIs through the same VM-injected fake clock.
  const fakeClearInterval = ((handle?: ReturnType<typeof setInterval>) => {
    clearFakeTimer(state, handle);
  }) as typeof clearInterval;
  return {
    setTimeout: fakeSetTimeout,
    clearTimeout: fakeClearTimeout,
    setInterval: fakeSetInterval,
    clearInterval: fakeClearInterval,
    /**
     * Invariant: one tick drains every callback due at or before the target
     * before moving the fake clock to the target timestamp.
     */
    tick(durationMs: number): void {
      runDueTimers(state, state.now + durationMs);
    },
    // A non-zero pending count after a scenario catches leaked fallback work.
    pending(): number {
      return state.timers.size;
    },
  };
}

class FakeTerminal {
  cols = 80;
  rows = 24;
  _addonFit?: FakeFitAddon;
  dataHandler?: (data: string) => void;
  written: string[] = [];

  /**
   * Stores the fit addon so terminal setup can run without loading xterm.
   */
  loadAddon(addon: FakeFitAddon): void {
    this._addonFit = addon;
  }

  /**
   * DOM mounting is outside these tests; the method only satisfies xterm's API.
   */
  open(): void {
    void 0;
  }

  /**
   * Mutates `written` by appending output that helpers would write into xterm.
   */
  write(data: string): void {
    this.written.push(data);
  }

  /**
   * Focus changes are not observable in this harness.
   */
  focus(): void {
    void 0;
  }

  /**
   * Disposal side effects are asserted through session refs, not xterm internals.
   */
  dispose(): void {
    void 0;
  }

  /**
   * Keyboard shortcut wiring is not under test in this launch-focused suite.
   */
  attachCustomKeyEventHandler(): void {
    void 0;
  }

  /**
   * Tests drive input through dashboardSendToTerminalSession instead of xterm events.
   */
  onData(handler: (data: string) => void): void {
    this.dataHandler = handler;
  }

  /**
   * Simulates xterm input events emitted toward the PTY.
   */
  emitData(data: string): void {
    this.dataHandler?.(data);
  }

  /**
   * Resize paths are triggered through the fake ResizeObserver when needed.
   */
  onResize(): void {
    void 0;
  }

  /**
   * Keeps paste tests on the no-selection branch unless a test overrides xterm.
   */
  hasSelection(): boolean {
    return false;
  }

  /**
   * Mirrors xterm's empty-selection return value for clipboard tests.
   */
  getSelection(): string {
    return "";
  }

  buffer = {
    active: {
      length: 0,
      /**
       * Forces helpers to rely on session outputTail, the state these tests set.
       */
      getLine(): null {
        return null;
      },
    },
  };
}

class FakeFitAddon {
  /**
   * Layout measurements are not meaningful in the VM harness.
   */
  fit(): void {
    void 0;
  }
}

class FakeResizeObserver {
  /**
   * Observed elements are static fake DOM nodes, so no callback is needed.
   */
  observe(): void {
    void 0;
  }

  /**
   * Disconnect is present so terminal cleanup can call the browser API shape.
   */
  disconnect(): void {
    void 0;
  }
}

class FakeDashboardWebSocket {
  static OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  onopen?: () => void;
  onmessage?: (event: { data: string }) => void;
  onclose?: () => void;
  onerror?: () => void;

  /**
   * Registers constructed sockets so tests can drive open/message/close events.
   */
  constructor(
    public readonly url: string,
    public readonly instances: FakeDashboardWebSocket[],
  ) {
    instances.push(this);
  }

  /**
   * Records browser-to-server terminal payloads for assertions.
   */
  send(payload: string): void {
    this.sent.push(payload);
  }

  /**
   * Simulates browser close semantics and notifies the dashboard helper.
   */
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
}

/**
 * Creates the mutable WebSocket double used by tests that only assert terminal
 * wire payloads; `readyState` stays writable for retry and reconnect scenarios.
 *
 * @param sent - array the double appends each raw browser-to-server payload to, in send order, so a test can
 *   assert the exact wire traffic and its ordering
 * @returns a minimal socket with a writable `readyState` and a `send` that pushes onto `sent`
 */
export function makeCapturingWebSocket(sent: string[]): {
  readyState: number;
  /**
   * Mutates the provided array with raw browser wire payloads.
   */
  send(payload: string): void;
} {
  return {
    readyState: 1,
    // Side effect: appends raw browser wire payloads for order-sensitive checks.
    send(payload: string): void {
      sent.push(payload);
    },
  };
}

/**
 * Creates the minimum browser global surface needed by dashboard-terminal.ts
 * because these tests load the classic dashboard script in a VM, not a browser.
 */
export function makeBrowserTerminalGlobals(): {
  globals: Record<string, unknown>;
  sockets: FakeDashboardWebSocket[];
  terminals: FakeTerminal[];
} {
  const sockets: FakeDashboardWebSocket[] = [];
  const terminals: FakeTerminal[] = [];
  const WebSocketCtor = class extends FakeDashboardWebSocket {
    /**
     * Binds the browser-facing constructor to this test's socket registry.
     */
    constructor(url: string) {
      super(url, sockets);
    }
  };
  const TerminalCtor = class extends FakeTerminal {
    /** Registers each constructed terminal so tests can inspect launch state. */
    constructor() {
      super();
      terminals.push(this);
    }
  };
  return {
    sockets,
    terminals,
    globals: {
      window: {
        Terminal: TerminalCtor,
        FitAddon: { FitAddon: FakeFitAddon },
        // Dashboard helpers register listeners, but these tests invoke events directly.
        addEventListener(): void {
          return;
        },
        // Cleanup calls this even though the fake window has no listener registry.
        removeEventListener(): void {
          return;
        },
      },
      document: {
        // Stable dimensions let terminal setup run without a real layout engine.
        getElementById(): { innerHTML: string; offsetWidth: number } {
          return { innerHTML: "", offsetWidth: 80 };
        },
      },
      location: { protocol: "http:", host: "127.0.0.1:31337" },
      navigator: {
        clipboard: {
          readText: async (): Promise<string> => "",
          writeText: async (): Promise<void> => {},
        },
      },
      ResizeObserver: FakeResizeObserver,
      WebSocket: WebSocketCtor,
    },
  };
}

export {
  FakeDashboardWebSocket,
  FakeFitAddon,
  FakeResizeObserver,
  FakeTerminal,
};
