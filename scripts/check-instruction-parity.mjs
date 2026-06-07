#!/usr/bin/env node
/**
 * Deterministic parity guard for goat-flow instruction contracts.
 *
 * This is not a raw diff. Agent files are allowed to differ on owned paths,
 * runtime quirks, and target-project commands. The shared contract below is
 * the part that must stay aligned across setup guides and live hot-path files.
 */
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";

const ROOT = process.cwd();

const SETUP_FILES = [
  "workflow/setup/agents/claude.md",
  "workflow/setup/agents/codex.md",
  "workflow/setup/agents/copilot.md",
  "workflow/setup/agents/antigravity.md",
];

const LIVE_FILES = [
  "CLAUDE.md",
  "AGENTS.md",
  ".github/copilot-instructions.md",
];

const ALL_FILES = [...SETUP_FILES, ...LIVE_FILES];

const CANONICAL_SECTIONS = [
  "Truth Order",
  "Autonomy Tiers",
  "Hard Rules",
  "Commit Messages",
  "Key Resources",
  "Essential Commands",
  "Execution Loop",
  "Definition of Done",
  "Artifact Routing",
  "Router Table",
];

const H3_LOOP_SECTIONS = ["READ", "SCOPE", "ACT", "VERIFY"];

const SHARED_PHRASES = [
  {
    label: "learning-loop Key Resources",
    section: "Key Resources",
    phrases: [
      ".goat-flow/learning-loop/footguns/",
      ".goat-flow/learning-loop/lessons/",
      ".goat-flow/learning-loop/patterns/",
      ".goat-flow/learning-loop/decisions/",
    ],
  },
  {
    label: "tool-playbook Key Resources",
    section: "Key Resources",
    phrases: [
      ".goat-flow/skill-docs/playbooks/browser-use.md",
      ".goat-flow/skill-docs/playbooks/page-capture.md",
      "read BEFORE declaring a tool unavailable",
    ],
  },
  {
    label: "tool availability READ rule",
    section: "Execution Loop",
    phrases: [
      "Before declaring any tool or capability unavailable",
      ".goat-flow/skill-docs/playbooks/",
      "Availability Check",
    ],
  },
  {
    label: "hallucination red flags",
    section: "Execution Loop",
    phrases: [
      "Hallucination red-flags",
      "Checks passed.",
      "Completion.",
      "Fix verification.",
      "Hedged claims.",
      "Stop-the-line",
    ],
  },
  {
    label: "artifact routing destinations",
    section: "Artifact Routing",
    phrases: [
      ".goat-flow/learning-loop/footguns/",
      ".goat-flow/learning-loop/lessons/",
      ".goat-flow/learning-loop/decisions/",
      ".goat-flow/learning-loop/patterns/",
    ],
  },
  {
    label: "router table cold-path resources",
    section: "Router Table",
    phrases: [
      ".goat-flow/skill-docs/",
      ".goat-flow/skill-docs/playbooks/",
      ".goat-flow/learning-loop/footguns/",
      ".goat-flow/learning-loop/lessons/",
      ".goat-flow/learning-loop/patterns/",
      ".goat-flow/learning-loop/decisions/",
    ],
  },
];

/** Render a repository-relative path for deterministic failure messages. */
function pathLabel(path) {
  return relative(ROOT, resolve(ROOT, path)) || path;
}

/** Normalize headings that include explanatory suffixes before parity comparison. */
function normalizeHeading(text) {
  const trimmed = text.trim();
  if (/^Execution Loop\b/i.test(trimmed)) return "Execution Loop";
  return trimmed;
}

/** Extract normalized H2 section names in document order. */
function h2Sections(content) {
  return Array.from(content.matchAll(/^##\s+(.+)$/gm), (m) =>
    normalizeHeading(m[1] ?? ""),
  );
}

/** Extract H3 section names in document order from one section body. */
function h3Sections(content) {
  return Array.from(content.matchAll(/^###\s+(.+)$/gm), (m) =>
    (m[1] ?? "").trim(),
  );
}

/** Split a markdown document into H2-keyed section bodies for targeted phrase checks. */
function splitSections(content) {
  const matches = Array.from(content.matchAll(/^##\s+(.+)$/gm));
  const sections = new Map();
  for (let i = 0; i < matches.length; i++) {
    const match = matches[i];
    const next = matches[i + 1];
    if (match.index === undefined) continue;
    const start = match.index;
    const end = next?.index ?? content.length;
    sections.set(normalizeHeading(match[1] ?? ""), content.slice(start, end));
  }
  return sections;
}

/** Record one ordered-array parity failure without throwing so all files report in one run. */
function assertEqualArray(actual, expected, path, label, failures) {
  if (
    actual.length !== expected.length ||
    actual.some((value, index) => value !== expected[index])
  ) {
    failures.push(
      `${path}: ${label} mismatch. Expected [${expected.join(" > ")}], got [${actual.join(" > ")}]`,
    );
  }
}

/** Record missing required contract phrases for a specific file section. */
function requirePhrases(path, sectionName, section, phrases, label, failures) {
  for (const phrase of phrases) {
    if (!section.includes(phrase)) {
      failures.push(
        `${path}: ${label} missing ${JSON.stringify(phrase)} in ${sectionName}`,
      );
    }
  }
}

/** Strip the single per-agent ACT line so the shared Execution Loop body can be compared byte-for-byte across setup guides. */
function normalizeSharedLoop(executionLoopBody) {
  return executionLoopBody
    .split("\n")
    .filter((line) => !/^For .+ setup, ACT means/.test(line))
    .join("\n");
}

/** Validate shared instruction contracts because parity errors need a complete mismatch list before it exits. */
function validateInstructionParity() {
  const failures = [];
  const setupLoopBodies = [];

  for (const file of ALL_FILES) {
    const abs = resolve(ROOT, file);
    const label = pathLabel(file);
    if (!existsSync(abs)) {
      failures.push(`${label}: file does not exist`);
      continue;
    }

    const content = readFileSync(abs, "utf8");
    const sections = h2Sections(content);
    const sectionBodies = splitSections(content);

    assertEqualArray(
      sections,
      CANONICAL_SECTIONS,
      label,
      "canonical H2 order",
      failures,
    );

    if (sections.at(-1) !== "Router Table") {
      failures.push(`${label}: Router Table must be the final H2 section`);
    }

    const executionLoop = sectionBodies.get("Execution Loop") ?? "";
    const executionLoopHeadings = h3Sections(executionLoop);
    assertEqualArray(
      executionLoopHeadings.slice(0, H3_LOOP_SECTIONS.length),
      H3_LOOP_SECTIONS,
      label,
      "Execution Loop H3 order",
      failures,
    );

    for (const rule of SHARED_PHRASES) {
      const section = sectionBodies.get(rule.section) ?? "";
      requirePhrases(
        label,
        rule.section,
        section,
        rule.phrases,
        rule.label,
        failures,
      );
    }

    const essentialCommands = sectionBodies.get("Essential Commands") ?? "";
    const routerTable = sectionBodies.get("Router Table") ?? "";

    if (SETUP_FILES.includes(file)) {
      setupLoopBodies.push({ label, body: normalizeSharedLoop(executionLoop) });
      requirePhrases(
        label,
        "Essential Commands",
        essentialCommands,
        ["<lint command>", "<typecheck command>", "<test command>"],
        "generic setup Essential Commands",
        failures,
      );
      if (
        /workflow\/(setup|hooks)|workflow\/manifest\.json/.test(routerTable)
      ) {
        failures.push(
          `${label}: Router Table must describe installed project resources, not workflow setup internals`,
        );
      }
    } else {
      if (/<(?:lint|typecheck|test) command>/.test(essentialCommands)) {
        failures.push(
          `${label}: live Essential Commands still contains setup placeholders`,
        );
      }
      if (!routerTable.includes("Peer instructions")) {
        failures.push(
          `${label}: Router Table must include peer instruction routing`,
        );
      }
    }
  }

  // Shared Execution Loop body must stay byte-identical across setup guides (minus the per-agent ACT line),
  // so a reworded red-flag or a dropped rule in one guide cannot pass parity while the other three go stale.
  if (setupLoopBodies.length > 1) {
    const [reference, ...rest] = setupLoopBodies;
    for (const entry of rest) {
      if (entry.body === reference.body) continue;
      const refLines = reference.body.split("\n");
      const entryLines = entry.body.split("\n");
      const diffAt = entryLines.findIndex(
        (line, idx) => line !== refLines[idx],
      );
      const detail =
        diffAt === -1
          ? "trailing content differs"
          : `first diff at shared-loop line ${diffAt + 1}: ${JSON.stringify(refLines[diffAt] ?? "<missing>")} vs ${JSON.stringify(entryLines[diffAt] ?? "<missing>")}`;
      failures.push(
        `${entry.label}: shared Execution Loop body drifted from ${reference.label} (${detail})`,
      );
    }
  }

  if (failures.length > 0) {
    console.error("Instruction parity failed:");
    for (const failure of failures) console.error(`- ${failure}`);
    process.exit(1);
  }

  console.log(
    `Instruction parity passed: ${ALL_FILES.length} files share the required contract`,
  );
}

validateInstructionParity();
