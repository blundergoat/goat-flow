/**
 * Locks the `--untrusted-target` audit flag. The deny-mechanism runtime smoke
 * executes the target checkout's own hook code (the configured launcher string
 * and the managed deny script), so `--untrusted-target` downgrades it to static
 * checks for a checkout you don't trust. `handleAuditCommand` maps
 * `untrustedTarget` to the "static" vs default (runtime) deny-mechanism evidence
 * level; the default audit is unchanged, so the flag must parse and default off.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCLIArgs } from "../../src/cli/cli.js";

describe("audit --untrusted-target flag", () => {
  it("defaults off so an ordinary audit keeps its runtime deny proof", () => {
    assert.equal(parseCLIArgs(["audit", "."]).untrustedTarget, false);
  });

  it("turns on to skip executing an untrusted checkout's hook code", () => {
    assert.equal(
      parseCLIArgs(["audit", ".", "--untrusted-target"]).untrustedTarget,
      true,
    );
  });
});
