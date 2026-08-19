/**
 * Generates the portable managed-hook contract consumed by the standalone installer.
 * Use `--write` after registry changes and `--check` in verification or release builds.
 * Every provider fragment comes from the TypeScript writer, so users receive the same registrations through Bash, the CLI, and the dashboard.
 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { getAgentProfiles } from "../src/cli/agents/registry.ts";
import {
  LEGACY_DENY_DANGEROUS_HOOK_IDS,
  LEGACY_DENY_DANGEROUS_SCRIPT_NAMES,
} from "../src/cli/server/agent-hook-command.ts";
import {
  deriveManagedHookDesiredState,
  writeAgentHookState,
} from "../src/cli/server/agent-hook-writer.ts";
import { listHookSpecs } from "../src/cli/server/hooks-registry.ts";

const PROJECT_ROOT = resolve(import.meta.dirname, "..");
const OUTPUT_PATH = join(
  PROJECT_ROOT,
  "workflow",
  "hooks",
  "agent-config",
  "managed-hook-desired-state.json",
);
const CONTRACT_SCHEMA = "goat-flow.managed-hook-desired-state.v1";
const RETIRED_HOOK_IDS = [
  "plan-checkbox-guard",
  ...LEGACY_DENY_DANGEROUS_HOOK_IDS,
];
const RETIRED_HOOK_SCRIPT_NAMES = [
  "plan-checkbox-guard.sh",
  ...LEGACY_DENY_DANGEROUS_SCRIPT_NAMES,
];

/**
 * Build the exact provider config one enabled hook contributes for a user.
 *
 * Use only under the disposable root so generated installer data comes from the public writer.
 * Side effects: creates directories and writes one JSON fixture below that disposable root.
 */
function buildEnabledHookConfig(temporaryProjectRoot, agentProfile, hookSpec) {
  const hookFixtureRoot = join(
    temporaryProjectRoot,
    `${agentProfile.id}-${hookSpec.id}`,
  );
  mkdirSync(hookFixtureRoot, { recursive: true });
  writeAgentHookState(hookFixtureRoot, agentProfile, hookSpec, true);
  const hookConfigPath = join(hookFixtureRoot, agentProfile.hookConfigFile);
  return JSON.parse(readFileSync(hookConfigPath, "utf-8"));
}

/** Return every provider id and exact script name setup owns for one hook. */
function hookCleanupContract(hookSpec) {
  return {
    hookIds: [
      hookSpec.id,
      ...(hookSpec.id === "deny-dangerous"
        ? LEGACY_DENY_DANGEROUS_HOOK_IDS
        : []),
    ],
    commandScriptNames: [
      hookSpec.primaryScript,
      ...(hookSpec.id === "deny-dangerous"
        ? LEGACY_DENY_DANGEROUS_SCRIPT_NAMES
        : []),
    ],
  };
}

/**
 * Derive one deterministic provider/hook contract from the same public writer used by UI toggles and sync.
 *
 * Why the control flow is split:
 * - The provider loop excludes unsupported hooks, so users never receive registrations their agent cannot deliver.
 * - The hook loop isolates each generated fragment, preventing one enabled hook from leaking another hook's rows.
 *
 * It writes into one temporary filesystem tree and removes that tree in `finally`. The public invariant is that
 * rendered writer JSON is the installer source of truth, which avoids a second command implementation.
 */
function buildManagedHookContract() {
  const temporaryProjectRoot = mkdtempSync(
    join(tmpdir(), "goat-flow-managed-hook-contract-"),
  );

  try {
    const hookSpecs = listHookSpecs();
    const managedScriptNames = [
      ...new Set(hookSpecs.flatMap((hookSpec) => hookSpec.scriptFiles)),
    ].sort();
    const agentContracts = {};

    // Every hook-capable provider receives its own config path and supported desired states.
    for (const agentProfile of getAgentProfiles()) {
      // A provider without a hook config has no installer registration surface to publish.
      if (!agentProfile.hookConfigFile) continue;
      const hookContracts = {};

      // Each supported hook is generated independently so its fragment cannot contain another hook.
      for (const hookSpec of hookSpecs) {
        const cleanup = hookCleanupContract(hookSpec);
        // Unsupported delivery still publishes cleanup ownership so upgrades remove an obsolete registration.
        if (hookSpec.unsupportedAgents?.[agentProfile.id]) {
          hookContracts[hookSpec.id] = {
            supported: false,
            cleanup,
          };
          continue;
        }
        const desiredState = deriveManagedHookDesiredState(
          agentProfile,
          hookSpec,
          true,
        );
        hookContracts[hookSpec.id] = {
          supported: true,
          cleanup,
          defaultEnabled: hookSpec.defaultEnabled,
          commandScriptNames: [
            hookSpec.primaryScript,
            ...(hookSpec.id === "deny-dangerous"
              ? LEGACY_DENY_DANGEROUS_SCRIPT_NAMES
              : []),
          ],
          managedScriptFiles: desiredState.managedScriptFiles,
          registrationTargets: desiredState.registrationTargets,
          config: buildEnabledHookConfig(
            temporaryProjectRoot,
            agentProfile,
            hookSpec,
          ),
        };
      }

      agentContracts[agentProfile.id] = {
        hookConfigFile: agentProfile.hookConfigFile,
        hooks: hookContracts,
      };
    }

    return {
      schema: CONTRACT_SCHEMA,
      managedScriptNames,
      retiredHookIds: RETIRED_HOOK_IDS,
      retiredHookScriptNames: RETIRED_HOOK_SCRIPT_NAMES,
      agents: agentContracts,
    };
  } finally {
    rmSync(temporaryProjectRoot, { recursive: true, force: true });
  }
}

/**
 * Render deterministic JSON for byte-for-byte artifact checks.
 * Use after registry changes so reviewers can see the exact standalone state users will receive.
 */
function renderManagedHookContract() {
  return `${JSON.stringify(buildManagedHookContract(), null, 2)}\n`;
}

/**
 * Run the read-only artifact check by default, or deliberately regenerate it with `--write`.
 *
 * Side effects: write mode replaces only the generated JSON; check mode writes nothing.
 * Missing, stale, or invalid checks set a failing process status so divergent installers cannot build.
 */
function main() {
  // No argument defaults to the read-only check used by normal verification.
  const requestedMode = process.argv[2] ?? "--check";
  const generatedContract = renderManagedHookContract();

  // Write mode is the deliberate maintenance action used after registry changes.
  if (requestedMode === "--write") {
    writeFileSync(OUTPUT_PATH, generatedContract);
    process.stdout.write(`updated ${OUTPUT_PATH}\n`);
    return;
  }

  // Unknown modes are usage mistakes rather than contract drift.
  if (requestedMode !== "--check") {
    process.stderr.write(
      "Usage: generate-managed-hook-desired-state.mjs [--check|--write]\n",
    );
    process.exitCode = 2;
    return;
  }

  // A missing artifact means the standalone installer has no desired state to consume.
  if (!existsSync(OUTPUT_PATH)) {
    process.stderr.write(
      `Missing generated managed-hook contract: ${OUTPUT_PATH}\nRun this script with --write.\n`,
    );
    process.exitCode = 1;
    return;
  }

  const committedContract = readFileSync(OUTPUT_PATH, "utf-8");
  // Different bytes mean TypeScript and standalone installation would show users different hook state.
  if (committedContract !== generatedContract) {
    process.stderr.write(
      `Generated managed-hook contract is stale: ${OUTPUT_PATH}\nRun this script with --write.\n`,
    );
    process.exitCode = 1;
    return;
  }

  process.stdout.write(`managed-hook contract current: ${OUTPUT_PATH}\n`);
}

main();
