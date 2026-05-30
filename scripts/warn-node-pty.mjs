// Skip in CI - node-pty is intentionally absent in CI environments
if (process.env.CI) process.exit(0);

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const userAgent = process.env.npm_config_user_agent ?? "";
const isPnpmInstall = userAgent.includes("pnpm/");

/** Probe optional node-pty availability without making installation fail. */
function hasNodePty() {
  try {
    require("node-pty");
    return true;
  } catch {
    return false;
  }
}

if (!hasNodePty()) {
  console.log(
    "Warning: node-pty failed to compile. Dashboard terminal will not work.",
  );
  console.log("  Install C++ build tools, then: npm rebuild node-pty");
  if (isPnpmInstall) {
    console.log("  pnpm: pnpm approve-builds (select node-pty)");
  }
}
