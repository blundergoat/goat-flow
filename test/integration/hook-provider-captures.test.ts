/**
 * Checks host-specific delivery metadata without launching a provider.
 * Keep recorded runtime bytes and incomplete host outcomes separate from support activation.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { HookProviderHostEvidence } from "../../src/cli/hook-contracts.js";
import { HOOK_PROVIDER_HOST_EVIDENCE } from "../../src/cli/hook-provider-captures.js";
import {
  currentHookProviderSupportGate,
  getHookSpec,
  listHookSpecs,
} from "../../src/cli/server/hooks-registry.js";

/** Files a capture hashes, as `workflow/hooks/README.md` states; adding one means recapturing every verified row. */
const CAPTURED_RUNTIME_FILE_COUNT = 41;

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
        row.caseId + ": only verified rows carry a capture",
      );
      if (!row.capture) continue;
      assert.match(row.capture.artifactSha256, /^[a-f0-9]{64}$/u);
      assert.match(row.capture.approvalPacketSha256, /^[a-f0-9]{64}$/u);
      // Rows share one map, so dropping a key would silently stop every row from noticing a change to that file.
      assert.equal(
        Object.keys(row.capture.runtimeSha256).length,
        CAPTURED_RUNTIME_FILE_COUNT,
        row.caseId + ": a capture records every runtime hash",
      );
      for (const [file, expectedHash] of Object.entries(
        row.capture.runtimeSha256,
      )) {
        const actualHash = createHash("sha256")
          .update(readFileSync(join(process.cwd(), "workflow", "hooks", file)))
          .digest("hex");
        assert.equal(
          actualHash,
          expectedHash,
          row.caseId + ": recapture after changing " + file,
        );
      }
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
    // Verified captures inform review only; each gate they attach to still waits for local scenario proof.
    const attached = [
      ["copilot", "deny-dangerous", "C7"],
      ["copilot", "deny-git-mutations", "C7"],
      ["copilot", "gruff-code-quality", "C8"],
      ["claude", "deny-dangerous", "C1"],
      ["claude", "deny-git-mutations", "C1"],
      ["claude", "gruff-code-quality", "C2"],
      ["claude", "post-turn-safety", "C3"],
      ["codex", "deny-dangerous", "C4"],
      ["codex", "deny-git-mutations", "C4"],
      ["codex", "gruff-code-quality", "C5"],
      ["codex", "post-turn-safety", "C6"],
      ["claude", "deny-dangerous", "C10"],
      ["claude", "deny-git-mutations", "C10"],
      ["claude", "gruff-code-quality", "C11"],
      ["claude", "post-turn-safety", "C12"],
      ["codex", "deny-dangerous", "C13"],
      ["codex", "deny-git-mutations", "C13"],
      ["codex", "gruff-code-quality", "C14"],
      ["codex", "post-turn-safety", "C15"],
      ["copilot", "deny-dangerous", "C16"],
      ["copilot", "deny-git-mutations", "C16"],
      ["copilot", "gruff-code-quality", "C17"],
      ["antigravity", "deny-dangerous", "C9"],
      ["antigravity", "deny-git-mutations", "C9"],
      ["antigravity", "deny-dangerous", "C18"],
      ["antigravity", "deny-git-mutations", "C18"],
    ] as const;
    for (const [provider, hookId, caseId] of attached) {
      const evidence = getHookSpec(hookId)?.providerEvidence?.[provider];
      assert.ok(
        evidence?.hostCaptures?.some(
          (row) => row.caseId === caseId && row.verification === "verified",
        ),
        `${provider}/${hookId} carries verified ${caseId}`,
      );
      assert.equal(
        evidence?.effectiveSupportGate,
        "scenario-unverified",
        `${provider}/${hookId} gate`,
      );
    }
  });

  it("keeps each reviewed support gate within its verified host delivery", () => {
    for (const hook of listHookSpecs()) {
      for (const [provider, evidence] of Object.entries(
        hook.providerEvidence ?? {},
      )) {
        const label = `${provider}/${hook.id}`;
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
        if (
          currentHookProviderSupportGate(evidence) === "scenario-unverified"
        ) {
          // Only live delivery on both captured hosts lets a gate wait for nothing but local scenario proof.
          assert.deepEqual(
            deliveredHosts,
            ["windows", "wsl"],
            label + ": verified delivery on both hosts",
          );
        } else {
          // A delivered capture behind a provider gap means the reviewed gate is stale, not conservative.
          assert.deepEqual(
            deliveredHosts,
            [],
            label + ": provider gap without delivery",
          );
        }
      }
    }
  });

  it("keeps renewed Stop versions separate from earlier event captures", () => {
    for (const [caseId, provider, host, version] of [
      ["C3", "claude", "windows", "2.1.317"],
      ["C6", "codex", "windows", "0.167.0"],
      ["C12", "claude", "wsl", "2.1.317"],
      ["C15", "codex", "wsl", "0.167.0"],
    ] as const) {
      const stop = getHookSpec("post-turn-safety")?.providerEvidence?.[
        provider
      ]?.hostCaptures?.find((row) => row.host === host);
      const earlier = hostEvidence(provider, host);
      assert.equal(stop?.caseId, caseId);
      assert.equal(stop.verification, "verified");
      assert.equal(stop.capture?.providerVersion, version);
      assert.equal(stop.capture?.resultDelivery, "delivered");
      assert.equal(stop.capture?.continuationBehavior, "continued");
      assert.notEqual(
        stop.capture?.artifactSha256,
        earlier.capture?.artifactSha256,
        caseId + ": the Stop capture must not reuse another event's receipt",
      );
    }
  });

  it("verifies only the recaptured rows after the shared runtime change", () => {
    const windows = hostEvidence("copilot", "windows");
    const wsl = hostEvidence("copilot", "wsl");
    assert.equal(windows.caseId, "C7");
    assert.equal(windows.verification, "verified");
    assert.equal(windows.capture?.providerVersion, "1.0.103");
    assert.equal(windows.capture?.resultDelivery, "delivered");
    assert.equal(wsl.caseId, "C16");
    assert.equal(wsl.verification, "verified");
    assert.equal(wsl.capture?.providerVersion, "1.0.91");
    assert.equal(wsl.capture?.resultDelivery, "delivered");
    const windowsClaude = hostEvidence("claude", "windows");
    assert.equal(windowsClaude.caseId, "C1");
    assert.equal(windowsClaude.verification, "verified");
    assert.equal(windowsClaude.capture?.providerVersion, "2.1.317");
    const wslClaude = hostEvidence("claude", "wsl");
    assert.equal(wslClaude.caseId, "C10");
    assert.equal(wslClaude.verification, "verified");
    assert.equal(wslClaude.capture?.providerVersion, "2.1.317");
    const windowsCodex = hostEvidence("codex", "windows");
    assert.equal(windowsCodex.caseId, "C4");
    assert.equal(windowsCodex.verification, "verified");
    assert.equal(windowsCodex.capture?.providerVersion, "0.167.0");
    const wslCodex = hostEvidence("codex", "wsl");
    assert.equal(wslCodex.caseId, "C13");
    assert.equal(wslCodex.verification, "verified");
    assert.equal(wslCodex.capture?.providerVersion, "0.167.0");
    const wslAntigravity = hostEvidence("antigravity", "wsl");
    assert.equal(wslAntigravity.caseId, "C18");
    assert.equal(wslAntigravity.verification, "verified");
    assert.equal(wslAntigravity.capture?.providerVersion, "1.4.12");
    const windowsAntigravity = hostEvidence("antigravity", "windows");
    assert.equal(windowsAntigravity.caseId, "C9");
    assert.equal(windowsAntigravity.verification, "verified");
    assert.equal(windowsAntigravity.capture?.providerVersion, "1.4.8");
    const expectedVerification: Readonly<
      Record<string, HookProviderHostEvidence["verification"]>
    > = {
      C1: "verified",
      C2: "verified",
      C3: "verified",
      C4: "verified",
      C5: "verified",
      C6: "verified",
      C7: "verified",
      C8: "verified",
      C9: "verified",
      C10: "verified",
      C11: "verified",
      C12: "verified",
      C13: "verified",
      C14: "verified",
      C15: "verified",
      C16: "verified",
      C17: "verified",
      C18: "verified",
    };
    for (const row of HOOK_PROVIDER_HOST_EVIDENCE) {
      const expected = expectedVerification[row.caseId] ?? "incomplete";
      assert.equal(row.verification, expected, row.caseId);
      assert.equal(
        row.capture !== undefined,
        expected === "verified",
        row.caseId,
      );
    }
  });
});
