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
      if (!row.capture) continue;
      assert.match(row.capture.artifactSha256, /^[a-f0-9]{64}$/u);
      assert.match(row.capture.approvalPacketSha256, /^[a-f0-9]{64}$/u);
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
  });

  it("keeps historical captures incomplete after the shared runtime changes", () => {
    const windows = hostEvidence("copilot", "windows");
    const wsl = hostEvidence("copilot", "wsl");
    assert.equal(windows.verification, "incomplete");
    assert.equal(windows.capture, undefined);
    assert.equal(wsl.verification, "incomplete");
    assert.equal(wsl.capture, undefined);
    assert.match(wsl.limitations.join(" "), /fallback/u);
    assert.equal(hostEvidence("claude", "windows").verification, "incomplete");
    const wslClaude = hostEvidence("claude", "wsl");
    assert.equal(wslClaude.capture, undefined);
    assert.equal(wslClaude.verification, "incomplete");
    for (const row of HOOK_PROVIDER_HOST_EVIDENCE) {
      assert.equal(row.capture, undefined, row.caseId);
      assert.equal(
        row.verification,
        row.caseId === "C9" ? "security-hold" : "incomplete",
      );
    }
    assert.equal(
      hostEvidence("antigravity", "windows").verification,
      "security-hold",
    );
  });
});
