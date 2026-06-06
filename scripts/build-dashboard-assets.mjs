/**
 * Copies dashboard static assets into the package dist directory during builds.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";

mkdirSync("dist/dashboard", { recursive: true });

for (const file of ["index.html", "styles.css", "preset-prompts.json"]) {
  cpSync(`src/dashboard/${file}`, `dist/dashboard/${file}`);
}

cpSync(
  "test/fixtures/reviews/security-target-goat-flow.json",
  "dist/dashboard/review-security-fixture.json",
);

rmSync("dist/dashboard/views", { recursive: true, force: true });
cpSync("src/dashboard/views", "dist/dashboard/views", { recursive: true });

const vendorAssets = [
  ["node_modules/@xterm/xterm/css/xterm.css", "dist/dashboard/xterm.css"],
  ["node_modules/@xterm/xterm/lib/xterm.js", "dist/dashboard/xterm.js"],
  [
    "node_modules/@xterm/addon-fit/lib/addon-fit.js",
    "dist/dashboard/addon-fit.js",
  ],
  [
    "node_modules/markdown-it/dist/markdown-it.min.js",
    "dist/dashboard/markdown-it.js",
  ],
  ["node_modules/js-yaml/dist/js-yaml.min.js", "dist/dashboard/js-yaml.js"],
];

for (const [from, to] of vendorAssets) {
  cpSync(from, to);
}
