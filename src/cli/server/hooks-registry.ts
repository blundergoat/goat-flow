/**
 * Defines the hooks users can enable from the dashboard or CLI.
 *
 * Use when setup, sync, and audit need one display name, script, event, and deadline.
 *
 * The manifest still decides which coding agents support hook registration.
 * Keeping these values central makes every user-facing setup path agree.
 */
import type { AgentId } from "../types.js";
import {
  HOOK_RESULT_SCHEMA,
  type HookEffectiveState,
} from "../hook-contracts.js";

type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

/**
 * Names the result protocol, adapter, and deadline used by a registered hook.
 *
 * Use when setup writes a command users expect their coding agent to run.
 * Invariant: the launcher deadline stays below the host timeout.
 */
export interface HookDeliveryContract {
  resultProtocol: "legacy" | typeof HOOK_RESULT_SCHEMA;
  adapterVersion: string;
  launcherDeadlineMs: number;
}

/**
 * Names deterministic adapter evidence and one host's first unmet support gate.
 *
 * Use when UI and audit surfaces explain why delivery is not yet verified.
 * Invariant: fixture identity never upgrades itself into live provider proof.
 */
export interface HookProviderRegistryEvidence {
  identity: string;
  effectiveSupportGate: HookEffectiveState["status"];
}

/**
 * Defines one hook users can install, toggle, and inspect across supported agents.
 *
 * Use as the shared setup, dashboard, and audit registration contract.
 * Invariant: active hooks identify delivery; only removed-hook tombstones may omit it.
 */
export interface HookSpec extends Record<"togglable", boolean> {
  id: string;
  displayName: string;
  description: string;
  event: HookEvent;
  matcher: string;
  scriptFiles: string[];
  primaryScript: string;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  /** Runner-side timeout agents register for this hook; omitted = agent default. */
  timeoutSec?: number;
  /** Internal result and launcher ceiling; omitted only for removed-hook tombstones. */
  deliveryContract?: HookDeliveryContract;
  /** Provider override used only where live proof approves a newer result path. */
  providerDeliveryContracts?: Partial<Record<AgentId, HookDeliveryContract>>;
  /** Deterministic contract identity; absence means the UI has no provider proof to show. */
  providerEvidence?: Partial<Record<AgentId, HookProviderRegistryEvidence>>;
  unsupportedAgents?: Partial<Record<AgentId, string>>;
}

const POLICY_DELIVERY_CONTRACT: HookDeliveryContract = {
  resultProtocol: "legacy",
  adapterVersion: "1",
  launcherDeadlineMs: 25_000, // Ceiling: leaves five seconds for the host to render failure.
};

const FEEDBACK_DELIVERY_CONTRACT: HookDeliveryContract = {
  resultProtocol: "legacy",
  adapterVersion: "1",
  launcherDeadlineMs: 75_000, // Ceiling: leaves fifteen seconds for the host to render feedback.
};

const GRUFF_DELIVERY_CONTRACT: HookDeliveryContract = {
  resultProtocol: HOOK_RESULT_SCHEMA,
  adapterVersion: "1",
  launcherDeadlineMs: 75_000, // Ceiling: includes Gruff's 60-second analyzer budget and host rendering.
};

const CODEX_POST_TURN_DELIVERY_CONTRACT: HookDeliveryContract = {
  resultProtocol: HOOK_RESULT_SCHEMA,
  adapterVersion: "1",
  launcherDeadlineMs: 75_000, // Ceiling: leaves Codex fifteen seconds to render Stop feedback.
};

// Every native hook uses this launcher and provider-response boundary.
const NATIVE_LAUNCH_RUNTIME_FILES = [
  "run-hook.mjs",
  "hook-launch.mjs",
  "hook-output.mjs",
  "hook-supervisor.mjs",
  "process-tree.mjs",
  "hook-launch-runtime.mjs",
  "hook-provider-adapters.mjs",
  "hook-policy-state.cjs",
  "vendor/js-yaml.cjs",
];

// Both policy entrypoints load the same parser, rule modules and self-test corpus.
const POLICY_RUNTIME_FILES = [
  ...NATIVE_LAUNCH_RUNTIME_FILES,
  "gh-graphql-read.cjs",
  "vendor/graphql.cjs",
  "policy-corpus.mjs",
  "policy-evaluation.mjs",
  "policy-git.mjs",
  "policy-heredoc.mjs",
  "policy-input.mjs",
  "policy-prefixes.mjs",
  "policy-segments.mjs",
  "policy-substitutions.mjs",
  "policy-syntax.mjs",
  "policy-words.mjs",
  "deny-dangerous/git-command.mjs",
  "deny-dangerous/github-command.mjs",
  "deny-dangerous/patterns-paths.mjs",
  "deny-dangerous/patterns-shell.mjs",
  "deny-dangerous/patterns-writes.mjs",
  "deny-dangerous/corpus.json",
];

const HOOKS: HookSpec[] = [
  {
    id: "deny-dangerous",
    displayName: "Deny dangerous hook",
    description: "Block risky shell operations and direct secret-path access.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["deny-dangerous.mjs", ...POLICY_RUNTIME_FILES],
    primaryScript: "deny-dangerous.mjs",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: true,
    // Above the shared launcher's 25s policy deadline so Goat Flow can emit
    // its protocol-specific unavailable response before supported hosts stop it.
    timeoutSec: 30,
    deliveryContract: POLICY_DELIVERY_CONTRACT,
    providerEvidence: {
      claude: {
        identity: "hook-provider-adapter.v1:claude:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      codex: {
        identity: "hook-provider-adapter.v1:codex:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      antigravity: {
        identity: "hook-provider-adapter.v1:antigravity:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      copilot: {
        identity: "hook-provider-adapter.v1:copilot:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
    },
  },
  {
    id: "deny-git-mutations",
    displayName: "Deny Git and GitHub writes",
    description:
      "Block Git commits, publication, remote lock changes, destructive Git operations, and GitHub writes; allow GitHub reads and issue or PR comments.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["deny-git-mutations.mjs", ...POLICY_RUNTIME_FILES],
    primaryScript: "deny-git-mutations.mjs",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: true,
    // Above the shared launcher's 25s policy deadline so Goat Flow can emit
    // its protocol-specific unavailable response before supported hosts stop it.
    timeoutSec: 30,
    deliveryContract: POLICY_DELIVERY_CONTRACT,
    providerEvidence: {
      claude: {
        identity: "hook-provider-adapter.v1:claude:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      codex: {
        identity: "hook-provider-adapter.v1:codex:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      antigravity: {
        identity: "hook-provider-adapter.v1:antigravity:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      copilot: {
        identity: "hook-provider-adapter.v1:copilot:pre-tool",
        effectiveSupportGate: "scenario-unverified",
      },
    },
  },
  {
    id: "gruff-code-quality",
    displayName: "gruff code quality",
    description:
      "Check each edited source file with its nearest gruff-* config and return attributable line, symbol, file, and project feedback.",
    event: "PostToolUse",
    matcher: "Edit|Write|Bash",
    scriptFiles: [
      ...NATIVE_LAUNCH_RUNTIME_FILES,
      "gruff-code-quality.mjs",
      "gruff/analyzer.mjs",
      "gruff/feedback.mjs",
      "gruff/ranges.mjs",
      "gruff/scope.mjs",
    ],
    primaryScript: "gruff-code-quality.mjs",
    togglable: true,
    defaultEnabled: false,
    requiresConfirmDialog: false,
    // Above the script's internal 60s analyzer timeout so the hook's own
    // timeout/config diagnostics print before the runner kills the wrapper.
    timeoutSec: 90,
    deliveryContract: GRUFF_DELIVERY_CONTRACT,
    providerEvidence: {
      claude: {
        identity: "hook-provider-adapter.v1:claude:post-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      codex: {
        identity: "hook-provider-adapter.v1:codex:post-tool",
        effectiveSupportGate: "scenario-unverified",
      },
      antigravity: {
        identity: "hook-provider-adapter.v1:antigravity:post-tool",
        effectiveSupportGate: "result-undelivered",
      },
      copilot: {
        identity: "hook-provider-adapter.v1:copilot:post-tool",
        effectiveSupportGate: "scenario-unverified",
      },
    },
    unsupportedAgents: {
      antigravity:
        "Antigravity PostToolUse can run a command but cannot deliver Gruff feedback to the active model.",
    },
  },
  {
    id: "post-turn-safety",
    displayName: "Post-turn safety guard",
    description:
      "Scan changed content after an agent turn for built-in safety hazards such as obvious secrets, private keys, and merge conflict markers.",
    event: "Stop",
    matcher: "",
    scriptFiles: [
      ...NATIVE_LAUNCH_RUNTIME_FILES,
      "post-turn-safety.mjs",
      "post-turn/assignments.mjs",
      "post-turn/context.mjs",
      "post-turn/controller.mjs",
      "post-turn/recovery.mjs",
      "post-turn/scanner.mjs",
    ],
    primaryScript: "post-turn-safety.mjs",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: false,
    // Allow the script's 60s scan budget to finish and print "scan incomplete" before killing its wrapper.
    // A silent early kill would leave the user unaware that the scan covered only part of the project.
    timeoutSec: 90,
    deliveryContract: FEEDBACK_DELIVERY_CONTRACT,
    providerDeliveryContracts: {
      codex: CODEX_POST_TURN_DELIVERY_CONTRACT,
    },
    providerEvidence: {
      claude: {
        identity: "hook-provider-adapter.v1:claude:turn-stop",
        effectiveSupportGate: "scenario-unverified",
      },
      codex: {
        identity: "hook-provider-adapter.v1:codex:turn-stop",
        effectiveSupportGate: "scenario-unverified",
      },
      antigravity: {
        identity: "hook-provider-adapter.v1:antigravity:turn-stop",
        effectiveSupportGate: "provider-capture-absent",
      },
      copilot: {
        identity: "hook-provider-adapter.v1:copilot:turn-stop",
        effectiveSupportGate: "provider-capture-absent",
      },
    },
    unsupportedAgents: {
      copilot:
        "Copilot agentStop delivery is unverified and has no current Goat Flow registration adapter.",
      antigravity:
        "Antigravity Stop-hook delivery is unverified: hook trust gates execution and no Stop payload was captured firing.",
    },
  },
];

const HOOKS_BY_IDENTIFIER = new Map(HOOKS.map((hook) => [hook.id, hook]));

/**
 * Read the reviewed provider support gate without imposing a calendar deadline.
 * Use when setup, audit, or the dashboard reads one provider support gate.
 *
 * @param providerEvidence - registry proof for the provider and event under review
 * @returns the explicit support gate; elapsed time never upgrades or invalidates provider proof
 */
export function currentHookProviderSupportGate(
  providerEvidence: HookProviderRegistryEvidence,
): HookEffectiveState["status"] {
  return providerEvidence.effectiveSupportGate;
}

/**
 * List hook definitions without exposing the canonical array to UI sorting.
 * Use when setup or the dashboard needs every user-visible hook.
 *
 * @returns Hook definitions; never empty while Goat Flow ships managed hooks.
 */
export function listHookSpecs(): HookSpec[] {
  return [...HOOKS];
}

/**
 * Find one hook definition for a route, toggle, or setup request.
 * Use when unknown UI identifiers need a normal not-found result.
 *
 * @param hookIdentifier - requested id; empty or unknown text has no hook
 * @returns Matching hook, or null when the user selected an unknown id
 */
export function getHookSpec(hookIdentifier: string): HookSpec | null {
  // A missing match lets the UI show not found without turning user input into an exception.
  return HOOKS_BY_IDENTIFIER.get(hookIdentifier) ?? null;
}

/**
 * Check whether a hook id is safe for URLs and managed file keys.
 * Use before a user-supplied id reaches routing or storage.
 *
 * @param hookIdentifier - requested id; empty text is invalid
 * @returns True for lowercase kebab ids; false for empty or path-shaped text
 */
export function isValidHookIdShape(hookIdentifier: string): boolean {
  // Empty or path-shaped text cannot safely become a route or managed filename.
  return /^[a-z0-9][a-z0-9-]*$/u.test(hookIdentifier);
}
