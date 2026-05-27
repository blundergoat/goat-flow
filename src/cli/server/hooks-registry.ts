/**
 * Registry of goat-flow-shipped hook scripts.
 *
 * The registry is the dashboard/CLI authority for togglable hooks. The
 * manifest remains the authority for which agents have hook support.
 */
import type { AgentId } from "../types.js";

type HookEvent = "PreToolUse" | "PostToolUse";

export interface HookSpec {
  id: string;
  displayName: string;
  description: string;
  event: HookEvent;
  matcher: string;
  scriptFiles: string[];
  primaryScript: string;
  togglable: boolean;
  defaultEnabled: boolean;
  requiresConfirmDialog: boolean;
  unsupportedAgents?: Partial<Record<AgentId, string>>;
}

const HOOKS: HookSpec[] = [
  {
    id: "guard-destructive-shell",
    displayName: "Guard destructive shell",
    description:
      "Block risky shell operations such as recursive deletion, chmod 777, pipe-to-shell, file truncation, destructive database commands, and opaque shell execution.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["guard-common.sh", "guard-destructive-shell.sh"],
    primaryScript: "guard-destructive-shell.sh",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: true,
  },
  {
    id: "guard-secret-paths",
    displayName: "Guard secret paths",
    description:
      "Block Bash access to .env files, SSH/AWS/GCP credentials, key material, package credentials, and other common secret paths.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["guard-common.sh", "guard-secret-paths.sh"],
    primaryScript: "guard-secret-paths.sh",
    togglable: true,
    defaultEnabled: true,
    requiresConfirmDialog: true,
  },
  {
    id: "guard-repository-writes",
    displayName: "Guard repository writes",
    description:
      "Block agent-side git commits, git pushes, destructive git flags, and GitHub write operations through gh.",
    event: "PreToolUse",
    matcher: "Bash",
    scriptFiles: ["guard-common.sh", "guard-repository-writes.sh"],
    primaryScript: "guard-repository-writes.sh",
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

const HOOKS_BY_ID = new Map(HOOKS.map((hook) => [hook.id, hook]));

export function listHookSpecs(): HookSpec[] {
  return [...HOOKS];
}

export function getHookSpec(hookId: string): HookSpec | null {
  return HOOKS_BY_ID.get(hookId) ?? null;
}

export function isValidHookIdShape(hookId: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/u.test(hookId);
}
