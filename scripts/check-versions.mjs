#!/usr/bin/env node
/**
 * Verify workflow skill and reference templates have the same version as package.json.
 * Run: node scripts/check-versions.mjs
 * Called by: npm run check-versions (and prepublishOnly)
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

/** Collect markdown files recursively so version checks cover nested docs and playbooks. */
function walkMarkdown(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      walkMarkdown(path, out);
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

let ok = true;
for (const f of templates) {
  const content = readFileSync(f, "utf8");
  if (!content.includes(`goat-flow-skill-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${f} does not contain goat-flow-skill-version: "${version}"`,
    );
    ok = false;
  }
}

for (const f of referenceTemplates) {
  const content = readFileSync(f, "utf8");
  if (!content.includes(`goat-flow-reference-version: "${version}"`)) {
    console.error(
      `Version mismatch: ${f} does not contain goat-flow-reference-version: "${version}"`,
    );
    ok = false;
  }
}

if (!ok) {
  console.error(
    `\nFix: update goat-flow-skill-version / goat-flow-reference-version in the files above to "${version}"`,
  );
  process.exit(1);
}
console.log(`All template and reference versions match ${version}`);
