#!/usr/bin/env node
/**
 * Verify workflow/skills templates have the same version as package.json.
 * Run: node scripts/check-versions.mjs
 * Called by: npm run check-versions (and prepublishOnly)
 */
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const version = pkg.version;

const templates = [
  "workflow/skills/goat/SKILL.md",
  "workflow/skills/goat-debug/SKILL.md",
  "workflow/skills/goat-plan/SKILL.md",
  "workflow/skills/goat-review/SKILL.md",
  "workflow/skills/goat-sbao/SKILL.md",
  "workflow/skills/goat-security/SKILL.md",
  "workflow/skills/goat-test/SKILL.md",
];

let ok = true;
for (const f of templates) {
  const content = readFileSync(f, "utf8");
  if (!content.includes(version)) {
    console.error(`Version mismatch: ${f} does not contain ${version}`);
    ok = false;
  }
}

if (!ok) {
  console.error(
    `\nFix: update goat-flow-skill-version in the files above to "${version}"`,
  );
  process.exit(1);
}
console.log(`All template versions match ${version}`);
