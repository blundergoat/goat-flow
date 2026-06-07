/**
 * Registry of goat-flow-shipped hook scripts.
 *
 * The registry is the dashboard/CLI authority for togglable hooks. The
 * manifest remains the authority for which agents have hook support.
 */
import type { AgentId } from "../types.js";

type HookEvent = "PreToolUse" | "PostToolUse";

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
    matcher: "Edit|Write|MultiEdit",
    scriptFiles: ["gruff-code-quality.sh"],
    primaryScript: "gruff-code-quality.sh",
    togglable: true,
    defaultEnabled: false,
    requiresConfirmDialog: false,
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
