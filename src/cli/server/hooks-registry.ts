/**
 * Registry of goat-flow-shipped hook scripts.
 *
 * The registry is the dashboard/CLI authority for togglable hooks. The
 * manifest remains the authority for which agents have hook support.
 */
import type { AgentId } from "../types.js";

type HookEvent = "PreToolUse" | "PostToolUse" | "Stop";

/** Static manifest for one shipped hook and how agents register it. */
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
  unsupportedAgents?: Partial<Record<AgentId, string>>;
}

const HOOKS: HookSpec[] = [
  {
    id: "deny-dangerous",
    displayName: "Deny dangerous hook",
    description:
      "Block risky shell operations, direct secret-path access, repository writes, and GitHub write operations through one PreToolUse dispatcher.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["deny-dangerous.sh"],
    primaryScript: "deny-dangerous.sh",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: true,
  },
  {
    id: "gruff-code-quality",
    displayName: "gruff code quality",
    description:
      "Run gruff-* on each edited file and surface findings on changed lines inline.",
    event: "PostToolUse",
    matcher: "Edit|Write",
    scriptFiles: ["gruff-code-quality.sh"],
    primaryScript: "gruff-code-quality.sh",
    togglable: true,
    defaultEnabled: false,
    requiresConfirmDialog: false,
    // Above the script's internal 60s analyzer timeout so the hook's own
    // timeout/config diagnostics print before the runner kills the wrapper.
    timeoutSec: 90,
  },
  {
    id: "post-turn-safety",
    displayName: "Post-turn safety guard",
    description:
      "Scan changed content after an agent turn for built-in safety hazards such as obvious secrets, private keys, and merge conflict markers.",
    event: "Stop",
    matcher: "",
    scriptFiles: ["post-turn-safety.sh"],
    primaryScript: "post-turn-safety.sh",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: false,
    timeoutSec: 60,
    unsupportedAgents: {
      copilot: "Copilot has no project-local post-turn hook event.",
    },
  },
  {
    id: "plan-checkbox-guard",
    displayName: "Plan checkbox guard",
    description:
      "Remind agents to update the active milestone plan when repository changes move while open checkboxes remain untouched.",
    event: "Stop",
    matcher: "",
    scriptFiles: ["plan-checkbox-guard.sh"],
    primaryScript: "plan-checkbox-guard.sh",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: false,
    timeoutSec: 15,
    // Per the M02b Stop-payload spike (2026-06-13): only Claude delivered a
    // verified payload (session_id/transcript_path/cwd/stop_hook_active).
    // Codex and Antigravity Stop delivery is unverified, and a blocking guard
    // without a proven stop_hook_active loop guard risks turn-end loops, so
    // they are gated off until a verified capture supersedes this (ADR-038).
    unsupportedAgents: {
      copilot: "Copilot has no project-local post-turn hook event.",
      codex:
        "Codex Stop-hook delivery is unverified: registered .codex/hooks.json Stop hooks did not fire under codex exec 0.139.0.",
      antigravity:
        "Antigravity Stop payload is unverified: hook trust gates execution and no stop_hook_active loop guard was observed.",
    },
  },
];

const HOOKS_BY_IDENTIFIER = new Map(HOOKS.map((hook) => [hook.id, hook]));

// Returns a defensive copy so callers may sort or filter without mutating the
// canonical registry that getHookSpec / readAllHookStates read from.
export function listHookSpecs(): HookSpec[] {
  return [...HOOKS];
}

// Returns null (rather than throwing) for an unknown id so callers can treat a
// missing hook as a 404-style branch instead of an exception path.
export function getHookSpec(hookIdentifier: string): HookSpec | null {
  return HOOKS_BY_IDENTIFIER.get(hookIdentifier) ?? null;
}

// Guards an id before it is used as a filesystem-safe key and URL segment:
// lowercase-kebab only, so it can never escape a directory or need encoding.
export function isValidHookIdShape(hookIdentifier: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(hookIdentifier);
}
