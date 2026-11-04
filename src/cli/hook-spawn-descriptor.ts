/** Selects local hook replay commands without loading registration writers or audit owners. */
import type {
  AgentHookHandlerDescriptor,
  AgentHookSpawnDescriptor,
} from "./server/agent-hook-command.js";

/**
 * Choose the process that replays a registered hook when the user runs `goat-flow hooks verify` on this platform.
 * A Windows override wins; Antigravity uses its provider shell from .agents, and other native commands become Node argv.
 *
 * @param descriptor - Registered handler whose current-platform command is selected.
 * @param platform - Host platform used for selection; defaults to the running Node process.
 * @returns Executable, arguments, optional project-relative cwd, verbatim-argument setting and environment additions.
 * @throws when native replay names installed Bash operands or a noncanonical command.
 */
export function agentHookSpawnDescriptor(
  descriptor: AgentHookHandlerDescriptor,
  platform: NodeJS.Platform = process.platform,
): AgentHookSpawnDescriptor {
  // Claude's exec registration is already literal argv and needs no intermediate shell.
  if (descriptor.form === "argv") {
    return nativeArgvReplay(descriptor);
  }
  // A registered Windows override keeps precedence for native and legacy replays.
  if (platform === "win32" && descriptor.commandWindows !== undefined) {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        descriptor.commandWindows,
      ],
    };
  }
  if (
    descriptor.command.startsWith(
      "node ../.goat-flow/hooks/antigravity-hook-bootstrap.cjs ",
    )
  ) {
    return antigravityShellReplay(descriptor.command, platform);
  }
  const nativeReplay = descriptor.command.includes("run-hook.mjs")
    ? nativeShellReplay(descriptor.command)
    : null;
  if (nativeReplay !== null) return nativeReplay;
  // Windows argv conversion can strip nested quotes; environment transport preserves source and leaves stdin for the event.
  if (platform === "win32") {
    // This executes the selected trusted handler for local verification; provider delivery still needs its own capture.
    // If a caller drops env, the replay fails with a named error instead of running nothing and reporting a passing hook.
    return {
      command: "bash",
      args: [
        "--noprofile",
        "--norc",
        "-c",
        'eval "${GOAT_FLOW_HOOK_REPLAY_COMMAND:?hook replay command missing}"',
      ],
      env: { GOAT_FLOW_HOOK_REPLAY_COMMAND: descriptor.command },
    };
  }
  return { command: "bash", args: ["-c", descriptor.command] };
}

/** Keep Claude's literal argv and validate managed launcher operands without replaying its inert shell routes. */
function nativeArgvReplay(
  descriptor: Extract<AgentHookHandlerDescriptor, { form: "argv" }>,
): AgentHookSpawnDescriptor {
  if (descriptor.args[6]?.endsWith("/run-hook.mjs"))
    assertNativeOperands(descriptor.args, descriptor.command);
  return { command: descriptor.command, args: [...descriptor.args] };
}

/** Replay the managed-file command through Antigravity's shell; reject altered operands before launch. */
function antigravityShellReplay(
  command: string,
  platform: NodeJS.Platform,
): AgentHookSpawnDescriptor {
  const operands = command.split(" ");
  if (
    operands.length !== 7 ||
    operands.some((operand) => !/^[A-Za-z0-9._/-]+$/u.test(operand)) ||
    !operands[2]?.endsWith(".mjs") ||
    operands[3] !== "antigravity" ||
    operands[4] !== "CLAUDE_PROJECT_DIR" ||
    operands[5] !== ".agents/hooks.json" ||
    operands[6] !== ".goat-flow/hooks/run-hook.mjs"
  )
    throw new Error(
      "Antigravity replay requires the canonical managed-file command",
    );
  // Go quotes this whitespace-containing argument once; there are no embedded quotes to escape.
  return platform === "win32"
    ? {
        command: "cmd.exe",
        args: ["/c", `"${command}"`],
        cwd: ".agents",
        windowsVerbatimArguments: true,
      }
    : { command: "sh", args: ["-c", command], cwd: ".agents" };
}

/** Validate native registration operands; throws instead of replaying a Bash entrypoint. */
function assertNativeOperands(args: string[], executable: string): void {
  if (
    executable !== "node" ||
    args.length !== 7 ||
    !args[2]?.endsWith(".mjs") ||
    !args[6]?.replaceAll("\\", "/").endsWith("/run-hook.mjs")
  ) {
    throw new Error(
      "native candidate replay requires native hook and launcher operands",
    );
  }
}

/** Decode the writer's JSON-quoted Node command into literal argv; throws on other shapes or non-native operands. */
function nativeShellReplay(commandText: string): AgentHookSpawnDescriptor {
  const scanBudgetPrefix = "GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES=4194304 ";
  const hasScanBudget = commandText.startsWith(scanBudgetPrefix);
  const command = hasScanBudget
    ? commandText.slice(scanBudgetPrefix.length)
    : commandText;
  const operands = command.match(/"(?:\\.|[^"\\])*"/gu) ?? [];
  if (
    operands.length !== 6 ||
    command !== ["node", "-e", ...operands].join(" ")
  ) {
    throw new Error(
      "native candidate replay requires the canonical Node command",
    );
  }
  const args = [
    "-e",
    ...operands.map((operand) => JSON.parse(operand) as string),
  ];
  assertNativeOperands(args, "node");
  return hasScanBudget
    ? {
        command: "node",
        args,
        env: { GOAT_FLOW_POST_TURN_SAFETY_MAX_BYTES: "4194304" },
      }
    : { command: "node", args };
}
