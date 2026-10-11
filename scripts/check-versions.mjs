#!/usr/bin/env node
/**
 * Check that every shipped skill, reference doc and hook runtime, plus the manifest, carries the package.json version.
 *
 * Run it after scripts/bump-version.sh; CI and the publish gate also run it through `npm run check-versions`.
 * A mismatch means users could install a release whose version stamps disagree with the code that runs in their project.
 *
 * Only canonical sources under workflow/ are read; installed mirrors are not checked here.
 * Each mismatch prints one line and the script exits 1; otherwise it prints a single success line.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;

// Canonical skill entry points; a new skill must be listed here as well as in the manifest, or its stamp goes unchecked.
const skillTemplates = [
  "workflow/skills/goat/SKILL.md",
  "workflow/skills/goat-debug/SKILL.md",
  "workflow/skills/goat-plan/SKILL.md",
  "workflow/skills/goat-review/SKILL.md",
  "workflow/skills/goat-critique/SKILL.md",
  "workflow/skills/goat-security/SKILL.md",
  "workflow/skills/goat-qa/SKILL.md",
  "workflow/skills/goat-clarity/SKILL.md",
];

/**
 * Collect every Markdown file under one folder, including subfolders, so each can be checked for its reference stamp.
 * @param {string} dir - source folder; missing or empty paths contribute no files
 * @param {string[]} out - accumulated paths; empty starts a fresh traversal
 * @returns {string[]} discovered Markdown paths; empty means the folder had none
 */
function walkMarkdown(dir, out = []) {
  // A missing optional source folder contributes no release-version mismatch.
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    // Per-skill reference packs sit in subfolders, so walk them into the same list.
    if (stat.isDirectory()) {
      walkMarkdown(path, out);
      // Only Markdown files carry the goat-flow-reference-version frontmatter this script checks.
    } else if (path.endsWith(".md")) {
      out.push(path);
    }
  }
  return out;
}

// Shared references, playbooks and per-skill reference packs all carry goat-flow-reference-version frontmatter.
const referenceTemplates = [
  ...walkMarkdown("workflow/skills/reference"),
  ...walkMarkdown("workflow/skills/playbooks"),
  ...walkMarkdown("workflow/skills").filter((path) =>
    path.includes("/references/"),
  ),
];
// Every top-level .sh and .mjs hook runtime must carry the stamp, so a new runtime added without one fails here.
const hookRuntimeTemplates = readdirSync("workflow/hooks")
  .filter(
    (runtimeName) =>
      runtimeName.endsWith(".sh") || runtimeName.endsWith(".mjs"),
  )
  .map((runtimeName) => join("workflow/hooks", runtimeName));
// Nested modules such as deny-dangerous/guard-runtime.sh opt in by carrying the stamp, which the audit compares on install.
const nestedStampedHookTemplates = readdirSync("workflow/hooks", {
  recursive: true,
})
  // Top-level files are already covered by the list above.
  .filter((relativePath) => dirname(relativePath) !== ".")
  .map((relativePath) => join("workflow/hooks", relativePath))
  .filter(
    (path) =>
      statSync(path).isFile() &&
      readFileSync(path, "utf8").includes("goat-flow-hook-version:"),
  );

let isVersionSetConsistent = true;
// Each skill entry point must advertise the package version users requested.
for (const skillTemplate of skillTemplates) {
  const content = readFileSync(skillTemplate, "utf8");
  // A stale skill version would make installed guidance disagree with the CLI release.
  if (!content.includes(`goat-flow-skill-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${skillTemplate} does not contain goat-flow-skill-version: "${version}"`,
    );
    isVersionSetConsistent = false;
  }
}

// Every shared reference, playbook and reference pack must advertise the same release as the skills.
for (const referenceTemplate of referenceTemplates) {
  const content = readFileSync(referenceTemplate, "utf8");
  // A stale stamp ships to every install, and the audit rejects an installed playbook whose stamp lags the CLI.
  if (!content.includes(`goat-flow-reference-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${referenceTemplate} does not contain goat-flow-reference-version: "${version}"`,
    );
    isVersionSetConsistent = false;
  }
}

// Each top-level .sh/.mjs runtime and each stamped nested module must name the release that shipped its bytes.
for (const hookRuntimeTemplate of [
  ...hookRuntimeTemplates,
  ...nestedStampedHookTemplates,
]) {
  const hookRuntimeContent = readFileSync(hookRuntimeTemplate, "utf8");
  // A stale hook stamp prevents setup and diagnostics from identifying current runtime behavior.
  if (!hookRuntimeContent.includes(`goat-flow-hook-version: ${version}`)) {
    console.error(
      `Version mismatch: ${hookRuntimeTemplate} does not contain goat-flow-hook-version: ${version}`,
    );
    isVersionSetConsistent = false;
  }
}

const manifest = JSON.parse(readFileSync("workflow/manifest.json", "utf8"));
// Setup reads the manifest as its source of truth, so its version must match package.json.
if (manifest.version !== version) {
  console.error(
    `Version mismatch: workflow/manifest.json is ${String(manifest.version)} instead of ${version}`,
  );
  isVersionSetConsistent = false;
}

// Any mismatch blocks the package rather than letting users install mixed release bytes.
if (!isVersionSetConsistent) {
  console.error(
    `\nFix: in each file above, add or correct the named version so it reads ${version}.`,
  );
  process.exit(1);
}
console.log(
  `All skill, reference, hook, and manifest versions match ${version}`,
);
