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

const COMMIT_GUIDE_FILES = [
  "docs/coding-standards/git-commit-message.md",
  "workflow/setup/reference/git-commit-message.md",
];

// A newline-only budget can hide several independent rules in one unreadable physical line.
const MAX_INSTRUCTION_LINE_CHARACTERS = 800;

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

const SHARED_PHRASES = JSON.parse(
  readFileSync(resolve(ROOT, "workflow/manifest.json"), "utf8"),
).instruction_file.parity_phrases;

/** Render a repository-relative path for deterministic failure messages. */
function pathLabel(path) {
  return relative(ROOT, resolve(ROOT, path)) || path;
}

/** Record byte drift between repository mirrors while allowing fixtures that omit both files. */
function validateByteParity(files, label, failures) {
  const existingFiles = files.filter((file) => existsSync(resolve(ROOT, file)));
  if (existingFiles.length === 0) return;
  if (existingFiles.length !== files.length) {
    for (const file of files) {
      if (!existsSync(resolve(ROOT, file))) {
        failures.push(`${pathLabel(file)}: missing ${label} mirror`);
      }
    }
    return;
  }

  const [reference, ...mirrors] = files;
  const referenceBytes = readFileSync(resolve(ROOT, reference));
  for (const mirror of mirrors) {
    const mirrorBytes = readFileSync(resolve(ROOT, mirror));
    if (mirrorBytes.equals(referenceBytes)) continue;
    failures.push(
      `${pathLabel(mirror)}: ${label} drifted from ${pathLabel(reference)}`,
    );
  }
}

/** Escape a package version before matching its exact CHANGELOG heading. */
function escapeRegExp(literalText) {
  return literalText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Read the current package release date for live-header validation.
 * Package read or parse failures are recorded and recover to null; CHANGELOG read failures propagate.
 */
function readReleaseMetadata(failures) {
  let version;
  try {
    version = JSON.parse(
      readFileSync(resolve(ROOT, "package.json"), "utf8"),
    ).version;
  } catch (error) {
    failures.push(
      `package.json: cannot read current version (${error.message})`,
    );
    return null;
  }
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    failures.push("package.json: current version is not stable semver");
    return null;
  }

  const changelog = readFileSync(resolve(ROOT, "CHANGELOG.md"), "utf8");
  const headingPattern = new RegExp(
    `^## v${escapeRegExp(version)} - (\\d{4}-\\d{2}-\\d{2})$`,
    "gm",
  );
  const matches = Array.from(changelog.matchAll(headingPattern));
  if (matches.length !== 1) {
    failures.push(
      `CHANGELOG.md: expected exactly one release heading for v${version}, found ${matches.length}`,
    );
    return null;
  }
  return { version, date: matches[0][1] };
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

/** Validate shared H2/H3 and phrase contracts for one instruction file, mutating the failure report. */
function validateInstructionFile(
  file,
  failures,
  setupLoopBodies,
  releaseMetadata,
) {
  const abs = resolve(ROOT, file);
  const label = pathLabel(file);
  if (!existsSync(abs)) {
    failures.push(`${label}: file does not exist`);
    return;
  }

  const content = readFileSync(abs, "utf8");
  content.split("\n").forEach((line, lineIndex) => {
    if (line.length <= MAX_INSTRUCTION_LINE_CHARACTERS) return;
    failures.push(
      `${label}:${lineIndex + 1}: instruction line has ${line.length} characters; limit ${MAX_INSTRUCTION_LINE_CHARACTERS}`,
    );
  });
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
    validateSetupInstructionFile(
      label,
      executionLoop,
      essentialCommands,
      routerTable,
      failures,
      setupLoopBodies,
    );
    return;
  }

  validateLiveInstructionFile(
    label,
    content,
    essentialCommands,
    routerTable,
    releaseMetadata,
    failures,
  );
}

/** Mutate setup-guide parity state because setup files share generic commands and loop bodies. */
function validateSetupInstructionFile(
  label,
  executionLoop,
  essentialCommands,
  routerTable,
  failures,
  setupLoopBodies,
) {
  setupLoopBodies.push({ label, body: normalizeSharedLoop(executionLoop) });
  requirePhrases(
    label,
    "Essential Commands",
    essentialCommands,
    ["<lint command>", "<typecheck command>", "<test command>"],
    "generic setup Essential Commands",
    failures,
  );
  if (/workflow\/(setup|hooks)|workflow\/manifest\.json/.test(routerTable)) {
    failures.push(
      `${label}: Router Table must describe installed project resources, not workflow setup internals`,
    );
  }
}

/** Validate live instruction files because they must not retain setup placeholders. */
function validateLiveInstructionFile(
  label,
  content,
  essentialCommands,
  routerTable,
  releaseMetadata,
  failures,
) {
  if (releaseMetadata) {
    const firstLine = content.split("\n", 1)[0] ?? "";
    const expectedSuffix = ` - v${releaseMetadata.version} (${releaseMetadata.date})`;
    if (!firstLine.endsWith(expectedSuffix)) {
      failures.push(
        `${label}: header must end with ${JSON.stringify(expectedSuffix)}, got ${JSON.stringify(firstLine)}`,
      );
    }
  }
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
  if (
    !content.includes(
      "except explicitly labelled placeholder scenarios in shipped skills, skill references, and playbooks",
    )
  ) {
    failures.push(
      `${label}: real-evidence rule must carry the architecture-approved placeholder-scenario exception for shipped skills, skill references, and playbooks`,
    );
  }
}

/** Describe the first shared-loop difference for deterministic failure output. */
function sharedLoopDriftDetail(referenceBody, entryBody) {
  const refLines = referenceBody.split("\n");
  const entryLines = entryBody.split("\n");
  const diffAt = entryLines.findIndex((line, idx) => line !== refLines[idx]);
  if (diffAt === -1) return "trailing content differs";
  return `first diff at shared-loop line ${diffAt + 1}: ${JSON.stringify(refLines[diffAt] ?? "<missing>")} vs ${JSON.stringify(entryLines[diffAt] ?? "<missing>")}`;
}

/** Mutate the failure report when setup-guide shared Execution Loop bodies drift. */
function validateSharedSetupLoopBodies(setupLoopBodies, failures) {
  if (setupLoopBodies.length <= 1) return;
  const [reference, ...rest] = setupLoopBodies;
  for (const entry of rest) {
    if (entry.body === reference.body) continue;
    failures.push(
      `${entry.label}: shared Execution Loop body drifted from ${reference.label} (${sharedLoopDriftDetail(reference.body, entry.body)})`,
    );
  }
}

/** Write the complete failure report to stderr and exits non-zero when parity failed. */
function exitOnInstructionParityFailures(failures) {
  if (failures.length === 0) return;
  console.error("Instruction parity failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

/** Validate shared instruction contracts because parity errors need a complete mismatch list before it exits. */
function validateInstructionParity() {
  const failures = [];
  const setupLoopBodies = [];
  const releaseMetadata = readReleaseMetadata(failures);

  validateByteParity(COMMIT_GUIDE_FILES, "commit guide", failures);

  for (const file of ALL_FILES) {
    validateInstructionFile(file, failures, setupLoopBodies, releaseMetadata);
  }

  validateSharedSetupLoopBodies(setupLoopBodies, failures);
  exitOnInstructionParityFailures(failures);

  console.log(
    `Instruction parity passed: ${ALL_FILES.length} files share the required contract`,
  );
}

validateInstructionParity();
