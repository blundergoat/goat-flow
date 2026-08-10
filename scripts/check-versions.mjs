#!/usr/bin/env node
/**
 * Verifies every shipped skill, reference, hook runtime, and manifest identity.
 * Use before packaging so users never install a release whose visible version
 * disagrees with the detector or adapter bytes that will run in their project.
 * Called by `npm run check-versions` and the publish gate.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;

const templates = [
  "workflow/skills/goat/SKILL.md",
  "workflow/skills/goat-debug/SKILL.md",
  "workflow/skills/goat-plan/SKILL.md",
  "workflow/skills/goat-review/SKILL.md",
  "workflow/skills/goat-critique/SKILL.md",
  "workflow/skills/goat-security/SKILL.md",
  "workflow/skills/goat-qa/SKILL.md",
];

/**
 * Collect Markdown files recursively for the version report users see before release.
 * @param {string} dir - source folder; missing or empty paths contribute no files
 * @param {string[]} out - accumulated paths; empty starts a fresh traversal
 * @returns {string[]} discovered Markdown paths; empty means the folder had none
 */
function walkMarkdown(dir, out = []) {
  // A missing optional source folder contributes no release-version mismatch.
  if (!existsSync(dir)) return out;
  // Every direct child is classified before nested references are added to the report.
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    // Nested reference packs stay part of the same user-visible release identity.
    if (stat.isDirectory()) {
      walkMarkdown(path, out);
      // Markdown files carry the frontmatter version users receive in installed mirrors.
    } else if (path.endsWith(".md")) {
      out.push(path);
    }
  }
  return out;
}

const referenceTemplates = [
  ...walkMarkdown("workflow/skills/reference"),
  ...walkMarkdown("workflow/skills/playbooks"),
  ...walkMarkdown("workflow/skills").filter((path) =>
    path.includes("/references/"),
  ),
];
const hookRuntimeTemplates = readdirSync("workflow/hooks")
  .filter(
    (runtimeName) =>
      runtimeName.endsWith(".sh") || runtimeName.endsWith(".mjs"),
  )
  .map((runtimeName) => join("workflow/hooks", runtimeName));

let allVersionsMatch = true;
// Each skill entry point must advertise the package version users requested.
for (const f of templates) {
  const content = readFileSync(f, "utf8");
  // A stale skill version would make installed guidance disagree with the CLI release.
  if (!content.includes(`goat-flow-skill-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${f} does not contain goat-flow-skill-version: "${version}"`,
    );
    allVersionsMatch = false;
  }
}

// Shared and per-skill references must advertise the same release as their entry point.
for (const f of referenceTemplates) {
  const content = readFileSync(f, "utf8");
  // A stale reference version makes mirror drift look current to the user.
  if (!content.includes(`goat-flow-reference-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${f} does not contain goat-flow-reference-version: "${version}"`,
    );
    allVersionsMatch = false;
  }
}

// Every executable hook and Node support module must name the release that shipped its bytes.
for (const hookRuntimeTemplate of hookRuntimeTemplates) {
  const hookRuntimeContent = readFileSync(hookRuntimeTemplate, "utf8");
  // A stale hook stamp prevents setup and diagnostics from identifying current runtime behavior.
  if (!hookRuntimeContent.includes(`goat-flow-hook-version: ${version}`)) {
    console.error(
      `Version mismatch: ${hookRuntimeTemplate} does not contain goat-flow-hook-version: ${version}`,
    );
    allVersionsMatch = false;
  }
}

const manifest = JSON.parse(readFileSync("workflow/manifest.json", "utf8"));
// The manifest is the setup source of truth, so its package identity must never lag.
if (manifest.version !== version) {
  console.error(
    `Version mismatch: workflow/manifest.json is ${String(manifest.version)} instead of ${version}`,
  );
  allVersionsMatch = false;
}

// Any mismatch blocks the package rather than letting users install mixed release bytes.
if (!allVersionsMatch) {
  console.error(
    `\nFix: update goat-flow-skill-version / goat-flow-reference-version in the files above to "${version}"`,
  );
  process.exit(1);
}
console.log(
  `All skill, reference, hook, and manifest versions match ${version}`,
);
