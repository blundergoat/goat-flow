/**
 * Copies dashboard static assets into the package dist directory during builds.
 *
 * This is what makes `goat-flow dashboard` work from an npm install: the HTML
 * shell, styles, preset catalog, view templates, and pinned vendor scripts a
 * user's browser loads all ship inside dist/dashboard rather than being
 * fetched from a CDN at runtime.
 */
import { cpSync, mkdirSync, rmSync } from "node:fs";

mkdirSync("dist/dashboard", { recursive: true });

// Shell files the browser requests directly (page, styles, preset catalog).
for (const file of ["index.html", "styles.css", "preset-prompts.json"]) {
  cpSync(`src/dashboard/${file}`, `dist/dashboard/${file}`);
}

// Replace the whole views tree so deleted templates never linger in dist.
rmSync("dist/dashboard/views", { recursive: true, force: true });
cpSync("src/dashboard/views", "dist/dashboard/views", { recursive: true });

// Vendored browser scripts, pinned via package.json and served from /assets/
// so the dashboard (a local shell-capable page) never loads remote code.
const vendorAssets = [
  ["node_modules/@xterm/xterm/css/xterm.css", "dist/dashboard/xterm.css"],
  ["node_modules/@xterm/xterm/lib/xterm.js", "dist/dashboard/xterm.js"],
  [
    "node_modules/@xterm/addon-fit/lib/addon-fit.js",
    "dist/dashboard/addon-fit.js",
  ],
  // Alpine powers every x-data/x-show binding in the shell; Tailwind's
  // browser JIT compiles the utility classes at page load. Both used to load
  // from jsdelivr - vendored in 1.13.0/M02 so the dashboard works offline and
  // never executes remote code. (Build-time Tailwind compile stays deferred.)
  ["node_modules/alpinejs/dist/cdn.min.js", "dist/dashboard/alpine.js"],
  [
    "node_modules/@tailwindcss/browser/dist/index.global.js",
    "dist/dashboard/tailwind.js",
  ],
];

// Copy each vendor file into dist so packaged installs are self-contained.
for (const [from, to] of vendorAssets) {
  cpSync(from, to);
}
