/**
 * Exercise the actual Hooks browser actions and navigation watchers with controlled HTTP responses.
 *
 * Use these checks when Sync, replacement review, or project navigation changes.
 * Delayed replies must never alter a later visit, and cancellation must never submit a write.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it } from "node:test";
import { createContext, runInContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";

/** One delayed browser request; the test decides which visible result arrives and when. */
interface PendingRequest {
  url: string;
  init?: RequestInit;
  /** Complete the delayed request when the test lets the browser receive a response. */
  resolve(response: Response): void;
  /** Simulate a lost dashboard connection after the user has started an action. */
  reject(error: Error): void;
}

/** Minimal row fields needed by the real actions; rendering and provider details have separate owners. */
interface HookRow {
  id: string;
  name: string;
  enabled: boolean;
  togglable: boolean;
  requiresConfirmDialog?: boolean;
}

/** State and actions exposed by the actual dashboard fragments for these interaction tests. */
interface HookPage {
  projectPath: string;
  activeView: string;
  hooksState: HookRow[];
  hooksLoading: boolean;
  hooksError: string;
  hookSavingId: string | null;
  hooksReplacement: Record<string, unknown> | null;
  hooksChangedPaths: string[];
  /** Click the global Sync action through the actual dashboard method. */
  syncOfficialHooks(): Promise<void>;
  /** Choose one hook's enabled state through the actual row action. */
  toggleHook(hook: HookRow, enabled: boolean): Promise<void>;
  /** Confirm the currently displayed replacement review, if it still belongs to this visit. */
  confirmHookReplacement(): Promise<void>;
  /** Dismiss the review without sending a write request. */
  cancelHookReplacement(): void;
  /** Refresh the selected project's visible hook rows. */
  loadHooks(): Promise<void>;
}

const ROOT = resolve(import.meta.dirname, "../..");
const HOOK: HookRow = {
  id: "deny-dangerous",
  name: "Deny dangerous hook",
  enabled: true,
  togglable: true,
};
const REVIEW = {
  error: "Review local files before replacement.",
  code: "hook-replacement-required",
  replacementAvailable: true,
  confirmationIdentity: "a".repeat(64),
  conflicts: [
    {
      path: ".goat-flow/hooks/deny-dangerous.sh",
      hookIds: ["deny-dangerous"],
      reason: "diverged",
    },
  ],
};

/**
 * Load the same classic scripts and state composition as the browser, replacing only network and unrelated UI effects.
 *
 * @returns a Hooks visit with delayed requests, observable toasts/focus, and real project/view watchers
 */
function hookPageFixture() {
  const requests: PendingRequest[] = [];
  const toasts: string[] = [];
  const watchers = new Map<string, (...args: string[]) => void>();
  let cancelFocusCount = 0;
  const sandbox = createContext({
    URL,
    // Model the user cancelling a confirmation so the Hooks fixture can verify that the action is refused.
    window: { confirm: () => false, location: { href: "http://localhost/" } },
    document: { title: "" },
    localStorage: {
      /** Leave saved preferences untouched while the test exercises project navigation. */
      setItem() {},
    },
    clearInterval,
    setInterval,
  });
  // These are the shipped scripts that own payload reading, state, actions, and navigation invalidation.
  for (const file of [
    "dashboard-readers.ts",
    "dashboard-app-merge.ts",
    "dashboard-app-state-fragments.ts",
    "dashboard-app-hook-setup-fragments.ts",
    "dashboard-app-init.ts",
  ]) {
    const filename = resolve(ROOT, "src/dashboard", file);
    runInContext(
      transpileModule(readFileSync(filename, "utf-8"), {
        compilerOptions: { target: ScriptTarget.ES2022 },
      }).outputText,
      sandbox,
      { filename },
    );
  }
  // Payload readers define the real fetch wrapper; control its HTTP boundary after all scripts are loaded.
  sandbox.dashboardFetch = (url: string, init?: RequestInit) =>
    new Promise<Response>((resolveRequest, rejectRequest) => {
      requests.push({
        url,
        init,
        resolve: resolveRequest,
        reject: rejectRequest,
      });
    });
  // Match the Hooks-owning fragment calls in app.ts; loadHooks belongs to the task/display fragment.
  const ctx = runInContext(
    `dashboardMergeAppFragments(
    dashboardWorkspaceCollectionsStateFragment(),
    dashboardTaskDisplayFragment(),
    dashboardHookSetupActionsFragment([]),
    dashboardHookFilterActionsFragment()
  )`,
    sandbox,
  ) as HookPage;
  Object.assign(ctx, {
    projectPath: "/project-a",
    projectName: "Project A",
    activeView: "hooks",
    supportedAgents: [],
    serverSessions: [],
    sessions: [],
    // Retain navigation callbacks so the fixture can replay the user changing project or view.
    $watch: (name: string, callback: (...args: string[]) => void) =>
      watchers.set(name, callback),
    // Run deferred UI work immediately so this fixture can observe focus after a Hooks review opens.
    $nextTick: (callback: () => void) => callback(),
    $refs: {
      hookReplacementCancel: {
        // Count focus on Cancel so the fixture can verify the user can safely dismiss the replacement review.
        focus: () => {
          cancelFocusCount += 1;
        },
      },
    },
    // Retain visible notifications so the fixture can assert what the user sees after a hook action.
    showToast: (message: string) => toasts.push(message),
    /** Keep unrelated terminal cleanup inert while real project-navigation watchers run. */
    detachTerminal() {},
    // Keep terminal reconnection inert while the fixture exercises real Hooks navigation behavior.
    reconnectTerminal: async () => {},
    // Keep unrelated session counting inert while the fixture exercises real Hooks navigation behavior.
    updateSessionCount: async () => {},
    // Keep unrelated Home quality work inert while the fixture exercises real Hooks navigation behavior.
    generateHomeQualitySummary: async () => {},
  });
  sandbox.fixtureContext = ctx;
  runInContext(
    "dashboardRegisterViewWatchers(fixtureContext); dashboardRegisterRunnerAndProjectWatchers(fixtureContext)",
    sandbox,
  );
  return {
    ctx,
    requests,
    toasts,
    /** Count whether the real replacement action focused the safe default. */
    cancelFocusCount: () => cancelFocusCount,
    /** Trigger the registered Alpine watcher after changing the value a user selected. */
    navigate(field: "projectPath" | "activeView", nextSelection: string): void {
      const previousSelection = ctx[field];
      ctx[field] = nextSelection;
      const watcher = watchers.get(field);
      assert.ok(watcher, field);
      watcher(nextSelection, previousSelection);
    },
  };
}

/** Deliver a JSON response at the real fetch boundary; non-200 status models a visible server refusal. */
function respond(
  request: PendingRequest | undefined,
  payload: unknown,
  status = 200,
): void {
  assert.ok(request, "the user action must have made a request");
  request.resolve(Response.json(payload, { status }));
}

/** Let fire-and-forget navigation loaders finish their response callbacks before inspecting visible state. */
async function settleNavigation(): Promise<void> {
  await new Promise<void>((resolveTick) => setImmediate(resolveTick));
}

/** Compare values across VM realms by their serialized API representation, not their object prototypes. */
function plain(observedState: unknown): unknown {
  return JSON.parse(JSON.stringify(observedState));
}

describe("dashboard hook actions", () => {
  it("locks duplicate actions and focuses Cancel without granting replacement permission", async () => {
    const page = hookPageFixture();
    const saving = page.ctx.syncOfficialHooks();
    await page.ctx.syncOfficialHooks();
    await page.ctx.toggleHook(HOOK, false);
    assert.equal(page.requests.length, 1);
    assert.deepEqual(JSON.parse(String(page.requests[0]?.init?.body)), {});
    respond(page.requests[0], REVIEW, 409);
    await saving;
    assert.equal(page.cancelFocusCount(), 1);
    assert.ok(page.ctx.hooksReplacement);
    await page.ctx.syncOfficialHooks();
    assert.equal(page.requests.length, 1);
    page.ctx.cancelHookReplacement();
    await page.ctx.confirmHookReplacement();
    assert.equal(
      page.requests.length,
      1,
      "Cancel and a later stale confirmation send no POST",
    );
    assert.equal(page.ctx.hooksReplacement, null);
    assert.equal(page.toasts.length, 0);
  });

  it("retries the reviewed enable action with its exact identity and refreshes every row", async () => {
    const page = hookPageFixture();
    const enabling = page.ctx.toggleHook({ ...HOOK, enabled: false }, true);
    respond(page.requests[0], REVIEW, 409);
    await enabling;
    assert.ok(page.ctx.hooksReplacement);
    page.ctx.hooksReplacement.hasAcceptedReplacement = true;
    const retrying = page.ctx.confirmHookReplacement();
    // No retry request becomes an empty URL and fails the assertion instead of hiding a missing user action.
    assert.match(
      page.requests[1]?.url ?? "",
      /deny-dangerous\/toggle\?path=%2Fproject-a/u,
    );
    assert.deepEqual(JSON.parse(String(page.requests[1]?.init?.body)), {
      enabled: true,
      replace: true,
      confirmationIdentity: REVIEW.confirmationIdentity,
    });
    const sibling = {
      ...HOOK,
      id: "deny-git-mutations",
      name: "Deny Git mutations",
    };
    respond(page.requests[1], { hook: HOOK, hooks: [HOOK, sibling] });
    await retrying;
    assert.deepEqual(plain(page.ctx.hooksState), [HOOK, sibling]);
    assert.deepEqual(page.toasts, ["Deny dangerous hook: on saved"]);
    assert.equal(
      page.requests.length,
      2,
      "the successful POST already supplies every affected row",
    );
  });

  // A policy upgrade can require consent without replacing local edits, so each checkbox has independent request authority.
  for (const hasConflicts of [false, true]) {
    it(`keeps policy and replacement consent separate with conflicts=${hasConflicts}`, async () => {
      const page = hookPageFixture();
      const saving = page.ctx.syncOfficialHooks();
      respond(
        page.requests[0],
        {
          ...REVIEW,
          code: "hook-policy-review-required",
          replacementAvailable: hasConflicts,
          conflicts: hasConflicts ? REVIEW.conflicts : [],
          policyReview: {
            original: { "deny-dangerous": true, "deny-git-mutations": false },
            requested: { "deny-dangerous": true, "deny-git-mutations": false },
            paths: [".goat-flow/hooks/deny-dangerous/guard-runtime.sh"],
          },
        },
        409,
      );
      await saving;
      assert.ok(page.ctx.hooksReplacement);
      assert.equal(page.ctx.hooksReplacement.hasAcceptedPolicyChange, false);
      await page.ctx.confirmHookReplacement();
      assert.equal(page.requests.length, 1);
      page.ctx.hooksReplacement.hasAcceptedPolicyChange = true;
      // Policy consent alone cannot authorize a separate file conflict displayed in the same panel.
      if (hasConflicts) {
        await page.ctx.confirmHookReplacement();
        assert.equal(page.requests.length, 1);
        page.ctx.hooksReplacement.hasAcceptedReplacement = true;
      }
      const retry = page.ctx.confirmHookReplacement();
      assert.deepEqual(JSON.parse(String(page.requests[1]?.init?.body)), {
        acceptPolicyChange: true,
        ...(hasConflicts ? { replace: true } : {}),
        confirmationIdentity: REVIEW.confirmationIdentity,
      });
      respond(page.requests[1], { hooks: [HOOK] });
      await retry;
    });
  }

  // Incomplete before/after choices must retain the server's refusal and never offer the user an approval retry.
  for (const policyReview of [
    "invalid review",
    { original: null, requested: {}, paths: ["runtime.sh"] },
    { original: {}, requested: [], paths: ["runtime.sh"] },
  ]) {
    it(`preserves the server diagnostic for a malformed policy review: ${JSON.stringify(policyReview)}`, async () => {
      const page = hookPageFixture();
      const saving = page.ctx.syncOfficialHooks();
      const error = "Policy upgrade refused; no hook files changed.";
      respond(page.requests[0], { ...REVIEW, error, policyReview }, 409);
      await saving;
      assert.equal(page.ctx.hooksError, error);
      assert.equal(page.ctx.hooksReplacement, null);
      await page.ctx.confirmHookReplacement();
      assert.equal(page.requests.length, 1);
      assert.deepEqual(page.toasts, []);
    });
  }

  // Cancelling policy-only review must leave the project untouched, even if a stale confirmation follows.
  it("cancels a policy-only review without another request", async () => {
    const page = hookPageFixture();
    const saving = page.ctx.syncOfficialHooks();
    respond(
      page.requests[0],
      {
        ...REVIEW,
        replacementAvailable: false,
        conflicts: [],
        policyReview: {
          original: { "deny-dangerous": false, "deny-git-mutations": true },
          requested: { "deny-dangerous": false, "deny-git-mutations": true },
          paths: [".goat-flow/hooks/deny-dangerous/guard-runtime.sh"],
        },
      },
      409,
    );
    await saving;
    assert.ok(page.ctx.hooksReplacement);
    page.ctx.cancelHookReplacement();
    await page.ctx.confirmHookReplacement();
    assert.equal(page.requests.length, 1);
    assert.equal(page.ctx.hooksReplacement, null);
  });

  // Every completion type must respect both project and page visit changes, including returning to the original value.
  for (const field of ["projectPath", "activeView"] as const) {
    // Late success, refusal and connection loss must all leave the user's new project visit untouched.
    for (const completion of [
      "success",
      "server-error",
      "connection-error",
    ] as const) {
      it(`ignores late ${completion} and finally after changing ${field} away and back`, async () => {
        const page = hookPageFixture();
        const oldSave = page.ctx.syncOfficialHooks();
        page.navigate(
          field,
          field === "projectPath" ? "/project-b" : "prompts",
        );
        page.navigate(field, field === "projectPath" ? "/project-a" : "hooks");
        const currentRow = { ...HOOK, name: "Current visit" };
        // Navigation triggers real GET loaders; only the newest one may populate this returned visit.
        for (const request of page.requests.slice(1))
          respond(request, { hooks: [currentRow] });
        await settleNavigation();
        const newSave = page.ctx.syncOfficialHooks();
        const currentRequest = page.requests.at(-1);
        // Simulate losing the connection after navigation, alongside the separate delayed HTTP response cases.
        if (completion === "connection-error")
          page.requests[0]?.reject(new Error("disconnected"));
        else
          respond(
            page.requests[0],
            completion === "success" ? { hooks: [HOOK] } : REVIEW,
            completion === "success" ? 200 : 409,
          );
        await oldSave;
        assert.equal(
          page.ctx.hookSavingId,
          "sync",
          "old finally must not unlock the new save",
        );
        assert.equal(page.ctx.hooksError, "");
        assert.equal(page.ctx.hooksReplacement, null);
        assert.deepEqual(plain(page.ctx.hooksState), [currentRow]);
        assert.deepEqual(page.toasts, []);
        respond(currentRequest, { hooks: [currentRow] });
        await newSave;
        assert.equal(page.ctx.hookSavingId, null);
        assert.deepEqual(page.toasts, ["Official hook files synced"]);
      });
    }
  }

  it("discards a pending review on navigation and ignores an old read without ending the new spinner", async () => {
    const page = hookPageFixture();
    const saving = page.ctx.syncOfficialHooks();
    respond(page.requests[0], REVIEW, 409);
    await saving;
    page.navigate("activeView", "prompts");
    page.navigate("activeView", "hooks");
    await page.ctx.confirmHookReplacement();
    assert.equal(
      page.requests.length,
      2,
      "navigation's GET is the only request after review is discarded",
    );
    page.navigate("activeView", "prompts");
    page.navigate("activeView", "hooks");
    respond(page.requests[1], { hooks: [HOOK] });
    await settleNavigation();
    assert.equal(page.ctx.hooksLoading, true);
    assert.deepEqual(plain(page.ctx.hooksState), []);
    respond(page.requests[2], { hooks: [] });
    await settleNavigation();
    assert.equal(page.ctx.hooksLoading, false);
  });

  // A failed save can still change files; both apply and claim-release failures need fresh rows beside persistent repair guidance.
  for (const failure of [
    { code: "hook-apply-failed", recovery: "" },
    {
      code: "hook-claim-release-failed",
      recovery:
        "Inspect before retrying:\ngoat-flow claims inspect /project --target notes.txt",
    },
  ]) {
    it(`refreshes after ${failure.code} while retaining the error, recovery and changed-file list`, async () => {
      const page = hookPageFixture();
      const saving = page.ctx.syncOfficialHooks();
      respond(
        page.requests[0],
        {
          error: "Some hook files changed; repair write access and retry.",
          code: failure.code,
          recovery: failure.recovery,
          replacementAvailable: false,
          changedPaths: [".goat-flow/hooks/deny-dangerous.sh"],
        },
        500,
      );
      await settleNavigation();
      assert.equal(page.ctx.hookSavingId, "sync");
      assert.equal(page.ctx.hooksLoading, true);
      respond(page.requests[1], { hooks: [HOOK] });
      await saving;
      assert.match(page.ctx.hooksError, /repair write access/u);
      assert.equal(
        page.ctx.hooksError,
        [
          "Some hook files changed; repair write access and retry.",
          failure.recovery,
        ]
          .filter(Boolean)
          .join("\n"),
      );
      assert.deepEqual(plain(page.ctx.hooksChangedPaths), [
        ".goat-flow/hooks/deny-dangerous.sh",
      ]);
      assert.deepEqual(plain(page.ctx.hooksState), [HOOK]);
      assert.equal(page.ctx.hookSavingId, null);
      assert.deepEqual(page.toasts, []);
    });
  }

  it("sends no request when a user cancels disabling a guarded hook", async () => {
    const page = hookPageFixture();
    await page.ctx.toggleHook({ ...HOOK, requiresConfirmDialog: true }, false);
    assert.equal(page.requests.length, 0);
    assert.deepEqual(page.toasts, []);
  });
});
