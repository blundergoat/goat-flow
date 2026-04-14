/**
 * Interactive CLI menu helper for explicit opt-in flows.
 * Uses Node's built-in readline — no external dependencies.
 */
import { createInterface, type Interface as RLInterface } from "node:readline";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import type { ParsedCLI } from "./cli.js";
import type { AgentId } from "./types.js";
import { getPackageVersion } from "./paths.js";

const VERSION = getPackageVersion();

const AGENT_FILES: { id: AgentId; file: string }[] = [
  { id: "claude", file: "CLAUDE.md" },
  { id: "codex", file: "AGENTS.md" },
  { id: "gemini", file: "GEMINI.md" },
];

const ALL_AGENTS: AgentId[] = ["claude", "codex", "gemini"];

interface MenuChoice {
  command: ParsedCLI["command"];
  quality: boolean;
  agentMode: "none" | "optional" | "required";
  cliLabel: string;
}

const CHOICES: MenuChoice[] = [
  { command: "audit", quality: false, agentMode: "none", cliLabel: "audit" },
  {
    command: "audit",
    quality: true,
    agentMode: "optional",
    cliLabel: "audit --harness",
  },
  { command: "status", quality: false, agentMode: "none", cliLabel: "status" },
  {
    command: "dashboard",
    quality: false,
    agentMode: "none",
    cliLabel: "dashboard",
  },
  {
    command: "setup",
    quality: false,
    agentMode: "optional",
    cliLabel: "setup",
  },
  {
    command: "critique",
    quality: false,
    agentMode: "required",
    cliLabel: "critique",
  },
];

// --- Helpers ----------------------------------------------------------------

function detectAgents(projectPath: string): AgentId[] {
  return AGENT_FILES.filter((a) =>
    existsSync(resolve(projectPath, a.file)),
  ).map((a) => a.id);
}

function ask(rl: RLInterface, question: string): Promise<string> {
  return new Promise((res, rej) => {
    rl.question(question, res);
    rl.once("close", () => rej(new Error("cancelled")));
  });
}

function dim(s: string): string {
  return `\x1b[2m${s}\x1b[0m`;
}
function bold(s: string): string {
  return `\x1b[1m${s}\x1b[0m`;
}

// --- Prompts ----------------------------------------------------------------

async function selectCommand(rl: RLInterface): Promise<MenuChoice> {
  console.log(`\n  ${bold(`goat-flow v${VERSION}`)}\n`);

  console.log(`  ${bold("Project")}`);
  console.log(`    1  audit             Validate setup correctness`);
  console.log(
    `    2  audit --harness   AI harness checks ${dim("(advisory)")}`,
  );
  console.log(`    3  status            Show adoption state`);
  console.log(`    4  dashboard         Launch browser dashboard`);
  console.log(`\n  ${bold("Agent")}`);
  console.log(`    5  setup             Generate setup prompt`);
  console.log(`    6  critique          Quality assessment prompt`);
  console.log("");

  while (true) {
    const input = (await ask(rl, "  Select (1-6): ")).trim();
    const idx = parseInt(input, 10) - 1;
    if (idx >= 0 && idx < CHOICES.length) return CHOICES[idx]!;
    console.log(`  ${dim("Enter a number 1-6")}`);
  }
}

async function selectAgent(
  rl: RLInterface,
  detected: AgentId[],
  required: boolean,
): Promise<AgentId | null> {
  const available = detected.length > 0 ? detected : ALL_AGENTS;
  const showAll = !required;

  if (detected.length > 0) {
    console.log(`\n  Detected agents: ${bold(detected.join(", "))}`);
  } else {
    console.log(`\n  ${dim("No agents detected — showing all options")}`);
  }
  console.log("");

  let i = 1;
  if (showAll) {
    console.log(`    ${i}  ${dim("all detected")}`);
    i++;
  }
  for (const id of available) {
    console.log(`    ${i}  ${id}`);
    i++;
  }
  console.log("");

  const max = available.length + (showAll ? 1 : 0);
  while (true) {
    const input = (await ask(rl, `  Select agent (1-${max}): `)).trim();
    const idx = parseInt(input, 10);
    if (idx >= 1 && idx <= max) {
      if (showAll && idx === 1) return null;
      const agentIdx = showAll ? idx - 2 : idx - 1;
      return available[agentIdx]!;
    }
    console.log(`  ${dim(`Enter a number 1-${max}`)}`);
  }
}

// --- Entry ------------------------------------------------------------------

/** Build the equivalent CLI string for display. */
function buildCliString(
  choice: MenuChoice,
  agent: AgentId | null,
): string {
  let cmd = `goat-flow ${choice.cliLabel} .`;
  if (agent) cmd += ` --agent ${agent}`;
  return cmd;
}

/**
 * Show an interactive menu and return a fully resolved ParsedCLI.
 * Empty argv still follows the normal `audit` default path in `cli.ts`.
 */
export async function showMenu(): Promise<ParsedCLI> {
  const projectPath = resolve(".");
  const detected = detectAgents(projectPath);

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  // Ctrl+C during menu → clean exit
  rl.on("SIGINT", () => {
    rl.close();
    console.log("");
    process.exit(0);
  });

  try {
    const choice = await selectCommand(rl);

    let agent: AgentId | null = null;
    if (choice.agentMode !== "none") {
      agent = await selectAgent(
        rl,
        detected,
        choice.agentMode === "required",
      );
    }

    console.log(`\n  ${dim("→")} ${dim(buildCliString(choice, agent))}\n`);

    return {
      command: choice.command,
      projectPath,
      format: "text" as const,
      agent,
      verbose: false,
      output: null,
      quality: choice.quality,
      dev: false,
      help: false,
      version: false,
    };
  } finally {
    rl.close();
  }
}
