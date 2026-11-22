/**
 * Checks the Windows and WSL evidence the Hooks page and audit present.
 *
 * Use when delivery is recaptured or a hook runtime change makes earlier evidence stale.
 * The tests compare registry metadata and runtime hashes without launching an agent.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, posix } from "node:path";
import { describe, it } from "node:test";
import type { HookProviderHostEvidence } from "../../src/cli/hook-contracts.js";
import { HOOK_PROVIDER_HOST_EVIDENCE } from "../../src/cli/hook-provider-captures.js";
import {
  currentHookProviderSupportGate,
  getHookSpec,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";

/** Files a capture hashes, as `workflow/hooks/README.md` states; every verified row records all of them as captured. */
const CAPTURED_RUNTIME_FILE_COUNT = 41;

/**
 * Hash one shipped runtime file as it is in the working tree now.
 *
 * @param file - path relative to `workflow/hooks`, such as `post-turn/scanner.mjs`
 * @returns lowercase SHA256 of the file's current bytes
 */
function runtimeFileHash(file: string): string {
  return createHash("sha256")
    .update(readFileSync(join(process.cwd(), "workflow", "hooks", file)))
    .digest("hex");
}

/**
 * List the runtime files a hook loads, following relative specifiers from its launcher and its entry file.
 * The walk reads from, import, require, createRequire and new URL forms; a specifier built at run time is not seen.
 *
 * @param entries - files to start from, relative to `workflow/hooks`, such as the launcher and the hook entry
 * @returns paths relative to `workflow/hooks` in deterministic sorted order; never empty
 */
function loadedRuntimeFiles(entries: readonly string[]): string[] {
  const loaded = new Set<string>();
  const pending = [...entries];
  // Each newly found file is read once for its own specifiers until no unread file remains.
  while (pending.length > 0) {
    const file = pending.pop() as string;
    // A file reached through two importers is read only the first time.
    if (loaded.has(file)) continue;
    loaded.add(file);
    // Data files such as the policy corpus are loaded but hold no specifiers of their own.
    if (!/\.[cm]js$/u.test(file)) continue;
    const source = readFileSync(
      join(process.cwd(), "workflow", "hooks", file),
      "utf8",
    );
    // A quoted specifier that starts with a dot names a sibling runtime file in each of these call forms.
    for (const match of source.matchAll(
      /(?:from\s*|import\s*\(?\s*|require\s*\(\s*|\)\s*\(\s*|new URL\(\s*)["'](\.{1,2}\/[^"']+)["']/gu,
    ))
      pending.push(
        posix.normalize(posix.join(dirname(file), match[1] as string)),
      );
  }
  return [...loaded].sort();
}

/** Find the reviewed row or fail before asserting its host-specific outcome. */
function hostEvidence(
  provider: HookProviderHostEvidence["provider"],
  host: HookProviderHostEvidence["host"],
): HookProviderHostEvidence {
  const row = getHookSpec("deny-dangerous")?.providerEvidence?.[
    provider
  ]?.hostCaptures?.find((capture) => capture.host === host);
  assert.ok(row, provider + ":" + host);
  return row;
}

describe("host-specific hook provider captures", () => {
  it("retains runtime hashes for all required host captures", () => {
    const captures = listHookSpecs().flatMap((hook) =>
      Object.values(hook.providerEvidence ?? {}).flatMap(
        (evidence) => evidence.hostCaptures ?? [],
      ),
    );
    assert.deepEqual(
      [...new Set(captures.map((row) => row.caseId))].sort(),
      Array.from({ length: 18 }, (_, index) => "C" + (index + 1)).sort(),
    );
    for (const row of captures) {
      // A verified row without its capture would pass every hash check below vacuously.
      assert.equal(
        row.capture !== undefined,
        row.verification === "verified",
        row.caseId + ": only verified rows carry current receipts",
      );
      const receipt = row.capture ?? row.historicalCapture;
      if (!receipt) continue;
      assert.match(receipt.artifactSha256, /^[a-f0-9]{64}$/u);
      assert.match(receipt.approvalPacketSha256, /^[a-f0-9]{64}$/u);
      // Rows share one map, so dropping a key would silently stop every row from noticing a change to that file.
      assert.equal(
        Object.keys(receipt.runtimeSha256).length,
        CAPTURED_RUNTIME_FILE_COUNT,
        row.caseId + ": a capture records every runtime hash",
      );
    }
    // A row must match the current bytes of the files its own hook loads; its other hashes stay as captured (ADR-069).
    const staleRows: string[] = [];
    for (const hook of listHookSpecs()) {
      // Rows from every provider are gathered; a hook with no provider evidence, or a provider with no host captures, adds none.
      const hookCaptures = Object.values(hook.providerEvidence ?? {}).flatMap(
        (evidence) => evidence.hostCaptures ?? [],
      );
      // Each row is checked only against its own hook's files, so a change to a file this hook does not load leaves the row valid.
      for (const row of hookCaptures) {
        // Historical receipts retain their original hashes and do not attest the current runtime.
        if (!row.capture) continue;
        // Changing any file this hook loads means recapturing this hook's rows.
        for (const file of hook.scriptFiles) {
          // Every stale row is collected, so one failure names all the rows to recapture.
          if (row.capture.runtimeSha256[file] !== runtimeFileHash(file))
            staleRows.push(`${row.caseId}: ${file} changed (${hook.id})`);
        }
      }
    }
    assert.deepEqual(
      staleRows.sort(),
      [],
      "recapture the rows whose hook loads a changed runtime file",
    );
  });

  it("registers every runtime file a hook entry loads", () => {
    // The per-hook rule above is only sound when a hook's registered list covers everything its launcher and entry load.
    for (const hook of listHookSpecs()) {
      // The walk starts from the shared launcher and this hook's entry, so a file only the launcher loads must be registered too.
      for (const file of loadedRuntimeFiles([
        "run-hook.mjs",
        hook.primaryScript,
      ]))
        assert.ok(
          hook.scriptFiles.includes(file),
          `${hook.id}: ${file} is loaded but not registered, so no capture would pin it`,
        );
    }
  });

  it("attaches matching captures without advancing support gates", () => {
    for (const hook of listHookSpecs()) {
      for (const [provider, evidence] of Object.entries(
        hook.providerEvidence ?? {},
      )) {
        assert.equal(
          currentHookProviderSupportGate(evidence),
          currentHookProviderSupportGate({ ...evidence, hostCaptures: [] }),
        );
        for (const row of evidence.hostCaptures ?? []) {
          assert.equal(row.provider, provider);
          assert.equal(
            row.providerEventName.toLowerCase(),
            hook.event.toLowerCase(),
          );
          if (row.capture) {
            for (const file of hook.scriptFiles)
              assert.ok(file in row.capture.runtimeSha256, file);
          }
        }
      }
    }
    // Each observation stays attached to its provider and event. Codex rows still need fresh evidence; the others carry current captures.
    const CURRENT = ["verified", "scenario-unverified"] as const;
    const STALE = ["incomplete", "provider-capture-stale"] as const;
    const attached = [
      ["copilot", "deny-dangerous", "C7", CURRENT],
      ["copilot", "deny-git-mutations", "C7", CURRENT],
      ["copilot", "gruff-code-quality", "C8", CURRENT],
      ["claude", "deny-dangerous", "C1", CURRENT],
      ["claude", "deny-git-mutations", "C1", CURRENT],
      ["claude", "gruff-code-quality", "C2", CURRENT],
      ["claude", "post-turn-safety", "C3", CURRENT],
      ["codex", "deny-dangerous", "C4", STALE],
      ["codex", "deny-git-mutations", "C4", STALE],
      ["codex", "gruff-code-quality", "C5", STALE],
      ["codex", "post-turn-safety", "C6", STALE],
      ["claude", "deny-dangerous", "C10", CURRENT],
      ["claude", "deny-git-mutations", "C10", CURRENT],
      ["claude", "gruff-code-quality", "C11", CURRENT],
      ["claude", "post-turn-safety", "C12", CURRENT],
      ["codex", "deny-dangerous", "C13", STALE],
      ["codex", "deny-git-mutations", "C13", STALE],
      ["codex", "gruff-code-quality", "C14", STALE],
      ["codex", "post-turn-safety", "C15", STALE],
      ["copilot", "deny-dangerous", "C16", CURRENT],
      ["copilot", "deny-git-mutations", "C16", CURRENT],
      ["copilot", "gruff-code-quality", "C17", CURRENT],
      ["antigravity", "deny-dangerous", "C9", CURRENT],
      ["antigravity", "deny-git-mutations", "C9", CURRENT],
      ["antigravity", "deny-dangerous", "C18", CURRENT],
      ["antigravity", "deny-git-mutations", "C18", CURRENT],
    ] as const;
    // Every linked observation still belongs to the same hook, with the verification and gate its row expects.
    for (const [provider, hookId, caseId, [verification, gate]] of attached) {
      const evidence = getHookSpec(hookId)?.providerEvidence?.[provider];
      const row = evidence?.hostCaptures?.find(
        (capture) => capture.caseId === caseId,
      );
      assert.equal(row?.verification, verification, caseId);
      assert.equal(
        evidence?.effectiveSupportGate,
        gate,
        `${provider}/${hookId} gate`,
      );
    }
  });

  it("keeps each reviewed support gate within its verified host delivery", () => {
    // Check each hook's status against what has been verified on the two hosts.
    for (const hook of listHookSpecs()) {
      // A hook with no recorded provider evidence has no delivery rows to check.
      for (const [provider, evidence] of Object.entries(
        hook.providerEvidence ?? {},
      )) {
        const label = `${provider}/${hook.id}`;
        // A host with no current successful capture cannot appear as verified.
        const deliveredHosts = [
          ...new Set(
            (evidence.hostCaptures ?? [])
              .filter(
                (row) =>
                  row.verification === "verified" &&
                  row.capture?.supportOutcome === "supported" &&
                  row.capture.resultDelivery === "delivered",
              )
              .map((row) => row.host),
          ),
        ].sort();
        const gate = currentHookProviderSupportGate(evidence);
        const expectedHosts =
          gate === "scenario-unverified" ? ["windows", "wsl"] : [];
        assert.deepEqual(
          deliveredHosts,
          expectedHosts,
          label + ": verified delivery by host",
        );
      }
    }
  });

  it("keeps renewed Stop versions separate from earlier event captures", () => {
    // A Stop result must stay tied to its own event, even when the same agent also ran a policy hook.
    for (const [caseId, provider, host, version, verification] of [
      ["C3", "claude", "windows", "2.1.330", "verified"],
      ["C12", "claude", "wsl", "2.1.330", "verified"],
      ["C15", "codex", "wsl", "0.169.0", "incomplete"],
    ] as const) {
      const stop = getHookSpec("post-turn-safety")?.providerEvidence?.[
        provider
      ]?.hostCaptures?.find((row) => row.host === host);
      const earlier = hostEvidence(provider, host);
      // A verified row carries its current capture; an incomplete one keeps only its historical receipt.
      const stopReceipt = stop?.capture ?? stop?.historicalCapture;
      const earlierReceipt = earlier.capture ?? earlier.historicalCapture;
      assert.equal(stop?.caseId, caseId);
      assert.equal(stop.verification, verification);
      assert.equal(stopReceipt?.providerVersion, version);
      assert.equal(stopReceipt?.resultDelivery, "delivered");
      assert.equal(stopReceipt?.continuationBehavior, "continued");
      assert.ok(earlierReceipt);
      assert.notEqual(
        stopReceipt?.artifactSha256,
        earlierReceipt.artifactSha256,
        caseId + ": the Stop capture must not reuse the pre-tool receipt",
      );
    }
  });

  it("retains verified host observations and reports incomplete Codex captures", () => {
    // Each provider's pre-tool row on each host carries the version its reviewed capture recorded.
    for (const [provider, host, caseId, version] of [
      ["claude", "windows", "C1", "2.1.330"],
      ["claude", "wsl", "C10", "2.1.330"],
      ["copilot", "windows", "C7", "1.0.103"],
      ["copilot", "wsl", "C16", "1.0.114"],
      ["antigravity", "windows", "C9", "1.4.8"],
      ["antigravity", "wsl", "C18", "1.4.12"],
    ] as const) {
      const row = hostEvidence(provider, host);
      assert.equal(row.caseId, caseId);
      assert.equal(row.verification, "verified", caseId);
      assert.equal(row.capture?.providerVersion, version, caseId);
      assert.equal(row.capture?.resultDelivery, "delivered", caseId);
    }
    const windowsCodex = hostEvidence("codex", "windows");
    assert.equal(windowsCodex.caseId, "C4");
    assert.equal(windowsCodex.verification, "incomplete");
    assert.equal(windowsCodex.capture, undefined);
    const wslCodex = hostEvidence("codex", "wsl");
    assert.equal(wslCodex.caseId, "C13");
    assert.equal(wslCodex.verification, "incomplete");
    assert.equal(wslCodex.historicalCapture?.providerVersion, "0.169.0");
    // Every non-Codex row attests the current runtime and no longer carries an earlier receipt.
    const verifiedRows = HOOK_PROVIDER_HOST_EVIDENCE.filter(
      (row) => row.provider !== "codex",
    );
    assert.deepEqual(
      verifiedRows.map((row) => row.caseId),
      [
        "C1",
        "C2",
        "C3",
        "C7",
        "C8",
        "C9",
        "C10",
        "C11",
        "C12",
        "C16",
        "C17",
        "C18",
      ],
    );
    for (const row of verifiedRows) {
      assert.equal(row.verification, "verified", row.caseId);
      assert.equal(row.historicalCapture, undefined, row.caseId);
    }
    // Codex rows still need fresh evidence; the reviewed WSL results remain available as history.
    const codexRows = HOOK_PROVIDER_HOST_EVIDENCE.filter(
      (row) => row.provider === "codex",
    );
    for (const row of codexRows) {
      assert.equal(row.verification, "incomplete", row.caseId);
      assert.equal(row.capture, undefined, row.caseId);
    }
    const historicalReceipts = codexRows.flatMap((row) =>
      row.historicalCapture
        ? [[row.caseId, row.historicalCapture] as const]
        : [],
    );
    assert.deepEqual(
      historicalReceipts.map(([caseId]) => caseId),
      ["C13", "C14", "C15"],
    );
    // A past capture still describes the launcher the user was running when it was recorded.
    for (const [caseId, receipt] of historicalReceipts) {
      assert.notEqual(
        receipt.runtimeSha256["hook-launch.mjs"],
        runtimeFileHash("hook-launch.mjs"),
        caseId + ": retain the original launcher hash",
      );
    }
  });
});
