import { cpSync, mkdirSync, rmSync } from "node:fs";

mkdirSync("dist/dashboard", { recursive: true });

for (const file of ["index.html", "styles.css", "preset-prompts.json"]) {
  cpSync(`src/dashboard/${file}`, `dist/dashboard/${file}`);
}

rmSync("dist/dashboard/views", { recursive: true, force: true });
cpSync("src/dashboard/views", "dist/dashboard/views", { recursive: true });

const vendorAssets = [
  ["node_modules/@xterm/xterm/css/xterm.css", "dist/dashboard/xterm.css"],
  ["node_modules/@xterm/xterm/lib/xterm.js", "dist/dashboard/xterm.js"],
  [
    "node_modules/@xterm/addon-fit/lib/addon-fit.js",
    "dist/dashboard/addon-fit.js",
  ],
];

for (const [from, to] of vendorAssets) {
  cpSync(from, to);
}
