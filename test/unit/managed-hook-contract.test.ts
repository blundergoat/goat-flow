/**
 * Guards the one place the standalone installer borrows registrar wording.
 * The Bash installer keeps its own eligibility check and only renders this prose, so a
 * registrar reword must reach the shipped contract or an upgrade explains a hook loss wrongly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { readAllHookStates } from "../../src/cli/server/hook-registrar.js";

const CONTRACT_PATH = resolve(
  "workflow/hooks/agent-config/managed-hook-desired-state.json",
);
const BLOCKED_HOOK_ID = "post-turn-safety";

/**
 * Build a non-Git project whose post-turn scan-root contract cannot be satisfied.
 * Use to reach the registrar's blocked-registration reason without touching a real checkout.
 * Filesystem side effects: creates one temporary directory outside any Git working tree and
 * writes a `.goat-flow/config.yaml` enabling the hook; the caller removes the directory.
 *
 * @returns project root the caller must remove; it is never inside a Git working tree
 */
function makeNonGitProject(): string {
  const root = mkdtempSync(join(tmpdir(), "goat-flow-prerequisite-"));
  mkdirSync(join(root, ".goat-flow"), { recursive: true });
  writeFileSync(
    join(root, ".goat-flow", "config.yaml"),
    `hooks:\n  ${BLOCKED_HOOK_ID}: true\n`,
  );
  return root;
}

describe("managed hook desired-state contract", () => {
  it("ships the registrar's exact blocked-registration wording", () => {
    const projectRoot = makeNonGitProject();
    try {
      const hookState = readAllHookStates(projectRoot).find(
        (state) => state.id === BLOCKED_HOOK_ID,
      );
      const agentState = hookState?.agents.claude;
      assert.ok(agentState, `${BLOCKED_HOOK_ID} must expose Claude state`);

      const contract: unknown = JSON.parse(readFileSync(CONTRACT_PATH, "utf8"));
      const prerequisite = (
        contract as {
          agents: Record<
            string,
            {
              hooks: Record<
                string,
                {
                  registrationPrerequisite?: {
                    reason: string;
                    remediation: string;
                  };
                }
              >;
            }
          >;
        }
      ).agents.claude?.hooks[BLOCKED_HOOK_ID]?.registrationPrerequisite;

      assert.ok(
        prerequisite,
        `${BLOCKED_HOOK_ID} must publish registrationPrerequisite for the installer`,
      );
      // The installer prints these two strings verbatim, so a registrar reword must land here too.
      assert.equal(prerequisite.reason, agentState.reason);
      assert.equal(prerequisite.remediation, agentState.repairSummary);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
    }
  });
});
