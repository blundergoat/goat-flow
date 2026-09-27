/**
 * Covers the upgrade path that silently dropped an enabled safety hook.
 * A non-Git workspace cannot satisfy the post-turn scan-root contract, and the installer used to
 * skip that registration without saying so, leaving the user unaware their Stop hook was gone.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { makeTempProject, runInstaller } from "./setup-install.helpers.js";

describe("non-Git install hook reporting", () => {
  it("names the blocked post-turn registration and its fix", () => {
    const projectRoot = makeTempProject();
    mkdirSync(join(projectRoot, ".goat-flow"), { recursive: true });
    writeFileSync(
      join(projectRoot, ".goat-flow", "config.yaml"),
      "hooks:\n  post-turn-safety: true\n",
    );

    const installed = runInstaller(projectRoot, "--agent", "claude");

    // The installer still succeeds; the user simply learns which hook it could not register.
    assert.equal(installed.status, 0, installed.stderr || installed.stdout);
    assert.match(
      installed.stderr,
      /post-turn-safety not registered: A non-Git workspace requires explicit post-turn scan roots\./u,
    );
    assert.match(
      installed.stderr,
      /fix: Configure valid scan roots or disable this hook before registering it\./u,
    );
  });
});
